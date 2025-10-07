// functions/api/bundle.ts
import JSZip from "jszip";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Handle CORS preflight requests */
export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

/** Normalize patent inputs (array or text block) */
function parsePatents(input: { patents?: string[]; text?: string }): string[] {
  if (Array.isArray(input.patents) && input.patents.length > 0) {
    return input.patents;
  }
  if (typeof input.text === "string" && input.text.trim().length > 0) {
    return input.text
      .split(/[\s,;]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Build a rough public PDF URL for a US patent */
function pdfUrlForUS(patent: string): string {
  const digits = patent.replace(/[^0-9]/g, "");
  return `https://patentimages.storage.googleapis.com/pdfs/US${digits}.pdf`;
}

/** Main POST handler */
export async function onRequestPost({ request }: { request: Request }) {
  try {
    // Parse JSON body
    const body = (await request.json().catch(() => ({}))) as {
      patents?: string[];
      text?: string;
    };

    const patents = parsePatents(body);
    const zip = new JSZip();

    // Always include a README
    zip.file(
      "README.txt",
      `Patent bundle generated on ${new Date().toISOString()}\nCount: ${patents.length}\n`
    );

    if (patents.length === 0) {
      const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
      return new Response(buf, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="patent_bundle_empty.zip"`,
          ...CORS,
        },
      });
    }

    // Fetch PDFs (limit batch size to prevent Cloudflare timeouts)
    for (const p of patents.slice(0, 10)) {
      try {
        const url = pdfUrlForUS(p);
        const res = await fetch(url);
        if (!res.ok) {
          zip.file(`${p}.txt`, `Failed to fetch PDF (${res.status} ${res.statusText})\nURL: ${url}`);
          continue;
        }

        const bytes = new Uint8Array(await res.arrayBuffer());
        zip.file(`${p}.pdf`, bytes);
      } catch (err: any) {
        zip.file(`${p}.txt`, `Error fetching ${p}: ${err?.message || String(err)}\n`);
      }
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
