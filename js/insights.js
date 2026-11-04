// JourneyMan — phase 3: rankings, project health and forecasts. Plain rules, no DOM, so it's
// predictable, works offline and runs in Node tests. Every number comes with the reason behind it.

import { addDays, daysBetween, formatDay } from './parse.js';
import { weekStart, localDay, bucket } from './reports.js';

const clamp = (x) => Math.max(0, Math.min(1, x));
const DEFAULT_ESTIMATE = 30; // minutes assumed for a task with no estimate, in forecasts
const hm = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);

/* Tasks the rankings and forecasts look at: open, sorted out of the inbox, not in a parked project. */
export function activeTasks(store) {
  return store.state.tasks.filter((t) => {
    if (t.done || t.inbox) return false;
    const p = t.projectId && store.project(t.projectId);
    return !p || p.status === 'active';
  });
}

/* The last time anything happened in a project: a task added or finished, or time logged. */
export function lastActivity(store, projectId) {
  const p = store.project(projectId);
  let last = p ? p.createdAt : null;
  const bump = (s) => { if (s && (!last || s > last)) last = s; };
  for (const t of store.state.tasks) {
    if (t.projectId !== projectId) continue;
    bump(t.createdAt);
    bump(t.doneAt);
    for (const e of store.state.entries) if (e.taskId === t.id) bump(e.end || e.start);
  }
  for (const e of store.state.entries) if (!e.taskId && e.projectId === projectId) bump(e.end || e.start);
  return last;
}
export function idleDays(store, projectId) {
  const last = lastActivity(store, projectId);
  return last ? Math.max(0, daysBetween(localDay(last), store.today())) : 0;
}

/* Minutes still free today: your hours minus what you've tracked so far. */
export function freeToday(store) {
  const day = store.today();
  const tracked = store.entriesBetween(day, day).reduce((s, e) => s + store.entryMinutes(e), 0);
  return Math.max(store.state.settings.hoursPerDay * 60 - tracked, 0);
}

/*
  score = 3·urgency + 2·importance + fit + staleness, each part 0–1.
    urgency    deadline closeness (task's own, or its project's), or a planned day that has come
    importance priority, plus a lift when the project's deadline is near
    fit        whether the (adjusted) estimate fits the time you have
    staleness  how long the project has gone untouched
*/
export function scoreTask(store, t, { freeMinutes = freeToday(store) } = {}) {
  const today = store.today();
  const p = store.projectOf(t);
  const reasons = [];

  const deadline = t.deadline || (p && p.deadline) || null;
  const ownDeadline = !!t.deadline;
  let urgency = 0;
  if (deadline) {
    const d = daysBetween(today, deadline);
    urgency = d <= 0 ? 1 : clamp(1 - d / 14);
    const what = ownDeadline ? '' : 'Project ';
    if (d < 0) reasons.push(`${what}${ownDeadline ? 'Overdue' : 'overdue'} by ${-d} day${d === -1 ? '' : 's'}`);
    else if (d === 0) reasons.push(`${what}${ownDeadline ? 'Due' : 'due'} today`);
    else if (d <= 7) reasons.push(`${what}${ownDeadline ? 'Due' : 'due'} ${formatDay(deadline, today)}`);
  }
  if (t.when) {
    const d = daysBetween(today, t.when);
    const u = d <= 0 ? 0.8 : clamp(0.5 - d / 14);
    if (u > urgency) urgency = u;
    if (d < 0) reasons.push(`Planned for ${formatDay(t.when, today)}`);
    else if (d === 0) reasons.push('Planned for today');
  }

  let importance = (t.priority || 0) / 3;
  if (t.priority) reasons.push(`Priority ${'!'.repeat(t.priority)}`);
  if (p && p.deadline && daysBetween(today, p.deadline) <= 21) importance += 0.25;
  importance = clamp(importance);

  const est = t.estimate ? store.adjusted(t.estimate) : null;
  let fit = 0.5;
  if (est) {
    fit = est <= freeMinutes ? 1 : clamp(freeMinutes / est);
    if (est <= freeMinutes) reasons.push(`Fits in your ${hm(freeMinutes)} left`);
    else if (freeMinutes > 0) reasons.push(`Needs ${hm(est)}, more than you have left`);
  }

  let staleness = 0;
  if (p) {
    const idle = idleDays(store, p.id);
    staleness = clamp(idle / 14);
    if (idle >= 7) reasons.push(`${p.name} untouched for ${idle} days`);
  }

  const parts = { urgency, importance, fit, staleness };
  return { task: t, score: 3 * urgency + 2 * importance + fit + staleness, parts, reasons };
}

