import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/model.js';
import { parseAtlasExport, importAtlas, journeymanExport, atlasFields, atlasTaskId, atlasNodeOf, trackedHere, exportKey, summaryText } from '../js/atlas.js';

const N1 = '6F1C2B9E-0A57-4D7B-9E1A-1B2C3D4E5F60';
const N2 = '0D3E4F50-1111-4222-8333-944455566677';
const MAP = 'AAAA0000-1111-4222-8333-944455566677';

/* A store with a clock we can move. */
function makeStore(start = '2026-11-05T09:00:00Z') {
  let now = new Date(start);
  const store = createStore({ now: () => now });
  store.load({});
  store.at = (iso) => { now = new Date(iso); };
  store.advance = (mins) => { now = new Date(now.getTime() + mins * 60_000); };
  return store;
}
const atlasTask = (over = {}) => ({
  id: N1, title: 'Write chapter 2', status: 'todo', statusChangedAt: null, priority: 'high',
  due: null, scheduledStart: null, durationMinutes: 30, completedAt: null, focusMinutes: 0,
  map: { id: MAP, name: 'Thesis' }, inbox: 'none', updatedAt: '2026-11-05T08:00:00Z', url: `atlas://node/${N1}`,
  ...over,
});
const file = (tasks) => parseAtlasExport(JSON.stringify({ app: 'Atlas', format: 1, exportedAt: '2026-11-05T08:30:00Z', tasks }));

test('parseAtlasExport checks the file and tidies each task', () => {
  assert.throws(() => parseAtlasExport('not json'), /not valid JSON/);
  assert.throws(() => parseAtlasExport('{"app":"Other","tasks":[]}'), /not an Atlas task file/);
  assert.throws(() => parseAtlasExport('{"app":"Atlas","format":9,"tasks":[]}'), /newer/);
  const d = parseAtlasExport({ app: 'Atlas', tasks: [
    { id: N1.toLowerCase(), title: '  ', status: 'weird', priority: 'urgent', due: 'nope', focusMinutes: -3 },
    { id: N1 }, // duplicate
    { title: 'no id' },
  ] });
  assert.equal(d.tasks.length, 1);
  const t = d.tasks[0];
  assert.equal(t.id, N1);
  assert.equal(t.title, 'Untitled task');
  assert.equal(t.status, 'todo');
  assert.equal(t.priority, 'none');
  assert.equal(t.due, null);
  assert.equal(t.focusMinutes, 0);
});

test('atlasFields: a time block gives the day, time and estimate', () => {
  const start = new Date(2026, 10, 6, 14, 30); // local 6 Nov 14:30
  const due = new Date(2026, 10, 9); // local midnight
  const f = atlasFields({ title: 'A', scheduledStart: start.toISOString(), durationMinutes: 45, due: due.toISOString(), priority: 'medium' });
  assert.deepEqual(f, { title: 'A', when: '2026-11-06', time: '14:30', deadline: '2026-11-09', estimate: 45, priority: 2 });
  // Unscheduled: Atlas's default duration is not an estimate.
  assert.equal(atlasFields({ title: 'B', durationMinutes: 30, priority: 'none' }).estimate, null);
});

test('first import makes tasks and a project per map', () => {
  const store = makeStore();
  const sum = importAtlas(store, file([atlasTask(), atlasTask({ id: N2, title: 'Loose task', map: null })]));
  assert.equal(sum.created, 2);
  assert.equal(sum.projects, 1);
  const p = store.state.projects.find((x) => x.atlasMapId === MAP);
  assert.equal(p.name, 'Thesis');
  const t = store.task(atlasTaskId(N1));
  assert.equal(t.title, 'Write chapter 2');
  assert.equal(t.projectId, p.id);
  assert.equal(t.priority, 3);
  assert.equal(t.atlasId, N1);
  assert.equal(atlasNodeOf(t), N1);
  const loose = store.task(atlasTaskId(N2));
  assert.equal(loose.projectId, null);
  assert.equal(loose.inbox, true);
  // Importing the same file again changes nothing.
  const again = importAtlas(store, file([atlasTask(), atlasTask({ id: N2, title: 'Loose task', map: null })]));
  assert.equal(summaryText(again), 'Already in step');
});

