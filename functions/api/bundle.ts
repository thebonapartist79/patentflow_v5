// functions/api/bundle.ts
import JSZip from "jszip";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost() {
  // Smoke test: always add 2 files so the zip is NEVER empty
  const zip = new JSZip();
  zip.file("README.txt", `Generated: ${new Date().toISOString()}\n`);
  zip.file("hello.txt", "hi from Cloudflare Pages Functions\n");

  // Workers is happiest with Uint8Array
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="test_bundle.zip"`,
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}
