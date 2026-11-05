// JourneyMan — the Atlas link. Atlas (the Mac mind-mapping app) and JourneyMan share one folder,
// ~/Documents/JourneyMan/atlas. Atlas writes tasks.json there and JourneyMan writes journeyman.json.
// The file formats are described in docs/ATLAS.md.
//
// No DOM and no file access here: the app reads the files, passes them in, and writes what comes out.
// The rules, field by field:
//   name, dates, estimate, priority and map  Atlas → JourneyMan. Your edits here stay until that
//                                            field changes in Atlas.
//   done                                     both ways. The side that changed it last wins.
//   time                                     both ways, without double counting. Atlas focus time
//                                            becomes deep-work entries here; time tracked here is
//                                            sent back as a separate total.
//   deleted or cancelled in Atlas            removed here, or kept and unlinked if it has time on it.

import { toISO } from './parse.js';

export const ATLAS_PREFIX = 'atlas:';
export const ATLAS_FILE = 'tasks.json';
export const JOURNEYMAN_FILE = 'journeyman.json';
export const FORMAT = 1;

const STATUSES = ['todo', 'doing', 'done', 'cancelled'];
const PRIORITY = { none: 0, low: 1, medium: 2, high: 3 };
const SEEN_FIELDS = ['title', 'when', 'time', 'deadline', 'estimate', 'priority'];

export const atlasTaskId = (nodeId) => ATLAS_PREFIX + String(nodeId).toUpperCase();
export const atlasLink = (nodeId) => `atlas://node/${String(nodeId).toUpperCase()}`;
/* The Atlas node behind a task, if it came from Atlas (also for tasks unlinked since). */
export const atlasNodeOf = (t) => (t && (t.atlasId || (String(t.id).startsWith(ATLAS_PREFIX) ? t.id.slice(ATLAS_PREFIX.length) : null))) || null;

const ms = (iso) => { const v = Date.parse(iso || ''); return Number.isFinite(v) ? v : 0; };
const pad = (n) => String(n).padStart(2, '0');
const validDate = (iso) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso) : null);

/* Reads tasks.json (text or parsed). Throws an Error with a message fit to show. */
export function parseAtlasExport(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error('That file is not valid JSON.'); }
  }
  if (!data || data.app !== 'Atlas' || !Array.isArray(data.tasks)) throw new Error('That is not an Atlas task file (tasks.json).');
  if ((data.format || 1) > FORMAT) throw new Error('This Atlas file is newer than this JourneyMan understands. Reload JourneyMan to update it.');
  const tasks = [];
  const ids = new Set();
  for (const raw of data.tasks) {
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) continue;
    const id = raw.id.trim().toUpperCase();
    if (ids.has(id)) continue;
    ids.add(id);
    tasks.push({
      id,
      title: String(raw.title || '').trim() || 'Untitled task',
      status: STATUSES.includes(raw.status) ? raw.status : 'todo',
      statusChangedAt: raw.statusChangedAt || null,
      priority: PRIORITY[raw.priority] != null ? raw.priority : 'none',
      due: validDate(raw.due) ? raw.due : null,
      scheduledStart: validDate(raw.scheduledStart) ? raw.scheduledStart : null,
      durationMinutes: Number(raw.durationMinutes) > 0 ? Math.round(Number(raw.durationMinutes)) : null,
      completedAt: raw.completedAt || null,
      focusMinutes: Number(raw.focusMinutes) > 0 ? Number(raw.focusMinutes) : 0,
      map: raw.map && typeof raw.map.id === 'string' && raw.map.id ? { id: raw.map.id.toUpperCase(), name: String(raw.map.name || '').trim() || 'Atlas map' } : null,
      inbox: raw.inbox === 'inbox' || raw.inbox === 'archived' ? raw.inbox : 'none',
      updatedAt: raw.updatedAt || null,
    });
  }
  return { exportedAt: data.exportedAt || null, tasks };
}