test('Atlas edits win field by field, and edits made here survive until that field changes there', () => {
  const store = makeStore();
  importAtlas(store, file([atlasTask()]));
  const id = atlasTaskId(N1);
  store.updateTask(id, { title: 'My own name', when: '2026-11-10' });
  // Atlas changes only the priority: the name and date chosen here stay.
  let sum = importAtlas(store, file([atlasTask({ priority: 'low', updatedAt: '2026-11-05T09:10:00Z' })]));
  assert.equal(sum.updated, 1);
  let t = store.task(id);
  assert.equal(t.title, 'My own name');
  assert.equal(t.when, '2026-11-10');
  assert.equal(t.priority, 1);
  // Atlas renames it: now Atlas's name wins.
  sum = importAtlas(store, file([atlasTask({ title: 'Chapter 2: methods', priority: 'low' })]));
  t = store.task(id);
  assert.equal(t.title, 'Chapter 2: methods');
  assert.equal(t.when, '2026-11-10');
});

test('done goes both ways, and the later change wins', () => {
  const store = makeStore('2026-11-05T09:00:00Z');
  importAtlas(store, file([atlasTask()]));
  const id = atlasTaskId(N1);

  // Ticked in Atlas → ticked here.
  let sum = importAtlas(store, file([atlasTask({ status: 'done', statusChangedAt: '2026-11-05T09:05:00Z', completedAt: '2026-11-05T09:05:00Z' })]));
  assert.equal(sum.completed, 1);
  assert.equal(store.task(id).done, true);

  // Unticked here later → stays unticked although Atlas still says done, and the export says so.
  store.at('2026-11-05T09:30:00Z');
  store.updateTask(id, { done: false });
  sum = importAtlas(store, file([atlasTask({ status: 'done', statusChangedAt: '2026-11-05T09:05:00Z' })]));
  assert.equal(sum.reopened, 0);
  assert.equal(store.task(id).done, false);
  const out = journeymanExport(store, { appUrl: 'http://localhost:8000/#today' });
  assert.equal(out.appUrl, 'http://localhost:8000/');
  assert.deepEqual(out.tasks.map((x) => [x.atlasId, x.done, x.doneChangedAt]), [[N1, false, '2026-11-05T09:30:00.000Z']]);

  // Atlas reopens and completes again after that → done here.
  sum = importAtlas(store, file([atlasTask({ status: 'done', statusChangedAt: '2026-11-05T10:00:00Z' })]));
  assert.equal(sum.completed, 1);
  assert.equal(store.task(id).done, true);

  // "Doing" in Atlas is not done.
  sum = importAtlas(store, file([atlasTask({ status: 'doing', statusChangedAt: '2026-11-05T10:05:00Z' })]));
  assert.equal(sum.reopened, 1);
  assert.equal(store.task(id).done, false);
});

test('an edit in Atlas that is not a status change does not undo a tick here', () => {
  const store = makeStore('2026-11-05T09:00:00Z');
  importAtlas(store, file([atlasTask()]));
  const id = atlasTaskId(N1);
  store.advance(10);
  store.updateTask(id, { done: true });
  store.advance(10);
  importAtlas(store, file([atlasTask({ title: 'Renamed in Atlas', updatedAt: '2026-11-05T09:30:00Z' })]));
  const t = store.task(id);
  assert.equal(t.title, 'Renamed in Atlas');
  assert.equal(t.done, true);
});

test('undoing a completion counts as a fresh change', () => {
  const store = makeStore();
  importAtlas(store, file([atlasTask()]));
  const id = atlasTaskId(N1);
  const before = { ...store.task(id) };
  store.advance(5);
  store.updateTask(id, { done: true });
  store.advance(5);
  store.undoComplete(before);
  const t = store.task(id);
  assert.equal(t.done, false);
  assert.ok(Date.parse(t.doneChangedAt) > Date.parse(before.doneChangedAt || 0));
});

test('Atlas focus time becomes deep-work entries, and is left out of the time sent back', () => {
  const store = makeStore('2026-11-05T12:00:00Z');
  importAtlas(store, file([atlasTask({ focusMinutes: 25, updatedAt: '2026-11-05T11:00:00Z' })]));
  const id = atlasTaskId(N1);
  let entries = store.taskEntries(id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, 'atlas');
  assert.equal(entries[0].deep, true);
  assert.equal(entries[0].end, '2026-11-05T11:00:00.000Z');
  assert.equal(store.tracked(id), 25);

  // Only the growth is added next time.
  const sum = importAtlas(store, file([atlasTask({ focusMinutes: 40, updatedAt: '2026-11-05T11:50:00Z' })]));
  assert.equal(sum.minutes, 15);
  assert.equal(store.tracked(id), 40);

  // Time tracked here goes back to Atlas on its own.
  store.logTime(id, 30);
  assert.equal(trackedHere(store, id), 30);
  assert.equal(journeymanExport(store).tasks[0].trackedMinutes, 30);
  entries = store.taskEntries(id);
  assert.equal(entries.length, 3);
});