/* The ranked list behind "Next up". `maxMinutes` keeps only tasks that fit a gap you have. */
export function nextUp(store, { limit = 3, maxMinutes = null } = {}) {
  const free = maxMinutes ?? freeToday(store);
  const running = store.running();
  return activeTasks(store)
    .filter((t) => !running || running.taskId !== t.id)
    .filter((t) => !t.when || t.when <= store.today())
    .filter((t) => maxMinutes == null || !t.estimate || store.adjusted(t.estimate) <= maxMinutes)
    .map((t) => scoreTask(store, t, { freeMinutes: free }))
    .sort((a, b) => b.score - a.score || a.task.order - b.task.order)
    .slice(0, limit);
}

/* Remaining work in minutes: adjusted estimates, with a default for tasks that have none. */
function remainingWork(store, tasks) {
  return tasks.reduce((s, t) => s + store.adjusted(t.estimate || DEFAULT_ESTIMATE), 0);
}
/* Work days between today (included) and a date, at your days-per-week. */
function workDays(store, to) {
  const days = daysBetween(store.today(), to) + 1;
  return Math.max(days * (store.state.settings.daysPerWeek / 7), 1);
}

/*
  Project health, with the reason in words:
    done / someday           not judged
    no-next-action           active with nothing left to do
    overdue                  deadline passed with work open
    stalled                  nothing has happened for 14+ days
    at-risk                  the work left needs more than half your day until the deadline,
                             or your recent pace on it won't get there
    on-track                 otherwise
*/
export function projectHealth(store, projectId) {
  const p = store.project(projectId);
  if (!p) return null;
  if (p.status === 'done' || p.status === 'archived') return { status: 'done', label: 'Completed', detail: '' };
  if (p.status === 'someday') return { status: 'someday', label: 'Someday', detail: 'Parked. Not counted in forecasts.' };
  const { open } = store.projectTasks(projectId);
  const today = store.today();
  const idle = idleDays(store, projectId);
  if (!open.length) return { status: 'no-next-action', label: 'No next action', detail: 'Add the next task so the project can move.' };
  if (p.deadline && p.deadline < today) {
    const d = daysBetween(p.deadline, today);
    return { status: 'overdue', label: 'Overdue', detail: `Deadline passed ${d} day${d === 1 ? '' : 's'} ago with ${open.length} task${open.length === 1 ? '' : 's'} open.` };
  }
  if (idle >= 14) return { status: 'stalled', label: 'Stalled', detail: `Nothing done or tracked for ${idle} days.` };
  if (!p.deadline) return { status: 'on-track', label: 'Active', detail: idle >= 7 ? `Quiet for ${idle} days.` : 'No deadline.' };

  const remaining = remainingWork(store, open);
  const days = workDays(store, p.deadline);
  const need = remaining / days; // minutes per work day
  const dayMinutes = store.state.settings.hoursPerDay * 60;
  // Recent pace: minutes tracked on this project per work day over the last 14 days.
  const from = addDays(today, -13);
  const ids = new Set(store.state.tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
  const recent = store.entriesBetween(from, today).filter((e) => ids.has(e.taskId)).reduce((s, e) => s + store.entryMinutes(e), 0);
  const pace = recent / (14 * (store.state.settings.daysPerWeek / 7));
  const due = formatDay(p.deadline, today);
  if (need > dayMinutes * 0.5) {
    return { status: 'at-risk', label: 'At risk', detail: `Needs about ${hm(need)} a day until ${due}, more than half your day.`, need, pace };
  }
  if (recent > 0 && pace * days < remaining * 0.8) {
    return { status: 'at-risk', label: 'At risk', detail: `At your recent pace (${hm(pace)} a day) about ${hm(Math.max(remaining - pace * days, 0))} will be left at ${due}.`, need, pace };
  }
  return { status: 'on-track', label: 'On track', detail: `Needs about ${hm(need)} a day until ${due}.`, need, pace };
}

const HEALTH_ORDER = { overdue: 0, 'at-risk': 1, stalled: 2, 'no-next-action': 3, 'on-track': 4, someday: 5, done: 6 };
export function projectsByHealth(store) {
  return store.state.projects
    .filter((p) => p.status === 'active')
    .map((p) => ({ project: p, health: projectHealth(store, p.id) }))
    .sort((a, b) => HEALTH_ORDER[a.health.status] - HEALTH_ORDER[b.health.status] || (a.project.deadline || '9') .localeCompare(b.project.deadline || '9'));
}

/*
  Planned hours against available hours for the next `weeks` weeks (this week counts only the days left).
  A task counts in the week of its "when" day. A task with only a deadline (its own or its project's)
  is spread evenly over the work days until then. Overdue plans land in this week.
*/
export function workloadForecast(store, weeks = 4) {
  const today = store.today();
  const s = store.state.settings;
  const first = weekStart(today);
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(first, 7 * i);
    const end = addDays(start, 6);
    const daysLeft = i === 0 ? daysBetween(today, end) + 1 : 7;
    out.push({ start, end, planned: 0, unestimated: 0, available: s.hoursPerDay * 60 * s.daysPerWeek * (daysLeft / 7) });
  }
  const lastDay = out[out.length - 1].end;
  const weekOf = (day) => out.find((w) => day >= w.start && day <= w.end);
  for (const t of activeTasks(store)) {
    const mins = store.adjusted(t.estimate || DEFAULT_ESTIMATE);
    if (t.when) {
      const w = weekOf(t.when < today ? today : t.when);
      if (w) { w.planned += mins; if (!t.estimate) w.unestimated++; }
      continue;
    }
    const p = store.projectOf(t);
    const deadline = t.deadline || (p && p.deadline);
    if (!deadline) continue;
    const until = deadline < today ? today : deadline;
    const span = daysBetween(today, until) + 1;
    for (let d = 0; d < span; d++) {
      const day = addDays(today, d);
      if (day > lastDay) break;
      const w = weekOf(day);
      if (w) w.planned += mins / span;
    }
    const w = weekOf(today);
    if (!t.estimate && w) w.unestimated++;
  }
  return out.map((w) => ({ ...w, over: Math.max(w.planned - w.available, 0) }));
}

