// JourneyMan — the data and the questions asked of it. No DOM, so it runs in Node tests too.
// Built on PARA: areas hold projects, projects hold tasks. Anything not yet sorted sits in the inbox.

import { todayISO, daysBetween, addDays, parseQuickAdd } from './parse.js';

/* Area colours are slots of a validated, colour-blind-checked categorical palette (fixed order).
   The hex for each slot lives in css/app.css as --c1…--c8, with its own light and dark steps. */
export const AREA_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
export const AREA_COLOR_NAMES = { c1: 'Blue', c2: 'Orange', c3: 'Aqua', c4: 'Yellow', c5: 'Pink', c6: 'Green', c7: 'Violet', c8: 'Red' };
/* Colours saved by the first version, mapped to the nearest slot. */
const LEGACY_COLORS = { '#2f7dd1': 'c1', '#e2632b': 'c2', '#2e9e6b': 'c3', '#d4a017': 'c4', '#d6457a': 'c5', '#3aa3a3': 'c6', '#9b5bd4': 'c7', '#6b7a8f': 'c8' };
export const colorVar = (slot) => (/^c[1-8]$/.test(slot || '') ? `var(--${slot})` : slot || 'var(--ink-3)');

export const DEFAULT_SETTINGS = {
  hoursPerDay: 6, daysPerWeek: 5, adjustEstimates: true, seeded: false,
  reviews: [], // finished weekly reviews: { date, notes, tracked, done }
  activityRules: [], // { id, field: 'app' | 'title', contains, target: { kind: 'task' | 'project' | 'area', id } }
  activityIgnore: ['loginwindow', 'ScreenSaverEngine', 'Private'],
  notion: { workerUrl: '', appKey: '', links: [], journal: null, autoSync: false },
};

let lastOrder = 0;
const nextOrder = () => (lastOrder = Math.max(Date.now(), lastOrder + 1));

