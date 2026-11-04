import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/model.js';
import { autoMap, pageToTask, taskToProps, syncLink, notionId, makeApi, writeJournal, journalMap } from '../js/notion.js';

/* The EC1002 Study Tasks database, as Notion describes it. */
const DB = {
  id: '69789a25-9541-44b2-8301-0287ce581403',
  title: [{ plain_text: 'EC1002 Study Tasks' }],
  properties: {
    Task: { type: 'title', title: {} },
    Status: { type: 'status', status: {
      options: [{ id: 'a', name: 'Not started' }, { id: 'b', name: 'Queued' }, { id: 'c', name: 'Studying' }, { id: 'd', name: 'Reviewing' }, { id: 'e', name: 'Done' }],
      groups: [{ name: 'To-do', option_ids: ['a', 'b'] }, { name: 'In progress', option_ids: ['c', 'd'] }, { name: 'Complete', option_ids: ['e'] }],
    } },
    Due: { type: 'date', date: {} },
    'Est. hours': { type: 'number', number: {} },
    Notes: { type: 'rich_text', rich_text: {} },
    'Time spent': { type: 'number', number: {} },
    Topic: { type: 'rich_text', rich_text: {} },
  },
};

/* A tiny in-memory Notion: query, create, update, archive. Each write bumps last_edited_time. */
function fakeNotion(startPages = []) {
  let clock = Date.parse('2026-11-04T08:00:00Z');
  const tick = () => new Date((clock += 60_000)).toISOString();
  const pages = new Map(startPages.map((p) => [p.id, p]));
  const calls = [];
  let n = 0;
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    if (method === 'GET' && path.startsWith('databases/')) return DB;
    if (method === 'POST' && path.endsWith('/query')) return { results: [...pages.values()].filter((p) => !p.archived), has_more: false };
    if (method === 'POST' && path === 'pages') {
      const id = `page-${++n}`;
      const p = { id, url: `https://www.notion.so/${id}`, last_edited_time: tick(), properties: body.properties };
      pages.set(id, p);
      return p;
    }
    if (method === 'PATCH' && path.startsWith('pages/')) {
      const p = pages.get(path.slice(6));
      if (body.archived) p.archived = true;
      if (body.properties) p.properties = { ...p.properties, ...body.properties };
      p.last_edited_time = tick();
      return p;
    }
    throw new Error('unexpected ' + method + ' ' + path);
  };
  return { api, pages, calls, tick };
}
const page = (id, title, status, extra = {}) => ({
  id, url: `https://www.notion.so/${id}`, last_edited_time: '2026-11-04T07:00:00.000Z',
  properties: { Task: { title: [{ plain_text: title }] }, Status: { status: { name: status } }, Due: { date: extra.due ? { start: extra.due } : null }, 'Est. hours': { number: extra.hours ?? null }, Notes: { rich_text: [] } },
});

test('auto mapping from a Notion database', () => {
  const m = autoMap(DB);
  assert.deepEqual(m, { title: 'Task', status: 'Status', statusType: 'status', doneValue: 'Done', todoValue: 'Not started', due: 'Due', estimate: 'Est. hours', estimateUnit: 'hours', notes: 'Notes', time: 'Time spent' });
});

test('page ↔ task conversion', () => {
  const m = autoMap(DB);
  const t = pageToTask(page('p1', 'Supply and demand', 'Studying', { due: '2026-11-12', hours: 1.5 }), m);
  assert.equal(t.title, 'Supply and demand');
  assert.equal(t.done, false);
  assert.equal(t.deadline, '2026-11-12');
  assert.equal(t.estimate, 90);
  const props = taskToProps({ title: 'X', done: true, deadline: null, estimate: 45, notes: 'n' }, m, { trackedMinutes: 30 });
  assert.deepEqual(props.Status, { status: { name: 'Done' } });
  assert.deepEqual(props['Est. hours'], { number: 0.75 });
  assert.deepEqual(props['Time spent'], { number: 0.5 });
  assert.equal(taskToProps({ title: 'X', done: false }, m, { statusChanged: false }).Status, undefined);
});

