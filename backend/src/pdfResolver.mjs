import { fetch } from 'undici';

/**
 * Fetch Google Patents HTML for a given slug and extract the direct PDF link
 * hosted at patentimages.storage.googleapis.com.
 *
 * @param {string} slug - e.g., "US10859001B2" or "US10859001"
 * @param {number} timeoutMs
 * @returns {Promise<string|null>} pdf URL or null if not found
 */
export async function resolvePdfUrl(slug, timeoutMs = 25000) {
  const url = `https://patents.google.com/patent/${encodeURIComponent(slug)}/en`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract direct PDF link
    const m = html.match(/https:\/\/patentimages\.storage\.googleapis\.com\/[^"]+\.pdf/);
    if (m && m[0]) return m[0];
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
