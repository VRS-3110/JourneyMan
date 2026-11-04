import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/model.js';
import { dayReport, weekReport, weekStart, entriesCsv, parseDuration } from '../js/reports.js';

/* A clock we can move forward. */
function clock(start = new Date(2026, 10, 4, 9, 0)) {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (mins) => { t += mins * 60_000; } };
}

test('one timer at a time, and short runs are dropped', () => {
  const c = clock();
  const store = createStore({ now: c.now });
  const a = store.addTask({ title: 'A', estimate: 30 });
  const b = store.addTask({ title: 'B' });
  store.startTimer(a.id);
  c.advance(25);
  store.startTimer(b.id); // stops A
  assert.equal(store.running().taskId, b.id);
  assert.equal(Math.round(store.tracked(a.id)), 25);
  c.advance(0.5);
  assert.equal(store.stopTimer(), null, 'under a minute is a mis-click');
  assert.equal(store.state.entries.length, 1);
});

test('manual entries, tracked totals and deletion with undo', () => {
  const c = clock();
  const store = createStore({ now: c.now });
  const t = store.addTask({ title: 'Essay', estimate: 60 });
  store.logTime(t.id, 45);
  store.logTime(t.id, 30, { day: '2026-11-02', deep: true });
  assert.equal(store.tracked(t.id), 75);
  const gone = store.deleteTask(t.id);
  assert.equal(store.state.entries.length, 0);
  store.undoDelete(gone);
  assert.equal(store.tracked(t.id), 75);
  assert.equal(store.state.tombstones.length, 0);
});

test('estimate multiplier needs three finished tasks', () => {
  const c = clock();
  const store = createStore({ now: c.now });
  for (const [est, act] of [[30, 45], [60, 90], [20, 30]]) {
    const t = store.addTask({ title: 'x', estimate: est });
    store.logTime(t.id, act);
    if (est !== 20) store.toggleDone(t.id);
  }
  assert.equal(store.estimateMultiplier().ratio, null);
  store.toggleDone(store.state.tasks[2].id);
  assert.equal(store.estimateMultiplier().ratio, 1.5);
  assert.equal(store.adjusted(40), 60);
  store.updateSettings({ adjustEstimates: false });
  assert.equal(store.adjusted(40), 40);
});

test('day and week reports', () => {
  const c = clock();
  const store = createStore({ now: c.now });
  const area = store.addArea('Study');
  const p = store.addProject('Thesis', { areaId: area.id });
  const t1 = store.addTask({ title: 'Read', projectId: p.id, estimate: 30 });
  const t2 = store.addTask({ title: 'Gym', areaId: area.id });
  store.logTime(t1.id, 60, { deep: true });
  store.logTime(t2.id, 30);
  store.logTime(t1.id, 20, { day: '2026-11-02' });
  store.toggleDone(t1.id);
  const d = dayReport(store);
  assert.equal(d.total, 90);
  assert.equal(d.deep, 60);
  assert.equal(d.byProject[0].name, 'Thesis');
  assert.equal(d.done.length, 1);
  assert.equal(d.compared[0].actual, 80);
  assert.equal(weekStart('2026-11-04'), '2026-11-02');
  assert.equal(weekStart('2026-11-08'), '2026-11-02');
  const w = weekReport(store);
  assert.equal(w.total, 110);
  assert.equal(w.days[0].minutes, 20); // Monday
  assert.equal(w.days[2].minutes, 90); // Wednesday
  assert.equal(w.days[2].byArea.get(area.id), 90);
  assert.equal(w.gaps[0].task.title, 'Read');
  assert.equal(store.projectStats(p.id).tracked, 80);
});

test('CSV export and duration parsing', () => {
  const c = clock();
  const store = createStore({ now: c.now });
  const t = store.addTask({ title: 'Write "intro", part 1' });
  store.logTime(t.id, 45);
  const csv = entriesCsv(store).split('\n');
  assert.equal(csv[0], 'Date,Start,End,Minutes,Task,Project,Area,Deep work,Source,Note');
  assert.match(csv[1], /^2026-11-04,08:15,09:00,45,"Write ""intro"", part 1",,,,manual,$/);
  assert.equal(parseDuration('45m'), 45);
  assert.equal(parseDuration('1h30m'), 90);
  assert.equal(parseDuration('1.5h'), 90);
  assert.equal(parseDuration('2 hours'), 120);
  assert.equal(parseDuration('20'), 20);
  assert.equal(parseDuration('abc'), null);
});