const uid = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function createStore(persist = {}) {
  const save = persist.save || (() => {});
  const remove = persist.remove || (() => {});
  const now = persist.now || (() => new Date());

  const state = { areas: [], projects: [], tasks: [], entries: [], journals: [], activity: [], tombstones: [], settings: { ...DEFAULT_SETTINGS } };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const today = () => todayISO(now());
  const stamp = () => now().toISOString();
  const kindOf = { area: 'areas', project: 'projects', task: 'tasks', entry: 'entries', journal: 'journals', activity: 'activity' };

  /* Every change is stamped with updatedAt, which Notion sync and device sync use to decide who wins. */
  function put(kind, rec, { touch = true } = {}) {
    if (touch) rec = { ...rec, updatedAt: stamp() };
    const list = state[kindOf[kind]];
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    save(kindOf[kind], rec);
    return rec;
  }
  /* Removing a record leaves a tombstone so device sync can pass the deletion on. */
  function drop(kind, id, { tombstone = true } = {}) {
    const list = state[kindOf[kind]];
    const i = list.findIndex((x) => x.id === id);
    const rec = i >= 0 ? list[i] : null;
    if (i >= 0) list.splice(i, 1);
    remove(kindOf[kind], id);
    if (tombstone) {
      const t = { id, kind, deletedAt: stamp() };
      if (rec && rec.notionPageId) t.notionPageId = rec.notionPageId; // so the Notion bridge can archive the page
      state.tombstones = state.tombstones.filter((x) => x.id !== id).concat(t).slice(-2000);
      save('meta', { id: 'tombstones', list: state.tombstones });
    }
  }

  const store = {
    state,
    today,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    load(data) {
      state.areas = (data.areas || []).map((a) => (LEGACY_COLORS[a.color] ? { ...a, color: LEGACY_COLORS[a.color] } : a));
      state.projects = data.projects || [];
      state.tasks = data.tasks || [];
      state.entries = data.entries || [];
      state.journals = data.journals || [];
      state.activity = data.activity || [];
      state.tombstones = data.tombstones || [];
      state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      state.settings.notion = { ...DEFAULT_SETTINGS.notion, ...(state.settings.notion || {}) };
      emit();
    },
    snapshot() {
      const copy = JSON.parse(JSON.stringify({ app: 'JourneyMan', version: 3, exportedAt: stamp(), ...state }));
      if (copy.settings.notion) copy.settings.notion.appKey = ''; // keys stay on this Mac
      if (copy.settings.sync) copy.settings.sync = { ...copy.settings.sync, session: null };
      if (copy.settings.ai) copy.settings.ai = { ...copy.settings.ai, appKey: '' };
      return copy;
    },
    /* Writes a record that came from elsewhere (Notion, another device) without re-stamping it. */
    applyRemote(kind, rec) {
      put(kind, rec, { touch: false });
    },
    removeRemote(kind, id) {
      drop(kind, id, { tombstone: false });
    },
    notify: () => emit(),

    area: (id) => state.areas.find((a) => a.id === id) || null,
    project: (id) => state.projects.find((p) => p.id === id) || null,
    task: (id) => state.tasks.find((t) => t.id === id) || null,
    entry: (id) => state.entries.find((e) => e.id === id) || null,
    now,

    /* ---------- areas ---------- */
    addArea(name, color) {
      const order = state.areas.length;
      const a = put('area', { id: uid(), name: name.trim() || 'New area', color: color || AREA_COLORS[order % AREA_COLORS.length], order, notionUrl: null, createdAt: stamp() });
      emit();
      return a;
    },
    updateArea(id, fields) {
      const a = store.area(id);
      if (!a) return null;
      put('area', { ...a, ...fields });
      emit();
      return store.area(id);
    },
    /* Projects and tasks in the area stay, without an area. */
    deleteArea(id) {
      for (const p of state.projects.filter((p) => p.areaId === id)) put('project', { ...p, areaId: null });
      for (const t of state.tasks.filter((t) => t.areaId === id)) put('task', { ...t, areaId: null });
      drop('area', id);
      emit();
    },

    /* ---------- projects ---------- */
    addProject(name, fields = {}) {
      const p = put('project', {
        id: uid(), name: name.trim() || 'New project', areaId: null, status: 'active', deadline: null,
        notes: '', notionUrl: null, createdAt: stamp(), completedAt: null, ...fields,
      });
      emit();
      return p;
    },
    updateProject(id, fields) {
      const p = store.project(id);
      if (!p) return null;
      const next = { ...p, ...fields };
      if (fields.status === 'done' && p.status !== 'done') next.completedAt = stamp();
      if (fields.status && fields.status !== 'done') next.completedAt = null;
      put('project', next);
      emit();
      return next;
    },
    /* Open tasks go back to the inbox so nothing is lost; finished ones go with the project. */
    deleteProject(id) {
      for (const t of state.tasks.filter((t) => t.projectId === id)) {
        if (t.done) {
          for (const e of state.entries.filter((e) => e.taskId === t.id)) drop('entry', e.id);
          drop('task', t.id);
        }
        else put('task', { ...t, projectId: null, inbox: !t.areaId && !t.when && !t.deadline });
      }
      drop('project', id);
      emit();
    },

    /* ---------- tasks ---------- */
    addTask(fields = {}) {
      const t = {
        id: uid(), title: '', notes: '', projectId: null, areaId: null,
        when: null, time: null, deadline: null, estimate: null, priority: 0, notionUrl: null,
        done: false, doneAt: null, createdAt: stamp(), order: nextOrder(),
        ...fields,
      };
      if (t.projectId) t.areaId = null; // a project's area is the task's area
      if (fields.inbox == null) t.inbox = !t.projectId && !t.areaId && !t.when && !t.deadline;
      put('task', t);
      emit();
      return t;
    },
    /* Adds a task from quick-add text, creating any new #project or @area it names. */
    addFromText(text, context = {}) {
      const parsed = parseQuickAdd(text, { today: today(), projects: state.projects, areas: state.areas });
      if (!parsed.title) return null;
      let areaId = parsed.areaId;
      if (parsed.newArea) areaId = store.addArea(parsed.newArea).id;
      let projectId = parsed.projectId;
      if (parsed.newProject) projectId = store.addProject(parsed.newProject, { areaId: areaId || context.areaId || null }).id;
      if (!projectId && !areaId) { projectId = context.projectId || null; areaId = context.areaId || null; }
      const when = parsed.when || context.when || null;
      return store.addTask({
        title: parsed.title, projectId, areaId: projectId ? null : areaId,
        when, time: parsed.time, deadline: parsed.deadline, estimate: parsed.estimate, priority: parsed.priority,
        notionUrl: parsed.notionUrl,
      });
    },
    updateTask(id, fields) {
      const t = store.task(id);
      if (!t) return null;
      const next = { ...t, ...fields };
      if (fields.projectId) next.areaId = null;
      // Giving a task a home or a date sorts it out of the inbox.
      if (t.inbox && (fields.projectId || fields.areaId || fields.when || fields.deadline)) next.inbox = false;
      if (fields.done === true && !t.done) next.doneAt = stamp();
      if (fields.done === false) next.doneAt = null;
      put('task', next);
      emit();
      return next;
    },
    toggleDone(id) {
      const t = store.task(id);
      return t ? store.updateTask(id, { done: !t.done }) : null;
    },
    /* Deletes a task and its time entries. Returns both, for undo. */
    deleteTask(id) {
      const task = store.task(id);
      if (!task) return null;
      const entries = state.entries.filter((e) => e.taskId === id);
      for (const e of entries) drop('entry', e.id);
      drop('task', id);
      emit();
      return { task, entries };
    },
    undoDelete({ task, entries = [] }) {
      put('task', task);
      for (const e of entries) put('entry', e);
      state.tombstones = state.tombstones.filter((t) => t.id !== task.id && !entries.some((e) => e.id === t.id));
      save('meta', { id: 'tombstones', list: state.tombstones });
      emit();
    },
    /* Puts a record back exactly as it was (undo). */
    restore(kind, rec) {
      put(kind, rec);
      emit();
    },

    /* ---------- time tracking ---------- */
    running() {
      return state.entries.find((e) => !e.end) || null;
    },
    /* Starts a timer on a task, stopping any other. */
    startTimer(taskId, { deep = false } = {}) {
      const r = store.running();
      if (r && r.taskId === taskId) return r;
      if (r) store.stopTimer();
      const e = put('entry', { id: uid(), taskId, start: stamp(), end: null, deep, source: 'timer', note: '' });
      emit();
      return e;
    },
    /* Stops the running timer. A run of under a minute is treated as a mis-click and dropped. */
    stopTimer({ at } = {}) {
      const r = store.running();
      if (!r) return null;
      const end = at ? new Date(at) : now();
      if (end - new Date(r.start) < 60_000) {
        drop('entry', r.id, { tombstone: false });
        emit();
        return null;
      }
      const e = put('entry', { ...r, end: end.toISOString() });
      emit();
      return e;
    },
    discardTimer() {
      const r = store.running();
      if (r) { drop('entry', r.id, { tombstone: false }); emit(); }
    },
    /* Time logged by hand: `minutes` ending now (today) or at 6pm on an earlier day. */
    logTime(taskId, minutes, { day = null, deep = false, note = '' } = {}) {
      if (!(minutes > 0)) return null;
      let end = now();
      if (day && day !== today()) {
        const [y, m, d] = day.split('-').map(Number);
        end = new Date(y, m - 1, d, 18, 0, 0);
      }
      const start = new Date(end.getTime() - minutes * 60_000);
      const e = put('entry', { id: uid(), taskId, start: start.toISOString(), end: end.toISOString(), deep, source: 'manual', note });
      emit();
      return e;
    },
    updateEntry(id, fields) {
      const e = store.entry(id);
      if (!e) return null;
      const next = put('entry', { ...e, ...fields });
      emit();
      return next;
    },
    deleteEntry(id) {
      const e = store.entry(id);
      if (!e) return null;
      drop('entry', id);
      emit();
      return e;
    },
    entryMinutes(e) {
      const end = e.end ? new Date(e.end) : now();
      return Math.max(0, (end - new Date(e.start)) / 60_000);
    },
    taskEntries(taskId) {
      return state.entries.filter((e) => e.taskId === taskId).sort((a, b) => (a.start < b.start ? 1 : -1));
    },
    tracked(taskId) {
      return state.entries.reduce((s, e) => (e.taskId === taskId ? s + store.entryMinutes(e) : s), 0);
    },
    /* Entries whose start falls on a local day from `from` to `to` (inclusive). */
    entriesBetween(from, to) {
      return state.entries.filter((e) => {
        const d = localDay(e.start);
        return d >= from && d <= to;
      });
    },
    /* How long tasks really take compared with their estimates, from finished tasks that have both. */
    estimateMultiplier(sample = 30) {
      const done = state.tasks
        .filter((t) => t.done && t.estimate > 0)
        .map((t) => ({ t, actual: store.tracked(t.id) }))
        .filter((x) => x.actual >= 1)
        .sort((a, b) => (a.t.doneAt < b.t.doneAt ? 1 : -1))
        .slice(0, sample);
      if (done.length < 3) return { ratio: null, samples: done.length };
      const est = done.reduce((s, x) => s + x.t.estimate, 0);
      const act = done.reduce((s, x) => s + x.actual, 0);
      return { ratio: act / est, samples: done.length };
    },
    /* An estimate adjusted by your multiplier, when that setting is on. */
    adjusted(minutes) {
      if (!minutes) return 0;
      const m = state.settings.adjustEstimates ? store.estimateMultiplier().ratio : null;
      return m ? minutes * m : minutes;
    },

    /* ---------- journal and Mac activity ---------- */
    journal: (day) => state.journals.find((j) => j.day === day) || null,
    saveJournal(day, fields) {
      const cur = store.journal(day);
      const j = put('journal', { id: cur ? cur.id : uid(), day, text: '', notes: '', stats: null, createdAt: cur ? cur.createdAt : stamp(), ...(cur || {}), ...fields });
      emit();
      return j;
    },
    activityDay: (day) => state.activity.find((a) => a.id === day) || null,
    /* Keeps the merged sessions of one day (not raw samples), and only the last 60 days. */
    saveActivity(day, sessions, source = 'import') {
      put('activity', { id: day, sessions, source, importedAt: stamp() });
      const keep = [...state.activity].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(60);
      for (const old of keep) drop('activity', old.id, { tombstone: false });
      emit();
    },
    /* Time logged against a project or area, with no task (from Mac activity). */
    addEntry(fields) {
      const e = put('entry', { id: uid(), taskId: null, projectId: null, areaId: null, start: stamp(), end: stamp(), deep: false, source: 'manual', note: '', ...fields });
      emit();
      return e;
    },
    setTombstones(list) {
      state.tombstones = list;
      save('meta', { id: 'tombstones', list });
    },
    removeEntries(pred) {
      for (const e of state.entries.filter(pred)) drop('entry', e.id);
      emit();
    },

    /* `silent` saves without re-rendering, for fields being typed into. */
    updateSettings(fields, { silent = false } = {}) {
      state.settings = { ...state.settings, ...fields };
      save('meta', { id: 'settings', ...state.settings });
      if (!silent) emit();
    },

    /* ---------- views ---------- */
    inbox() {
      return state.tasks.filter((t) => t.inbox && !t.done).sort(byCreated);
    },
    todayList() {
      const d = today();
      return state.tasks
        .filter((t) => !t.done && ((t.when && t.when <= d) || (t.deadline && t.deadline <= d)))
        .sort(byPlan);
    },
    doneToday() {
      const d = today();
      return state.tasks.filter((t) => t.done && t.doneAt && localDay(t.doneAt) === d).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));
    },
    /* Next `days` days after today, grouped by day. A task shows on its "when" day, or its deadline if it has no "when". */
    upcoming(days = 14) {
      const d = today();
      const end = addDays(d, days);
      const groups = new Map();
      for (const t of state.tasks) {
        if (t.done) continue;
        const day = t.when || t.deadline;
        if (!day || day <= d || day > end) continue;
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(t);
      }
      return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, tasks]) => ({ day, tasks: tasks.sort(byPlan) }));
    },
    /* Sorted tasks with no date, ready to pick up any time. */
    anytime() {
      return state.tasks.filter((t) => !t.done && !t.inbox && !t.when && !isParked(t)).sort(byPlan);
    },
    logbook(limit = 200) {
      return state.tasks.filter((t) => t.done).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)).slice(0, limit);
    },
    projectTasks(id) {
      const tasks = state.tasks.filter((t) => t.projectId === id);
      return { open: tasks.filter((t) => !t.done).sort(byPlan), done: tasks.filter((t) => t.done).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)) };
    },
    areaTasks(id) {
      return state.tasks.filter((t) => t.areaId === id && !t.projectId && !t.done).sort(byPlan);
    },
    areaProjects(id) {
      return state.projects.filter((p) => (p.areaId || null) === (id || null) && p.status !== 'archived').sort(byProject);
    },
    projectStats(id) {
      const p = store.project(id);
      const { open, done } = store.projectTasks(id);
      const total = open.length + done.length;
      const estimateLeft = open.reduce((s, t) => s + (t.estimate || 0), 0);
      const unestimated = open.filter((t) => !t.estimate).length;
      const daysLeft = p && p.deadline ? daysBetween(today(), p.deadline) : null;
      const tracked = [...open, ...done].reduce((s, t) => s + store.tracked(t.id), 0)
        + state.entries.filter((e) => !e.taskId && e.projectId === id).reduce((s, e) => s + store.entryMinutes(e), 0);
      return { open: open.length, done: done.length, total, progress: total ? done.length / total : 0, estimateLeft, unestimated, daysLeft, tracked };
    },
    /* Planned minutes for today against the hours you said you have. */
    capacity() {
      const list = store.todayList();
      const planned = list.reduce((s, t) => s + (t.estimate || 0), 0);
      return { planned, available: state.settings.hoursPerDay * 60, unestimated: list.filter((t) => !t.estimate).length, count: list.length };
    },
    counts() {
      return { inbox: store.inbox().length, today: store.todayList().length };
    },
    /* Text search across tasks, projects and areas, for the command palette. */
    search(q, limit = 30) {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      const hits = [];
      for (const a of state.areas) if (a.name.toLowerCase().includes(s)) hits.push({ kind: 'area', item: a });
      for (const p of state.projects) if (p.name.toLowerCase().includes(s)) hits.push({ kind: 'project', item: p });
      for (const t of state.tasks) if ((t.title + ' ' + t.notes).toLowerCase().includes(s)) hits.push({ kind: 'task', item: t });
      return hits.slice(0, limit);
    },
    projectOf: (t) => (t.projectId ? store.project(t.projectId) : null),
    areaOf(t) {
      const p = store.projectOf(t);
      return store.area(p ? p.areaId : t.areaId);
    },
  };

  /* Tasks in a someday or archived project stay out of Anytime. */
  function isParked(t) {
    const p = t.projectId && store.project(t.projectId);
    return !!p && p.status !== 'active';
  }
  return store;
}

