import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import worker from '../src/index.js';
import { TASKS, MODEL } from '../src/ai.js';

const env = { APP_KEY: 'k'.repeat(32), ANTHROPIC_API_KEY: 'sk-ant-test', ALLOWED_ORIGINS: '*' };
const call = (task, body) => worker.fetch(new Request(`https://bridge.example/ai/${task}`, {
  method: 'POST', headers: { authorization: 'Bearer ' + env.APP_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body),
}), env);

/* Replaces the network: every request to the Messages API gets `reply`. */
function stubClaude(reply, status = 200) {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}
const message = (data, stop = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, stop_reason: stop, stop_details: stop === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: 'x' } : null,
  content: stop === 'refusal' ? [] : [{ type: 'text', text: JSON.stringify(data) }], usage: { input_tokens: 10, output_tokens: 10 },
});

test('every feature has a valid strict schema', () => {
  const walk = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual(s.required.sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === 'array') walk(s.items);
  };
  for (const [name, spec] of Object.entries(TASKS)) {
    walk(spec.schema);
    assert.ok(['low', 'medium'].includes(spec.effort), name);
  }
});

test('brain dump → tasks: request shape and parsed answer', async () => {
  const s = stubClaude(message({ tasks: [{ title: 'Email supervisor', project: '', area: 'Study', when: '2026-11-05', deadline: '', estimate_minutes: 10, priority: 1, notes: '' }] }));
  try {
    const r = await call('plan', { text: 'email my supervisor tomorrow', today: '2026-11-04', weekday: 'Wednesday', areas: ['Study'], projects: [] });
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.data.tasks[0].title, 'Email supervisor');
    const req = s.seen[0];
    assert.match(req.url, /\/v1\/messages/);
    assert.equal(req.body.model, 'claude-opus-5-5');
    assert.equal(req.body.fallbacks, 'default');
    assert.equal(req.body.output_config.effort, 'low');
    assert.equal(req.body.output_config.format.type, 'json_schema');
    assert.equal(req.body.thinking, undefined, 'Opus 5.5 always thinks; effort is the control');
    assert.match(String(req.headers['anthropic-beta'] ?? req.headers.get?.('anthropic-beta')), /server-side-fallback-2026-07-01/);
    assert.match(req.body.messages[0].content, /email my supervisor tomorrow/);
  } finally { s.restore(); }
});

test('a refusal is reported, not parsed', async () => {
  const s = stubClaude(message(null, 'refusal'));
  try {
    const r = await call('now', { minutes: 30, energy: 'low', time: '15:00', weekday: 'Wednesday', candidates: [] });
    assert.equal(r.status, 422);
    assert.equal((await r.json()).category, 'cyber');
  } finally { s.restore(); }
});

test('API errors become friendly messages', async () => {
  let s = stubClaude({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
  try {
    const r = await call('journal', { day: '2026-11-04', facts: 'x' });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /ANTHROPIC_API_KEY/);
  } finally { s.restore(); }
  s = stubClaude({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 400);
  try {
    const r = await call('review', { summary: 'x' });
    assert.equal(r.status, 400);
  } finally { s.restore(); }
});

test('unknown features and missing keys are refused', async () => {
  let r = await call('chat', {});
  assert.equal(r.status, 404);
  r = await worker.fetch(new Request('https://bridge.example/ai/plan', { method: 'POST', headers: { authorization: 'Bearer ' + env.APP_KEY }, body: '{}' }), { ...env, ANTHROPIC_API_KEY: '' });
  assert.equal(r.status, 501);
  assert.equal(typeof Anthropic, 'function');
});
