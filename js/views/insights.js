// JourneyMan — the Insights view (phase 3) and the "Next up" panel on Today.

import { nextUp, projectsByHealth, workloadForecast, areaWeeks, focusGrid, matrixPoints, estimateAccuracy, projectHealth } from '../insights.js';
import { stackedColumns, heatmap, matrix } from '../charts.js';
import { esc, icon, hours } from '../ui.js';
import { colorVar } from '../model.js';
import { fromISO, formatDay } from '../parse.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const HEALTH_ICON = { overdue: 'warn', 'at-risk': 'warn', stalled: 'pause', 'no-next-action': 'pause', 'on-track': 'ok', someday: 'pause', done: 'ok' };

/* A status badge: icon + label, never colour alone. */
export function healthBadge(h) {
  if (!h || h.status === 'done') return '';
  return `<span class="health h-${h.status}" title="${esc(h.detail)}">${icon(HEALTH_ICON[h.status])}${esc(h.label)}</span>`;
}
export { projectHealth };

/* "Next up" on Today: the three best things to do now, with why. */
export function nextUpPanel(store, ui, { ai = false } = {}) {
  const filter = ui.fitFilter ?? null;
  const list = nextUp(store, { limit: 3, maxMinutes: filter });
  const chips = [[null, 'Any time'], [15, '15m'], [30, '30m'], [60, '1h'], [120, '2h']]
    .map(([v, l]) => `<button type="button" data-fit="${v ?? ''}" aria-pressed="${filter === v}">${l}</button>`).join('');
  const rows = list.map((s, i) => {
    const t = s.task;
    const p = store.projectOf(t);
    return `<li data-id="${t.id}" class="nu-row">
      <span class="nu-rank">${i + 1}</span>
      <div class="nu-main"><button type="button" class="nu-title" data-nu="open">${esc(t.title)}</button>
        <span class="nu-why">${s.reasons.length ? s.reasons.slice(0, 3).map(esc).join(' · ') : 'A good next action'}${p ? ` · <span class="muted">${esc(p.name)}</span>` : ''}</span></div>
      <button type="button" class="btn small" data-nu="start">${icon('play')} Start</button>
    </li>`;
  }).join('');
  return `<section class="next-up" aria-label="Next up">
    <div class="nu-head"><h2>${icon('sparkle')} Next up</h2><div class="seg nu-fit" role="group" aria-label="Time you have">${chips}</div>
      ${ai ? `<button type="button" class="btn small ghost" data-ai="now" title="Ask Claude what to do now">${icon('sparkle')} Ask Claude</button>` : ''}</div>
    ${list.length ? `<ol class="nu-list">${rows}</ol>` : `<p class="hint">${filter ? `Nothing open fits in ${hours(filter)}.` : 'Nothing open yet. Give tasks a project or area and they show up here.'}</p>`}
    <div id="ai-now" class="ai-out" hidden></div>
  </section>`;
}

export function insightsHead() {
  return `<div class="title-row"><span class="view-icon v-insights">${icon('insights')}</span><h1>Insights</h1></div>
    <p class="view-sub">Plain rules on your own data. Each number says where it comes from.</p>`;
}