/* Tracked minutes per area for each of the last `weeks` weeks (oldest first). */
export function areaWeeks(store, weeks = 8) {
  const first = addDays(weekStart(store.today()), -7 * (weeks - 1));
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(first, 7 * i);
    const byArea = new Map();
    for (const e of store.entriesBetween(start, addDays(start, 6))) {
      const k = bucket(store, e).areaId || 'none';
      byArea.set(k, (byArea.get(k) || 0) + store.entryMinutes(e));
    }
    out.push({ start, byArea });
  }
  return out;
}

/* Minutes tracked per weekday (Mon = 0) and hour over the last `days` days, split across hour boundaries. */
export function focusGrid(store, days = 28) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const from = addDays(store.today(), -(days - 1));
  for (const e of store.entriesBetween(from, store.today())) {
    let t = new Date(e.start).getTime();
    const end = e.end ? new Date(e.end).getTime() : store.now().getTime();
    while (t < end) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const slice = Math.min(next, end) - t;
      grid[(d.getDay() + 6) % 7][d.getHours()] += slice / 60_000;
      t += slice;
    }
  }
  return grid;
}

/* Open tasks placed by urgency (x) and importance (y), for the 2×2. */
export function matrixPoints(store) {
  return activeTasks(store).map((t) => {
    const s = scoreTask(store, t, { freeMinutes: Infinity });
    return { task: t, x: s.parts.urgency, y: s.parts.importance, reasons: s.reasons };
  });
}

/* Estimated against actual time per project, from finished tasks that have both. */
export function estimateAccuracy(store) {
  const rows = new Map();
  for (const t of store.state.tasks) {
    if (!t.done || !t.estimate) continue;
    const actual = store.tracked(t.id);
    if (actual < 1) continue;
    const p = store.projectOf(t);
    const key = p ? p.id : 'none';
    const r = rows.get(key) || { project: p, estimated: 0, actual: 0, tasks: 0 };
    r.estimated += t.estimate;
    r.actual += actual;
    r.tasks++;
    rows.set(key, r);
  }
  return [...rows.values()].map((r) => ({ ...r, ratio: r.actual / r.estimated })).sort((a, b) => b.tasks - a.tasks);
}