test('tasks gone from Atlas are removed, or unlinked when they have time', () => {
  const store = makeStore();
  importAtlas(store, file([atlasTask(), atlasTask({ id: N2, title: 'Other' })]));
  store.logTime(atlasTaskId(N2), 20);
  const sum = importAtlas(store, file([]));
  assert.equal(sum.removed, 1);
  assert.equal(sum.unlinked, 1);
  assert.equal(store.task(atlasTaskId(N1)), null);
  const kept = store.task(atlasTaskId(N2));
  assert.equal(kept.atlasId, null);
  assert.equal(atlasNodeOf(kept), N2);
  assert.equal(journeymanExport(store).tasks.length, 0);

  // Both come back if they reappear in Atlas (an undo there).
  const back = importAtlas(store, file([atlasTask(), atlasTask({ id: N2, title: 'Other' })]));
  assert.equal(back.created, 1);
  assert.equal(store.task(atlasTaskId(N1)).title, 'Write chapter 2');
  assert.equal(store.task(atlasTaskId(N2)).atlasId, N2);
});

test('cancelled or archived in Atlas counts as gone', () => {
  const store = makeStore();
  importAtlas(store, file([atlasTask(), atlasTask({ id: N2 })]));
  const sum = importAtlas(store, file([atlasTask({ status: 'cancelled' }), atlasTask({ id: N2, inbox: 'archived' })]));
  assert.equal(sum.removed, 2);
  assert.equal(store.state.tasks.length, 0);
});

test('a task deleted here stays deleted until it changes in Atlas', () => {
  const store = makeStore('2026-11-05T09:00:00Z');
  importAtlas(store, file([atlasTask()]));
  store.deleteTask(atlasTaskId(N1));
  let sum = importAtlas(store, file([atlasTask()]));
  assert.equal(sum.skipped, 1);
  assert.equal(store.task(atlasTaskId(N1)), null);
  sum = importAtlas(store, file([atlasTask({ title: 'Changed later', updatedAt: '2026-11-05T10:00:00Z' })]));
  assert.equal(sum.created, 1);
  assert.equal(store.task(atlasTaskId(N1)).title, 'Changed later');
  assert.ok(!store.state.tombstones.some((x) => x.id === atlasTaskId(N1)));
});

test('maps: renamed with Atlas unless renamed here; moving maps moves projects', () => {
  const store = makeStore();
  importAtlas(store, file([atlasTask()]));
  const p = store.state.projects.find((x) => x.atlasMapId === MAP);
  importAtlas(store, file([atlasTask({ map: { id: MAP, name: 'PhD thesis' } })]));
  assert.equal(store.project(p.id).name, 'PhD thesis');
  store.updateProject(p.id, { name: 'Thesis (mine)' });
  importAtlas(store, file([atlasTask({ map: { id: MAP, name: 'Thesis v3' } })]));
  assert.equal(store.project(p.id).name, 'Thesis (mine)');

  const OTHER = 'BBBB0000-1111-4222-8333-944455566677';
  const sum = importAtlas(store, file([atlasTask({ map: { id: OTHER, name: 'Reading' } })]));
  assert.equal(sum.projects, 1);
  const t = store.task(atlasTaskId(N1));
  assert.equal(store.project(t.projectId).name, 'Reading');

  // A project deleted here is not made again just to keep its name in step.
  store.deleteProject(t.projectId);
  const n = store.state.projects.length;
  importAtlas(store, file([atlasTask({ map: { id: OTHER, name: 'Reading' } })]));
  assert.equal(store.state.projects.length, n);
});

test('exportKey ignores the timestamp', () => {
  const store = makeStore();
  importAtlas(store, file([atlasTask()]));
  const a = journeymanExport(store, { appUrl: 'x' });
  store.advance(10);
  const b = journeymanExport(store, { appUrl: 'x' });
  assert.notEqual(a.exportedAt, b.exportedAt);
  assert.equal(exportKey(a), exportKey(b));
});
