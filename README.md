# Patentflow v5 (Full Working Version)

Paste patent identifiers (messy is fine) and download a ZIP of the PDFs.

## Quick Start
```bash
npm i
# If your environment blocks lifecycle scripts, run:
npm --prefix backend i && npm --prefix frontend i
npm run dev
```

- Frontend: http://localhost:5173  (Vite, proxied to backend)
- Backend:  http://localhost:8080   (Express API)

## Usage
1) Paste patent numbers/publication identifiers (commas/spaces/newlines are all fine; 'US' prefix and kind codes optional, e.g., US10859001B2, 10,859,001).
2) Click **Download Bundle** → get `patent_bundle_<timestamp>.zip` containing PDFs and a `manifest.csv` with success/fail rows.

## Configuration (.env)
```
FRONTEND_ORIGIN=http://localhost:5173
PORT=8080
FETCH_CONCURRENCY=3
FETCH_TIMEOUT_MS=25000
```

- If using Codespaces/Cloud dev URLs, set `FRONTEND_ORIGIN` to the forwarded frontend URL to avoid CORS warnings.

## Structure
```
patentflow_v5/
  package.json (root orchestrator)
  backend/
    package.json
    src/index.mjs        (API + zip streaming)
    src/util.mjs         (input parsing + slug candidates)
    src/pdfResolver.mjs  (Google Patents HTML → direct PDF URL)
  frontend/
    package.json
    vite.config.js
    index.html
    src/main.jsx
    src/App.jsx
```

## Notes for future agents
- If Google Patents changes markup, update the regex in `backend/src/pdfResolver.mjs` that extracts the `patentimages.storage.googleapis.com/*.pdf` URL.
- To add alternative resolvers, extend `resolvePdfUrl()` to try more strategies before returning `null`.
- Keep network politeness by tuning `FETCH_CONCURRENCY` and `FETCH_TIMEOUT_MS`.
