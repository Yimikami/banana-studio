import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Runs the exact App persistCompletedVideo, resumeVideoPolling and handleDelete source.
// The provider result is gated so the delete always lands first.
import { transformSync } from 'esbuild';
const src = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const a = src.indexOf('  const persistCompletedVideo = async');
const b = src.indexOf('  const handleRecoverVideo = ', a);
const hd = src.indexOf('  const handleDelete = async');
const he = src.indexOf('  const handleDeleteMultiple', hd);
const body = src.slice(a, b) + src.slice(hd, he);
const cls = (src.match(/class DeletedVideoError[^\n]*\n/) || [''])[0];
const code = transformSync(`${cls}module.exports = (env) => { const { setGeneratedMedia, setActiveRequests, pollVideoTask, saveVideo, deleteImage, updateVideoStatus, getImageById, assertWorkspaceSession, toast, deletedMediaIdsRef, RecoverableVideoTaskError, isRecoverableVideoTaskError, DEFAULT_VIDEO_MODEL } = env; ${body}; return { resumeVideoPolling, handleDelete }; };`, { loader: 'ts', format: 'cjs' }).code;
const run = async deleteWhen => {
  const calls = { saved: 0, deleted: [], completed: 0, toasts: [] };
  let items = [{ id: 'v1', mediaType: 'video', status: 'processing', isLoading: true }];
  let release, releaseSave;
  const env = {
    setGeneratedMedia: f => { items = typeof f === 'function' ? f(items) : f; }, setActiveRequests() {},
    pollVideoTask: () => new Promise(r => { release = () => r({ urls: ['https://provider/v.mp4'] }); }),
    saveVideo: async () => { if (deleteWhen === 'saving') await new Promise(r => { releaseSave = r; }); calls.saved++; return { publicUrl: 'https://store/v.mp4', storagePath: 'u/v1.mp4', thumbnailPath: 'u/v1.png' }; },
    deleteImage: async m => { calls.deleted.push(m.storagePath || 'default'); },
    updateVideoStatus: async (id, status) => { if (status === 'completed') calls.completed++; },
    getImageById: async () => null, assertWorkspaceSession: async () => {},
    toast: { success: t => calls.toasts.push(t), warning: t => calls.toasts.push(t), error: t => calls.toasts.push(t), dismissToast() {} },
    deletedMediaIdsRef: { current: new Set() },
    RecoverableVideoTaskError: class extends Error {}, isRecoverableVideoTaskError: () => false, DEFAULT_VIDEO_MODEL: 'm',
  };
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  const { resumeVideoPolling, handleDelete } = mod.exports(env);
  const done = resumeVideoPolling('v1', 'task1', items[0]);
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  if (deleteWhen === 'polling') await handleDelete(items[0]);
  release();
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  if (deleteWhen === 'saving') { await handleDelete({ id: 'v1', mediaType: 'video' }); releaseSave(); }
  await done;
  return { cardPresent: items.length === 1, ...calls };
};

test('a video cancelled while polling is never saved again', async () => {
  const result = await run('polling');
  assert.equal(result.saved, 0);
  assert.equal(result.completed, 0);
  assert.deepEqual(result.toasts, []);
});

test('a video deleted while it is being saved has that copy removed', async () => {
  const result = await run('saving');
  assert.ok(result.deleted.includes('u/v1.mp4'));
  assert.equal(result.completed, 0);
  assert.deepEqual(result.toasts, []);
});

test('a video that is not deleted is still saved and completed', async () => {
  const result = await run('never');
  assert.equal(result.saved, 1);
  assert.equal(result.completed, 1);
  assert.ok(result.cardPresent);
});
