import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, seed } from '../js/model.js';

const fixedNow = () => new Date(2026, 10, 4, 9, 0); // Wed 4 Nov 2026, 9am local

function makeStore() {
  const saved = [];
  const removed = [];
  const store = createStore({ now: fixedNow, save: (s, r) => saved.push([s, r.id]), remove: (s, id) => removed.push([s, id]) });
  return { store, saved, removed };
}

test('quick-add sorts tasks into the inbox or out of it', () => {
  const { store } = makeStore();
  const a = store.addFromText('Idea for later');
  assert.equal(a.inbox, true);
  const b = store.addFromText('Write intro #thesis ~1h today');
  assert.equal(b.inbox, false);
  assert.ok(store.state.projects.find((p) => p.name === 'thesis'), 'new project created');
  assert.equal(store.inbox().length, 1);
  assert.equal(store.todayList().length, 1);
  assert.equal(store.addFromText('   '), null);
});

test('context fills in project or today when the text names none', () => {
  const { store } = makeStore();
  const p = store.addProject('Garden');
  const t = store.addFromText('Buy seeds', { projectId: p.id });
  assert.equal(t.projectId, p.id);
  assert.equal(t.inbox, false);
  const t2 = store.addFromText('Stretch', { when: store.today() });
  assert.equal(t2.when, '2026-11-04');
});

test('giving an inbox task a home sorts it', () => {
  const { store } = makeStore();
  const t = store.addTask({ title: 'Loose' });
  const p = store.addProject('P');
  store.updateTask(t.id, { projectId: p.id });
  assert.equal(store.task(t.id).inbox, false);
});

test('today includes overdue and due-today tasks, and capacity adds estimates', () => {
  const { store } = makeStore();
  store.addTask({ title: 'Overdue', when: '2026-11-01', estimate: 30 });
  store.addTask({ title: 'Due today', deadline: '2026-11-04', estimate: 60 });
  store.addTask({ title: 'Tomorrow', when: '2026-11-05' });
  store.addTask({ title: 'No estimate', when: '2026-11-04' });
  const list = store.todayList().map((t) => t.title);
  assert.deepEqual(list, ['Overdue', 'Due today', 'No estimate']);
  const c = store.capacity();
  assert.equal(c.planned, 90);
  assert.equal(c.available, 360);
  assert.equal(c.unestimated, 1);
});

test('completing a task stamps it and shows it in done-today and the logbook', () => {
  const { store } = makeStore();
  const t = store.addTask({ title: 'Do it', when: '2026-11-04' });
  store.toggleDone(t.id);
  assert.equal(store.todayList().length, 0);
  assert.equal(store.doneToday().length, 1);
  assert.equal(store.logbook().length, 1);
  store.toggleDone(t.id);
  assert.equal(store.task(t.id).doneAt, null);
});

test('upcoming groups by day and skips today', () => {
  const { store } = makeStore();
  store.addTask({ title: 'A', when: '2026-11-06' });
  store.addTask({ title: 'B', deadline: '2026-11-06' });
  store.addTask({ title: 'C', when: '2026-11-04' });
  store.addTask({ title: 'Far', when: '2027-01-01' });
  const up = store.upcoming(14);
  assert.equal(up.length, 1);
  assert.equal(up[0].day, '2026-11-06');
  assert.equal(up[0].tasks.length, 2);
});

test('project stats', () => {
  const { store } = makeStore();
  const p = store.addProject('Launch', { deadline: '2026-11-14' });
  const t1 = store.addTask({ title: '1', projectId: p.id, estimate: 60 });
  store.addTask({ title: '2', projectId: p.id, estimate: 30 });
  store.addTask({ title: '3', projectId: p.id });
  store.toggleDone(t1.id);
  const s = store.projectStats(p.id);
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  assert.equal(s.estimateLeft, 30);
  assert.equal(s.unestimated, 1);
  assert.equal(s.daysLeft, 10);
});

test('deleting a project sends open tasks to the inbox', () => {
  const { store } = makeStore();
  const p = store.addProject('Gone');
  const open = store.addTask({ title: 'open', projectId: p.id });
  const done = store.addTask({ title: 'done', projectId: p.id });
  store.toggleDone(done.id);
  store.deleteProject(p.id);
  assert.equal(store.task(open.id).projectId, null);
  assert.equal(store.task(open.id).inbox, true);
  assert.equal(store.task(done.id), null);
});

test('deleting an area keeps its projects', () => {
  const { store } = makeStore();
  const a = store.addArea('Work');
  const p = store.addProject('P', { areaId: a.id });
  store.deleteArea(a.id);
  assert.equal(store.project(p.id).areaId, null);
});

test('someday projects stay out of Anytime', () => {
  const { store } = makeStore();
  const p = store.addProject('Later', { status: 'someday' });
  store.addTask({ title: 'parked', projectId: p.id });
  const q = store.addProject('Now');
  store.addTask({ title: 'active', projectId: q.id });
  assert.deepEqual(store.anytime().map((t) => t.title), ['active']);
});

test('changes are saved and undo restores a deleted task', () => {
  const { store, saved, removed } = makeStore();
  const t = store.addTask({ title: 'x' });
  assert.ok(saved.some(([s, id]) => s === 'tasks' && id === t.id));
  const gone = store.deleteTask(t.id);
  assert.ok(removed.some(([s, id]) => s === 'tasks' && id === t.id));
  store.restore('task', gone);
  assert.equal(store.task(t.id).title, 'x');
});

test('seed data and search', () => {
  const { store } = makeStore();
  seed(store);
  assert.equal(store.state.areas.length, 3);
  assert.ok(store.state.settings.seeded);
  assert.equal(store.inbox().length, 1);
  assert.ok(store.search('getting').some((h) => h.kind === 'project'));
  const snap = store.snapshot();
  assert.equal(snap.app, 'JourneyMan');
  assert.equal(snap.tasks.length, store.state.tasks.length);
});
