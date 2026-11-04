// JourneyMan — the Time view: a week of tracked time, by day, area and project.

import { weekReport, weekStart, entriesCsv } from '../reports.js';
import { addDays, fromISO, formatDay } from '../parse.js';
import { stackedColumns } from '../charts.js';
import { esc, icon, hours, download } from '../ui.js';
import { colorVar } from '../model.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const short = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

export function weekLabel(store, start) {
  const thisWeek = weekStart(store.today());
  if (start === thisWeek) return 'This week';
  if (start === addDays(thisWeek, -7)) return 'Last week';
  return `${short(start)} – ${short(addDays(start, 6))}`;
}

export function timeHead(store, ui) {
  const start = ui.week || weekStart(store.today());
  const isThis = start === weekStart(store.today());
  return `<div class="title-row"><span class="view-icon v-time">${icon('time')}</span><h1>Time</h1></div>
    <div class="head-fields">
      <div class="seg week-nav" role="group" aria-label="Week">
        <button type="button" data-week="-1" aria-label="Previous week">‹</button>
        <button type="button" data-week="0" aria-pressed="${isThis}">${esc(weekLabel(store, start))}</button>
        <button type="button" data-week="1" aria-label="Next week"${isThis ? ' disabled' : ''}>›</button>
      </div>
      <button type="button" class="btn small ghost" data-export-week>Export CSV</button>
    </div>`;
}

export function timeBody(store, ui) {
  const start = ui.week || weekStart(store.today());
  const r = weekReport(store, start);
  const mult = store.estimateMultiplier();
  const tiles = [
    ['Tracked', hours(r.total), `${short(r.start)} – ${short(r.end)}`],
    ['Deep work', hours(r.deep), r.total ? `${Math.round((r.deep / r.total) * 100)}% of tracked time` : 'Mark a timer as deep work'],
    ['Tasks done', String(r.done), r.done === 1 ? 'task finished' : 'tasks finished'],
    ['Your estimates', mult.ratio ? `${mult.ratio.toFixed(2)}×` : '—',
      mult.ratio ? `Tasks take ${mult.ratio >= 1 ? 'longer' : 'less time'} than you plan (from ${mult.samples} tasks)` : `Needs 3 finished tasks with an estimate and time (${mult.samples} so far)`],
  ];
  let html = `<div class="tiles">${tiles.map(([l, v, s]) => `<div class="tile"><span>${l}</span><b>${v}</b><small>${esc(s)}</small></div>`).join('')}</div>`;
  if (!r.total) {
    return html + `<div class="empty"><b>No time tracked this week</b><p>Start a timer with the ${icon('play')} on a task, or select it and press <kbd>S</kbd>. You can also log time in a task's details.</p></div>`;
  }
  html += `<section class="card"><h2 class="card-title">Hours per day, by area</h2><div id="time-chart"></div></section>`;
  const max = r.byProject[0]?.minutes || 1;
  html += `<section class="card"><h2 class="card-title">By project</h2><table class="table">
    <thead><tr><th>Project or area</th><th class="num">Tracked</th><th class="num">Share</th><th class="bar-col" aria-hidden="true"></th></tr></thead><tbody>
    ${r.byProject.map((b) => `<tr><td><i class="dot" style="--c:${b.color ? colorVar(b.color) : 'var(--c-none)'}"></i> ${esc(b.name)}</td>
      <td class="num">${hours(b.minutes)}</td><td class="num">${Math.round((b.minutes / r.total) * 100)}%</td>
      <td class="bar-col"><span class="mini-bar"><i style="width:${((b.minutes / max) * 100).toFixed(1)}%;background:${b.color ? colorVar(b.color) : 'var(--c-none)'}"></i></span></td></tr>`).join('')}
    </tbody></table></section>`;
  if (r.gaps.length) {
    html += `<section class="card"><h2 class="card-title">Plan against reality</h2><table class="table">
      <thead><tr><th>Task</th><th class="num">Estimate</th><th class="num">Actual</th><th class="num">Difference</th></tr></thead><tbody>
      ${r.gaps.map((g) => {
        const d = g.actual - g.estimate;
        return `<tr><td>${esc(g.task.title)}${g.task.done ? '' : ' <span class="muted">(open)</span>'}</td><td class="num">${hours(g.estimate)}</td><td class="num">${hours(g.actual)}</td>
          <td class="num ${d > 0 ? 'late-text' : 'good-text'}">${d > 0 ? '+' : '−'}${hours(Math.abs(d))}</td></tr>`;
      }).join('')}</tbody></table></section>`;
  }
  return html;
}

/* Draws the chart once the body is in the page. */
export function timeAfter(store, ui) {
  const box = document.getElementById('time-chart');
  if (!box) return;
  const start = ui.week || weekStart(store.today());
  const r = weekReport(store, start);
  const areas = [...store.state.areas].sort((a, b) => a.order - b.order).filter((a) => r.areaIds.includes(a.id));
  const series = areas.map((a) => ({ key: a.id, label: a.name, color: colorVar(a.color) }));
  if (r.areaIds.includes('none')) series.push({ key: 'none', label: 'No area', color: 'var(--c-none)' });
  stackedColumns(box, {
    title: 'Tracked hours per day this week, by area',
    categories: r.days.map((d, i) => ({ key: d.day, label: DAYS[i], sub: String(fromISO(d.day).getDate()) })),
    series,
    // Plotted in hours so the axis ticks land on whole hours (0, 1h, 2h…), not 1.7h.
    value: (day, key) => (r.days.find((d) => d.day === day).byArea.get(key) || 0) / 60,
    format: (h, tick) => (tick ? `${+h.toFixed(1)}h` : hours(h * 60)),
  });
}

export function exportWeek(store, ui) {
  const start = ui.week || weekStart(store.today());
  download(`journeyman-time-${start}.csv`, entriesCsv(store, start, addDays(start, 6)), 'text/csv');
}

export { formatDay };