function localDay(isoStamp) {
  return todayISO(new Date(isoStamp));
}
function byCreated(a, b) {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
/* Earliest date first (overdue on top), then time of day, then priority, then the order added. */
export function byPlan(a, b) {
  const da = a.when || a.deadline || '9999', db = b.when || b.deadline || '9999';
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.time || '99', tb = b.time || '99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.order - b.order;
}
function byProject(a, b) {
  const rank = { active: 0, someday: 1, done: 2, archived: 3 };
  if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
  const da = a.deadline || '9999', db = b.deadline || '9999';
  if (da !== db) return da < db ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

/* A first-run example so the app isn't empty, all of it deletable. */
export function seed(store) {
  const d = store.today();
  const work = store.addArea('Work', AREA_COLORS[0]);
  const personal = store.addArea('Personal', AREA_COLORS[2]);
  store.addArea('Health', AREA_COLORS[1]);
  const start = store.addProject('Getting started with JourneyMan', { areaId: personal.id });
  const tips = [
    ['Press N and type: Plan the week #getting-started ~20m tomorrow', 5],
    ['Try a deadline: Send report @work due fri !!', 5],
    ['Open the Inbox and give each item a project or a date', 10],
    ['Press ⌘K to jump to any project, area or task', 2],
    ['Press ? to see every keyboard shortcut', 2],
  ];
  tips.forEach(([title, estimate], i) => store.addTask({ title, projectId: start.id, estimate, when: i === 0 ? d : null, order: i }));
  store.addTask({ title: 'Something you thought of on the go', inbox: true });
  store.addProject('Example project', { areaId: work.id, deadline: addDays(d, 10), notes: 'Projects have an end. Give each one a next action.' });
  store.updateSettings({ seeded: true });
}
