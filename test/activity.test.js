import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/model.js';
import { parseActivity, toSessions, classify, summarizeDay, applyActivity, planVsReality, journalText, rollForward, suggestRule } from '../js/activity.js';
import { dayReport } from '../js/reports.js';

/* Builds JSON lines: [startHH:MM, minutes, app, title, idle?] → samples every 30s. */
function lines(spec) {
  const out = [];
  for (const [at, mins, app, title, idle = 0] of spec) {
    const [h, m] = at.split(':').map(Number);
    const start = new Date(2026, 10, 4, h, m).getTime();
    for (let s = 30; s <= mins * 60; s += 30) out.push(JSON.stringify({ t: new Date(start + s * 1000).toISOString(), app, title, idle }));
  }
  return out.join('\n') + '\nnot json\n';
}

test('samples become sessions; idle, gaps and ignored apps are dropped', () => {
  const samples = parseActivity(lines([
    ['09:00', 30, 'Code', 'app.js — journeyman'],
    ['09:30', 10, 'Notion', 'EC1002 Study Tasks'],
    ['09:40', 5, 'Notion', 'EC1002 Study Tasks', 400], // idle
    ['09:45', 5, 'loginwindow', ''],
    ['11:00', 20, 'Safari', 'Supply and demand – Khan Academy'], // after a gap
  ]));
  assert.equal(samples.length, 140);
  const sessions = toSessions(samples, { ignore: ['loginwindow'] });
  assert.deepEqual(sessions.map((s) => [s.app, Math.round(s.minutes)]), [['Code', 30], ['Notion', 10], ['Safari', 20]]);
});

test('matching: rules, then task titles, project names, area names', () => {
  const store = createStore({ now: () => new Date(2026, 10, 4, 18) });
  const study = store.addArea('Study');
  const ec = store.addProject('EC1002 Study Tasks', { areaId: study.id });
  const sd = store.addTask({ title: 'Supply and demand', projectId: ec.id, when: '2026-11-04' });
  const jm = store.addProject('JourneyMan');
  assert.deepEqual(classify({ app: 'Safari', title: 'Supply and demand – Khan Academy' }, store), { kind: 'task', id: sd.id, via: 'title' });
  assert.deepEqual(classify({ app: 'Notion', title: 'EC1002 Study Tasks' }, store), { kind: 'project', id: ec.id, via: 'title' });
  assert.equal(classify({ app: 'Code', title: 'app.js — journeyman' }, store).id, jm.id);
  assert.equal(classify({ app: 'Mail', title: 'Inbox' }, store), null);
  const el = store.addTask({ title: 'Elasticities (PED, YED, XED)', projectId: ec.id });
  assert.equal(classify({ app: 'Chrome', title: 'Elasticities lecture notes' }, store).id, el.id, 'matches the core of a task name');
  store.updateSettings({ activityRules: [{ id: 'r', field: 'app', contains: 'Mail', target: { kind: 'area', id: study.id } }] });
  assert.deepEqual(classify({ app: 'Mail', title: 'Inbox' }, store), { kind: 'area', id: study.id, via: 'rule' });
  assert.deepEqual(suggestRule({ app: 'Safari', title: 'Bank statement – HSBC' }), { field: 'title', contains: 'Bank statement' });
  assert.deepEqual(suggestRule({ app: 'Spotify', title: '' }), { field: 'app', contains: 'Spotify' });
});

test('day summary, time entries without double counting, plan and journal', () => {
  const store = createStore({ now: () => new Date(2026, 10, 4, 18) });
  const study = store.addArea('Study');
  const ec = store.addProject('EC1002 Study Tasks', { areaId: study.id });
  const sd = store.addTask({ title: 'Supply and demand', projectId: ec.id, when: '2026-11-04', estimate: 30 });
  const el = store.addTask({ title: 'Elasticities', projectId: ec.id, when: '2026-11-04' });
  const old = store.addTask({ title: 'Old plan', projectId: ec.id, when: '2026-11-03' });
  // A timer already covered 09:30–09:40.
  store.restore('entry', { id: 'e1', taskId: sd.id, start: new Date(2026, 10, 4, 9, 30).toISOString(), end: new Date(2026, 10, 4, 9, 40).toISOString(), source: 'timer', deep: false });
  const sessions = toSessions(parseActivity(lines([
    ['09:00', 60, 'Safari', 'Supply and demand – Khan Academy'],
    ['10:00', 30, 'Notion', 'EC1002 Study Tasks'],
    ['10:30', 15, 'Mail', 'Inbox'],
  ])));
  const sum = summarizeDay(store, sessions);
  assert.equal(Math.round(sum.total), 105);
  assert.equal(Math.round(sum.matchedMinutes), 90);
  assert.equal(sum.unmatched[0].app, 'Mail');
  assert.equal(sum.matched[0].name, 'Supply and demand');

  const added = applyActivity(store, '2026-11-04', sum.sessions);
  assert.equal(Math.round(added), 80, '60 + 30 minus the 10 the timer already had');
  assert.equal(Math.round(store.tracked(sd.id)), 60);
  assert.equal(Math.round(store.projectStats(ec.id).tracked), 90);
  applyActivity(store, '2026-11-04', sum.sessions);
  assert.equal(Math.round(store.tracked(sd.id)), 60, 'running it again replaces, never doubles');

  store.toggleDone(sd.id);
  const plan = planVsReality(store, '2026-11-04', sum);
  assert.deepEqual(plan.map((p) => [p.task.title, p.state]), [['Supply and demand', 'done'], ['Elasticities', 'untouched'], ['Old plan', 'untouched']]);
  const text = journalText(store, '2026-11-04', sum, plan, dayReport(store, '2026-11-04'));
  assert.match(text, /At the Mac 1h 45m, 9:00–10:45/);
  assert.match(text, /Finished: Supply and demand/);
  assert.match(text, /Planned but not started: Elasticities; Old plan/);
  assert.equal(rollForward(store, plan, '2026-11-05'), 2);
  assert.equal(store.task(el.id).when, '2026-11-05');
  assert.equal(store.task(old.id).when, '2026-11-05');
});
