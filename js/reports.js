// JourneyMan — time reports: the daily recap, the weekly report and CSV export. No DOM.

import { addDays, weekday, todayISO } from './parse.js';

export const localDay = (stamp) => todayISO(new Date(stamp));

/* Monday of the week that holds `iso`. */
export function weekStart(iso) {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}

/* Who an entry's time belongs to: its project, else its area, else nothing. */
function bucket(store, e) {
  const t = store.task(e.taskId);
  const p = t && store.projectOf(t);
  const a = t && store.areaOf(t);
  if (p) return { key: 'p:' + p.id, name: p.name, color: a ? a.color : null, areaId: a ? a.id : null };
  if (a) return { key: 'a:' + a.id, name: a.name, color: a.color, areaId: a.id };
  return { key: 'none', name: 'No project', color: null, areaId: null };
}

function groupMinutes(store, entries) {
  const map = new Map();
  for (const e of entries) {
    const b = bucket(store, e);
    const m = store.entryMinutes(e);
    const cur = map.get(b.key) || { ...b, minutes: 0 };
    cur.minutes += m;
    map.set(b.key, cur);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

/* One day: total, deep work, time by project, tasks done, planned against actual for those tasks. */
export function dayReport(store, day = store.today()) {
  const entries = store.entriesBetween(day, day);
  const total = entries.reduce((s, e) => s + store.entryMinutes(e), 0);
  const deep = entries.filter((e) => e.deep).reduce((s, e) => s + store.entryMinutes(e), 0);
  const done = store.state.tasks.filter((t) => t.done && t.doneAt && localDay(t.doneAt) === day);
  const compared = done.filter((t) => t.estimate).map((t) => ({ task: t, estimate: t.estimate, actual: store.tracked(t.id) })).filter((x) => x.actual > 0);
  return { day, total, deep, byProject: groupMinutes(store, entries), done, compared };
}

/* A week from Monday `start`: time per day split by area, per project, deep work and the biggest misses. */
export function weekReport(store, start = weekStart(store.today())) {
  const end = addDays(start, 6);
  const entries = store.entriesBetween(start, end);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const own = entries.filter((e) => localDay(e.start) === day);
    const byArea = new Map();
    for (const e of own) {
      const b = bucket(store, e);
      const k = b.areaId || 'none';
      byArea.set(k, (byArea.get(k) || 0) + store.entryMinutes(e));
    }
    days.push({ day, minutes: own.reduce((s, e) => s + store.entryMinutes(e), 0), byArea });
  }
  const total = days.reduce((s, d) => s + d.minutes, 0);
  const deep = entries.filter((e) => e.deep).reduce((s, e) => s + store.entryMinutes(e), 0);
  const byProject = groupMinutes(store, entries);
  const doneTasks = store.state.tasks.filter((t) => t.done && t.doneAt && localDay(t.doneAt) >= start && localDay(t.doneAt) <= end);
  // Tasks worked on this week that have an estimate, with the largest gap between plan and reality first.
  const touched = [...new Set(entries.map((e) => e.taskId))].map((id) => store.task(id)).filter((t) => t && t.estimate);
  const gaps = touched
    .map((t) => ({ task: t, estimate: t.estimate, actual: store.tracked(t.id) }))
    .filter((g) => g.task.done || g.actual > g.estimate)
    .sort((a, b) => Math.abs(b.actual - b.estimate) - Math.abs(a.actual - a.estimate))
    .slice(0, 5);
  const areaIds = [...new Set(days.flatMap((d) => [...d.byArea.keys()]))];
  return { start, end, days, total, deep, byProject, done: doneTasks.length, gaps, areaIds };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* Time entries as CSV, for spreadsheets or invoicing. */
export function entriesCsv(store, from, to) {
  const rows = [['Date', 'Start', 'End', 'Minutes', 'Task', 'Project', 'Area', 'Deep work', 'Source', 'Note']];
  const list = (from ? store.entriesBetween(from, to) : store.state.entries.slice()).filter((e) => e.end).sort((a, b) => (a.start < b.start ? -1 : 1));
  const hm = (stamp) => { const d = new Date(stamp); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  for (const e of list) {
    const t = store.task(e.taskId);
    const p = t && store.projectOf(t);
    const a = t && store.areaOf(t);
    rows.push([localDay(e.start), hm(e.start), hm(e.end), Math.round(store.entryMinutes(e)), t ? t.title : '(deleted task)', p ? p.name : '', a ? a.name : '', e.deep ? 'yes' : '', e.source, e.note || '']);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/* "1h 30m", "45m", "2h": the same parser quick add uses for estimates, without the ~. */
export function parseDuration(text) {
  const s = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(h|hr|hrs|hours?|m|min|mins|minutes?)?(?:(\d+)(m|min|mins|minutes?)?)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || (m[3] ? 'h' : 'm');
  let mins = unit.startsWith('h') ? n * 60 : n;
  if (m[3]) { if (!unit.startsWith('h')) return null; mins += Number(m[3]); }
  mins = Math.round(mins);
  return mins > 0 && mins <= 24 * 60 ? mins : null;
}
