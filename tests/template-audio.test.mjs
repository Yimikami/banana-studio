import test from 'node:test';
import assert from 'node:assert/strict';
import { build, transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WorkspaceQuery } from '../desktop/shared/query.mjs';

const f = { user: 'user-1', rows: [], uploads: new Map(), uploadError: false, fetchHook: null };
f.client = {
  from: table => new WorkspaceQuery(async plan => {
    assert.equal(table, 'templates');
    if (plan.operation === 'upsert') { f.rows = [structuredClone(plan.value)]; return { error: null }; }
    return { data: f.rows.filter(row => plan.filters.every(filter => row[filter.column] === filter.value)), error: null };
  }, table),
  storage: { from: () => ({
    upload: async (path, blob) => { if (f.uploadError) return { error: { message: 'Storage unavailable' } }; f.uploads.set(path, blob); return { error: null }; },
    createSignedUrl: async path => ({ data: { signedUrl: `https://storage.invalid/storage/v1/object/sign/media/${path}?token=temporary` }, error: null }),
  }) },
};
globalThis.__templateAudio = f;
const compiled = await build({ stdin: { contents: "export { saveTemplate, getTemplates } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'template-audio', setup(b) {
    b.onResolve({ filter: /\/authService$|^tus-js-client$|^@supabase\/supabase-js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'tus-js-client' ? 'export class Upload {}' : args.path === '@supabase/supabase-js' ? "export const isAuthSessionMissingError = e => e?.name === 'AuthSessionMissingError';" :
      "export const supabase=globalThis.__templateAudio.client; export const getCurrentUserId=async()=>globalThis.__templateAudio.user,SUPABASE_URL='https://storage.invalid';" }));
  } }] });
const { saveTemplate, getTemplates } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function setup(t) {
  Object.assign(f, { user: 'user-1', rows: [], uploads: new Map(), uploadError: false, fetchHook: null });
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, ...args) => {
    if (String(url).startsWith('blob:')) { const result = await nativeFetch(url, ...args); await f.fetchHook?.(); return result; }
    const path = new URL(url).pathname.split('/media/')[1];
    const blob = f.uploads.get(path);
    return blob ? new Response(blob) : new Response('Missing', { status: 404 });
  });
  t.mock.method(console, 'warn', () => {});
}
const template = url => ({ id: 'template', name: 'Soundtrack', createdAt: 1,
  config: { prompt: 'A video with this soundtrack', mode: 'video', referenceImages: [], referenceAudios: [{ id: 'audio', url, name: 'sound.wav', mimeType: 'audio/wav', duration: 5 }] } });
const audio = new Blob(['RIFFsyntheticWAVEaudio'], { type: 'audio/wav' });

test('saved template audio survives revocation of the picker URL and retains its bytes', async t => {
  setup(t);
  const url = URL.createObjectURL(audio);
  t.after(() => URL.revokeObjectURL(url));
  const original = template(url);
  const saved = await saveTemplate(original);
  URL.revokeObjectURL(url);
  const [loaded] = await getTemplates();
  const response = await fetch(loaded.config.referenceAudios[0].url);
  assert.equal(response.ok, true);
  assert.equal(await response.text(), await audio.text());
  assert.ok(!f.rows[0].config.referenceAudios[0].url.startsWith('blob:'));
  assert.ok(!f.rows[0].config.referenceAudios[0].url.includes('token='));
  assert.deepEqual(saved.config, loaded.config);
  assert.equal(original.config.referenceAudios[0].url, url);
});

test('an unreadable local clip rejects the save without writing a broken template', async t => {
  setup(t);
  const url = URL.createObjectURL(audio); URL.revokeObjectURL(url);
  await assert.rejects(saveTemplate(template(url)));
  assert.deepEqual(f.rows, []);
});

test('an upload failure rejects without changing the draft and allows retry', async t => {
  setup(t); f.uploadError = true;
  const url = URL.createObjectURL(audio); t.after(() => URL.revokeObjectURL(url));
  const draft = template(url);
  await assert.rejects(saveTemplate(draft), /audio|upload/i);
  assert.deepEqual(f.rows, []);
  f.uploadError = false;
  const saved = await saveTemplate(draft);
  assert.ok(saved.config.referenceAudios[0].url.startsWith('https://'));
  assert.equal(draft.config.referenceAudios[0].url, url);
  assert.equal(f.rows.length, 1);
});

test('existing durable clips are not downloaded or uploaded again', async t => {
  setup(t);
  const value = template('https://cdn.invalid/audio.mp3');
  await saveTemplate(value);
  assert.equal(f.uploads.size, 0);
  assert.deepEqual(f.rows[0].config, value.config);
});

test('an account change during local audio preparation cannot save the template', async t => {
  setup(t); f.fetchHook = async () => { f.user = 'user-2'; };
  const url = URL.createObjectURL(audio); t.after(() => URL.revokeObjectURL(url));
  await assert.rejects(saveTemplate(template(url)), /session|account/i);
  assert.deepEqual(f.rows, []);
});

// Exercise the real create/update handlers: the visible list must use the
// durable snapshot returned by storage, not the original picker URLs.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = app.indexOf('  const handleSaveTemplate = async');
const end = app.indexOf('  const handleDeleteTemplate = async', start);
assert.ok(start > 0 && end > start);
const handlers = await transform(`export const create = (config, saveTemplate, setTemplates, toast) => {
  ${app.slice(start, end)}
  return { save: handleSaveTemplate, update: handleUpdateTemplate };
};`, { loader: 'ts', format: 'esm' });
const { create } = await import('data:text/javascript;base64,' + Buffer.from(handlers.code).toString('base64'));
for (const operation of ['save', 'update']) {
  test(`template ${operation} keeps the durable snapshot in the visible list`, async () => {
    const original = template('blob:picker');
    const durable = template('https://storage.invalid/stored-audio.wav');
    let rows = operation === 'update' ? [original] : [];
    const handler = create(original.config, async value => ({ ...value, config: durable.config }),
      update => { rows = update(rows); }, { success() {}, error() { assert.fail('Save should succeed'); } });
    await handler[operation](operation === 'update' ? original : original.name);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].config, durable.config);
    assert.equal(original.config.referenceAudios[0].url, 'blob:picker');
  });
}

test('image-only templates retain their existing shape without uploading media', async t => {
  setup(t);
  const value = template('unused');
  delete value.config.referenceAudios;
  const saved = await saveTemplate(value);
  assert.deepEqual(saved.config, value.config);
  assert.equal(f.uploads.size, 0);
});

test('an empty picker-backed clip cannot become a saved reference', async t => {
  setup(t);
  const url = URL.createObjectURL(new Blob([], { type: 'audio/wav' }));
  t.after(() => URL.revokeObjectURL(url));
  await assert.rejects(saveTemplate(template(url)), /empty/i);
  assert.deepEqual(f.rows, []);
});