/* The JourneyMan fields an Atlas task sets. A time block gives the day, time and estimate. */
export function atlasFields(a) {
  const start = validDate(a.scheduledStart);
  const due = validDate(a.due);
  return {
    title: a.title,
    when: start ? toISO(start) : null,
    time: start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : null,
    deadline: due ? toISO(due) : null,
    estimate: start && a.durationMinutes ? a.durationMinutes : null,
    priority: PRIORITY[a.priority] || 0,
  };
}

/* The project that stands for an Atlas map: made on first use, and renamed with the map unless you renamed it here. */
function projectFor(store, map, sum, { create = true } = {}) {
  let p = store.state.projects.find((x) => x.atlasMapId === map.id);
  if (!p) {
    if (!create) return null; // deleted here: only a new task or a move in Atlas brings it back
    p = store.addProject(map.name, { atlasMapId: map.id, atlasMapName: map.name });
    sum.projects++;
  } else if (map.name !== p.atlasMapName) {
    p = store.updateProject(p.id, { atlasMapName: map.name, ...(p.name === p.atlasMapName ? { name: map.name } : {}) });
  }
  return p.id;
}

const hasTime = (store, id) => store.state.entries.some((e) => e.taskId === id);

/*
  Brings tasks.json into the store. Returns what changed:
  { created, updated, completed, reopened, removed, unlinked, minutes, projects, skipped }.
*/
export function importAtlas(store, data, { now = store.now() } = {}) {
  const sum = { created: 0, updated: 0, completed: 0, reopened: 0, removed: 0, unlinked: 0, minutes: 0, projects: 0, skipped: 0 };
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const linked = new Map(store.state.tasks.filter((t) => t.atlasId).map((t) => [t.atlasId, t]));
  const seen = new Set();

  for (const a of data.tasks) {
    if (a.inbox === 'archived' || a.status === 'cancelled') continue; // handled as gone, below
    seen.add(a.id);
    const id = atlasTaskId(a.id);
    const fields = atlasFields(a);
    const remoteDone = a.status === 'done';
    // When Atlas last changed the status. Not its last edit: a rename there mustn't undo a tick here.
    const remoteDoneAt = a.statusChangedAt || a.completedAt || null;
    const t = linked.get(a.id) || store.task(id);

    if (!t) {
      // Deleted here on purpose: stays deleted until it changes in Atlas.
      const tomb = store.state.tombstones.find((x) => x.kind === 'task' && x.id === id);
      if (tomb && !tomb.atlasGone && ms(a.updatedAt) <= ms(tomb.deletedAt)) { sum.skipped++; continue; }
      if (tomb) store.setTombstones(store.state.tombstones.filter((x) => x !== tomb));
      const projectId = a.map ? projectFor(store, a.map, sum) : null;
      store.addTask({
        id, ...fields, projectId,
        done: remoteDone, doneAt: remoteDone ? remoteDoneAt || nowIso : null, doneChangedAt: remoteDoneAt || nowIso,
        atlasId: a.id, atlasMapId: a.map ? a.map.id : null, atlasSeen: { ...fields }, atlasFocus: 0,
      });
      sum.created++;
      addFocus(store, id, a, nowMs, sum);
      continue;
    }

    // Fields that changed in Atlas since the last import replace what is here; the rest is left alone.
    const seenBefore = t.atlasSeen || {};
    const patch = {};
    for (const k of SEEN_FIELDS) if (fields[k] !== seenBefore[k] && fields[k] !== t[k]) patch[k] = fields[k];
    const mapId = a.map ? a.map.id : null;
    if (a.map) projectFor(store, a.map, sum, { create: false }); // keeps the project's name in step
    if (mapId !== (t.atlasMapId || null)) {
      if (a.map) patch.projectId = projectFor(store, a.map, sum);
      patch.atlasMapId = mapId;
    }
    const seenChanged = SEEN_FIELDS.some((k) => fields[k] !== seenBefore[k]);
    if (seenChanged) patch.atlasSeen = { ...fields };
    if (!t.atlasId) { patch.atlasId = a.id; patch.atlasGone = null; }
    const visible = Object.keys(patch).some((k) => !['atlasSeen', 'atlasMapId', 'atlasId', 'atlasGone'].includes(k));
    if (Object.keys(patch).length) {
      store.updateTask(t.id, patch);
      if (visible) sum.updated++;
    }

    // Done: whichever side changed it last.
    const cur = store.task(t.id);
    if (remoteDone !== !!cur.done) {
      const localAt = ms(cur.doneChangedAt || cur.doneAt || cur.createdAt);
      if (ms(remoteDoneAt) > localAt) {
        store.updateTask(cur.id, { done: remoteDone });
        if (remoteDone) sum.completed++; else sum.reopened++;
      }
    }
    addFocus(store, t.id, a, nowMs, sum);
  }

  // Gone from Atlas (deleted, cancelled, archived, or no longer a task).
  for (const [nodeId, t] of linked) {
    if (seen.has(nodeId)) continue;
    const cur = store.task(t.id);
    if (!cur) continue;
    if (hasTime(store, cur.id)) {
      store.updateTask(cur.id, { atlasId: null, atlasGone: nowIso });
      sum.unlinked++;
    } else {
      store.deleteTask(cur.id);
      // Marked so the task can come back if it reappears in Atlas (an undo there, say).
      store.setTombstones(store.state.tombstones.map((x) => (x.id === cur.id ? { ...x, atlasGone: true } : x)));
      sum.removed++;
    }
  }
  return sum;
}

