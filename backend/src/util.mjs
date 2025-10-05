// Known jurisdictions we’ll preserve when present; default to US otherwise
const KNOWN_JURS = new Set([
  'US', 'EP', 'WO', 'JP', 'KR', 'CN', 'CA', 'AU',
  'DE', 'GB', 'ES', 'FR', 'RU', 'IN', 'BR', 'MX', 'TW'
]);

// Heuristic kind-code fallbacks by jurisdiction (not exhaustive)
const KIND_FALLBACKS = {
  US: ['B2', 'B1', 'A1'],
  EP: ['B1', 'A1'],
  WO: ['A1'],
  JP: ['B2', 'A'],
  CN: ['B', 'A'],
  KR: ['B1', 'A'],
  CA: ['C', 'A1'],
  AU: ['B2', 'A1'],
  DEFAULT: ['B2', 'B1', 'A1']
};

export function extractPatentTokens(text) {
  if (!text) return [];

  // Normalize line breaks; replace punctuation separators with spaces
  const normalized = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[,\-\/]+/g, ' ')
    .toUpperCase();

  // Split on non-alphanumerics; keep tokens with digits and reasonable length
  const rawPieces = normalized.split(/[^0-9A-Z]+/g).filter(Boolean);
  const pieces = rawPieces.filter(p => /[0-9]/.test(p) && p.length >= 5);

  // De-duplicate while preserving order
  const seen = new Set();
  const out = [];
  for (const p of pieces) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export function slugCandidatesForToken(token) {
  // keep only A-Z0-9, normalize case
  let cleaned = token.replace(/[^0-9A-Z]/gi, '').toUpperCase();

  // Jurisdiction detection (prefix), default to US
  let jur = 'US';
  for (const code of KNOWN_JURS) {
    if (cleaned.startsWith(code)) {
      jur = code;
      cleaned = cleaned.slice(code.length);
      break;
    }
  }

  // Extract trailing kind code if present (A1/B2/S1/E1/H1/P1 etc.)
  let kind = null;
  const kindMatch = cleaned.match(/(A\d|B\d|S\d|E\d|H\d|P\d)$/i);
  if (kindMatch) {
    kind = kindMatch[1].toUpperCase();
    cleaned = cleaned.slice(0, -kind.length);
  }

  // Remaining portion should be digits
  const digits = cleaned.replace(/[^0-9]/g, '');
  if (!digits) {
    // If somehow no digits, fall back to the uppercased token under detected jur
    return [`${jur}${token.replace(/[^0-9A-Z]/gi, '').toUpperCase()}`];
  }

  const fallbacks =
    (KIND_FALLBACKS[jur] && Array.from(KIND_FALLBACKS[jur])) ||
    Array.from(KIND_FALLBACKS.DEFAULT);

  const slugs = new Set();

  // If explicit kind present, try exact first
  if (kind) slugs.add(`${jur}${digits}${kind}`);

  // Base without kind
  slugs.add(`${jur}${digits}`);

  // Jurisdiction-appropriate fallbacks
  for (const k of fallbacks) {
    if (k !== kind) slugs.add(`${jur}${digits}${k}`);
  }

  return Array.from(slugs);
}