test('two-way sync: pull, push, create both ways, time, archive, removal', async () => {
  let now = new Date('2026-11-04T09:00:00Z');
  const store = createStore({ now: () => now });
  const proj = store.addProject('EC1002 Study Tasks');
  const n = fakeNotion([page('p1', 'Supply and demand', 'Studying', { hours: 2 }), page('p2', 'Elasticities', 'Queued')]);
  const link = { databaseId: DB.id, projectId: proj.id, map: autoMap(DB) };

  // First sync: two pages come in.
  let r = await syncLink(store, link, n.api);
  assert.equal(r.created, 2);
  const sd = store.state.tasks.find((t) => t.title === 'Supply and demand');
  assert.equal(sd.estimate, 120);

  // Change here: complete one, track time, add a task. Change there: rename the other.
  now = new Date('2026-11-04T10:00:00Z');
  store.toggleDone(sd.id);
  store.logTime(sd.id, 90);
  store.addTask({ title: 'Revise IS–MP', projectId: proj.id, estimate: 60 });
  const p2 = n.pages.get('p2');
  p2.properties.Task = { title: [{ plain_text: 'Elasticities (all types)' }] };
  p2.last_edited_time = n.tick();
  now = new Date('2026-11-04T10:05:00Z');
  r = await syncLink(store, link, n.api);
  assert.equal(r.pushed, 1);
  assert.equal(r.pulled, 1);
  assert.equal(r.createdInNotion, 1);
  assert.deepEqual(n.pages.get('p1').properties.Status, { status: { name: 'Done' } });
  assert.deepEqual(n.pages.get('p1').properties['Time spent'], { number: 1.5 });
  assert.ok(store.state.tasks.some((t) => t.title === 'Elasticities (all types)'));
  assert.equal([...n.pages.values()].length, 3);

  // A third sync with nothing changed does nothing.
  now = new Date('2026-11-04T10:10:00Z');
  const before = n.calls.length;
  r = await syncLink(store, link, n.api);
  assert.equal(r.pulled + r.pushed + r.created + r.createdInNotion + r.time, 0);
  assert.equal(n.calls.length, before + 1, 'only the query');

  // Time added later is written back on its own.
  store.logTime(sd.id, 30);
  r = await syncLink(store, link, n.api);
  assert.equal(r.time, 1);
  assert.deepEqual(n.pages.get('p1').properties['Time spent'], { number: 2 });

  // Delete here → archived there. Archived there → removed here.
  const revise = store.state.tasks.find((t) => t.title === 'Revise IS–MP');
  store.deleteTask(revise.id);
  n.pages.get('p2').archived = true;
  r = await syncLink(store, link, n.api);
  assert.equal(r.archived, 1);
  assert.equal(r.removed, 1);
  assert.ok(n.pages.get(revise.notionPageId).archived);
  assert.ok(!store.state.tasks.some((t) => t.title.startsWith('Elasticities')));
});

test('conflict: the newer edit wins', async () => {
  let now = new Date('2026-11-04T09:00:00Z');
  const store = createStore({ now: () => now });
  const proj = store.addProject('P');
  const n = fakeNotion([page('p1', 'Original', 'Queued')]);
  const link = { databaseId: DB.id, projectId: proj.id, map: autoMap(DB) };
  await syncLink(store, link, n.api);
  const t = store.state.tasks.find((x) => x.title === 'Original');
  now = new Date('2026-11-04T09:30:00Z');
  store.updateTask(t.id, { title: 'Edited here' });
  const p = n.pages.get('p1');
  p.properties.Task = { title: [{ plain_text: 'Edited in Notion' }] };
  p.last_edited_time = '2026-11-04T09:45:00.000Z'; // later than the local edit
  now = new Date('2026-11-04T09:50:00Z');
  const r = await syncLink(store, link, n.api);
  assert.equal(r.conflicts, 1);
  assert.equal(store.task(t.id).title, 'Edited in Notion');
});

test('ids, the api caller and the journal', async () => {
  assert.equal(notionId('https://www.notion.so/69789a25954144b283010287ce581403?v=1'), '69789a25-9541-44b2-8301-0287ce581403');
  assert.equal(notionId('nope'), null);
  const seen = [];
  const api = makeApi({ workerUrl: 'https://bridge.example/', appKey: 'k' }, async (url, init) => { seen.push([url, init]); return new Response('{"ok":1}', { status: 200 }); });
  await api('GET', 'databases/x');
  assert.equal(seen[0][0], 'https://bridge.example/notion/v1/databases/x');
  assert.equal(seen[0][1].headers.authorization, 'Bearer k');
  const bad = makeApi({ workerUrl: 'https://b' }, async () => new Response('{"message":"Could not find database"}', { status: 404 }));
  await assert.rejects(bad('GET', 'databases/x'), /Could not find database/);

  const jm = journalMap({ properties: { Name: { type: 'title' }, Date: { type: 'date' } } });
  assert.deepEqual(jm, { titleProp: 'Name', dateProp: 'Date' });
  const calls = [];
  const japi = async (m, p, b) => { calls.push([m, p, b]); return m === 'POST' && p.endsWith('/query') ? { results: [] } : { id: 'new', url: 'u' }; };
  const res = await writeJournal(japi, { databaseId: 'db', ...jm }, { day: '2026-11-04', title: 'Wed 4 Nov', text: 'Line one\nLine two' });
  assert.equal(res.created, true);
  assert.equal(calls[1][2].children.length, 3);
  const japi2 = async (m, p, b) => { calls.push([m, p, b]); return p.endsWith('/query') ? { results: [{ id: 'existing' }] } : {}; };
  const res2 = await writeJournal(japi2, { databaseId: 'db', ...jm }, { day: '2026-11-04', title: 'x', text: 'a' });
  assert.equal(res2.pageId, 'existing');
  assert.equal(calls.at(-1)[1], 'blocks/existing/children');
});
