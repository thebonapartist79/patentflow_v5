// backend/src/util.mjs

export function extractPatentTokens(text) {
  if (!text) return [];

  let cleanedText = String(text).replace(/\r\n?/g, '\n');

  // remove commas and hyphens INSIDE numbers
  cleanedText = cleanedText.replace(/[,-]+/g, '');

  // drop lone "US" tokens (we add it later anyway)
  cleanedText = cleanedText.replace(/\bUS\b/gi, ' ');

  // now split on whitespace / non-alphanumerics
  const pieces = cleanedText
    .split(/[^0-9A-Za-z]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const t of pieces) {
    const norm = t.toUpperCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export function slugCandidatesForToken(token) {
  const cleaned = token.replace(/\s+/g, '').toUpperCase();

  const kindMatch = cleaned.match(/([0-9]+)([AB][0-9])$/i);
  let base = cleaned;
  let kind = null;
  if (kindMatch) {
    base = kindMatch[1];
    kind = kindMatch[2].toUpperCase();
  }

  const slugs = [];
  if (kind) slugs.push(`US${base}${kind}`);
  slugs.push(`US${base}`);
  for (const k of ['B2','B1','A1']) {
    if (k !== kind) slugs.push(`US${base}${k}`);
  }
  return Array.from(new Set(slugs));
}
