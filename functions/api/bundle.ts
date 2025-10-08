// functions/api/bundle.ts
import JSZip from "jszip";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

// --- Token parsing → slugs (US/EP/WO… + optional kind code), adapted from your util.mjs ---
const KNOWN_JURS = new Set(["US","EP","WO","JP","KR","CN","CA","AU","DE","GB","ES","FR","RU","IN","BR","MX","TW"]);
const KIND_FALLBACKS: Record<string, string[]> = {
  US: ["B2","B1","A1"],
  EP: ["B1","A1"],
  WO: ["A1"],
  JP: ["B2","A"],
  CN: ["B","A"],
  KR: ["B1","A"],
  CA: ["C","A1"],
  AU: ["B2","A1"],
  DEFAULT: ["B2","B1","A1"],
};
function extractTokens(raw: string): string[] {
  if (!raw) return [];
  const norm = String(raw).replace(/\r\n?/g, "\n").replace(/[,\-\/]+/g, " ").toUpperCase();
  const pieces = norm.split(/[^0-9A-Z]+/g).filter(Boolean).filter(p => /[0-9]/.test(p) && p.length >= 5);
  const seen = new Set<string>(); const out: string[] = [];
  for (const p of pieces) { if (!seen.has(p)) { seen.add(p); out.push(p); } }
  return out;
}
function slugCandidatesForToken(token: string): string[] {
  let cleaned = token.replace(/[^0-9A-Z]/gi, "").toUpperCase();
  let jur = "US";
  for (const code of KNOWN_JURS) {
    if (cleaned.startsWith(code)) { jur = code; cleaned = cleaned.slice(code.length); break; }
  }
  let kind: string | null = null;
  const m = cleaned.match(/(A\d|B\d|S\d|E\d|H\d|P\d)$/i);
  if (m) { kind = m[1].toUpperCase(); cleaned = cleaned.slice(0, -kind.length); }
  const digits = cleaned.replace(/[^0-9]/g, "");
  if (!digits) return [`${jur}${token.replace(/[^0-9A-Z]/gi, "").toUpperCase()}`];

  const fallbacks = (KIND_FALLBACKS[jur] ?? KIND_FALLBACKS.DEFAULT);
  const slugs = new Set<string>();
  if (kind) slugs.add(`${jur}${digits}${kind}`);
  slugs.add(`${jur}${digits}`);
  for (const k of fallbacks) if (k !== kind) slugs.add(`${jur}${digits}${k}`);
  return Array.from(slugs);
}

// --- HTML → PDF resolver (Cloudflare fetch; UA + tolerant regexes), adapted from your pdfResolver.mjs ---
const SANE_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

async function fetchHtmlWithRetry(url: string, timeoutMs: number, tries = 2): Promise<string | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: ctrl.signal,
          headers: {
            "user-agent": SANE_UA,
            "accept": "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
          },
        });
        if (!r.ok) {
          if (r.status === 429 || (r.status >= 500 && r.status <= 599)) {
            await new Promise(res => setTimeout(res, 300 + i * 300));
            continue;
          }
          return null;
        }
        return await r.text();
      } catch (_) {
        if (i === tries - 1) throw _;
        await new Promise(res => setTimeout(res, 250 + i * 250));
      }
    }
    return null;
  } finally {
    clearTimeout(to);
  }
}

async function resolvePdfUrl(slug: string, timeoutMs = 25000): Promise<string | null> {
  const url = `https://patents.google.com/patent/${encodeURIComponent(slug)}/en`;
  const html = await fetchHtmlWithRetry(url, timeoutMs, 2);
  if (!html) return null;

  const patterns = [
    /href\s*=\s*"(https:\/\/patentimages\.storage\.googleapis\.com\/[^"]+\.pdf)"/i,
    /'(https:\/\/patentimages\.storage\.googleapis\.com\/[^']+\.pdf)'/i,
    /https:\/\/patentimages\.storage\.googleapis\.com\/[^\s"'<>]+\.pdf/i,
  ];
  for (const rx of patterns) {
    const m = html.match(rx);
    if (m?.[1]) return m[1].replace(/&amp;/g, "&");
    if (m?.[0]) return m[0].replace(/&amp;/g, "&");
  }
  return null;
}

// --- Main handler: resolve each token to a signed PDF URL, fetch, and zip ---
type Body = { patents?: string[]; text?: string };

export async function onRequestPost({ request }: { request: Request }) {
  try {
    const { patents = [], text = "" } = (await request.json().catch(() => ({}))) as Body;
    const tokens = Array.isArray(patents) && patents.length ? patents : extractTokens(text);
    const list = tokens.slice(0, 10); // keep ≤10 to avoid worker timeouts

    const zip = new JSZip();
    zip.file("README.txt", `Generated: ${new Date().toISOString()}\nCount: ${list.length}\n`);

    if (!list.length) {
      const empty = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
      return new Response(empty, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="patent_bundle_empty.zip"`,
          ...CORS,
        },
      });
    }

    for (const token of list) {
      let pdfUrl: string | null = null;
      let usedSlug: string | null = null;

      for (const slug of slugCandidatesForToken(token)) {
        pdfUrl = await resolvePdfUrl(slug, 25000);
        if (pdfUrl) { usedSlug = slug; break; }
      }

      if (!pdfUrl) {
        zip.file(`${token}.txt`, `Could not resolve a PDF link from Google Patents HTML for any slug variant.`);
        continue;
      }

      // Fetch the real PDF (use UA + accept to avoid 403s)
      const r = await fetch(pdfUrl, {
        headers: {
          "user-agent": SANE_UA,
          "accept": "application/pdf",
          "referer": "https://patents.google.com/",
        },
        redirect: "follow",
      });

      if (!r.ok) {
        zip.file(`${token}.txt`, `Failed to fetch PDF (${r.status} ${r.statusText})\nURL: ${pdfUrl}`);
        continue;
      }

      const bytes = new Uint8Array(await r.arrayBuffer());
      const safeBase = (usedSlug ?? token).replace(/[^0-9A-Z]/gi, "_");
      zip.file(`${safeBase}.pdf`, bytes);
    }

    const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new Response(out, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="patent_bundle_${Date.now()}.zip"`,
        "Cache-Control": "no-store",
        ...CORS,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}
