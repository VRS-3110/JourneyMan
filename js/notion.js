// JourneyMan — the Notion bridge (phase 4). Two-way sync between a JourneyMan project and a Notion
// database, time written back to Notion, and day journals added to a Notion journal database.
//
// The browser can't call the Notion API itself: Notion blocks it (no CORS), and the token must stay
// secret. Calls go through your own small proxy, worker/ (a Cloudflare Worker), which holds the token.
// Every function here takes an `api(method, path, body)` so the sync rules can be tested without a network.

export const NOTION_TIMEOUT = 20_000;

/* A caller for your proxy. */
export function makeApi({ workerUrl, appKey }, fetchImpl = globalThis.fetch) {
  const base = String(workerUrl || '').replace(/\/+$/, '');
  return async (method, path, body) => {
    if (!base) throw new Error('Add your bridge URL first.');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), NOTION_TIMEOUT) : 0;
    let res;
    try {
      res = await fetchImpl(`${base}/notion/v1/${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${appKey || ''}` },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `Notion said ${res.status}`);
    return data;
  };
}

/* The 32-character id inside a Notion database or page link, with dashes. */
export function notionId(urlOrId) {
  const m = String(urlOrId || '').replace(/-/g, '').match(/([0-9a-f]{32})(?![0-9a-f])/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- mapping between a database's properties and task fields ---------- */

/*
  Guesses which property feeds which field from the names and types, as the CSV import does:
    title → title · Status (status / select / checkbox) → done · Due/Deadline (date) → deadline
    Est. hours / Estimate / Minutes (number) → estimate · Notes (text) → notes
    Tracked / Time spent / Actual (number) → time written back
*/
export function autoMap(database) {
  const props = Object.entries(database.properties || {}).map(([name, p]) => ({ name, ...p }));
  const find = (types, re) => props.find((p) => types.includes(p.type) && re.test(p.name));
  const title = props.find((p) => p.type === 'title');
  const status = find(['status'], /.*/) || find(['checkbox'], /^(done|complete|completed|finished)$/i) || find(['select'], /^(status|state|stage)$/i);
  const map = { title: title ? title.name : null, status: null, statusType: null, doneValue: null, todoValue: null, due: null, estimate: null, estimateUnit: 'hours', notes: null, time: null };
  if (status) {
    map.status = status.name;
    map.statusType = status.type;
    if (status.type === 'status') {
      const opts = status.status?.options || [];
      const groups = status.status?.groups || [];
      const inGroup = (re) => {
        const g = groups.find((x) => re.test(x.name));
        return g ? opts.find((o) => g.option_ids.includes(o.id))?.name : null;
      };
      map.doneValue = inGroup(/complete/i) || opts.find((o) => /done|complete/i.test(o.name))?.name || null;
      map.todoValue = inGroup(/to-?do/i) || opts.find((o) => /not started|to ?do|todo/i.test(o.name))?.name || opts[0]?.name || null;
    } else if (status.type === 'select') {
      const opts = status.select?.options || [];
      map.doneValue = opts.find((o) => /done|complete/i.test(o.name))?.name || null;
      map.todoValue = opts.find((o) => /not started|to ?do|todo|open/i.test(o.name))?.name || opts[0]?.name || null;
    }
  }
  const due = find(['date'], /^(due|due date|deadline|date)$/i) || find(['date'], /due|deadline/i);
  if (due) map.due = due.name;
  const est = find(['number'], /est|estimate|duration|minutes|hours/i);
  if (est && !/tracked|spent|actual/i.test(est.name)) {
    map.estimate = est.name;
    map.estimateUnit = /min/i.test(est.name) ? 'minutes' : 'hours';
  }
  const notes = find(['rich_text'], /^(notes?|description|details)$/i);
  if (notes) map.notes = notes.name;
  const time = find(['number'], /tracked|time spent|actual/i);
  if (time) map.time = time.name;
  return map;
}

const plain = (arr) => (arr || []).map((x) => x.plain_text ?? x.text?.content ?? '').join('');

/* A Notion page → the task fields it carries. */
export function pageToTask(page, map) {
  const p = page.properties || {};
  const out = { notionPageId: page.id, notionUrl: page.url || null, notionEditedAt: page.last_edited_time || null };
  if (map.title && p[map.title]) out.title = plain(p[map.title].title).trim() || 'Untitled';
  if (map.status && p[map.status]) {
    const v = p[map.status];
    if (map.statusType === 'checkbox') out.done = !!v.checkbox;
    else {
      const name = (v.status || v.select || {}).name || null;
      out.done = !!name && name === map.doneValue;
      out.notionStatus = name;
    }
  }
  if (map.due && p[map.due]) out.deadline = p[map.due].date?.start?.slice(0, 10) || null;
  if (map.estimate && p[map.estimate]) {
    const n = p[map.estimate].number;
    out.estimate = n > 0 ? Math.round(map.estimateUnit === 'minutes' ? n : n * 60) : null;
  }
  if (map.notes && p[map.notes]) out.notes = plain(p[map.notes].rich_text);
  return out;
}

/*
  Task → Notion properties. Status is only written when done-ness changed, so an in-between
  Notion status like "Studying" isn't overwritten by a plain "not done".
*/
export function taskToProps(task, map, { trackedMinutes = null, statusChanged = true } = {}) {
  const props = {};
  if (map.title) props[map.title] = { title: [{ type: 'text', text: { content: (task.title || 'Untitled').slice(0, 2000) } }] };
  if (map.status && statusChanged) {
    if (map.statusType === 'checkbox') props[map.status] = { checkbox: !!task.done };
    else {
      const name = task.done ? map.doneValue : map.todoValue;
      if (name) props[map.status] = map.statusType === 'status' ? { status: { name } } : { select: { name } };
    }
  }
  if (map.due) props[map.due] = { date: task.deadline ? { start: task.deadline } : null };
  if (map.estimate) props[map.estimate] = { number: task.estimate ? +(map.estimateUnit === 'minutes' ? task.estimate : task.estimate / 60).toFixed(2) : null };
  if (map.notes) props[map.notes] = { rich_text: task.notes ? [{ type: 'text', text: { content: task.notes.slice(0, 2000) } }] : [] };
  if (map.time && trackedMinutes != null) props[map.time] = { number: +(trackedMinutes / 60).toFixed(2) };
  return props;
}

async function queryAll(api, databaseId) {
  const pages = [];
  let cursor;
  do {
    const res = await api('POST', `databases/${databaseId}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    pages.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return pages;
}

/*
  One linked database ↔ one project. For each page and task:
    only Notion changed       → update the task
    only JourneyMan changed   → update the page
    both changed              → the newer edit wins (counted as a conflict)
    new page                  → new task;  new task → new page
    task deleted here         → page archived in Notion
    page gone from Notion     → task deleted here if unchanged since the last sync, else unlinked
  Time tracked is written to the mapped number property when it changes.
*/
export async function syncLink(store, link, api) {
  const now = () => store.now().toISOString();
  const summary = { pulled: 0, pushed: 0, created: 0, createdInNotion: 0, conflicts: 0, archived: 0, removed: 0, unlinked: 0, time: 0 };
  const map = link.map;
  const pages = await queryAll(api, link.databaseId);
  const byPage = new Map(store.state.tasks.filter((t) => t.projectId === link.projectId && t.notionPageId).map((t) => [t.notionPageId, t]));
  const seen = new Set();

  // A synced task is "changed here" when its updatedAt is newer than the last sync.
  const changedHere = (t) => !t.notionSyncedAt || (t.updatedAt && t.updatedAt > t.notionSyncedAt);
  const settle = (t, extra) => {
    const stamp = now();
    store.applyRemote('task', { ...t, ...extra, notionSyncedAt: stamp, updatedAt: stamp });
  };

  for (const page of pages) {
    if (page.archived || page.in_trash) continue;
    seen.add(page.id);
    const remote = pageToTask(page, map);
    const local = byPage.get(page.id);
    if (!local) {
      // Already done in Notion: date it by Notion's last edit, not by this sync.
      const t = store.addTask({ ...remote, projectId: link.projectId, doneAt: remote.done ? remote.notionEditedAt || now() : null });
      settle(store.task(t.id), { notionTracked: store.tracked(t.id) });
      summary.created++;
      continue;
    }
    const remoteChanged = remote.notionEditedAt && (!local.notionEditedAt || remote.notionEditedAt > local.notionEditedAt);
    const localChanged = changedHere(local);
    let pullWins = remoteChanged && !localChanged;
    let pushWins = localChanged && !remoteChanged;
    if (remoteChanged && localChanged) {
      summary.conflicts++;
      pullWins = remote.notionEditedAt > local.updatedAt;
      pushWins = !pullWins;
    }
    if (pullWins) {
      const fields = { ...remote };
      if (fields.done && !local.done) fields.doneAt = remote.notionEditedAt || now();
      if (fields.done === false) fields.doneAt = null;
      settle(local, fields);
      summary.pulled++;
    } else if (pushWins) {
      const remoteDone = remote.done;
      const tracked = store.tracked(local.id);
      const props = taskToProps(local, map, { trackedMinutes: map.time ? tracked : null, statusChanged: remoteDone !== local.done });
      const res = await api('PATCH', `pages/${page.id}`, { properties: props });
      settle(store.task(local.id), { notionEditedAt: res.last_edited_time || now(), notionTracked: tracked, notionUrl: res.url || local.notionUrl });
      summary.pushed++;
    }
    // Time written back on its own when only the tracked total moved.
    const cur = store.task(local.id);
    if (map.time && cur) {
      const tracked = store.tracked(cur.id);
      if (Math.round(tracked) !== Math.round(cur.notionTracked || 0)) {
        const res = await api('PATCH', `pages/${page.id}`, { properties: { [map.time]: { number: +(tracked / 60).toFixed(2) } } });
        settle(cur, { notionEditedAt: res.last_edited_time || now(), notionTracked: tracked });
        summary.time++;
      }
    }
  }

  // New tasks in the project → new pages.
  for (const t of store.state.tasks.filter((x) => x.projectId === link.projectId && !x.notionPageId)) {
    const tracked = store.tracked(t.id);
    const res = await api('POST', 'pages', { parent: { database_id: link.databaseId }, properties: taskToProps(t, map, { trackedMinutes: map.time ? tracked : null }) });
    settle(store.task(t.id), { notionPageId: res.id, notionUrl: res.url || null, notionEditedAt: res.last_edited_time || now(), notionTracked: tracked });
    summary.createdInNotion++;
  }

  // Pages gone from Notion.
  for (const [pageId, t] of byPage) {
    if (seen.has(pageId)) continue;
    const cur = store.task(t.id);
    if (!cur) continue;
    if (!changedHere(cur)) { store.removeRemote('task', cur.id); summary.removed++; }
    else { settle(cur, { notionPageId: null, notionEditedAt: null }); summary.unlinked++; }
  }

  // Tasks deleted here → archive their pages.
  const pageIds = new Set(pages.map((p) => p.id));
  const keep = [];
  for (const tomb of store.state.tombstones) {
    if (tomb.kind === 'task' && tomb.notionPageId && pageIds.has(tomb.notionPageId) && !tomb.notionArchived) {
      await api('PATCH', `pages/${tomb.notionPageId}`, { archived: true });
      keep.push({ ...tomb, notionArchived: true });
      summary.archived++;
    } else keep.push(tomb);
  }
  store.setTombstones(keep);

  link.lastSync = now();
  link.lastResult = summary;
  return summary;
}

/* Looks up a database: its title, properties and a suggested mapping. */
export async function inspectDatabase(api, urlOrId) {
  const id = notionId(urlOrId);
  if (!id) throw new Error('That doesn’t look like a Notion database link.');
  const db = await api('GET', `databases/${id}`);
  return { id, title: plain(db.title) || 'Untitled database', properties: db.properties || {}, map: autoMap(db), url: db.url || null };
}

/* Journal: one page per day in a Notion database (title + a date property), body as paragraphs. */
export function journalMap(database) {
  const props = Object.entries(database.properties || {}).map(([name, p]) => ({ name, ...p }));
  const title = props.find((p) => p.type === 'title');
  const date = props.find((p) => p.type === 'date' && /date|day/i.test(p.name)) || props.find((p) => p.type === 'date');
  return { titleProp: title ? title.name : null, dateProp: date ? date.name : null };
}

const paragraph = (text) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }] } });

/* Adds the day's journal under a heading on that day's page, creating the page if there isn't one. */
export async function writeJournal(api, journal, { day, title, text, notes }) {
  const blocks = [
    { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'From JourneyMan' } }] } },
    ...String(text || '').split('\n').filter(Boolean).map(paragraph),
    ...(notes ? [paragraph(`Notes: ${notes}`)] : []),
  ];
  let pageId = null;
  if (journal.dateProp) {
    const found = await api('POST', `databases/${journal.databaseId}/query`, { filter: { property: journal.dateProp, date: { equals: day } }, page_size: 1 });
    pageId = found.results && found.results[0] ? found.results[0].id : null;
  }
  if (pageId) {
    await api('PATCH', `blocks/${pageId}/children`, { children: blocks });
    return { pageId, created: false };
  }
  const properties = {};
  if (journal.titleProp) properties[journal.titleProp] = { title: [{ type: 'text', text: { content: title } }] };
  if (journal.dateProp) properties[journal.dateProp] = { date: { start: day } };
  const page = await api('POST', 'pages', { parent: { database_id: journal.databaseId }, properties, children: blocks });
  return { pageId: page.id, created: true, url: page.url };
}
