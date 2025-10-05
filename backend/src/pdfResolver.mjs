import { fetch } from 'undici';

const SANE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

// small retry helper for transient HTML fetch wobble
async function fetchHtmlWithRetry(url, timeoutMs, tries = 2) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: ctrl.signal,
          headers: {
            'user-agent': SANE_UA,
            'accept': 'text/html,application/xhtml+xml',
            'accept-language': 'en-US,en;q=0.9'
          }
        });
        if (!res.ok) {
          // retry on 429/5xx
          if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
            await new Promise(r => setTimeout(r, 300 + i * 300));
            continue;
          }
          return null;
        }
        return await res.text();
      } catch {
        if (i === tries - 1) throw new Error('fetch failed');
        await new Promise(r => setTimeout(r, 250 + i * 250));
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch Google Patents HTML for a given slug and extract the direct PDF link
 * hosted at patentimages.storage.googleapis.com.
 *
 * @param {string} slug - e.g., "US10859001B2" or "EP1234567B1"
 * @param {number} timeoutMs
 * @returns {Promise<string|null>} pdf URL or null if not found
 */
export async function resolvePdfUrl(slug, timeoutMs = 25000) {
  const url = `https://patents.google.com/patent/${encodeURIComponent(slug)}/en`;
  const html = await fetchHtmlWithRetry(url, timeoutMs, 2);
  if (!html) return null;

  // Be tolerant to minor DOM shifts
  const patterns = [
    /href\s*=\s*"(https:\/\/patentimages\.storage\.googleapis\.com\/[^"]+\.pdf)"/i,
    /'(https:\/\/patentimages\.storage\.googleapis\.com\/[^']+\.pdf)'/i,
    /https:\/\/patentimages\.storage\.googleapis\.com\/[^\s"'<>]+\.pdf/i
  ];

  for (const rx of patterns) {
    const m = html.match(rx);
    if (m && m[1]) return m[1].replace(/&amp;/g, '&');
    if (m && m[0]) return m[0].replace(/&amp;/g, '&');
  }

  return null;
}
