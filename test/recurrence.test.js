import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepeatAt, nextOccurrence, firstOccurrence, occurrencesBetween, describeRepeat, anchorRule } from '../js/recurrence.js';
import { parseQuickAdd } from '../js/parse.js';
import { createStore } from '../js/model.js';
import { workloadForecast } from '../js/insights.js';
import { syncOnce } from '../js/sync.js';

const today = '2026-11-04'; // Wednesday
const rep = (s) => parseQuickAdd(s, { today }).repeat;

test('quick add reads repeats', () => {
  assert.deepEqual(rep('Gym every mon wed fri'), { unit: 'week', every: 1, days: [1, 3, 5] });
  assert.deepEqual(rep('Gym every mon and thu'), { unit: 'week', every: 1, days: [1, 4] });
  assert.deepEqual(rep('Standup every weekday 9am'), { unit: 'week', every: 1, days: [1, 2, 3, 4, 5] });
  assert.deepEqual(rep('Water plants every 3 days'), { unit: 'day', every: 3 });
  assert.deepEqual(rep('1:1 every other week'), { unit: 'week', every: 2 });
  assert.deepEqual(rep('Review every 2 weeks on fri'), { unit: 'week', every: 2, days: [5] });
  assert.deepEqual(rep('Rent every month'), { unit: 'month', every: 1 });
  assert.deepEqual(rep('Journal daily'), { unit: 'day', every: 1 });
  assert.deepEqual(rep('Taxes yearly'), { unit: 'year', every: 1 });
  const r = parseQuickAdd('Gym every mon wed fri ~1h @health', { today });
  assert.equal(r.title, 'Gym');
  assert.equal(r.estimate, 60);
  assert.equal(r.when, null, 'every fri is a repeat, not a date');
  assert.equal(parseQuickAdd('Read every word carefully', { today }).repeat, null, '"every word" is text');
  assert.equal(parseQuickAdd('Read every word carefully', { today }).title, 'Read every word carefully');
});

test('next dates', () => {
  assert.equal(nextOccurrence({ unit: 'day', every: 3 }, today), '2026-11-07');
  assert.equal(nextOccurrence({ unit: 'week', every: 1, days: [1, 3, 5] }, today), '2026-11-06');
  assert.equal(nextOccurrence({ unit: 'week', every: 1, days: [1, 3, 5] }, '2026-11-06'), '2026-11-09');
  assert.equal(nextOccurrence({ unit: 'week', every: 1 }, today), '2026-11-11');
  // every 2 weeks on Fri, anchored to the week of 2 Nov: 6 Nov, then 20 Nov
  const fortnight = anchorRule({ unit: 'week', every: 2, days: [5] }, '2026-11-06');
  assert.equal(nextOccurrence(fortnight, '2026-11-06'), '2026-11-20');
  // month ends and leap years
  assert.equal(nextOccurrence(anchorRule({ unit: 'month', every: 1 }, '2026-01-31'), '2026-01-31'), '2026-02-28');
  assert.equal(nextOccurrence({ unit: 'month', every: 1, dom: 31 }, '2026-02-28'), '2026-03-31');
  assert.equal(nextOccurrence(anchorRule({ unit: 'year', every: 1 }, '2028-02-29'), '2028-02-29'), '2029-02-28');
  assert.equal(nextOccurrence({ unit: 'day', every: 1, until: '2026-11-05' }, '2026-11-05'), null);
  assert.equal(firstOccurrence({ unit: 'week', every: 1, days: [1] }, today), '2026-11-09');
  assert.equal(firstOccurrence({ unit: 'week', every: 1, days: [3] }, today), today);
  assert.deepEqual(occurrencesBetween({ unit: 'week', every: 1, days: [1, 3] }, today, '2026-11-16'), ['2026-11-09', '2026-11-11', '2026-11-16']);
});

test('descriptions', () => {
  assert.equal(describeRepeat({ unit: 'week', every: 1, days: [5, 1, 3] }), 'Every Mon, Wed, Fri');
  assert.equal(describeRepeat({ unit: 'week', every: 1, days: [1, 2, 3, 4, 5] }), 'Every weekday');
  assert.equal(describeRepeat({ unit: 'month', every: 1, dom: 5 }), 'Every month on the 5th');
  assert.equal(describeRepeat({ unit: 'day', every: 2, afterDone: true, until: '2026-12-01' }), 'Every 2 days, counted from when you finish until 1 Dec');
  assert.equal(describeRepeat({ unit: 'year', every: 1, dom: 4, month: 10 }), 'Every year on 4 Nov');
});

