  import { useState } from 'react';

  export default function App() {
    const [text, setText] = useState(
`10961918
11022046
11378015
10914241
10808626
11143112
11512648
10,859,001
11,162,431
10,837,370
10,823,084
10,815,901
11,098,656
11,525,408`
    );
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    async function handleDownload() {
      setBusy(true);
      setMsg('Resolving and bundling PDFs…');

      try {
        const res = await fetch('/api/bundle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setMsg(`Error: ${err.error || res.statusText}`);
          setBusy(false);
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `patent_bundle_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setMsg('Download started.');
      } catch (e) {
        setMsg(`Request failed: ${e.message}`);
      } finally {
        setBusy(false);
      }
    }

    return (
      <div style={{ maxWidth: 820, margin: '6vh auto 0', lineHeight: 1.45 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ margin: 0 }}>Patentflow v5</h1>
          <div>
            <button style={{ marginRight: 8 }}>Subscribe</button>
            <button>Invalidity Assistant</button>
          </div>
        </header>

        <p style={{ opacity: 0.8, marginTop: 8 }}>
          Paste patent numbers or publication identifiers (any separators).
        </p>

        <textarea
          rows={14}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste numbers here, one per line or comma/space-separated…"
          style={{ width: '100%', padding: 12, fontFamily: 'monospace', fontSize: 14 }}
        />

        <div style={{ marginTop: 12 }}>
          <button onClick={handleDownload} disabled={busy}>
            {busy ? 'Working…' : 'Download Bundle'}
          </button>
          <span style={{ marginLeft: 12, fontStyle: 'italic' }}>{msg}</span>
        </div>

        <details style={{ marginTop: 20 }}>
          <summary>What formats are accepted?</summary>
          <div style={{ marginTop: 10 }}>
            <ul>
              <li>Plain numbers: <code>10961918</code></li>
              <li>With commas: <code>10,859,001</code></li>
              <li>With kind code: <code>US11162431B2</code>, <code>11162431B2</code></li>
              <li>Mixed separators: commas, spaces, newlines, hyphens</li>
            </ul>
          </div>
        </details>
      </div>
    );
  }
