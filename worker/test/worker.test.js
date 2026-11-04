import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = { APP_KEY: 'k'.repeat(32), NOTION_TOKEN: 'secret_x', ALLOWED_ORIGINS: 'https://vrs-3110.github.io' };
const req = (path, init = {}) => new Request('https://bridge.example' + path, {
  ...init,
  headers: { origin: 'https://vrs-3110.github.io', authorization: 'Bearer ' + env.APP_KEY, ...(init.headers || {}) },
});

test('rejects a wrong key and a foreign origin', async () => {
  let r = await worker.fetch(req('/health', { headers: { authorization: 'Bearer nope' } }), env);
  assert.equal(r.status, 401);
  r = await worker.fetch(req('/health', { headers: { origin: 'https://evil.example' } }), env);
  assert.equal(r.status, 403);
  r = await worker.fetch(req('/health', { method: 'OPTIONS' }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://vrs-3110.github.io');
});

test('health says what is set up', async () => {
  const r = await worker.fetch(req('/health'), env);
  assert.deepEqual(await r.json(), { ok: true, notion: true, ai: false });
});

test('forwards allowed Notion calls with the token, refuses others', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push([url, init]); return new Response('{"results":[]}', { status: 200 }); };
  try {
    const id = '69789a25954144b283010287ce581403';
    let r = await worker.fetch(req(`/notion/v1/databases/${id}/query`, { method: 'POST', body: '{"page_size":100}' }), env);
    assert.equal(r.status, 200);
    assert.equal(calls[0][0], `https://api.notion.com/v1/databases/${id}/query`);
    assert.equal(calls[0][1].headers.authorization, 'Bearer secret_x');
    assert.equal(calls[0][1].headers['notion-version'], '2022-06-28');
    assert.equal(calls[0][1].body, '{"page_size":100}');
    r = await worker.fetch(req('/notion/v1/users', { method: 'GET' }), env);
    assert.equal(r.status, 403);
    r = await worker.fetch(req(`/notion/v1/pages/${id}`, { method: 'DELETE' }), env);
    assert.equal(r.status, 403);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
