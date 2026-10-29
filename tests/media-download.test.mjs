import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: ['src/lib/gallery/mediaDownload.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { fetchMediaBlob, shouldOpenDownloadFallback } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('an HTTP error is reported instead of saved or opened in a new tab', async () => {
  const error = await fetchMediaBlob('https://cdn/expired', async () => new Response('{"error":"InvalidJWT"}', { status: 400 })).catch(error => error);
  assert.equal(error.message, 'Download failed (400). Reload the gallery and try again.');
  assert.equal(shouldOpenDownloadFallback(error), false);
});

test('a working download returns the file, and request failures keep the new-tab fallback', async () => {
  const blob = await fetchMediaBlob('https://cdn/a', async () => new Response(new Blob(['png'], { type: 'image/png' })));
  assert.deepEqual([blob.type, blob.size], ['image/png', 3]);
  const networkError = await fetchMediaBlob('https://cdn/a', async () => { throw new TypeError('Failed to fetch'); }).catch(error => error);
  assert.equal(shouldOpenDownloadFallback(networkError), true);
  // Decoding or canvas failures while converting to JPEG also keep the fallback.
  assert.equal(shouldOpenDownloadFallback(new Error('Canvas context failed')), true);
});
