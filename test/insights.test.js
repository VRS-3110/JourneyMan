import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/model.js';
import { scoreTask, nextUp, projectHealth, workloadForecast, focusGrid, matrixPoints, estimateAccuracy, areaWeeks, freeToday } from '../js/insights.js';

const at = (y, m, d, h = 9) => () => new Date(y, m - 1, d, h, 0);
const make = (now = at(2026, 11, 4)) => createStore({ now }); // Wed 4 Nov 2026, 9am

test('score parts and reasons', () => {
  const store = make();
  const p = store.addProject('Launch', { deadline: '2026-11-06' });
  const urgent = store.addTask({ title: 'Ship', projectId: p.id, priority: 2, estimate: 30 });
  const later = store.addTask({ title: 'Someday idea', areaId: store.addArea('Life').id });
  const s = scoreTask(store, urgent);
  assert.ok(s.parts.urgency > 0.8);
  assert.equal(s.parts.fit, 1);
  assert.ok(s.reasons.includes('Project due Fri'));
  assert.ok(s.reasons.includes('Priority !!'));
  assert.ok(s.reasons.some((r) => r.startsWith('Fits in your')));
  assert.ok(s.score > scoreTask(store, later).score);
});

test('next up ranks, filters by time available and skips future plans', () => {
  const store = make();
  const a = store.addArea('Work');
  store.addTask({ title: 'Big', areaId: a.id, estimate: 120, deadline: '2026-11-05' });
  store.addTask({ title: 'Small', areaId: a.id, estimate: 15, priority: 1 });
  store.addTask({ title: 'Next week', areaId: a.id, when: '2026-11-11', priority: 3 });
  store.addTask({ title: 'Inbox item' });
  const top = nextUp(store, { limit: 5 }).map((x) => x.task.title);
  assert.deepEqual(top, ['Big', 'Small']);
  assert.deepEqual(nextUp(store, { maxMinutes: 30 }).map((x) => x.task.title), ['Small']);
});

test('free time today subtracts tracked time', () => {
  const store = make();
  const t = store.addTask({ title: 'x', areaId: store.addArea('A').id });
  store.logTime(t.id, 90);
  assert.equal(freeToday(store), 6 * 60 - 90);
});

test('project health states', () => {
  const store = make();
  const empty = store.addProject('Empty');
  assert.equal(projectHealth(store, empty.id).status, 'no-next-action');

  const late = store.addProject('Late', { deadline: '2026-11-01' });
  store.addTask({ title: 'x', projectId: late.id });
  assert.equal(projectHealth(store, late.id).status, 'overdue');

  const heavy = store.addProject('Heavy', { deadline: '2026-11-05' });
  store.addTask({ title: 'Huge', projectId: heavy.id, estimate: 600 });
  const h = projectHealth(store, heavy.id);
  assert.equal(h.status, 'at-risk');
  assert.match(h.detail, /more than half your day/);

  const fine = store.addProject('Fine', { deadline: '2026-11-30' });
  store.addTask({ title: 'Small', projectId: fine.id, estimate: 60 });
  assert.equal(projectHealth(store, fine.id).status, 'on-track');

  const someday = store.addProject('Later', { status: 'someday' });
  assert.equal(projectHealth(store, someday.id).status, 'someday');
});

test('stalled after two quiet weeks', () => {
  let now = at(2026, 10, 1);
  const store = createStore({ now: () => now() });
  const p = store.addProject('Old');
  store.addTask({ title: 'x', projectId: p.id });
  now = at(2026, 11, 4);
  assert.equal(projectHealth(store, p.id).status, 'stalled');
});

test('slow recent pace puts a project at risk', () => {
  let now = at(2026, 11, 2);
  const store = createStore({ now: () => now() });
  const p = store.addProject('Thesis', { deadline: '2026-11-20' });
  const t = store.addTask({ title: 'Write', projectId: p.id, estimate: 1200 });
  store.logTime(t.id, 20);
  now = at(2026, 11, 4);
  const h = projectHealth(store, p.id);
  assert.equal(h.status, 'at-risk');
  assert.match(h.detail, /recent pace/);
});

test('workload forecast: planned days, deadlines spread, this week partial', () => {
  const store = make();
  const a = store.addArea('A');
  store.addTask({ title: 'Fri', areaId: a.id, when: '2026-11-06', estimate: 120 });
  store.addTask({ title: 'Next Tue', areaId: a.id, when: '2026-11-10', estimate: 60 });
  store.addTask({ title: 'Spread', areaId: a.id, deadline: '2026-11-17', estimate: 140 }); // 14 days incl. today
  store.addTask({ title: 'Overdue plan', areaId: a.id, when: '2026-11-01' }); // no estimate → 30m, this week
  const f = workloadForecast(store, 4);
  assert.equal(f.length, 4);
  assert.equal(f[0].start, '2026-11-02');
  assert.equal(Math.round(f[0].available), Math.round(6 * 60 * 5 * (5 / 7)));
  // this week: 120 + 30 + 5 days of the spread task (140/14 × 5 = 50)
  assert.equal(Math.round(f[0].planned), 200);
  assert.equal(f[0].unestimated, 1);
  assert.equal(Math.round(f[1].planned), 60 + 70);
  assert.equal(Math.round(f[2].planned), 20);
});

test('focus grid splits entries across hours', () => {
  const store = make(at(2026, 11, 4, 11));
  const t = store.addTask({ title: 'x', areaId: store.addArea('A').id });
  store.logTime(t.id, 90); // 9:30–11:00 on Wednesday
  const g = focusGrid(store);
  assert.equal(Math.round(g[2][9]), 30);
  assert.equal(Math.round(g[2][10]), 60);
});

test('matrix, accuracy and area weeks', () => {
  const store = make();
  const a = store.addArea('Study');
  const p = store.addProject('EC1002', { areaId: a.id });
  const t = store.addTask({ title: 'Read', projectId: p.id, estimate: 60, priority: 3, deadline: '2026-11-04' });
  store.logTime(t.id, 90);
  const pts = matrixPoints(store);
  assert.equal(pts[0].x, 1);
  assert.equal(pts[0].y, 1);
  store.toggleDone(t.id);
  const acc = estimateAccuracy(store);
  assert.equal(acc[0].ratio, 1.5);
  const w = areaWeeks(store, 8);
  assert.equal(w.length, 8);
  assert.equal(w[7].byArea.get(a.id), 90);
});
