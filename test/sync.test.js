import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/model.js';
import { syncOnce, sessionFromHash, toSession, ensureToken } from '../js/sync.js';

/* A tiny Supabase: push_records keeps a row only when strictly newer, and pull filters by a server clock. */
function fakeServer() {
  const rows = new Map();
  let serverClock = Date.parse('2026-11-04T00:00:00Z');
  const api = {
    push: async (token, list) => {
      let n = 0;
      for (const r of list) {
        const key = `${token}|${r.kind}|${r.id}`;
        const cur = rows.get(key);
        if (cur && !(cur.updated_at < r.updated_at)) continue;
        rows.set(key, { ...r, user: token, server_updated_at: new Date((serverClock += 1000)).toISOString() });
        n++;
      }
      return n;
    },
    pull: async (token, since) => [...rows.values()].filter((r) => r.user === token && (!since || r.server_updated_at > since))
      .sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1)),
  };
  return { api, rows };
}

function device(start) {
  let t = Date.parse(start);
  const now = () => new Date(t);
  const store = createStore({ now });
  return { store, tick: (mins = 1) => { t += mins * 60_000; }, stamp: () => now().toISOString(), state: {} };
}

test('two devices converge: create, edit, delete, prefs', async () => {
  const server = fakeServer();
  const mac = device('2026-11-04T09:00:00Z');
  const phone = device('2026-11-04T09:00:30Z');
  const run = async (d) => { const r = await syncOnce(d.store, server.api, 'user-1', d.state, d.stamp); d.state = r.state; d.tick(); return r.summary; };

  const area = mac.store.addArea('Study');
  const task = mac.store.addTask({ title: 'Read chapter 7', areaId: area.id, estimate: 45 });
  mac.store.logTime(task.id, 30);
  mac.store.updateSettings({ hoursPerDay: 5 });
  mac.tick();
  let s = await run(mac);
  assert.ok(s.pushed >= 4);
  s = await run(phone);
  assert.equal(phone.store.task(task.id).title, 'Read chapter 7');
  assert.equal(Math.round(phone.store.tracked(task.id)), 30);
  assert.equal(phone.store.state.settings.hoursPerDay, 5);

  // Edit on the phone, later than the Mac's version.
  phone.tick(5);
  phone.store.updateTask(task.id, { title: 'Read chapter 7 and take notes' });
  await run(phone);
  await run(mac);
  assert.equal(mac.store.task(task.id).title, 'Read chapter 7 and take notes');

  // Delete on the Mac → gone on the phone.
  mac.tick(5);
  mac.store.deleteTask(task.id);
  await run(mac);
  s = await run(phone);
  assert.equal(phone.store.task(task.id), null);
  assert.ok(s.removed >= 1);

  // Nothing changed → a quiet round.
  await run(mac);
  s = await run(mac);
  assert.deepEqual(s, { pushed: 0, pulled: 0, removed: 0 });
});

test('an older edit never overwrites a newer one', async () => {
  const server = fakeServer();
  const a = device('2026-11-04T09:00:00Z');
  const b = device('2026-11-04T09:00:00Z');
  const run = async (d) => { const r = await syncOnce(d.store, server.api, 'u', d.state, d.stamp); d.state = r.state; d.tick(); };
  const t = a.store.addTask({ title: 'v1' });
  await run(a); await run(b);
  b.tick(10); b.store.updateTask(t.id, { title: 'newer (b)' });   // 09:11
  a.tick(2); a.store.updateTask(t.id, { title: 'older (a)' });    // 09:04
  await run(b);  // server: newer
  await run(a);  // a's older push is rejected; a pulls the newer one
  assert.equal(a.store.task(t.id).title, 'newer (b)');
  await run(b);
  assert.equal(b.store.task(t.id).title, 'newer (b)');
});

test('Postgres time format (+00:00) is compared as an instant', async () => {
  const server = fakeServer();
  const pg = { ...server.api, pull: async (t, since) => (await server.api.pull(t, since)).map((r) => ({ ...r, updated_at: r.updated_at.replace('Z', '000+00:00') })) };
  const a = device('2026-11-04T09:00:00Z');
  const b = device('2026-11-04T09:30:00Z');
  const t = a.store.addTask({ title: 'Same instant' });
  let r = await syncOnce(a.store, pg, 'u', {}, a.stamp);
  assert.equal(r.summary.pulled, 0, 'own echo in +00:00 format is not newer');
  r = await syncOnce(b.store, pg, 'u', {}, b.stamp);
  assert.equal(b.store.task(t.id).updatedAt, '2026-11-04T09:00:00.000Z', 'stored in one format');
});

test('sessions from a sign-in link, verify answers and refresh', async () => {
  const s = sessionFromHash('#access_token=abc&refresh_token=r1&expires_in=3600&token_type=bearer&type=magiclink');
  assert.equal(s.access_token, 'abc');
  assert.equal(s.refresh_token, 'r1');
  assert.equal(sessionFromHash('#today'), null);
  const v = toSession({ access_token: 't', refresh_token: 'r', expires_in: 3600, user: { email: 'me@x.com' } }, 0);
  assert.equal(v.expires_at, 3_600_000);
  assert.equal(v.email, 'me@x.com');
  const fresh = await ensureToken({}, v, 0);
  assert.equal(fresh.token, 't');
  const api = { refresh: async (rt) => ({ access_token: 't2', refresh_token: rt + '2', expires_in: 3600 }) };
  const renewed = await ensureToken(api, v, 3_590_000);
  assert.equal(renewed.token, 't2');
  assert.equal(renewed.session.email, 'me@x.com');
});
