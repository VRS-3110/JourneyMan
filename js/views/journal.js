// JourneyMan — the Journal view: what you did on your Mac, matched to your work,
// planned against actual, and a journal entry for the day.

import { summarizeDay, planVsReality, journalText, targetName } from '../activity.js';
import { dayReport } from '../reports.js';
import { timeline } from '../charts.js';
import { esc, icon, hours } from '../ui.js';
import { colorVar } from '../model.js';
import { addDays, fromISO, formatDay } from '../parse.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDay = (iso) => { const d = fromISO(iso); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function journalHead(store, ui, { folder }) {
  const day = ui.journalDay || store.today();
  const isToday = day === store.today();
  const canPick = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  let source = '';
  if (folder === 'granted') source = `<span class="src-ok">${icon('ok')} Reading your activity folder</span>`;
  else if (folder === 'prompt') source = `<button type="button" class="btn small" data-act="reconnect">Reconnect activity folder</button>`;
  else if (canPick) source = `<button type="button" class="btn small" data-act="connect">Connect activity folder</button>`;
  return `<div class="title-row"><span class="view-icon v-review">${icon('note')}</span><h1>Journal</h1></div>
    <p class="view-sub">${esc(longDay(day))}</p>
    <div class="head-fields">
      <div class="seg week-nav" role="group" aria-label="Day">
        <button type="button" data-day="-1" aria-label="Previous day">‹</button>
        <button type="button" data-day="0" aria-pressed="${isToday}">${isToday ? 'Today' : esc(formatDay(day, store.today()))}</button>
        <button type="button" data-day="1" aria-label="Next day"${isToday ? ' disabled' : ''}>›</button>
      </div>
      ${source}
      <label class="btn small ghost" for="activity-file">Import a day's file</label>
      <input type="file" id="activity-file" accept=".jsonl,.json,.txt,application/json" multiple hidden>
    </div>`;
}

export function journalData(store, day) {
  const act = store.activityDay(day);
  const summary = summarizeDay(store, act ? act.sessions : []);
  const plan = planVsReality(store, day, summary);
  const report = dayReport(store, day);
  return { act, summary, plan, report };
}

export function journalBody(store, ui, { notion }) {
  const day = ui.journalDay || store.today();
  const { act, summary, plan, report } = journalData(store, day);
  const saved = store.journal(day);
  const text = saved?.text || journalText(store, day, summary, plan, report);
  let html = '';

  if (!act) {
    html += `<section class="card helper-card"><h2 class="card-title">${icon('time')} See what you did on your Mac</h2>
      <p>Install the small JourneyMan helper (in the <code>mac-agent</code> folder: <code>bash install.sh</code>). Every 30 seconds it notes which app and window you're in, stored only on your Mac in <code>Documents/JourneyMan/activity</code>.</p>
      <p class="hint">Then connect that folder here (Chrome) or import a day's <code>.jsonl</code> file (Safari). The JourneyMan Mac app reads it by itself. Below, the journal still uses your timers and tasks.</p></section>`;
  } else {
    const activeApps = summary.byApp.slice(0, 5).map((a) => `${esc(a.app)} ${hours(a.minutes)}`).join(' · ');
    html += `<div class="tiles">
      <div class="tile"><span>At the Mac</span><b>${hours(summary.total)}</b><small>${clock(summary.first)}–${clock(summary.last)}</small></div>
      <div class="tile"><span>Matched to your work</span><b>${hours(summary.matchedMinutes)}</b><small>${summary.total ? Math.round((summary.matchedMinutes / summary.total) * 100) : 0}% of active time</small></div>
      <div class="tile"><span>Tracked</span><b>${hours(report.total)}</b><small>timers, logs and added activity</small></div>
      <div class="tile"><span>Tasks done</span><b>${report.done.length}</b><small>${plan.filter((p) => p.state === 'untouched').length} planned, not started</small></div></div>
    <section class="card"><h2 class="card-title">Your day</h2><p class="card-sub">${activeApps}</p><div id="day-timeline"></div>
      <div class="chart-legend">${legendFor(store, summary)}</div></section>
    <div class="two-col">
      <section class="card"><h2 class="card-title">Where the time went</h2>
        ${summary.matched.length ? `<ul class="bars">${summary.matched.map((m) => barRow(m.name, m.minutes, summary.total, m.area ? colorVar(m.area.color) : 'var(--c-noarea)', m.target.kind)).join('')}</ul>` : '<p class="hint">Nothing matched yet. Assign some of the time on the right.</p>'}
      </section>
      <section class="card"><h2 class="card-title">Not matched yet</h2>
        ${summary.unmatched.length ? `<ul class="unmatched">${summary.unmatched.slice(0, 12).map((u, i) => `<li>
            <span class="um-main"><b>${esc(u.app)}</b><small>${esc(u.title || 'No window title')}</small></span>
            <span class="num">${hours(u.minutes)}</span>
            <button type="button" class="btn small ghost" data-assign="${i}">Assign…</button></li>`).join('')}</ul>
          <p class="hint">Assigning adds a rule, so the same app or window title matches next time.</p>` : '<p class="hint">Everything is matched.</p>'}
      </section>
    </div>`;
  }

  const untouched = plan.filter((p) => p.state !== 'done').length;
  html += `<section class="card"><h2 class="card-title">Plan against reality</h2>
    ${plan.length ? `<ul class="plan">${plan.map((p) => `<li data-id="${p.task.id}">
        <span class="pstate s-${p.state}">${icon(p.state === 'done' ? 'ok' : p.state === 'worked' ? 'time' : 'pause')}${p.state === 'done' ? 'Done' : p.state === 'worked' ? 'Worked on' : 'Not started'}</span>
        <button type="button" class="plan-title" data-open="${p.task.id}">${esc(p.task.title)}</button>
        ${p.task.when && p.task.when < day ? `<span class="muted">from ${esc(formatDay(p.task.when, store.today()))}</span>` : ''}
      </li>`).join('')}</ul>
      ${untouched && day === store.today() ? `<div class="row-actions-inline"><button type="button" class="btn small" data-act="roll">Move ${untouched} unfinished to tomorrow</button></div>` : ''}`
      : '<p class="hint">Nothing was planned for this day.</p>'}
  </section>`;

  html += `<section class="card"><h2 class="card-title">Journal entry</h2>
    <textarea class="journal-text" id="journal-text" rows="7">${esc(text)}</textarea>
    <label class="field-label" for="journal-notes">Your notes: how it went, what to change</label>
    <textarea class="journal-notes" id="journal-notes" rows="3" placeholder="Optional">${esc(saved?.notes || '')}</textarea>
    <div class="journal-actions">
      ${act ? '<button type="button" class="btn" data-act="apply">Add matched time to Time</button>' : ''}
      <button type="button" class="btn ghost" data-act="regen">Rewrite from the day</button>
      ${ui.aiReady ? `<button type="button" class="btn ghost" data-act="ai-journal">${icon('sparkle')} Write with Claude</button>` : ''}
      <button type="button" class="btn primary" data-act="save">${saved ? 'Update journal' : 'Save journal'}</button>
      ${notion ? `<button type="button" class="btn" data-act="notion">${icon('notion')} Add to Notion journal</button>` : ''}
    </div>
    ${saved ? `<p class="hint">Saved ${esc(new Date(saved.updatedAt).toLocaleString())}${saved.notionPageId ? ' · in Notion' : ''}.</p>` : ''}
  </section>`;

  const past = [...store.state.journals].filter((j) => j.day !== day).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 7);
  if (past.length) {
    html += `<section class="card"><h2 class="card-title">Earlier entries</h2><ul class="past">${past.map((j) => `<li><button type="button" data-goday="${j.day}">${esc(longDay(j.day))}</button><span class="muted">${esc((j.text || '').split('\n')[0].slice(0, 120))}</span></li>`).join('')}</ul></section>`;
  }
  return html;
}

