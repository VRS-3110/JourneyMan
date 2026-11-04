// JourneyMan — what you did on your Mac, turned into a day journal. No DOM.
//
// The Mac helper (mac-agent/) writes one JSON line every 30 seconds to
// ~/Documents/JourneyMan/activity/YYYY-MM-DD.jsonl:
//   {"t":"2026-11-04T09:00:30Z","app":"Code","title":"app.js — journeyman","idle":3}
// Here those samples become sessions, sessions are matched to tasks, projects and areas,
// and the day becomes time entries and a journal entry.

import { slugify } from './parse.js';
import { localDay } from './reports.js';

const SAMPLE_SECONDS = 30;

/* JSON lines → samples sorted by time. Bad lines are skipped. */
export function parseActivity(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (!o.t || !o.app) continue;
      const time = new Date(o.t);
      if (isNaN(time)) continue;
      out.push({ t: time.toISOString(), app: String(o.app), title: String(o.title || ''), idle: Number(o.idle) || 0 });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => (a.t < b.t ? -1 : 1));
}

/*
  Samples → sessions of one app and window title.
  A sample counts for the 30 seconds before it. Idle samples (no keyboard or mouse for
  `idleLimit` seconds) and ignored apps are dropped; a gap longer than `gapLimit` seconds
  (Mac asleep, helper stopped) ends a session.
*/
export function toSessions(samples, { idleLimit = 120, gapLimit = 90, ignore = [] } = {}) {
  const sessions = [];
  let cur = null;
  let prevT = null;
  for (const s of samples) {
    const t = new Date(s.t).getTime();
    const gap = prevT == null ? Infinity : (t - prevT) / 1000;
    prevT = t;
    const skip = s.idle >= idleLimit || ignore.includes(s.app);
    if (skip || gap > gapLimit) { if (cur) sessions.push(cur); cur = null; }
    if (skip) continue;
    const step = Math.min(gap, SAMPLE_SECONDS) * 1000;
    if (cur && cur.app === s.app && cur.title === s.title) {
      cur.end = new Date(t).toISOString();
    } else {
      if (cur) sessions.push(cur);
      cur = { start: new Date(t - (gap === Infinity ? SAMPLE_SECONDS * 1000 : step)).toISOString(), end: new Date(t).toISOString(), app: s.app, title: s.title };
    }
  }
  if (cur) sessions.push(cur);
  return sessions.map((x) => ({ ...x, minutes: (new Date(x.end) - new Date(x.start)) / 60_000 })).filter((x) => x.minutes > 0);
}

/* Words worth matching on: a name of 4+ letters, compared as slugs so punctuation doesn't matter. */
const norm = (s) => '-' + slugify(s) + '-';
function mentions(title, name) {
  const n = slugify(name);
  return n.length >= 4 && norm(title).includes('-' + n + '-');
}

/*
  What a session was for, first match wins:
    1. your rules (app name or title contains …)
    2. a task's title in the window title (open tasks first)
    3. a project's name in the window title
    4. an area's name in the window title
  Returns { kind, id, via } or null.
*/
export function classify(session, store, rules = store.state.settings.activityRules || []) {
  const title = session.title || '';
  for (const r of rules) {
    const hay = r.field === 'app' ? session.app : title;
    if (r.contains && hay.toLowerCase().includes(r.contains.toLowerCase())) {
      const ok = r.target.kind === 'task' ? store.task(r.target.id) : r.target.kind === 'project' ? store.project(r.target.id) : store.area(r.target.id);
      if (ok) return { kind: r.target.kind, id: r.target.id, via: 'rule' };
    }
  }
  if (!title) return null;
  const tasks = [...store.state.tasks].sort((a, b) => Number(a.done) - Number(b.done));
  for (const t of tasks) {
    // The full name, or its core: without a trailing "(…)" or what follows a colon.
    const names = [t.title, t.title.replace(/\s*\([^)]*\)\s*$/, ''), t.title.split(':')[0]].filter((n, i, a) => n.length >= 6 && a.indexOf(n) === i);
    if (names.some((n) => mentions(title, n))) return { kind: 'task', id: t.id, via: 'title' };
  }
  for (const p of store.state.projects) if (mentions(title, p.name)) return { kind: 'project', id: p.id, via: 'title' };
  for (const a of store.state.areas) if (mentions(title, a.name)) return { kind: 'area', id: a.id, via: 'title' };
  return null;
}

