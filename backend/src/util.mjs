// Utilities for input parsing and normalization

/**
 * Extracts candidate tokens from free-form input.
 * Accepts commas, spaces, newlines, hyphens, "US" prefix, kind codes, etc.
 * Returns unique, truthy tokens preserving original order.
 */
export function extractPatentTokens(text) {
  if (!text) return [];
  // Remove 'US' prefixes to avoid duplication; we'll add US later as needed
  const raw = text
    .replace(/\bUS\b/gi, ' ')
    .split(/[^0-9A-Za-z]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const norm = t.toUpperCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/**
 * Given a raw token (e.g., "10,859,001" or "10859001" or "11162431B2"),
 * return a prioritized list of slug candidates for Google Patents paths:
 * e.g., ["US10859001B2", "US10859001", "US10859001B1", "US10859001A1"]
 */
export function slugCandidatesForToken(token) {
  const cleaned = token.replace(/[\s,.-]+/g, '').toUpperCase();

  // Detect trailing kind code (A1/A2/B1/B2 etc.)
  const kindMatch = cleaned.match(/([0-9]+)([AB][0-9])$/i);
  let base = cleaned;
  let kind = null;
  if (kindMatch) {
    base = kindMatch[1];
    kind = kindMatch[2].toUpperCase();
  }

  const slugs = [];
  if (kind) slugs.push(`US${base}${kind}`);

  // Plain (Google often redirects)
  slugs.push(`US${base}`);

  // Common kinds to try
  for (const k of ['B2','B1','A1']) {
    if (k !== kind) slugs.push(`US${base}${k}`);
  }

  return Array.from(new Set(slugs));
}