/* Atlas keeps a running total of focus time, so the growth since the last import becomes one deep-work entry. */
function addFocus(store, taskId, a, nowMs, sum) {
  const t = store.task(taskId);
  if (!t) return;
  const before = t.atlasFocus || 0;
  const delta = a.focusMinutes - before;
  if (delta < 1) {
    if (a.focusMinutes < before) store.updateTask(taskId, { atlasFocus: a.focusMinutes }); // reset in Atlas
    return;
  }
  const end = Math.min(ms(a.updatedAt) || nowMs, nowMs);
  store.addEntry({ taskId, start: new Date(end - delta * 60_000).toISOString(), end: new Date(end).toISOString(), deep: true, source: 'atlas', note: 'Focus time in Atlas' });
  store.updateTask(taskId, { atlasFocus: a.focusMinutes });
  sum.minutes += delta;
}

/* Minutes tracked in JourneyMan itself (Atlas's own focus time is left out, so it isn't counted twice). */
export function trackedHere(store, taskId) {
  return store.state.entries.reduce((s, e) => (e.taskId === taskId && e.source !== 'atlas' ? s + store.entryMinutes(e) : s), 0);
}

/* journeyman.json: done and tracked time for every linked task, and where JourneyMan lives. */
export function journeymanExport(store, { appUrl = '' } = {}) {
  return {
    app: 'JourneyMan',
    format: FORMAT,
    exportedAt: store.now().toISOString(),
    appUrl: String(appUrl).replace(/#.*$/, '') || null,
    tasks: store.state.tasks.filter((t) => t.atlasId).map((t) => ({
      atlasId: t.atlasId,
      done: !!t.done,
      doneChangedAt: t.doneChangedAt || t.doneAt || t.createdAt || null,
      trackedMinutes: Math.round(trackedHere(store, t.id)),
    })),
  };
}

/* The part of journeyman.json that matters, to skip writing a file that hasn't changed. */
export const exportKey = (data) => JSON.stringify([data.appUrl, data.tasks]);

/* One line for Connections and toasts. */
export function summaryText(s) {
  if (!s) return '';
  const bits = [];
  if (s.created) bits.push(`${s.created} new`);
  if (s.updated) bits.push(`${s.updated} updated`);
  if (s.completed) bits.push(`${s.completed} completed`);
  if (s.reopened) bits.push(`${s.reopened} reopened`);
  if (s.minutes >= 1) bits.push(`${Math.round(s.minutes)}m of focus time`);
  if (s.removed) bits.push(`${s.removed} removed`);
  if (s.unlinked) bits.push(`${s.unlinked} unlinked (kept for their time)`);
  if (s.projects) bits.push(`${s.projects} new project${s.projects === 1 ? '' : 's'}`);
  return bits.length ? bits.join(' · ') : 'Already in step';
}
