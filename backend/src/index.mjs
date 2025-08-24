import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createWriteStream, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';
import pLimit from 'p-limit';
import { fetch } from 'undici';

import { extractPatentTokens, slugCandidatesForToken } from './util.mjs';
import { resolvePdfUrl } from './pdfResolver.mjs';

const app = express();
app.use(express.json({ limit: '1mb' }));

const allowOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: allowOrigin }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'backend', time: new Date().toISOString() });
});

/**
 * POST /api/bundle
 * body: { text: string }
 * Returns: application/zip (PDFs + manifest.csv)
 */
app.post('/api/bundle', async (req, res) => {
  try {
    const text = String(req.body?.text || '');
    const tokens = extractPatentTokens(text);
    if (!tokens.length) {
      return res.status(400).json({ error: 'No patent identifiers found.' });
    }

    const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS || 25000);
    const concurrency = Math.max(1, Number(process.env.FETCH_CONCURRENCY || 3));
    const limiter = pLimit(concurrency);

    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'pfv5-'));

    const jobs = tokens.map(token =>
      limiter(async () => {
        const slugs = slugCandidatesForToken(token);
        let pdfUrl = null;

        for (const slug of slugs) {
          pdfUrl = await resolvePdfUrl(slug, timeoutMs);
          if (pdfUrl) break;
        }

        if (!pdfUrl) {
          return { token, ok: false, reason: 'PDF not found on Google Patents' };
        }

        const fileBase = slugs[0].replace(/^US/, 'US_');
        const outPath = path.join(tmp, `${fileBase}.pdf`);
        const resPdf = await fetch(pdfUrl, { redirect: 'follow' });

        if (!resPdf.ok || !resPdf.body) {
          return { token, ok: false, reason: `download failed (${resPdf.status})` };
        }

        const ws = createWriteStream(outPath);
        await pipeline(resPdf.body, ws);

        return { token, ok: true, path: outPath, name: path.basename(outPath) };
      })
    );

    const results = await Promise.all(jobs);
    const successes = results.filter(r => r.ok);
    const failures = results.filter(r => !r.ok);

    if (!successes.length) {
      return res.status(404).json({ error: 'No PDFs could be resolved.', details: failures });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="patent_bundle_${Date.now()}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('warning', err => console.warn('zip warning', err));
    archive.on('error', err => {
      console.error('zip error', err);
      res.destroy(err);
    });

    archive.pipe(res);

    for (const f of successes) {
      archive.file(f.path, { name: f.name });
    }

    const manifest =
      'input_token,status,filename_or_reason\n' +
      results
        .map(r => (r.ok ? `${r.token},OK,${r.name}` : `${r.token},FAIL,${r.reason.replace(/[\r\n,]+/g, ' ')}`))
        .join('\n');

    archive.append(manifest, { name: 'manifest.csv' });

    await archive.finalize();

    setTimeout(async () => {
      try {
        await Promise.all(successes.map(s => fsp.unlink(s.path).catch(() => {})));
        // Remove tmp directory if empty
        try { await fsp.rmdir(path.dirname(successes[0].path)); } catch {}
      } catch {}
    }, 15000);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