export function targetName(store, target) {
  if (!target) return 'Unmatched';
  if (target.kind === 'task') return store.task(target.id)?.title || 'Task';
  if (target.kind === 'project') return store.project(target.id)?.name || 'Project';
  return store.area(target.id)?.name || 'Area';
}
/* The area a target belongs to (for colour). */
export function targetArea(store, target) {
  if (!target) return null;
  if (target.kind === 'task') { const t = store.task(target.id); return t ? store.areaOf(t) : null; }
  if (target.kind === 'project') { const p = store.project(target.id); return p ? store.area(p.areaId) : null; }
  return store.area(target.id);
}

/* A suggested rule for an unmatched session: the app for app-only work, otherwise a short title phrase. */
export function suggestRule(session) {
  const browsers = ['Safari', 'Google Chrome', 'Arc', 'Firefox', 'Microsoft Edge', 'Brave Browser'];
  const title = (session.title || '').split(/ [—–-] | \| /)[0].trim();
  if (!title || title.length < 3) return { field: 'app', contains: session.app };
  if (browsers.includes(session.app) || title.length > 3) return { field: 'title', contains: title.slice(0, 60) };
  return { field: 'app', contains: session.app };
}

/* The whole day: totals, by app, by what it was for, the unmatched list and a timeline. */
export function summarizeDay(store, sessions) {
  const classified = sessions.map((s) => ({ ...s, target: classify(s, store) }));
  const total = classified.reduce((n, s) => n + s.minutes, 0);
  const byApp = groupBy(classified, (s) => s.app).map(([app, list]) => ({ app, minutes: sum(list) })).sort((a, b) => b.minutes - a.minutes);
  const matched = groupBy(classified.filter((s) => s.target), (s) => `${s.target.kind}:${s.target.id}`)
    .map(([, list]) => ({ target: list[0].target, minutes: sum(list), name: targetName(store, list[0].target), area: targetArea(store, list[0].target) }))
    .sort((a, b) => b.minutes - a.minutes);
  const unmatched = groupBy(classified.filter((s) => !s.target), (s) => `${s.app}\u0000${s.title}`)
    .map(([, list]) => ({ app: list[0].app, title: list[0].title, minutes: sum(list), sample: list[0] }))
    .sort((a, b) => b.minutes - a.minutes);
  const matchedMinutes = matched.reduce((n, m) => n + m.minutes, 0);
  const first = classified[0]?.start || null, last = classified[classified.length - 1]?.end || null;
  return { sessions: classified, total, byApp, matched, unmatched, matchedMinutes, first, last };
}

/*
  Turns matched activity into time entries (source "activity"). Re-running replaces that day's
  activity entries, so it never double counts; time already covered by a timer or a manual log
  is left out.
*/
export function applyActivity(store, day, sessions) {
  store.removeEntries((e) => e.source === 'activity' && localDay(e.start) === day);
  const own = store.state.entries.filter((e) => e.source !== 'activity' && e.end && localDay(e.start) === day)
    .map((e) => [new Date(e.start).getTime(), new Date(e.end).getTime()]);
  let added = 0;
  for (const s of sessions) {
    const target = s.target || classify(s, store);
    if (!target) continue;
    for (const [a, b] of subtract([new Date(s.start).getTime(), new Date(s.end).getTime()], own)) {
      if (b - a < 60_000) continue;
      const fields = { start: new Date(a).toISOString(), end: new Date(b).toISOString(), source: 'activity', note: `${s.app}${s.title ? ': ' + s.title : ''}`.slice(0, 140) };
      if (target.kind === 'task') fields.taskId = target.id;
      else if (target.kind === 'project') fields.projectId = target.id;
      else fields.areaId = target.id;
      store.addEntry(fields);
      added += (b - a) / 60_000;
    }
  }
  return added;
}