export function insightsBody(store) {
  const ranked = projectsByHealth(store);
  const attention = ranked.filter((x) => x.health.status !== 'on-track');
  const health = ranked.length
    ? `<ul class="health-list">${(attention.length ? attention : ranked).map(({ project: p, health: h }) => `
        <li><a href="#project/${p.id}"><i class="dot" style="--c:${colorVar(store.area(p.areaId)?.color)}"></i><b>${esc(p.name)}</b></a>${healthBadge(h)}<span class="muted">${esc(h.detail)}</span></li>`).join('')}</ul>
       ${attention.length ? `<p class="hint">${ranked.length - attention.length} other project${ranked.length - attention.length === 1 ? ' is' : 's are'} on track.</p>` : '<p class="hint">Every active project is on track.</p>'}`
    : '<p class="hint">No active projects yet.</p>';
  const mult = store.estimateMultiplier();
  const acc = estimateAccuracy(store);
  const accTable = acc.length
    ? `<table class="table"><thead><tr><th>Project</th><th class="num">Tasks</th><th class="num">Estimated</th><th class="num">Actual</th><th class="num">Ratio</th></tr></thead><tbody>
      ${acc.map((r) => `<tr><td>${esc(r.project ? r.project.name : 'No project')}</td><td class="num">${r.tasks}</td><td class="num">${hours(r.estimated)}</td><td class="num">${hours(r.actual)}</td>
        <td class="num ${r.ratio > 1.15 ? 'late-text' : r.ratio < 0.85 ? 'good-text' : ''}">${r.ratio.toFixed(2)}×</td></tr>`).join('')}</tbody></table>`
    : '<p class="hint">Finish tasks that have an estimate and tracked time to see how close your estimates are.</p>';
  const targets = store.state.areas.filter((a) => a.targetHours > 0);
  return `
    <section class="card"><h2 class="card-title">Projects that need attention</h2>${health}</section>
    <section class="card"><h2 class="card-title">Workload, next 4 weeks</h2>
      <p class="card-sub">Planned hours against the ${store.state.settings.hoursPerDay}h × ${store.state.settings.daysPerWeek} days you have.${mult.ratio && store.state.settings.adjustEstimates ? ` Estimates adjusted by your ${mult.ratio.toFixed(2)}×.` : ''} Tasks without an estimate count as 30m.</p>
      <div id="chart-forecast"></div></section>
    <section class="card"><h2 class="card-title">Time by area, last 8 weeks</h2>
      ${targets.length ? `<p class="card-sub">Weekly targets: ${targets.map((a) => `${esc(a.name)} ${a.targetHours}h`).join(' · ')}. Set them on each area's page.</p>` : '<p class="card-sub">Set a weekly target on an area\'s page to compare against it.</p>'}
      <div id="chart-areas"></div><div id="area-targets"></div></section>
    <section class="card"><h2 class="card-title">When you focus</h2><p class="card-sub">Tracked time by weekday and hour, last 4 weeks.</p><div id="chart-focus"></div></section>
    <section class="card"><h2 class="card-title">Urgent or important</h2><p class="card-sub">Open tasks by how soon they're due and how much they matter. Click a dot to open the task.</p><div id="chart-matrix"></div></section>
    <section class="card"><h2 class="card-title">Estimate check</h2><p class="card-sub">${mult.ratio ? `Overall, tasks take ${mult.ratio.toFixed(2)}× your estimate (last ${mult.samples} finished tasks).` : 'Needs 3 finished tasks with an estimate and tracked time.'}</p>${accTable}</section>`;
}

export function insightsAfter(store, { openTask }) {
  const f = workloadForecast(store, 4);
  const fBox = document.getElementById('chart-forecast');
  if (fBox) {
    stackedColumns(fBox, {
      title: 'Planned hours against available hours, next four weeks',
      categories: f.map((w, i) => ({ key: w.start, label: i === 0 ? 'This week' : i === 1 ? 'Next week' : `w/c ${short(w.start)}`, sub: i === 0 ? 'rest of week' : '' })),
      series: [{ key: 'planned', label: 'Planned', color: 'var(--c1)' }],
      value: (k) => f.find((w) => w.start === k).planned / 60,
      reference: { value: (k) => f.find((w) => w.start === k).available / 60, label: 'Hours you have' },
      note: (k) => { const w = f.find((x) => x.start === k); return w.over > 30 ? `⚠ ${hours(w.over)} over` : null; },
      format: (h, tick) => (tick ? `${+h.toFixed(1)}h` : hours(h * 60)),
    });
  }
  const weeks = areaWeeks(store, 8);
  const aBox = document.getElementById('chart-areas');
  if (aBox) {
    const used = new Set(weeks.flatMap((w) => [...w.byArea.keys()]));
    const areas = [...store.state.areas].sort((a, b) => a.order - b.order).filter((a) => used.has(a.id));
    const series = areas.map((a) => ({ key: a.id, label: a.name, color: colorVar(a.color) }));
    if (used.has('none')) series.push({ key: 'none', label: 'No area', color: 'var(--c-none)' });
    if (!series.length) aBox.innerHTML = '<p class="hint">No tracked time yet.</p>';
    else {
      stackedColumns(aBox, {
        title: 'Tracked hours per week by area, last eight weeks',
        categories: weeks.map((w, i) => ({ key: w.start, label: i === weeks.length - 1 ? 'This wk' : short(w.start) })),
        series,
        value: (k, a) => (weeks.find((w) => w.start === k).byArea.get(a) || 0) / 60,
        format: (h, tick) => (tick ? `${+h.toFixed(1)}h` : hours(h * 60)),
      });
      const t = document.getElementById('area-targets');
      const withTarget = areas.filter((a) => a.targetHours > 0);
      if (t && withTarget.length) {
        const cur = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
        t.innerHTML = `<table class="table targets"><thead><tr><th>Area</th><th class="num">Target</th><th class="num">Last week</th><th class="num">This week</th></tr></thead><tbody>
          ${withTarget.map((a) => {
            const last = (prev.byArea.get(a.id) || 0) / 60, now = (cur.byArea.get(a.id) || 0) / 60;
            return `<tr><td><i class="dot" style="--c:${colorVar(a.color)}"></i> ${esc(a.name)}</td><td class="num">${a.targetHours}h</td>
              <td class="num ${last < a.targetHours * 0.8 ? 'late-text' : 'good-text'}">${hours(last * 60)}</td><td class="num">${hours(now * 60)}</td></tr>`;
          }).join('')}</tbody></table>`;
      }
    }
  }
  const grid = focusGrid(store, 28);
  const hBox = document.getElementById('chart-focus');
  if (hBox) {
    const total = grid.flat().reduce((s, v) => s + v, 0);
    if (!total) hBox.innerHTML = '<p class="hint">No tracked time in the last 4 weeks.</p>';
    else heatmap(hBox, {
      title: 'Tracked minutes by weekday and hour',
      rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((l, i) => ({ key: i, label: l })),
      cols: Array.from({ length: 24 }, (_, h) => ({ key: h, label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm` })),
      value: (r, c) => grid[r][c],
      format: (m) => hours(m),
    });
  }
  const pts = matrixPoints(store);
  const mBox = document.getElementById('chart-matrix');
  if (mBox) {
    if (!pts.length) mBox.innerHTML = '<p class="hint">No open tasks.</p>';
    else matrix(mBox, {
      title: 'Open tasks by urgency and importance',
      xLabel: 'Urgent', yLabel: 'Important',
      quadrants: ['Schedule it', 'Do now', 'Drop or batch', 'Quick win or hand off'],
      points: pts.map((p) => ({ x: p.x, y: p.y, label: p.task.title, sub: p.reasons.slice(0, 2).join(' · ') || (p.task.deadline ? `Due ${formatDay(p.task.deadline, store.today())}` : ''), onClick: () => openTask(p.task.id) })),
    });
  }
}
