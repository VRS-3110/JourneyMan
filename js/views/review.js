// JourneyMan — the weekly review (GTD-style): empty the inbox, check every project, look back,
// look ahead, tidy up, reflect. Finishing it logs the review and keeps a streak.

import { projectsByHealth, workloadForecast } from '../insights.js';
import { weekReport, weekStart } from '../reports.js';
import { addDays, daysBetween, formatDay, fromISO } from '../parse.js';
import { esc, icon, hours } from '../ui.js';
import { healthBadge } from './insights.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

/* Consecutive weeks (back from this one or last) with a finished review. */
export function reviewStreak(store) {
  const weeks = new Set((store.state.settings.reviews || []).map((r) => weekStart(r.date)));
  let w = weekStart(store.today());
  if (!weeks.has(w)) w = addDays(w, -7);
  let n = 0;
  while (weeks.has(w)) { n++; w = addDays(w, -7); }
  return n;
}
export function lastReview(store) {
  const r = [...(store.state.settings.reviews || [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return r || null;
}
/* Due when there's been no review for 7 days. */
export function reviewDue(store) {
  const r = lastReview(store);
  return !r || daysBetween(r.date, store.today()) >= 7;
}

export function reviewHead(store) {
  const streak = reviewStreak(store);
  const last = lastReview(store);
  return `<div class="title-row"><span class="view-icon v-review">${icon('review')}</span><h1>Weekly review</h1></div>
    <p class="view-sub">${last ? `Last review ${esc(formatDay(last.date, store.today()))}` : 'No review yet'}${streak ? ` · ${streak} week${streak === 1 ? '' : 's'} in a row` : ''}. About 20 minutes, once a week.</p>`;
}

/* Everything the review shows, so the summary and the steps agree. */
export function reviewData(store) {
  const today = store.today();
  const lastWeekStart = addDays(weekStart(today), -7);
  const last = weekReport(store, lastWeekStart);
  const forecast = workloadForecast(store, 2);
  const next = forecast[1];
  const attention = projectsByHealth(store).filter((x) => ['overdue', 'stalled', 'no-next-action', 'at-risk'].includes(x.health.status));
  const deadlines = [
    ...store.state.projects.filter((p) => p.status === 'active' && p.deadline && p.deadline >= today && daysBetween(today, p.deadline) <= 14).map((p) => ({ name: p.name, day: p.deadline, kind: 'project', id: p.id })),
    ...store.state.tasks.filter((t) => !t.done && t.deadline && t.deadline >= today && daysBetween(today, t.deadline) <= 14).map((t) => ({ name: t.title, day: t.deadline, kind: 'task', id: t.id })),
  ].sort((a, b) => (a.day < b.day ? -1 : 1));
  const finished = store.state.projects.filter((p) => p.status === 'done');
  const someday = store.state.projects.filter((p) => p.status === 'someday');
  const journals = store.state.journals.filter((j) => j.day >= lastWeekStart && j.day <= addDays(lastWeekStart, 6));
  return { inbox: store.inbox().length, last, lastWeekStart, next, attention, deadlines, finished, someday, journals };
}

function step(n, title, done, body) {
  return `<section class="card step${done ? ' step-done' : ''}">
    <h2 class="card-title"><span class="step-n">${done ? icon('check') : n}</span>${title}</h2>${body}</section>`;
}

export function reviewBody(store, { notion, ai = false }) {
  const d = reviewData(store);
  const top = d.last.byProject.slice(0, 4).map((b) => `${esc(b.name)} ${hours(b.minutes)}`).join(' · ');
  return [
    step(1, 'Empty the inbox', d.inbox === 0, d.inbox
      ? `<p>${d.inbox} item${d.inbox === 1 ? '' : 's'} to sort. Give each a project, an area or a date, or delete it.</p><a class="btn small" href="#inbox">Open the Inbox</a>`
      : '<p class="hint">Inbox is empty.</p>'),
    step(2, 'Check every project', d.attention.length === 0, d.attention.length
      ? `<ul class="health-list">${d.attention.map(({ project: p, health: h }) => `<li><a href="#project/${p.id}"><b>${esc(p.name)}</b></a>${healthBadge(h)}<span class="muted">${esc(h.detail)}</span></li>`).join('')}</ul>
         <p class="hint">Give each one a next action, a new deadline, or set it to Someday.</p>`
      : '<p class="hint">Every active project has a next action and is moving.</p>'),
    step(3, `Look back: week of ${short(d.lastWeekStart)}`, false, `
      <p><b>${hours(d.last.total)}</b> tracked${d.last.deep ? ` (${hours(d.last.deep)} deep work)` : ''} · <b>${d.last.done}</b> task${d.last.done === 1 ? '' : 's'} done · ${d.journals.length} journal entr${d.journals.length === 1 ? 'y' : 'ies'}</p>
      ${top ? `<p class="hint">Most time: ${top}</p>` : ''}
      ${d.last.gaps.length ? `<p class="hint">Biggest miss: ${esc(d.last.gaps[0].task.title)} (${hours(d.last.gaps[0].estimate)} planned, ${hours(d.last.gaps[0].actual)} actual).</p>` : ''}
      <a class="btn small ghost" href="#time">Open Time</a>`),
    step(4, 'Look ahead', false, `
      <p>Next week: <b>${hours(d.next.planned)}</b> planned against <b>${hours(d.next.available)}</b> available${d.next.over > 30 ? ` · <span class="late-text">${icon('warn')} ${hours(d.next.over)} over</span>` : ''}.</p>
      ${d.deadlines.length ? `<ul class="deadlines">${d.deadlines.slice(0, 8).map((x) => `<li><span class="muted">${esc(formatDay(x.day, store.today()))}</span> ${x.kind === 'project' ? `<a href="#project/${x.id}">${esc(x.name)}</a>` : esc(x.name)}</li>`).join('')}</ul>` : '<p class="hint">No deadlines in the next two weeks.</p>'}
      <a class="btn small ghost" href="#upcoming">Open Upcoming</a>`),
    step(5, 'Tidy up', d.finished.length === 0, `
      ${d.finished.length ? `<p>${d.finished.length} completed project${d.finished.length === 1 ? '' : 's'} can be archived.</p><button type="button" class="btn small" data-act="archive">Archive completed projects</button>` : '<p class="hint">No completed projects waiting.</p>'}
      ${d.someday.length ? `<p class="hint">${d.someday.length} Someday project${d.someday.length === 1 ? '' : 's'}: ${d.someday.slice(0, 5).map((p) => `<a href="#project/${p.id}">${esc(p.name)}</a>`).join(', ')}. Bring one back if there's room.</p>` : ''}`),
    step(6, 'Reflect', false, `
      <textarea id="review-notes" class="journal-notes" rows="4" placeholder="What went well? What will you change next week?"></textarea>
      <div class="journal-actions">
        ${ai ? `<button type="button" class="btn ghost" data-act="ai-review">${icon('sparkle')} Draft with Claude</button>` : ''}
        ${notion ? `<label class="check-field"><input type="checkbox" id="review-notion" checked> Add to my Notion journal</label>` : ''}
        <button type="button" class="btn primary" data-act="finish">Finish review</button>
      </div>`),
  ].join('');
}

/* The words saved with a review, and sent to Notion. */
export function reviewSummary(store, notes) {
  const d = reviewData(store);
  const lines = [
    `Weekly review, week of ${short(d.lastWeekStart)}.`,
    `Tracked ${hours(d.last.total)}${d.last.deep ? ` (${hours(d.last.deep)} deep work)` : ''}, finished ${d.last.done} task${d.last.done === 1 ? '' : 's'}.`,
  ];
  if (d.last.byProject.length) lines.push(`Most time: ${d.last.byProject.slice(0, 3).map((b) => `${b.name} (${hours(b.minutes)})`).join(', ')}.`);
  lines.push(`Next week: ${hours(d.next.planned)} planned of ${hours(d.next.available)} available.`);
  if (d.attention.length) lines.push(`Needs attention: ${d.attention.map((x) => `${x.project.name} (${x.health.label.toLowerCase()})`).join(', ')}.`);
  if (notes) lines.push(`Notes: ${notes}`);
  return lines.join('\n');
}
