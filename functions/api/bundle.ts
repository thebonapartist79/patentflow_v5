const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: cors });
}

export async function onRequestPost({ request }: { request: Request }) {
  try {
    const { text } = await request.json();

    const blob = new Blob([`You sent: ${text}`], { type: 'text/plain' });
    const headers = {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="patent_bundle.txt"',
      ...cors,
    };
    return new Response(blob, { headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
