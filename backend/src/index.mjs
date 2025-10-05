import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createWriteStream, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import archiver from 'archiver';
import pLimit from 'p-limit';
import { fetch } from 'undici';
import { randomUUID } from 'crypto';

import { extractPatentTokens, slugCandidatesForToken } from './util.mjs';
import { resolvePdfUrl } from './pdfResolver.mjs';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// --- CORS allowlist (supports multiple origins via FRONTEND_ORIGINS, or single FRONTEND_ORIGIN) ---
const allowedOrigins = (() => {
  const list =
    (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  return new Set(list);
})();

app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin/no Origin (curl, server-to-server) and any explicitly listed origins
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    }
  })
);

// --- tiny in-memory rate limiter (per-IP, fixed window) ---
const rlStore = new Map(); // ip -> { count, reset }
const RL_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RL_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
function rateLimiter(req, res, next) {
  const ip =
    req.ip ||
    req.headers['x-forwarded-for'] ||
    req.connection?.remoteAddress ||
    'unknown';
  const now = Date.now();
  let entry = rlStore.get(ip);
  if (!entry || now >= entry.reset) {
    entry = { count: 0, reset: now + RL_WINDOW_MS };
    rlStore.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RL_MAX) {
    const retryAfter = Math.ceil((entry.reset - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMIT' });
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'backend', time: new Date().toISOString() });
});

/**
 * POST /api/bundle
 * body: { text: string }
 * Returns: application/zip (PDFs + manifest.csv)
 */
app.post('/api/bundle', rateLimiter, async (req, res) => {
  const reqId = (req.headers['x-request-id'] || randomUUID()).toString();
  res.setHeader('X-Request-Id', reqId);
  res.setHeader('Cache-Control', 'no-store');

  const log = (...args) => console.log(`[${reqId}]`, ...args);

  // CSV quoting helper
  const csv = v => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  try {
    const text = String(req.body?.text || '');
    const allTokens = extractPatentTokens(text);
    if (!allTokens.length) {
      return res.status(400).json({ error: 'No patent identifiers found.', code: 'NO_TOKENS' });
    }

    // Cap tokens to keep service predictable/polite
    const MAX_TOKENS = Math.max(1, Number(process.env.MAX_TOKENS_PER_REQUEST || 100));
    const tokens = allTokens.slice(0, MAX_TOKENS);
    const truncated = allTokens.length > tokens.length;

    const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS || 25000);
    const concurrency = Math.max(1, Number(process.env.FETCH_CONCURRENCY || 3));
    const limiter = pLimit(concurrency);

    const tmpRoot = await fsp.mkdtemp(path.join(tmpdir(), 'pfv5-'));

    // Download a URL to a file with streaming (convert undici's Web stream to Node stream)
    async function fetchPdfToFile(url, outPath) {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok || !r.body) {
        return { ok: false, code: 'DOWNLOAD_FAIL', reason: `download failed (${r.status})` };
      }
      const ws = createWriteStream(outPath);
      const nodeReadable = Readable.fromWeb(r.body);
      await pipeline(nodeReadable, ws);
      return { ok: true };
    }

    const jobs = tokens.map(token =>
      limiter(async () => {
        const slugs = slugCandidatesForToken(token); // preserves jurisdiction when present
        let pdfUrl = null;
        let usedSlug = null;

        for (const slug of slugs) {
          pdfUrl = await resolvePdfUrl(slug, timeoutMs);
          if (pdfUrl) {
            usedSlug = slug;
            break;
          }
        }

        if (!pdfUrl) {
          return { token, ok: false, code: 'RESOLVE_FAIL', reason: 'no PDF link found on Google Patents' };
        }

        // Sanitize filename
        const safeBase = usedSlug.replace(/[^0-9A-Z]/gi, '_');
        const outPath = path.join(tmpRoot, `${safeBase}.pdf`);

        const dl = await fetchPdfToFile(pdfUrl, outPath);
        if (!dl.ok) {
          return { token, ok: false, code: dl.code, reason: dl.reason };
        }

        return { token, ok: true, name: path.basename(outPath), path: outPath };
      })
    );

    const results = await Promise.all(jobs);
    const successes = results.filter(r => r.ok);
    const failures = results.filter(r => !r.ok);

    log(
      `Finished: ${results.length} total (${successes.length} OK, ${failures.length} FAIL)${
        truncated ? `; truncated to ${tokens.length} tokens` : ''
      }`
    );

    if (!successes.length) {
      // cleanup the empty temp dir
      await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      return res.status(404).json({ error: 'No PDFs could be resolved.', code: 'NO_PDFS', details: failures });
    }

    // Build ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="patent_bundle_${Date.now()}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const cleanupOnce = (() => {
      let done = false;
      return async () => {
        if (done) return;
        done = true;
        try {
          await fsp.rm(tmpRoot, { recursive: true, force: true });
        } catch {}
      };
    })();

    archive.on('warning', err => log('zip warning:', err?.message || err));
    archive.on('error', async err => {
      log('zip error:', err?.message || err);
      await cleanupOnce();
      res.destroy(err);
    });

    res.on('close', cleanupOnce);
    res.on('error', cleanupOnce);
    archive.on('close', cleanupOnce);

    archive.pipe(res);

    for (const f of successes) {
      archive.file(f.path, { name: f.name });
    }

    // Manifest with reason codes
    const manifestLines = [];
    manifestLines.push('input_token,status,code,filename_or_reason');
    for (const r of results) {
      if (r.ok) {
        manifestLines.push([csv(r.token), 'OK', 'OK', csv(r.name)].join(','));
      } else {
        manifestLines.push([csv(r.token), 'FAIL', csv(r.code || 'FAIL'), csv(r.reason || 'unknown')].join(','));
      }
    }
    if (truncated) {
      manifestLines.push([csv('[notice]'), 'INFO', 'TRUNCATED', csv(`Processed first ${tokens.length} of ${allTokens.length} tokens`)].join(','));
    }
    archive.append(manifestLines.join('\n'), { name: 'manifest.csv' });

    archive.finalize(); // cleanup happens on 'close'
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error', code: 'INTERNAL' });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