/* [a, b] minus every interval in `cuts`. */
function subtract([a, b], cuts) {
  let parts = [[a, b]];
  for (const [c, d] of cuts) {
    parts = parts.flatMap(([x, y]) => (d <= x || c >= y ? [[x, y]] : [[x, Math.min(c, y)], [Math.max(d, x), y]].filter(([p, q]) => q > p)));
  }
  return parts;
}

/* Planned tasks for the day against what happened: done, worked on, or untouched. */
export function planVsReality(store, day, summary) {
  const planned = store.state.tasks.filter((t) => (t.when === day) || (t.when && t.when < day && !t.done) || (t.done && t.doneAt && localDay(t.doneAt) === day));
  const touched = new Set(summary.sessions.filter((s) => s.target && s.target.kind === 'task').map((s) => s.target.id));
  for (const e of store.entriesBetween(day, day)) if (e.taskId) touched.add(e.taskId);
  return planned.map((t) => ({
    task: t,
    state: t.done && t.doneAt && localDay(t.doneAt) === day ? 'done' : touched.has(t.id) ? 'worked' : 'untouched',
  })).sort((a, b) => ['done', 'worked', 'untouched'].indexOf(a.state) - ['done', 'worked', 'untouched'].indexOf(b.state));
}

const hm = (m) => { const r = Math.round(m); return r >= 60 ? `${Math.floor(r / 60)}h${r % 60 ? ` ${r % 60}m` : ''}` : `${r}m`; };

/* A plain-words journal entry for the day (no AI). Lines, so it reads well in Notion too. */
export function journalText(store, day, summary, plan, dayReport) {
  const lines = [];
  const clock = (iso) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  if (summary.total) {
    lines.push(`At the Mac ${hm(summary.total)}, ${clock(summary.first)}–${clock(summary.last)}. ${hm(summary.matchedMinutes)} of it matched to your work.`);
    if (summary.matched.length) lines.push(`Most time: ${summary.matched.slice(0, 3).map((m) => `${m.name} (${hm(m.minutes)})`).join(', ')}.`);
    if (summary.byApp.length) lines.push(`Apps: ${summary.byApp.slice(0, 4).map((a) => `${a.app} ${hm(a.minutes)}`).join(', ')}.`);
  }
  if (dayReport && dayReport.total) lines.push(`Time tracked: ${hm(dayReport.total)}${dayReport.deep ? `, ${hm(dayReport.deep)} deep work` : ''}.`);
  const done = plan.filter((p) => p.state === 'done').map((p) => p.task.title);
  const worked = plan.filter((p) => p.state === 'worked').map((p) => p.task.title);
  const untouched = plan.filter((p) => p.state === 'untouched').map((p) => p.task.title);
  if (done.length) lines.push(`Finished: ${done.join('; ')}.`);
  if (worked.length) lines.push(`Worked on: ${worked.join('; ')}.`);
  if (untouched.length) lines.push(`Planned but not started: ${untouched.join('; ')}.`);
  if (!lines.length) lines.push('Nothing recorded for this day yet.');
  return lines.join('\n');
}

/* Moves planned tasks that weren't finished to `toDay`. Returns how many moved. */
export function rollForward(store, plan, toDay) {
  let n = 0;
  for (const p of plan) {
    if (p.state === 'done') continue;
    store.updateTask(p.task.id, { when: toDay });
    n++;
  }
  return n;
}

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.entries()];
}
const sum = (list) => list.reduce((n, s) => n + s.minutes, 0);
export { SAMPLE_SECONDS };
