import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: ['src/lib/gallery/batchDownload.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { collectBatchDownload, describeBatchDownloadFailure } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const media = [
  { id: 'a', url: 'https://cdn/a', mediaType: 'image' },
  { id: 'b', url: 'https://cdn/expired', mediaType: 'image' },
  { id: 'v', url: 'https://cdn/v', mediaType: 'video' },
];
const fetcher = async url => url.endsWith('expired')
  ? new Response('{"error":"InvalidJWT"}', { status: 400 })
  : new Response(new Blob(['x'], { type: url.endsWith('/v') ? 'video/mp4' : 'image/jpeg' }));

test('one failed item no longer cancels the rest of the ZIP', async () => {
  const { files, failed } = await collectBatchDownload(['a', 'b', 'v'], media, fetcher);
  assert.deepEqual(files.map(file => file.name), ['banana-a.jpg', 'banana-v.mp4']);
  assert.equal(failed, 1);
  // The error body is never packed as a media file.
  assert.ok(files.every(file => file.blob.size === 1));
});

test('items missing from the loaded list count as failed', async () => {
  const { files, failed } = await collectBatchDownload(['a', 'gone'], media, fetcher);
  assert.deepEqual([files.length, failed], [1, 1]);
  assert.deepEqual(await collectBatchDownload(['a'], media, async () => { throw new TypeError('Failed to fetch'); }).then(r => [r.files.length, r.failed]), [0, 1]);
});

test('the notice says how many items are missing', () => {
  assert.equal(describeBatchDownloadFailure(1, 3), '1 of 3 items could not be downloaded. The ZIP contains the other 2. Your selection is kept so you can try again.');
  assert.equal(describeBatchDownloadFailure(3, 3), 'None of the 3 selected items could be downloaded. Try again.');
  assert.equal(describeBatchDownloadFailure(1, 1), 'The selected item could not be downloaded. Try again.');
});