function storeAt(iso, hour = 9) {
  let now = new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00`);
  const store = createStore({ now: () => now });
  return { store, set: (d, h = 9) => { now = new Date(`${d}T${String(h).padStart(2, '0')}:00:00`); } };
}

test('completing creates the next one; undo removes it', () => {
  const { store } = storeAt(today);
  const gym = store.addFromText('Gym every mon wed fri ~1h');
  assert.equal(gym.when, today, 'today is a Wednesday, so the first one is today');
  store.toggleDone(gym.id);
  const next = store.task(store.task(gym.id).nextId);
  assert.equal(next.id, `${gym.id}@2026-11-06`);
  assert.equal(next.when, '2026-11-06');
  assert.equal(next.estimate, 60);
  assert.equal(next.done, false);
  // completing again doesn't make a second copy
  store.toggleDone(gym.id); store.toggleDone(gym.id);
  assert.equal(store.state.tasks.filter((t) => t.title === 'Gym').length, 2);
  // undo of the completion removes the untouched next one
  const before = { ...store.task(gym.id), done: false, doneAt: null, nextId: undefined };
  store.undoComplete(before);
  assert.equal(store.state.tasks.filter((t) => t.title === 'Gym').length, 1);
});

test('a repeating deadline typed in Today keeps no "when"', () => {
  const { store } = storeAt(today);
  const t = store.addFromText('Pay rent every month due nov 30', { when: today });
  assert.equal(t.when, null);
  assert.equal(t.deadline, '2026-11-30');
  store.toggleDone(t.id);
  assert.equal(store.task(store.task(t.id).nextId).deadline, '2026-12-30');
});

test('after-done repeats and overdue series', () => {
  const { store, set } = storeAt('2026-11-01');
  const t = store.addTask({ title: 'Haircut', when: '2026-11-01', repeat: { unit: 'week', every: 4, afterDone: true } });
  set('2026-11-10');
  store.toggleDone(t.id);
  assert.equal(store.task(store.task(t.id).nextId).when, '2026-12-08', '4 weeks from when it was done');
  const s = store.addTask({ title: 'Stretch', when: '2026-11-01', repeat: { unit: 'day', every: 1 } });
  store.toggleDone(s.id);
  assert.equal(store.task(store.task(s.id).nextId).when, '2026-11-10', 'no pile of overdue copies');
  const d = store.addTask({ title: 'Report', when: '2026-11-10', deadline: '2026-11-12', repeat: { unit: 'week', every: 1 } });
  store.toggleDone(d.id);
  const nd = store.task(store.task(d.id).nextId);
  assert.deepEqual([nd.when, nd.deadline], ['2026-11-17', '2026-11-19'], 'the deadline keeps its gap');
});

test('setRepeat, upcoming repeats and the forecast', () => {
  const { store } = storeAt(today);
  const a = store.addArea('Health');
  const t = store.addTask({ title: 'Run', areaId: a.id, estimate: 30 });
  store.setRepeat(t.id, { unit: 'week', every: 1, days: [1, 3, 5] });
  assert.equal(store.task(t.id).when, today);
  const ghosts = store.upcomingRepeats(7).map((g) => g.day);
  assert.deepEqual(ghosts, ['2026-11-06', '2026-11-09', '2026-11-11']);
  const f = workloadForecast(store, 2);
  assert.equal(Math.round(f[0].planned), 60, 'Wed + Fri this week');
  assert.equal(Math.round(f[1].planned), 90, 'Mon, Wed, Fri next week');
  store.setRepeat(t.id, null);
  assert.equal(store.task(t.id).repeat, null);
});

test('two devices completing the same occurrence end with one next task', async () => {
  const rows = new Map(); let clock = 0;
  const api = {
    push: async (u, list) => { let n = 0; for (const r of list) { const k = r.kind + r.id; const c = rows.get(k); if (c && !(c.updated_at < r.updated_at)) continue; rows.set(k, { ...r, server_updated_at: String(++clock).padStart(10, '0') }); n++; } return n; },
    pull: async (u, since) => [...rows.values()].filter((r) => !since || r.server_updated_at > since),
  };
  const mac = storeAt(today), phone = storeAt(today, 10);
  const t = mac.store.addFromText('Gym every mon wed fri');
  let ms = (await syncOnce(mac.store, api, 'u', {})).state;
  let ps = (await syncOnce(phone.store, api, 'u', {})).state;
  mac.store.toggleDone(t.id);
  phone.store.toggleDone(t.id);
  ms = (await syncOnce(mac.store, api, 'u', ms)).state;
  ps = (await syncOnce(phone.store, api, 'u', ps)).state;
  ms = (await syncOnce(mac.store, api, 'u', ms)).state;
  for (const s of [mac.store, phone.store]) assert.equal(s.state.tasks.filter((x) => x.title === 'Gym').length, 2);
});