function legendFor(store, summary) {
  const seen = new Map();
  for (const s of summary.sessions) {
    const a = s.target ? targetArea(store, s.target) : null;
    const k2 = a ? a.id : s.target ? 'matched' : 'none';
    if (!seen.has(k2)) seen.set(k2, a ? { label: a.name, color: colorVar(a.color) } : s.target ? { label: 'Matched, no area', color: 'var(--c-noarea)' } : { label: 'Not matched', color: 'var(--c-none)' });
  }
  return [...seen.values()].map((x) => `<span><i style="background:${x.color}"></i>${esc(x.label)}</span>`).join('');
}
function targetArea(store, target) {
  if (target.kind === 'task') { const t = store.task(target.id); return t ? store.areaOf(t) : null; }
  if (target.kind === 'project') { const p = store.project(target.id); return p ? store.area(p.areaId) : null; }
  return store.area(target.id);
}
function barRow(name, minutes, total, color, kind) {
  return `<li title="${esc(name)} (${kind})"><span class="b-name"><i class="dot" style="--c:${color}"></i>${esc(name)}</span>
    <span class="mini-bar"><i style="width:${((minutes / total) * 100).toFixed(1)}%;background:${color}"></i></span><span class="num">${hours(minutes)}</span></li>`;
}

export function journalAfter(store, ui) {
  const box = document.getElementById('day-timeline');
  if (!box) return;
  const day = ui.journalDay || store.today();
  const { summary } = journalData(store, day);
  timeline(box, {
    title: 'Your day at the Mac',
    segments: summary.sessions.map((s) => {
      const a = s.target ? targetArea(store, s.target) : null;
      return {
        start: s.start, end: s.end,
        color: s.target ? (a ? colorVar(a.color) : 'var(--c-noarea)') : 'var(--c-none)',
        label: `${s.app}${s.title ? ' · ' + s.title.slice(0, 60) : ''}`,
        sub: `${clock(s.start)}–${clock(s.end)} · ${hours(s.minutes)} · ${s.target ? targetName(store, s.target) : 'not matched'}`,
      };
    }),
  });
}

export function shiftDay(store, ui, step) {
  const cur = ui.journalDay || store.today();
  const next = step === 0 ? store.today() : addDays(cur, step);
  ui.journalDay = next > store.today() ? store.today() : next;
}
