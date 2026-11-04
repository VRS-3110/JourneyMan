// JourneyMan — the interface. Data and rules live in model.js; storage in db.js.

import { createStore, seed, AREA_COLORS, AREA_COLOR_NAMES, colorVar } from './model.js';
import { openStorage } from './db.js';
import { parseQuickAdd, formatMinutes, formatDay, addDays, nextMonday, fromISO, notionAppUrl, isNotionUrl } from './parse.js';
import { notionCsvToTasks } from './importers.js';

import { $, $$, esc, icon, hours, clockText, download } from './ui.js';
import { dayReport, parseDuration, weekStart, entriesCsv } from './reports.js';
import { timeHead, timeBody, timeAfter, exportWeek } from './views/time.js';
import { insightsHead, insightsBody, insightsAfter, nextUpPanel, healthBadge, projectHealth } from './views/insights.js';
import { hideTip } from './charts.js';
import { journalHead, journalBody, journalAfter, journalData, shiftDay, longDay } from './views/journal.js';
import { reviewHead, reviewBody, reviewSummary, reviewDue } from './views/review.js';
import { connectionsHead, bridgeSection, notionSection, activitySection } from './views/connections.js';
import { parseActivity, toSessions, applyActivity, rollForward, suggestRule, journalText, targetName } from './activity.js';
import { makeApi, syncLink, inspectDatabase, journalMap, notionId, writeJournal } from './notion.js';
import { localDay } from './reports.js';

const VIEWS = {
  inbox: { title: 'Inbox', icon: 'inbox' },
  today: { title: 'Today', icon: 'today' },
  upcoming: { title: 'Upcoming', icon: 'upcoming' },
  anytime: { title: 'Anytime', icon: 'anytime' },
  projects: { title: 'Projects', icon: 'projects' },
  logbook: { title: 'Logbook', icon: 'logbook' },
  time: { title: 'Time', icon: 'time' },
  insights: { title: 'Insights', icon: 'insights' },
  journal: { title: 'Journal', icon: 'note' },
  review: { title: 'Review', icon: 'review' },
  connections: { title: 'Connections', icon: 'link' },
};
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDate = (iso) => { const d = fromISO(iso); return `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`; };
const ESTIMATES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

let store, storage;
let addedMsg = null, addedTimer = 0;
const ui = { route: { view: 'today', id: null }, selected: null, detail: false, openGroups: {}, lastDay: null };

/* ---------- routing ---------- */
function parseRoute() {
  const [v, id] = location.hash.slice(1).split('/');
  if (v === 'project' && store.project(id)) return { view: 'project', id };
  if (v === 'area' && store.area(id)) return { view: 'area', id };
  return { view: VIEWS[v] ? v : 'today', id: null };
}
function go(hash) {
  if (location.hash === '#' + hash) onRoute();
  else location.hash = hash;
}
function onRoute() {
  addedMsg = null;
  ui.route = parseRoute();
  // A task asked for before the page changed (search result, chart dot, timer) opens once the new view is up.
  const pending = ui.pendingSelect && store.task(ui.pendingSelect) ? ui.pendingSelect : null;
  ui.pendingSelect = null;
  ui.selected = pending;
  ui.detail = !!pending;
  renderAll(true);
  $('#main').scrollTop = 0;
  if (ui.route.view === 'journal') refreshActivity();
}

/* Where quick add puts a task that names no project, area or date. */
function context() {
  const r = ui.route;
  if (r.view === 'today') return { when: store.today(), label: 'Today' };
  if (r.view === 'project') return { projectId: r.id, label: store.project(r.id).name };
  if (r.view === 'area') return { areaId: r.id, label: store.area(r.id).name };
  return { label: 'Inbox' };
}

/* ---------- rendering ---------- */
function renderAll(full) {
  if ((ui.route.view === 'project' && !store.project(ui.route.id)) || (ui.route.view === 'area' && !store.area(ui.route.id))) {
    go('projects');
    return;
  }
  if (ui.selected && !store.task(ui.selected)) { ui.selected = null; ui.detail = false; }
  renderNav();
  if (full) renderHead();
  renderMeta();
  const typingInBody = $('#view-body').contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (full || !(typingInBody && ['journal', 'review', 'connections'].includes(ui.route.view))) renderBody();
  renderDetail(full);
  renderTimer();
  if (full) {
    const ctx = context();
    $('#qa-input').placeholder = `Add to ${ctx.label}…  try: Plan the week #project ~30m tomorrow`;
    updatePreview();
  }
}

const areaColor = (a) => (a ? colorVar(a.color) : 'var(--ink-3)');
const sortedAreas = () => [...store.state.areas].sort((a, b) => a.order - b.order);

function renderNav() {
  const r = ui.route, c = store.counts(), today = store.today();
  const late = store.todayList().some((t) => (t.when && t.when < today) || (t.deadline && t.deadline < today));
  const item = (view, count, cls = '') => {
    const v = VIEWS[view], active = r.view === view;
    return `<a href="#${view}" class="nav-item${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>${icon(v.icon)}<span>${v.title}</span>${count ? `<b class="count ${cls}"${count === 'due' ? ' title="Your weekly review is due"' : ''}>${count}</b>` : ''}</a>`;
  };
  $('#nav-views').innerHTML = item('inbox', c.inbox) + item('today', c.today, late ? 'late' : '') + item('upcoming') + item('anytime') + item('projects') + item('logbook') + item('time') + item('insights') + item('journal') + item('review', reviewDue(store) ? 'due' : 0, 'due');

  const projLink = (p, color) => {
    const s = store.projectStats(p.id), active = r.view === 'project' && r.id === p.id;
    return `<a href="#project/${p.id}" class="nav-item sub${active ? ' active' : ''}${p.status === 'someday' ? ' someday' : ''}"${active ? ' aria-current="page"' : ''}>
      <span class="ring" style="--p:${s.progress};--c:${color}" aria-hidden="true"></span><span>${esc(p.name)}</span>${s.open ? `<b class="count">${s.open}</b>` : ''}</a>`;
  };
  const visible = (p) => p.status === 'active' || p.status === 'someday';
  let html = sortedAreas().map((a) => {
    const active = r.view === 'area' && r.id === a.id;
    const projects = store.areaProjects(a.id).filter(visible);
    return `<div class="nav-group"><a href="#area/${a.id}" class="nav-item area${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>
      <i class="dot" style="--c:${areaColor(a)}" aria-hidden="true"></i><span>${esc(a.name)}</span></a>${projects.map((p) => projLink(p, areaColor(a))).join('')}</div>`;
  }).join('');
  const loose = store.areaProjects(null).filter(visible);
  if (loose.length) html += `<div class="nav-group"><span class="nav-label">No area</span>${loose.map((p) => projLink(p, 'var(--ink-3)')).join('')}</div>`;
  $('#nav-areas').innerHTML = html || '<p class="nav-empty">Add an area for each part of your life: Work, Study, Health…</p>';
}

/* The editable header. Rendered only when the view changes, so typing in it never loses focus. */
function renderHead() {
  const r = ui.route, head = $('#view-head');
  if (r.view === 'project') {
    const p = store.project(r.id);
    const areaOpts = `<option value="">No area</option>` + sortedAreas().map((a) => `<option value="${a.id}"${a.id === p.areaId ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
    const status = [['active', 'Active'], ['someday', 'Someday'], ['done', 'Completed'], ['archived', 'Archived']]
      .map(([v, l]) => `<option value="${v}"${p.status === v ? ' selected' : ''}>${l}</option>`).join('');
    head.innerHTML = `
      <div class="title-row"><span class="ring big" id="p-ring" style="--c:${areaColor(store.area(p.areaId))}" aria-hidden="true"></span>
        <input class="title-input" id="p-name" value="${esc(p.name)}" aria-label="Project name" data-pfield="name"></div>
      <div class="head-fields">
        <label class="mini"><span>Area</span><select data-pfield="areaId">${areaOpts}</select></label>
        <label class="mini"><span>Deadline</span><input type="date" data-pfield="deadline" value="${p.deadline || ''}"></label>
        <label class="mini"><span>Status</span><select data-pfield="status">${status}</select></label>
        ${notionField(p.notionUrl, 'pfield')}
        <button type="button" class="btn small ghost danger" id="delete-project">Delete project</button>
      </div>
      <textarea class="notes-input" data-pfield="notes" rows="2" placeholder="Notes: what does done look like? (Keep longer notes in Notion.)">${esc(p.notes)}</textarea>`;
  } else if (r.view === 'area') {
    const a = store.area(r.id);
    head.innerHTML = `
      <div class="title-row"><i class="dot big" style="--c:${areaColor(a)}" aria-hidden="true"></i>
        <input class="title-input" value="${esc(a.name)}" aria-label="Area name" data-afield="name"></div>
      <div class="head-fields">
        <div class="swatches" role="group" aria-label="Colour">${AREA_COLORS.map((c) => `<button type="button" class="swatch${c === a.color ? ' on' : ''}" style="--c:${colorVar(c)}" data-color="${c}" aria-label="${AREA_COLOR_NAMES[c]}" title="${AREA_COLOR_NAMES[c]}" aria-pressed="${c === a.color}"></button>`).join('')}</div>
        <label class="mini"><span>Target hours a week</span><input type="number" min="0" max="80" step="0.5" data-afield="targetHours" value="${a.targetHours || ''}" placeholder="None" style="width:110px"></label>
        ${notionField(a.notionUrl, 'afield')}
        <button type="button" class="btn small" data-new-project="${a.id}">New project</button>
        <button type="button" class="btn small ghost danger" id="delete-area">Delete area</button>
      </div>`;
  } else if (r.view === 'time') {
    head.innerHTML = timeHead(store, ui);
  } else if (r.view === 'insights') {
    head.innerHTML = insightsHead();
  } else if (r.view === 'journal') {
    head.innerHTML = journalHead(store, ui, { folder: ui.folder });
  } else if (r.view === 'review') {
    head.innerHTML = reviewHead(store);
  } else if (r.view === 'connections') {
    head.innerHTML = connectionsHead(connectionsExtra());
  } else {
    const v = VIEWS[r.view];
    const sub = r.view === 'today' ? `<p class="view-sub">${longDate(store.today())}</p>` : '';
    const extra = r.view === 'projects'
      ? `<div class="head-fields"><button type="button" class="btn small" data-new-project="">New project</button><button type="button" class="btn small ghost" data-import-notion>${icon('notion')} Import a Notion database</button></div>`
      : '';
    head.innerHTML = `<div class="title-row"><span class="view-icon v-${r.view}">${icon(v.icon)}</span><h1>${v.title}</h1></div>${sub}${extra}`;
  }
}

function notionField(url, attr) {
  return `<label class="mini notion-field"><span>${icon('notion')} Notion page</span>
    <span class="notion-row"><input type="url" ${attr === 'pfield' ? 'data-pfield' : 'data-afield'}="notionUrl" value="${esc(url || '')}" placeholder="Paste a Notion link">
    <a class="btn small notion-open" href="${url ? esc(notionAppUrl(url)) : '#'}"${url ? '' : ' hidden'}>Open</a></span></label>`;
}

function renderMeta() {
  const r = ui.route, el = $('#view-meta');
  if (r.view === 'today') {
    const c = store.capacity();
    const pct = c.available ? Math.min(c.planned / c.available, 1) : 0;
    const over = c.planned > c.available;
    el.innerHTML = c.count ? `<div class="capacity${over ? ' over' : ''}">
      <div class="cap-bar" role="img" aria-label="${formatMinutes(c.planned) || '0m'} planned of ${formatMinutes(c.available)}"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      <span>${icon('clock')} <b>${formatMinutes(c.planned) || '0m'}</b> planned of ${formatMinutes(c.available)}${over ? ` · <b class="late-text">${formatMinutes(c.planned - c.available)} over</b>` : ''}${c.unestimated ? ` · ${c.unestimated} without an estimate` : ''}</span></div>` : '';
  } else if (r.view === 'project') {
    const s = store.projectStats(r.id);
    $('#p-ring')?.style.setProperty('--p', s.progress);
    const bits = [`${s.done} of ${s.total} done`];
    if (s.estimateLeft) bits.push(`${formatMinutes(s.estimateLeft)} estimated left`);
    if (s.unestimated) bits.push(`${s.unestimated} without an estimate`);
    if (s.daysLeft != null) bits.push(deadlineText(s.daysLeft, true));
    const h = projectHealth(store, r.id);
    const healthLine = h && h.status !== 'done' && !(h.status === 'on-track' && !store.project(r.id).deadline)
      ? `<p class="health-line">${healthBadge(h)}<span>${esc(h.detail)}</span></p>` : '';
    el.innerHTML = `<div class="progress"><div class="bar"><i style="width:${(s.progress * 100).toFixed(1)}%"></i></div><span>${bits.join(' · ')}${s.tracked >= 1 ? ` · ${hours(s.tracked)} tracked` : ''}</span></div>${healthLine}`;
  } else if (r.view === 'inbox') {
    const n = store.inbox().length;
    el.innerHTML = n ? `<p class="hint">Give each item a project, an area or a date, and it leaves the inbox. Keyboard: select, then <kbd>M</kbd> to move or <kbd>T</kbd> for today.</p>` : '';
  } else if (r.view === 'upcoming') {
    el.innerHTML = '<p class="hint">The next 14 days. Tasks show on the day you plan to do them, or on their deadline.</p>';
  } else if (r.view === 'anytime') {
    el.innerHTML = '<p class="hint">Sorted tasks with no date. Pick from here when Today is done.</p>';
  } else el.innerHTML = '';
}

function deadlineText(days, long) {
  if (days < 0) return `<span class="late-text">${long ? 'Deadline passed ' : ''}${-days} day${days === -1 ? '' : 's'} ago</span>`;
  if (days === 0) return '<span class="late-text">Due today</span>';
  if (days <= 7) return `<span class="soon-text">Due in ${days} day${days === 1 ? '' : 's'}</span>`;
  return `Due in ${days} days`;
}

function taskRow(t, opts = {}) {
  const today = store.today();
  const p = store.projectOf(t), a = store.areaOf(t);
  const chips = [];
  if (opts.project !== false && (p || a)) chips.push(`<span class="chip where"><i class="dot" style="--c:${areaColor(a)}"></i>${esc(p ? p.name : a.name)}</span>`);
  if (t.when && opts.when !== false) chips.push(`<span class="chip${!t.done && t.when < today ? ' late' : ''}">${formatDay(t.when, today)}${t.time ? ' ' + t.time : ''}</span>`);
  else if (t.time) chips.push(`<span class="chip">${t.time}</span>`);
  if (t.deadline) chips.push(`<span class="chip deadline${!t.done && t.deadline < today ? ' late' : !t.done && t.deadline === today ? ' soon' : ''}">${icon('flag')}${formatDay(t.deadline, today)}</span>`);
  const run = store.running();
  const isRunning = run && run.taskId === t.id;
  const tracked = store.tracked(t.id);
  if (isRunning) chips.push(`<span class="chip running"><i class="pulse" aria-hidden="true"></i><span class="run-clock" data-start="${run.start}">${clockText(run.start)}</span></span>`);
  if (tracked >= 1 && !isRunning) chips.push(`<span class="chip${t.estimate && tracked > t.estimate ? ' late' : ''}" title="Tracked${t.estimate ? ' of estimate' : ''}">${icon('time')}${hours(tracked)}${t.estimate ? ` / ${hours(t.estimate)}` : ''}</span>`);
  else if (t.estimate) chips.push(`<span class="chip">${icon('clock')}${formatMinutes(t.estimate)}</span>`);
  if (t.notes) chips.push(`<span class="chip icon-only" title="Has notes">${icon('note')}</span>`);
  if (t.notionUrl) chips.push(`<a class="chip notion" href="${esc(notionAppUrl(t.notionUrl))}" title="Open in Notion" aria-label="Open in Notion">${icon('notion')}</a>`);
  const triage = opts.triage
    ? `<span class="row-actions"><button type="button" data-action="today">Today</button><button type="button" data-action="move">Move…</button><button type="button" data-action="keep" title="No project or date: keep it in Anytime">Keep</button></span>`
    : '';
  return `<li class="task${t.done ? ' done' : ''}${ui.selected === t.id ? ' selected' : ''}" data-id="${t.id}">
    <button type="button" class="check" data-action="toggle" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark not done' : 'Complete'}: ${esc(t.title)}">${icon('check')}</button>
    <div class="task-main"><span class="task-title">${esc(t.title)}</span>${chips.length ? `<span class="task-meta">${chips.join('')}</span>` : ''}</div>
    ${t.priority ? `<span class="prio p${t.priority}" title="Priority ${t.priority}">${'!'.repeat(t.priority)}</span>` : ''}${triage}
    ${t.done ? '' : `<button type="button" class="play${isRunning ? ' on' : ''}" data-action="timer" aria-label="${isRunning ? 'Stop timer' : 'Start timer'}" title="${isRunning ? 'Stop timer' : 'Start timer'} (S)">${icon(isRunning ? 'stop' : 'play')}</button>`}
  </li>`;
}
const taskList = (tasks, opts) => `<ul class="tasks">${tasks.map((t) => taskRow(t, opts)).join('')}</ul>`;
const empty = (title, text) => `<div class="empty"><b>${title}</b><p>${text}</p></div>`;
function group(key, title, count, inner, startOpen = false) {
  const open = ui.openGroups[key] ?? startOpen;
  return `<details class="group" data-group="${key}"${open ? ' open' : ''}><summary>${title} <span>${count}</span></summary>${inner}</details>`;
}

function projectCard(p) {
  const s = store.projectStats(p.id), a = store.area(p.areaId);
  const h = p.status === 'active' ? projectHealth(store, p.id) : null;
  const badge = p.status !== 'active'
    ? `<span class="badge">${{ someday: 'Someday', done: 'Completed', archived: 'Archived' }[p.status]}</span>`
    : h && !(h.status === 'on-track' && !p.deadline) ? healthBadge(h) : '';
  const meta = [`${s.done} of ${s.total} done`];
  if (s.estimateLeft) meta.push(`${formatMinutes(s.estimateLeft)} left`);
  if (s.daysLeft != null && p.status === 'active') meta.push(deadlineText(s.daysLeft));
  return `<a class="pcard${p.status !== 'active' ? ' muted' : ''}" href="#project/${p.id}" style="--c:${areaColor(a)}">
    <span class="pcard-top"><span class="ring" style="--p:${s.progress}" aria-hidden="true"></span><b>${esc(p.name)}</b>${badge}${p.notionUrl ? `<span class="pc-notion" title="Linked to Notion">${icon('notion')}</span>` : ''}</span>
    <span class="bar"><i style="width:${(s.progress * 100).toFixed(1)}%"></i></span>
    <span class="pcard-meta">${meta.join(' · ')}</span></a>`;
}
const newProjectCard = (areaId) => `<button type="button" class="pcard add" data-new-project="${areaId || ''}">+ New project</button>`;

function renderBody() {
  const r = ui.route, body = $('#view-body'), today = store.today();
  let html = '';
  switch (r.view) {
    case 'inbox': {
      const list = store.inbox();
      html = list.length ? taskList(list, { triage: true }) : empty('Inbox zero', 'Everything is sorted. New ideas land here when you add them without a project, area or date.');
      break;
    }
    case 'today': {
      html += nextUpPanel(store, ui, { ai: aiReady() });
      const list = store.todayList();
      const late = list.filter((t) => (t.when && t.when < today) || (!t.when && t.deadline && t.deadline < today));
      const now = list.filter((t) => !late.includes(t));
      if (late.length) html += `<h2 class="list-head late-text">Overdue</h2>${taskList(late)}`;
      if (now.length) html += `${late.length ? '<h2 class="list-head">Today</h2>' : ''}${taskList(now, { when: false })}`;
      if (!list.length) html += empty('Nothing planned for today', 'Add something above, or pick from Anytime and press <kbd>T</kbd>.');
      const done = store.doneToday();
      if (done.length) html += group('done-today', 'Done today', done.length, taskList(done, { when: false }));
      html += recapCard();
      break;
    }
    case 'time': {
      body.innerHTML = timeBody(store, ui);
      timeAfter(store, ui);
      return;
    }
    case 'insights': {
      hideTip();
      body.innerHTML = insightsBody(store);
      insightsAfter(store, { openTask });
      return;
    }
    case 'journal': {
      hideTip();
      ui.aiReady = aiReady();
      body.innerHTML = journalBody(store, ui, { notion: !!(store.state.settings.notion.journal && bridgeReady()) });
      journalAfter(store, ui);
      return;
    }
    case 'review': {
      body.innerHTML = reviewBody(store, { notion: !!(store.state.settings.notion.journal && bridgeReady()) });
      return;
    }
    case 'connections': {
      body.innerHTML = bridgeSection(store, ui) + notionSection(store, ui) + activitySection(store, ui) + extraConnections();
      return;
    }
    case 'upcoming': {
      const days = store.upcoming(14);
      html = days.length
        ? days.map(({ day, tasks }) => `<section class="day"><h2 class="list-head"><b>${formatDay(day, today)}</b> <span>${longDate(day)}</span></h2>${taskList(tasks, { when: false })}</section>`).join('')
        : empty('Nothing scheduled', 'Add a date when you capture, like <code>fri</code> or <code>dec 5</code>.');
      break;
    }
    case 'anytime': {
      const list = store.anytime();
      html = list.length ? taskList(list) : empty('Nothing waiting', 'Tasks with a project or area but no date show here.');
      break;
    }
    case 'logbook': {
      const list = store.logbook();
      const byDay = new Map();
      for (const t of list) {
        const key = t.doneAt ? todayOf(new Date(t.doneAt)) : 'unknown';
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(t);
      }
      html = list.length
        ? [...byDay].map(([day, tasks]) => `<section class="day"><h2 class="list-head"><b>${day === 'unknown' ? 'Earlier' : formatDay(day, today)}</b> <span>${tasks.length} done</span></h2>${taskList(tasks, { when: false })}</section>`).join('')
        : empty('Nothing done yet', 'Completed tasks are kept here.');
      break;
    }
    case 'projects': {
      const sections = sortedAreas().map((a) => {
        const ps = store.areaProjects(a.id);
        return `<section class="area-block"><h2 class="list-head"><i class="dot" style="--c:${areaColor(a)}"></i><a href="#area/${a.id}">${esc(a.name)}</a></h2>
          <div class="cards">${ps.map(projectCard).join('')}${newProjectCard(a.id)}</div></section>`;
      });
      const loose = store.areaProjects(null);
      if (loose.length) sections.push(`<section class="area-block"><h2 class="list-head">No area</h2><div class="cards">${loose.map(projectCard).join('')}</div></section>`);
      html = sections.join('') || empty('No areas yet', 'Create an area in the sidebar, then add projects to it.');
      break;
    }
    case 'project': {
      const { open, done } = store.projectTasks(r.id);
      html = open.length ? taskList(open, { project: false }) : empty('No open tasks', 'What is the very next action? Add it above.');
      if (done.length) html += group('done-' + r.id, 'Completed', done.length, taskList(done, { project: false }));
      break;
    }
    case 'area': {
      const ps = store.areaProjects(r.id);
      html = `<h2 class="list-head">Projects</h2><div class="cards">${ps.map(projectCard).join('')}${newProjectCard(r.id)}</div>`;
      const loose = store.areaTasks(r.id);
      html += `<h2 class="list-head">Ongoing tasks</h2>` + (loose.length ? taskList(loose, { project: false }) : '<p class="hint">Tasks in this area that belong to no project, like regular chores.</p>');
      break;
    }
  }
  body.innerHTML = html;
}

/* ---------- detail pane ---------- */
function renderDetail(force) {
  const el = $('#detail');
  const t = ui.detail && ui.selected ? store.task(ui.selected) : null;
  document.body.classList.toggle('has-detail', !!t);
  if (!t) { el.hidden = true; el.dataset.id = ''; return; }
  if (!force && el.dataset.id === t.id) {
    // Keep the fields the user is typing in; refresh the rest.
    $('.d-check', el)?.setAttribute('aria-pressed', t.done);
    el.classList.toggle('is-done', t.done);
    $('#d-foot').innerHTML = detailFoot(t);
    return;
  }
  el.hidden = false;
  el.dataset.id = t.id;
  el.classList.toggle('is-done', t.done);
  const p = store.projectOf(t);
  const projectOpts = `<option value="">No project</option>` + sortedAreas().map((a) => {
    const ps = store.state.projects.filter((x) => x.areaId === a.id && (x.status === 'active' || x.status === 'someday' || x.id === t.projectId));
    return ps.length ? `<optgroup label="${esc(a.name)}">${ps.map((x) => `<option value="${x.id}"${x.id === t.projectId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : '';
  }).join('') + store.state.projects.filter((x) => !x.areaId && (x.status === 'active' || x.status === 'someday' || x.id === t.projectId))
    .map((x) => `<option value="${x.id}"${x.id === t.projectId ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  const areaId = p ? p.areaId : t.areaId;
  const areaOpts = `<option value="">No area</option>` + sortedAreas().map((a) => `<option value="${a.id}"${a.id === areaId ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  const estOpts = `<option value="">None</option>` + [...new Set([...ESTIMATES, t.estimate].filter(Boolean))].sort((a, b) => a - b)
    .map((m) => `<option value="${m}"${m === t.estimate ? ' selected' : ''}>${formatMinutes(m)}</option>`).join('');
  el.innerHTML = `
    <div class="d-head">
      <button type="button" class="check d-check" data-action="toggle" aria-pressed="${t.done}" aria-label="Complete">${icon('check')}</button>
      <textarea class="d-title" data-field="title" rows="1" aria-label="Task">${esc(t.title)}</textarea>
      <button type="button" class="icon-btn" id="d-close" aria-label="Close details" title="Close (Esc)">${icon('close')}</button>
    </div>
    <textarea class="d-notes" data-field="notes" placeholder="Notes" rows="3">${esc(t.notes)}</textarea>
    <div class="d-fields">
      <label><span>Project</span><select data-field="projectId">${projectOpts}</select></label>
      <label><span>Area</span><select data-field="areaId"${p ? ' disabled title="Set by the project"' : ''}>${areaOpts}</select></label>
      <label><span>When</span><input type="date" data-field="when" value="${t.when || ''}"></label>
      <div class="d-quick">
        <button type="button" data-when="today">Today</button><button type="button" data-when="tomorrow">Tomorrow</button>
        <button type="button" data-when="nextweek">Next week</button><button type="button" data-when="clear">No date</button>
      </div>
      <label><span>Time</span><input type="time" data-field="time" value="${t.time || ''}"></label>
      <label><span>Deadline</span><input type="date" data-field="deadline" value="${t.deadline || ''}"></label>
      <label><span>Estimate</span><select data-field="estimate">${estOpts}</select></label>
      <div class="d-prio"><span>Priority</span><div class="seg" role="group" aria-label="Priority">${[0, 1, 2, 3]
        .map((n) => `<button type="button" data-priority="${n}" aria-pressed="${t.priority === n}">${n ? '!'.repeat(n) : 'None'}</button>`).join('')}</div></div>
      <label class="d-notion"><span>${icon('notion')} Notion page</span>
        <span class="notion-row"><input type="url" data-field="notionUrl" value="${esc(t.notionUrl || '')}" placeholder="Paste a Notion link">
        <a class="btn small notion-open" href="${t.notionUrl ? esc(notionAppUrl(t.notionUrl)) : '#'}"${t.notionUrl ? '' : ' hidden'}>Open</a></span></label>
    </div>
    ${timeSection(t)}
    <div class="d-actions">
      ${t.inbox ? '<button type="button" class="btn small" data-action="keep">Keep without a project</button>' : ''}
      <button type="button" class="btn small ghost danger" data-action="delete">Delete</button>
    </div>
    <p class="d-foot" id="d-foot">${detailFoot(t)}</p>`;
  autosize($('.d-title', el));
}
function detailFoot(t) {
  const added = new Date(t.createdAt);
  let s = `Added ${formatDay(todayOf(added), store.today())}`;
  if (t.done && t.doneAt) s += ` · Done ${formatDay(todayOf(new Date(t.doneAt)), store.today())}`;
  return s;
}
const todayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function autosize(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

/* ---------- time tracking ---------- */
const LONG_RUN = 3 * 60; // minutes before a timer asks if you're still working

function toggleTimer(id) {
  const run = store.running();
  if (run && run.taskId === id) {
    const e = store.stopTimer();
    toast(e ? `Logged ${hours(store.entryMinutes(e))} on “${store.task(id)?.title}”` : 'Timer stopped (under a minute, not logged)');
  } else {
    const t = store.task(id);
    if (!t || t.done) return;
    store.startTimer(id);
    toast(`Timer started on “${t.title}”`);
  }
}

/* The running timer, pinned in the sidebar. */
function renderTimer() {
  const box = $('#timer');
  const run = store.running();
  if (!run) { box.hidden = true; box.dataset.id = ''; document.title = 'JourneyMan'; return; }
  const t = store.task(run.taskId);
  if (!t) { store.discardTimer(); return; }
  const mins = store.entryMinutes(run);
  const long = mins >= LONG_RUN && !(run.ackUntil && new Date(run.ackUntil) > store.now());
  box.hidden = false;
  box.dataset.id = run.id;
  box.innerHTML = `
    <div class="timer-row">
      <i class="pulse" aria-hidden="true"></i>
      <button type="button" class="timer-task" data-timer="open" title="Show task">${esc(t.title)}</button>
      <span class="timer-clock" data-start="${run.start}">${clockText(run.start)}</span>
    </div>
    <div class="timer-row">
      <label class="deep-toggle"><input type="checkbox" data-timer="deep"${run.deep ? ' checked' : ''}> Deep work</label>
      <button type="button" class="btn small" data-timer="stop">${icon('stop')} Stop</button>
    </div>
    ${long ? `<div class="timer-long">${icon('warn')}<span>Running for ${hours(mins)}. Still working?</span>
      <span class="row"><button type="button" data-timer="keep">Yes</button><button type="button" data-timer="cap">Stop at 3h</button><button type="button" data-timer="discard">Discard</button></span></div>` : ''}`;
}

/* Every second: move the clocks without re-rendering anything else. */
function tick() {
  const now = store.now();
  for (const c of $$('[data-start]')) c.textContent = clockText(c.dataset.start, now);
  const run = store.running();
  if (run) {
    document.title = `${clockText(run.start, now)} · ${store.task(run.taskId)?.title || 'JourneyMan'}`;
    const mins = store.entryMinutes(run);
    if (mins >= LONG_RUN && !$('#timer .timer-long') && !(run.ackUntil && new Date(run.ackUntil) > now)) renderTimer();
  }
}

function onTimerClick(e) {
  const action = e.target.closest('[data-timer]')?.dataset.timer;
  const run = store.running();
  if (!action || !run) return;
  if (action === 'open') openTask(run.taskId);
  else if (action === 'stop') toggleTimer(run.taskId);
  else if (action === 'keep') store.updateEntry(run.id, { ackUntil: new Date(store.now().getTime() + LONG_RUN * 60_000).toISOString() });
  else if (action === 'cap') { store.stopTimer({ at: new Date(new Date(run.start).getTime() + LONG_RUN * 60_000) }); toast('Logged 3h and stopped the timer'); }
  else if (action === 'discard') { store.discardTimer(); toast('Timer discarded'); }
}

/* The Time block in the task detail pane. */
function timeSection(t) {
  const run = store.running();
  const isRunning = run && run.taskId === t.id;
  const tracked = store.tracked(t.id);
  const entries = store.taskEntries(t.id).filter((e) => e.end);
  const hm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const dayOf = (iso) => formatDay(todayOf(new Date(iso)), store.today());
  const over = t.estimate && tracked > t.estimate;
  return `<section class="d-time">
    <div class="d-time-head"><span>${icon('time')} Time</span>
      <b class="${over ? 'late-text' : ''}">${hours(tracked)}${t.estimate ? ` of ${hours(t.estimate)}` : ' tracked'}</b></div>
    ${t.estimate ? `<span class="bar"><i style="width:${Math.min((tracked / t.estimate) * 100, 100).toFixed(1)}%;${over ? 'background:var(--late)' : ''}"></i></span>` : ''}
    <div class="d-time-actions">
      ${t.done ? '' : `<button type="button" class="btn small${isRunning ? ' primary' : ''}" data-action="timer">${icon(isRunning ? 'stop' : 'play')} ${isRunning ? `Stop <span class="run-clock" data-start="${run.start}">${clockText(run.start)}</span>` : 'Start timer'}</button>`}
      <form class="log-form" data-log-form>
        <input type="text" name="mins" placeholder="Log 45m" aria-label="Time to log, like 45m or 1h30m" autocomplete="off">
        <input type="date" name="day" value="${store.today()}" max="${store.today()}" aria-label="Day">
        <button type="submit" class="btn small">Log</button>
      </form>
    </div>
    ${entries.length ? `<ul class="entries">${entries.slice(0, 8).map((e) => `<li>
      <span>${dayOf(e.start)} · ${hm(e.start)}–${hm(e.end)}</span>
      <b>${hours(store.entryMinutes(e))}</b>
      <button type="button" class="tag${e.deep ? ' on' : ''}" data-entry-deep="${e.id}" aria-pressed="${!!e.deep}" title="Deep work">Deep</button>
      <button type="button" class="icon-btn" data-entry-del="${e.id}" aria-label="Remove this time">${icon('close')}</button></li>`).join('')}
      ${entries.length > 8 ? `<li class="muted">and ${entries.length - 8} earlier</li>` : ''}</ul>` : ''}
  </section>`;
}

/* End-of-day recap at the foot of Today. */
function recapCard() {
  const r = dayReport(store);
  if (!r.total && !r.done.length) return '';
  const top = r.byProject.slice(0, 5).map((b) => `<span class="chip where"><i class="dot" style="--c:${b.color ? colorVar(b.color) : 'var(--c-none)'}"></i>${esc(b.name)} · ${hours(b.minutes)}</span>`).join('');
  const comp = r.compared.slice(0, 4).map((c) => {
    const d = c.actual - c.estimate;
    return `<li><span>${esc(c.task.title)}</span><span class="muted">${hours(c.estimate)} planned · ${hours(c.actual)} actual</span><b class="${d > 0 ? 'late-text' : 'good-text'}">${d > 0 ? '+' : '−'}${hours(Math.abs(d))}</b></li>`;
  }).join('');
  return `<section class="recap">
    <h2 class="list-head">Today so far</h2>
    <p class="recap-line"><b>${hours(r.total)}</b> tracked${r.deep ? ` · ${hours(r.deep)} deep work` : ''} · <b>${r.done.length}</b> task${r.done.length === 1 ? '' : 's'} done</p>
    ${top ? `<div class="task-meta">${top}</div>` : ''}
    ${comp ? `<ul class="compare">${comp}</ul>` : ''}
  </section>`;
}

/* Opens a task wherever it lives: its home list, selected, with details. */
function openTask(id) {
  const t = store.task(id);
  if (!t) return;
  const home = t.done ? 'logbook' : t.projectId ? 'project/' + t.projectId : t.inbox ? 'inbox'
    : t.when && t.when <= store.today() ? 'today' : t.when ? 'upcoming' : t.areaId ? 'area/' + t.areaId : 'anytime';
  if (location.hash.slice(1) === home) { select(t.id, true); return; }
  ui.pendingSelect = t.id;
  go(home);
}
function aiReady() { return false; }
function onAi() {}

/* ---------- phase 4: Notion bridge, journal, review ---------- */
const bridgeReady = () => !!(store.state.settings.notion.workerUrl && store.state.settings.notion.appKey);
const notionApi = () => makeApi(store.state.settings.notion);
function connectionsExtra() { return ''; }
function extraConnections() { return ''; }

function setNotion(fields) {
  store.updateSettings({ notion: { ...store.state.settings.notion, ...fields } });
}

/* Runs the two-way sync for some or all linked databases. */
async function runNotionSync(indexes = null, { quiet = false } = {}) {
  if (ui.syncing || !bridgeReady()) return;
  const n = store.state.settings.notion;
  const links = n.links.map((l) => ({ ...l, map: { ...l.map } }));
  const which = indexes ?? links.map((_, i) => i);
  if (!which.length) return;
  ui.syncing = true;
  if (!quiet) toast('Syncing with Notion…');
  const api = notionApi();
  const totals = { changes: 0, errors: 0 };
  for (const i of which) {
    const link = links[i];
    if (!store.project(link.projectId)) { link.lastError = 'The project was deleted.'; totals.errors++; continue; }
    try {
      const r = await syncLink(store, link, api);
      link.lastError = null;
      totals.changes += r.pulled + r.pushed + r.created + r.createdInNotion + r.archived + r.removed + r.time;
    } catch (err) {
      link.lastError = err.message;
      totals.errors++;
    }
  }
  ui.syncing = false;
  setNotion({ links });
  if (!quiet || totals.errors) toast(totals.errors ? `Notion sync had ${totals.errors} problem${totals.errors === 1 ? '' : 's'}. See Connections.` : totals.changes ? `Synced with Notion: ${totals.changes} change${totals.changes === 1 ? '' : 's'}` : 'Notion is already in step');
}

/* ---------- Mac activity ---------- */
async function loadFolder() {
  const rec = await storage.getMeta('activityDir');
  ui.folderHandle = rec ? rec.handle : null;
  ui.folder = null;
  if (ui.folderHandle && ui.folderHandle.queryPermission) {
    try { ui.folder = await ui.folderHandle.queryPermission({ mode: 'read' }); } catch { ui.folder = null; }
  }
}
async function readActivityFile(handle, day) {
  try {
    const fh = await handle.getFileHandle(`${day}.jsonl`);
    const text = await (await fh.getFile()).text();
    const sessions = toSessions(parseActivity(text), { ignore: store.state.settings.activityIgnore || [] });
    store.saveActivity(day, sessions, 'folder');
    return true;
  } catch { return false; }
}
/* Re-reads the open day from the connected folder (Chrome). */
async function refreshActivity() {
  if (ui.folder !== 'granted' || !ui.folderHandle) return;
  await readActivityFile(ui.folderHandle, ui.journalDay || store.today());
}
async function connectFolder(reconnect) {
  try {
    if (reconnect && ui.folderHandle) {
      ui.folder = await ui.folderHandle.requestPermission({ mode: 'read' });
    } else {
      const handle = await window.showDirectoryPicker({ id: 'journeyman-activity', mode: 'read', startIn: 'documents' });
      ui.folderHandle = handle;
      ui.folder = 'granted';
      storage.save('meta', { id: 'activityDir', handle });
    }
  } catch { return; }
  renderHead();
  await refreshActivity();
  renderBody();
  if (ui.folder === 'granted') toast('Activity folder connected');
}
/* Imports one or more .jsonl files; samples are split by local day. */
async function importActivity(files) {
  const byDay = new Map();
  for (const f of files) {
    for (const smp of parseActivity(await f.text())) {
      const d = localDay(smp.t);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(smp);
    }
  }
  if (!byDay.size) { toast('No activity found in that file.'); return; }
  for (const [day, samples] of byDay) {
    samples.sort((a, b) => (a.t < b.t ? -1 : 1));
    store.saveActivity(day, toSessions(samples, { ignore: store.state.settings.activityIgnore || [] }), 'import');
  }
  const days = [...byDay.keys()].sort();
  ui.journalDay = days[days.length - 1] > store.today() ? store.today() : days[days.length - 1];
  renderAll(true);
  toast(`Imported activity for ${days.length} day${days.length === 1 ? '' : 's'}`);
}

/* Assign unmatched time: pick where it belongs, and a rule remembers it. */
function assignSource(sample) {
  return (q) => {
    const m = match(q);
    const items = [];
    for (const a of sortedAreas()) {
      // The area itself first, then its projects.
      if (m(a.name)) items.push({ label: a.name, sub: 'Area', color: areaColor(a), run: () => addRule(sample, { kind: 'area', id: a.id }) });
      for (const p of store.state.projects.filter((x) => x.areaId === a.id && x.status === 'active')) {
        if (m(p.name) || m(a.name)) items.push({ label: p.name, sub: a.name, color: areaColor(a), run: () => addRule(sample, { kind: 'project', id: p.id }) });
      }
    }
    for (const p of store.state.projects.filter((x) => !x.areaId && x.status === 'active')) if (m(p.name)) items.push({ label: p.name, sub: 'Project', run: () => addRule(sample, { kind: 'project', id: p.id }) });
    if (q.trim()) for (const t of store.state.tasks.filter((x) => !x.done)) if (m(t.title)) items.push({ label: t.title, sub: 'Task', icon: 'check', run: () => addRule(sample, { kind: 'task', id: t.id }) });
    return items;
  };
}
function addRule(sample, target) {
  const rule = { id: Math.random().toString(36).slice(2), ...suggestRule(sample), target };
  store.updateSettings({ activityRules: [...(store.state.settings.activityRules || []), rule] });
  toast(`${rule.field === 'app' ? 'App' : 'Title'} “${rule.contains}” → ${targetName(store, target)}`, () => {
    store.updateSettings({ activityRules: store.state.settings.activityRules.filter((r) => r.id !== rule.id) });
  });
}

async function journalAction(act, el) {
  const day = ui.journalDay || store.today();
  const data = journalData(store, day);
  const text = () => $('#journal-text')?.value || '';
  const notes = () => $('#journal-notes')?.value || '';
  const stats = { active: data.summary.total, matched: data.summary.matchedMinutes, tracked: data.report.total, done: data.report.done.length };
  if (act === 'connect') return connectFolder(false);
  if (act === 'reconnect') return connectFolder(true);
  if (act === 'apply') {
    const added = applyActivity(store, day, data.summary.sessions);
    toast(added ? `Added ${hours(added)} of matched activity to Time` : 'Nothing new to add. Timers already cover it.');
  } else if (act === 'regen') {
    $('#journal-text').value = journalText(store, day, data.summary, data.plan, data.report);
  } else if (act === 'save') {
    store.saveJournal(day, { text: text(), notes: notes(), stats });
    toast('Journal saved');
  } else if (act === 'notion') {
    const j = store.state.settings.notion.journal;
    store.saveJournal(day, { text: text(), notes: notes(), stats });
    el.disabled = true;
    try {
      const res = await writeJournal(notionApi(), j, { day, title: longDay(day), text: text(), notes: notes() });
      store.saveJournal(day, { notionPageId: res.pageId });
      toast(res.created ? 'Added a new page to your Notion journal' : 'Added to that day’s page in your Notion journal');
    } catch (err) { toast(`Notion: ${err.message}`); } finally { el.disabled = false; }
  } else if (act === 'roll') {
    const tomorrow = addDays(store.today(), 1);
    const before = data.plan.filter((p) => p.state !== 'done').map((p) => ({ ...p.task }));
    const n = rollForward(store, data.plan, tomorrow);
    toast(`Moved ${n} task${n === 1 ? '' : 's'} to tomorrow`, () => before.forEach((t) => store.restore('task', t)));
  } else if (act === 'ai-journal') {
    onAi('journal');
  }
}

async function connectionsAction(act, el) {
  const n = store.state.settings.notion;
  if (act === 'test-bridge') {
    ui.bridgeHealth = null;
    try {
      const base = n.workerUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${n.appKey}` } });
      const data = await res.json().catch(() => ({}));
      ui.bridgeHealth = res.ok ? data : { error: data.error || `The bridge answered ${res.status}` };
    } catch { ui.bridgeHealth = { error: 'Could not reach the bridge. Check the URL, and that ALLOWED_ORIGINS includes this page.' }; }
    renderBody();
  } else if (act === 'link-inspect') {
    const url = $('#link-url').value.trim();
    if (!notionId(url)) { toast('Paste the link of a Notion database (open it as a full page, then Share → Copy link).'); return; }
    el.disabled = true;
    try { ui.notionDraft = await inspectDatabase(notionApi(), url); } catch (err) { toast(`Notion: ${err.message}`); } finally { el.disabled = false; }
    renderBody();
  } else if (act === 'link-cancel') {
    ui.notionDraft = null;
    renderBody();
  } else if (act === 'link-save') {
    const d = ui.notionDraft;
    if (!d.map.title) { toast('Choose which property is the task name.'); return; }
    let projectId = $('#link-project').value;
    if (!projectId) projectId = store.addProject(d.title, { notionUrl: d.url }).id;
    else if (!store.project(projectId).notionUrl && d.url) store.updateProject(projectId, { notionUrl: d.url });
    const link = { id: Math.random().toString(36).slice(2), databaseId: d.id, title: d.title, url: d.url, projectId, map: d.map, lastSync: null };
    ui.notionDraft = null;
    setNotion({ links: [...n.links, link] });
    await runNotionSync([store.state.settings.notion.links.length - 1]);
  } else if (act === 'sync-all') {
    await runNotionSync();
  } else if (act === 'sync-one') {
    await runNotionSync([Number(el.dataset.i)]);
  } else if (act === 'unlink') {
    const l = n.links[Number(el.dataset.i)];
    if (!confirm(`Stop syncing “${l.title}”? Tasks stay in JourneyMan and pages stay in Notion.`)) return;
    setNotion({ links: n.links.filter((_, i) => i !== Number(el.dataset.i)) });
  } else if (act === 'journal-set') {
    const url = $('#journal-url').value.trim();
    const id = notionId(url);
    if (!id) { toast('Paste the link of your journal database.'); return; }
    try {
      const db = await notionApi()('GET', `databases/${id}`);
      const jm = journalMap(db);
      if (!jm.titleProp) throw new Error('That database has no title property.');
      setNotion({ journal: { databaseId: id, title: (db.title || []).map((x) => x.plain_text).join('') || 'Journal', ...jm } });
      toast(jm.dateProp ? 'Journal database set' : 'Journal set. Add a date property in Notion so each day gets one page.');
    } catch (err) { toast(`Notion: ${err.message}`); }
  } else if (act === 'journal-clear') {
    setNotion({ journal: null });
  } else if (act === 'rule-del') {
    const rules = [...store.state.settings.activityRules];
    const [gone] = rules.splice(Number(el.dataset.i), 1);
    store.updateSettings({ activityRules: rules });
    toast('Rule removed', () => store.updateSettings({ activityRules: [...store.state.settings.activityRules, gone] }));
  }
}

async function reviewAction(act, el) {
  if (act === 'archive') {
    const done = store.state.projects.filter((p) => p.status === 'done');
    for (const p of done) store.updateProject(p.id, { status: 'archived' });
    toast(`Archived ${done.length} project${done.length === 1 ? '' : 's'}`, () => done.forEach((p) => store.updateProject(p.id, { status: 'done' })));
  } else if (act === 'finish') {
    const notes = $('#review-notes').value.trim();
    const summary = reviewSummary(store, notes);
    const toNotion = $('#review-notion')?.checked;
    store.updateSettings({ reviews: [...(store.state.settings.reviews || []), { date: store.today(), notes, summary }] });
    toast('Review done. See you next week.');
    if (toNotion) {
      el.disabled = true;
      try {
        await writeJournal(notionApi(), store.state.settings.notion.journal, { day: store.today(), title: `${longDay(store.today())} · weekly review`, text: summary });
        toast('Review added to your Notion journal');
      } catch (err) { toast(`Notion: ${err.message}`); }
    }
    renderAll(true);
  }
}

function onSettingInput(el) {
  const path = el.dataset.set;
  if (path === 'activityIgnore') { store.updateSettings({ activityIgnore: el.value.split(',').map((x) => x.trim()).filter(Boolean) }, { silent: true }); return; }
  const [group, key] = path.split('.');
  const value = el.type === 'checkbox' ? el.checked : el.value.trim();
  store.updateSettings({ [group]: { ...store.state.settings[group], [key]: value } }, { silent: true });
  if (path === 'notion.autoSync') scheduleAutoSync();
}

let autoTimer = 0;
function scheduleAutoSync() {
  clearInterval(autoTimer);
  if (store.state.settings.notion.autoSync && bridgeReady()) autoTimer = setInterval(() => runNotionSync(null, { quiet: true }), 10 * 60_000);
}

/* ---------- actions ---------- */
function select(id, openDetail) {
  ui.selected = id;
  if (openDetail) ui.detail = true;
  renderBody();
  renderDetail(true);
  $(`.task[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}
function visibleIds() {
  return $$('#view-body .task').filter((li) => !li.closest('details:not([open])')).map((li) => li.dataset.id);
}
function moveSelection(step) {
  const ids = visibleIds();
  if (!ids.length) return;
  const i = ids.indexOf(ui.selected);
  const next = i < 0 ? (step > 0 ? 0 : ids.length - 1) : Math.min(Math.max(i + step, 0), ids.length - 1);
  select(ids[next], ui.detail);
}

function completeTask(id) {
  const t = store.task(id);
  if (!t) return;
  const before = { ...t };
  if (!t.done && store.running()?.taskId === id) store.stopTimer();
  const row = $(`#view-body .task[data-id="${id}"]`);
  if (!t.done && row) {
    row.classList.add('completing');
    setTimeout(() => store.toggleDone(id), 260);
  } else store.toggleDone(id);
  toast(t.done ? 'Marked as not done' : `Completed “${t.title}”`, () => store.restore('task', before));
}
function deleteTask(id) {
  const ids = visibleIds();
  const i = ids.indexOf(id);
  const gone = store.deleteTask(id);
  if (!gone) return;
  if (ui.selected === id) ui.selected = ids[i + 1] || ids[i - 1] || null;
  renderAll(false);
  toast(`Deleted “${gone.task.title}”`, () => store.undoDelete(gone));
}
function setWhen(id, when) {
  store.updateTask(id, { when });
  const t = store.task(id);
  toast(when ? `Scheduled for ${formatDay(when, store.today())}` : 'Date removed');
  if (ui.detail && ui.selected === id) renderDetail(true);
  return t;
}
async function newProject(areaId) {
  const name = await askText('New project', 'Project name, e.g. Launch my portfolio', 'Create');
  if (!name) return;
  const p = store.addProject(name, { areaId: areaId || null });
  go('project/' + p.id);
}
async function newArea() {
  const name = await askText('New area', 'Area name, e.g. Study, Health, Family', 'Create');
  if (!name) return;
  const a = store.addArea(name);
  go('area/' + a.id);
}

/* ---------- quick add ---------- */
function updatePreview() {
  const text = $('#qa-input').value;
  const el = $('#qa-preview');
  if (!text.trim()) {
    el.innerHTML = addedMsg || '';
    return;
  }
  const today = store.today();
  const p = parseQuickAdd(text, { today, projects: store.state.projects, areas: store.state.areas });
  const chips = [];
  if (p.projectId) chips.push(`<span class="chip where">${esc(store.project(p.projectId).name)}</span>`);
  if (p.newProject) chips.push(`<span class="chip new">New project: ${esc(p.newProject)}</span>`);
  if (p.areaId) chips.push(`<span class="chip where"><i class="dot" style="--c:${areaColor(store.area(p.areaId))}"></i>${esc(store.area(p.areaId).name)}</span>`);
  if (p.newArea) chips.push(`<span class="chip new">New area: ${esc(p.newArea)}</span>`);
  if (p.when) chips.push(`<span class="chip">${formatDay(p.when, today)}${p.time ? ' ' + p.time : ''}</span>`);
  if (p.deadline) chips.push(`<span class="chip deadline">${icon('flag')}Due ${formatDay(p.deadline, today)}</span>`);
  if (p.estimate) chips.push(`<span class="chip">${icon('clock')}${formatMinutes(p.estimate)}</span>`);
  if (p.priority) chips.push(`<span class="chip prio-chip">${'!'.repeat(p.priority)}</span>`);
  if (p.notionUrl) chips.push(`<span class="chip">${icon('notion')}Notion link</span>`);
  const ctx = context();
  const dest = !p.projectId && !p.newProject && !p.areaId && !p.newArea && !p.when && !p.deadline
    ? `<span class="qa-dest">→ ${esc(ctx.when ? 'Today' : ctx.label)}</span>` : '';
  el.innerHTML = `${p.title ? `<span class="qa-title">${esc(p.title)}</span>` : '<span class="qa-dest">Type a task name</span>'}${chips.join('')}${dest}<span class="qa-enter"><kbd>↩</kbd> to add</span>`;
}
function onQuickAdd(e) {
  e.preventDefault();
  const input = $('#qa-input');
  const t = store.addFromText(input.value, context());
  if (!t) return;
  input.value = '';
  const today = store.today();
  const where = t.inbox ? 'Inbox'
    : t.when === today ? 'Today'
    : t.when ? formatDay(t.when, today)
    : t.projectId ? store.project(t.projectId).name
    : t.areaId ? store.area(t.areaId).name : 'Anytime';
  const shown = !!$(`#view-body .task[data-id="${t.id}"]`);
  const target = t.projectId ? `project/${t.projectId}` : t.inbox ? 'inbox' : t.when && t.when > today ? 'upcoming' : t.when ? 'today' : t.areaId ? `area/${t.areaId}` : 'anytime';
  addedMsg = `<span class="qa-added">${icon('check')} Added to ${esc(where)}${shown ? '' : ` · <a href="#${target}">Show</a>`}</span>`;
  clearTimeout(addedTimer);
  addedTimer = setTimeout(() => { addedMsg = null; updatePreview(); }, 3500);
  updatePreview();
  const row = $(`#view-body .task[data-id="${t.id}"]`);
  if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'nearest' }); }
}

/* ---------- palette (⌘K and Move) ---------- */
const palette = { items: [], index: 0, source: null };
function openPalette(placeholder, source) {
  palette.source = source;
  palette.index = 0;
  const wrap = $('#palette'), input = $('#palette-input');
  wrap.hidden = false;
  input.value = '';
  input.placeholder = placeholder;
  renderPalette();
  input.focus();
}
function closePalette() {
  $('#palette').hidden = true;
  palette.source = null;
}
function renderPalette() {
  palette.items = palette.source($('#palette-input').value).slice(0, 40);
  palette.index = Math.min(palette.index, Math.max(palette.items.length - 1, 0));
  $('#palette-list').innerHTML = palette.items.length
    ? palette.items.map((it, i) => `<li role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === palette.index}" class="${i === palette.index ? 'on' : ''}">
        ${it.icon ? icon(it.icon) : `<i class="dot" style="--c:${it.color || 'var(--ink-3)'}"></i>`}<span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</li>`).join('')
    : '<li class="none">No matches</li>';
  $('#palette-input').setAttribute('aria-activedescendant', palette.items.length ? `pal-${palette.index}` : '');
  $('#palette-list .on')?.scrollIntoView({ block: 'nearest' });
}
function pickPalette(i) {
  const it = palette.items[i];
  closePalette();
  if (it) it.run();
}
const match = (q) => (s) => s.toLowerCase().includes(q.trim().toLowerCase());

function gotoSource(q) {
  const m = match(q);
  const items = Object.entries(VIEWS).filter(([, v]) => m(v.title)).map(([k, v]) => ({ label: v.title, icon: v.icon, run: () => go(k) }));
  for (const a of sortedAreas()) if (m(a.name)) items.push({ label: a.name, color: areaColor(a), sub: 'Area', run: () => go('area/' + a.id) });
  for (const p of store.state.projects) if (m(p.name) && p.status !== 'archived') items.push({ label: p.name, color: areaColor(store.area(p.areaId)), sub: 'Project', run: () => go('project/' + p.id) });
  if (q.trim()) {
    for (const t of store.state.tasks) {
      if (!m(t.title + ' ' + t.notes)) continue;
      const p = store.projectOf(t);
      items.push({
        label: t.title, icon: t.done ? 'logbook' : 'check', sub: p ? p.name : t.inbox ? 'Inbox' : '',
        run: () => openTask(t.id),
      });
    }
  }
  return items;
}
function moveSource(taskId) {
  return (q) => {
    const m = match(q);
    const items = [];
    if (m('inbox no project')) items.push({ label: 'No project or area', icon: 'inbox', run: () => store.updateTask(taskId, { projectId: null, areaId: null }) });
    for (const a of sortedAreas()) {
      for (const p of store.state.projects.filter((x) => x.areaId === a.id && x.status !== 'archived' && x.status !== 'done')) {
        if (m(p.name) || m(a.name)) items.push({ label: p.name, sub: a.name, color: areaColor(a), run: () => movedTo(taskId, { projectId: p.id }, p.name) });
      }
      if (m(a.name)) items.push({ label: a.name, sub: 'Area, no project', color: areaColor(a), run: () => movedTo(taskId, { projectId: null, areaId: a.id }, a.name) });
    }
    for (const p of store.state.projects.filter((x) => !x.areaId && x.status !== 'archived' && x.status !== 'done')) {
      if (m(p.name)) items.push({ label: p.name, sub: 'Project', run: () => movedTo(taskId, { projectId: p.id }, p.name) });
    }
    return items;
  };
}
function movedTo(id, fields, name) {
  store.updateTask(id, fields);
  toast(`Moved to ${name}`);
  if (ui.detail && ui.selected === id) renderDetail(true);
}

/* ---------- dialogs, toast ---------- */
function askText(title, placeholder, okLabel) {
  const dlg = $('#ask');
  $('#ask-title').textContent = title;
  const input = $('#ask-input');
  input.value = '';
  input.placeholder = placeholder;
  $('#ask-ok').textContent = okLabel;
  dlg.returnValue = '';
  dlg.showModal();
  input.focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? input.value.trim() : null), { once: true });
  });
}

let toastTimer = 0, toastUndo = null;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" id="toast-undo">Undo <kbd>⌘Z</kbd></button>' : ''}`;
  el.hidden = false;
  toastUndo = undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  $('#toast').hidden = true;
  toastUndo = null;
}
function undoLast() {
  if (!toastUndo) return false;
  const fn = toastUndo;
  hideToast();
  fn();
  return true;
}

function banner(msg) {
  const el = $('#banner');
  el.textContent = msg;
  el.hidden = false;
}

/* ---------- settings, backup, Notion import ---------- */
function openSettings() {
  $('#set-hours').value = store.state.settings.hoursPerDay;
  $('#set-days').value = store.state.settings.daysPerWeek;
  $('#set-adjust').checked = !!store.state.settings.adjustEstimates;
  const m = store.estimateMultiplier();
  $('#mult-status').textContent = m.ratio ? `Right now your tasks take ${m.ratio.toFixed(2)}× your estimates (from ${m.samples} finished tasks).` : `This starts once 3 finished tasks have both an estimate and tracked time (${m.samples} so far).`;
  const n = store.state.tasks.length;
  $('#storage-status').textContent = storage.ok
    ? `${n} task${n === 1 ? '' : 's'} and ${store.state.projects.length} projects are saved in this browser on this Mac. Export a backup now and then.`
    : 'Storage is unavailable in this window, so nothing is being saved. Export before you close it.';
  $('#settings').showModal();
}
function exportAllTime() {
  download(`journeyman-time-all-${store.today()}.csv`, entriesCsv(store), 'text/csv');
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(store.snapshot(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `journeyman-backup-${store.today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('That file is not a JourneyMan backup.');
    return;
  }
  if (!data || data.app !== 'JourneyMan' || !Array.isArray(data.tasks)) {
    toast('That file is not a JourneyMan backup.');
    return;
  }
  if (!confirm(`Replace everything here with this backup (${data.tasks.length} tasks, ${(data.projects || []).length} projects)?`)) return;
  await storage.replaceAll(data);
  store.load(data);
  $('#settings').close();
  go('today');
  toast('Backup restored');
}
function pickNotionCsv() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const { projectName, tasks, columns } = notionCsvToTasks(await file.text(), file.name);
    if (!tasks.length) {
      toast('No tasks found in that CSV. Export the database from Notion as Markdown & CSV.');
      return;
    }
    const p = store.addProject(projectName, { areaId: ui.route.view === 'area' ? ui.route.id : null, notes: 'Imported from Notion.' });
    const yesterday = new Date(Date.now() - 864e5).toISOString();
    tasks.forEach((t, i) => store.addTask({
      ...t, projectId: p.id, order: i,
      doneAt: t.done ? (t.deadline ? `${t.deadline}T12:00:00.000Z` : yesterday) : null,
    }));
    go('project/' + p.id);
    const used = Object.values(columns).join(', ');
    toast(`Imported ${tasks.length} tasks into “${projectName}”, using ${used}. Paste the database's Notion link above to link it.`);
  });
  input.click();
}

/* ---------- events ---------- */
function bind() {
  window.addEventListener('hashchange', onRoute);
  $('#quick-add').addEventListener('submit', onQuickAdd);
  $('#qa-input').addEventListener('input', updatePreview);
  $('#add-area').addEventListener('click', newArea);
  $('#open-search').addEventListener('click', () => openPalette('Go to a list, area, project or task…', gotoSource));
  $('#open-help').addEventListener('click', () => $('#help').showModal());
  $('#open-settings').addEventListener('click', openSettings);
  $('#open-connections').addEventListener('click', () => go('connections'));
  $('#set-days').addEventListener('change', (e) => {
    const d = Number(e.target.value);
    if (d >= 1 && d <= 7) store.updateSettings({ daysPerWeek: d });
  });
  $('#set-adjust').addEventListener('change', (e) => store.updateSettings({ adjustEstimates: e.target.checked }));
  $('#export-time').addEventListener('click', () => { exportAllTime(); });
  $('#set-hours').addEventListener('change', (e) => {
    const h = Number(e.target.value);
    if (h > 0 && h <= 24) store.updateSettings({ hoursPerDay: h });
  });
  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  $('#import-notion-btn').addEventListener('click', () => { $('#settings').close(); pickNotionCsv(); });
  $('#toast').addEventListener('click', (e) => { if (e.target.closest('#toast-undo')) undoLast(); });

  $('#timer').addEventListener('click', onTimerClick);
  $('#timer').addEventListener('change', (e) => {
    if (e.target.dataset.timer === 'deep' && store.running()) store.updateEntry(store.running().id, { deep: e.target.checked });
  });

  // List clicks
  $('#view-body').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const np = e.target.closest('[data-new-project]');
    if (np) { newProject(np.dataset.newProject); return; }
    const fit = e.target.closest('[data-fit]');
    if (fit) { ui.fitFilter = fit.dataset.fit ? Number(fit.dataset.fit) : null; renderBody(); return; }
    const nu = e.target.closest('[data-nu]');
    if (nu) {
      const id = nu.closest('[data-id]').dataset.id;
      if (nu.dataset.nu === 'start') { if (store.running()?.taskId !== id) toggleTimer(id); }
      else openTask(id);
      return;
    }
    if (e.target.closest('[data-ai]')) { onAi(e.target.closest('[data-ai]').dataset.ai); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const v = ui.route.view;
      if (v === 'journal') journalAction(act.dataset.act, act);
      else if (v === 'connections') connectionsAction(act.dataset.act, act);
      else if (v === 'review') reviewAction(act.dataset.act, act);
      return;
    }
    const asg = e.target.closest('[data-assign]');
    if (asg) {
      const u = journalData(store, ui.journalDay || store.today()).summary.unmatched[Number(asg.dataset.assign)];
      if (u) openPalette(`Where did “${u.app}${u.title ? ': ' + u.title.slice(0, 40) : ''}” belong?`, assignSource(u.sample));
      return;
    }
    const op = e.target.closest('[data-open]');
    if (op) { openTask(op.dataset.open); return; }
    const gd = e.target.closest('[data-goday]');
    if (gd) { ui.journalDay = gd.dataset.goday; renderAll(true); refreshActivity(); return; }
    const row = e.target.closest('.task');
    if (!row) return;
    const id = row.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle') completeTask(id);
    else if (action === 'timer') toggleTimer(id);
    else if (action === 'today') setWhen(id, store.today());
    else if (action === 'move') openPalette('Move to project or area…', moveSource(id));
    else if (action === 'keep') { store.updateTask(id, { inbox: false }); toast('Kept in Anytime'); }
    else select(id, true);
  });
  const onBodyInput = (e) => {
    const el = e.target;
    if (el.dataset.set) { onSettingInput(el); return; }
    if (el.dataset.map && ui.notionDraft) {
      const d = ui.notionDraft;
      d.map[el.dataset.map] = el.value || null;
      if (el.dataset.map === 'status') {
        const prop = d.properties[el.value];
        d.map.statusType = prop ? prop.type : null;
        const opts = prop && prop.type !== 'checkbox' ? ((prop.status || prop.select || {}).options || []).map((o) => o.name) : [];
        d.map.doneValue = opts.find((o) => /done|complete/i.test(o)) || null;
        d.map.todoValue = opts.find((o) => /not started|to ?do|todo/i.test(o)) || opts[0] || null;
        renderBody();
      }
    }
  };
  $('#view-body').addEventListener('change', onBodyInput);
  $('#view-body').addEventListener('input', (e) => { if (e.target.dataset.set && e.target.type !== 'checkbox') onSettingInput(e.target); });
  $('#view-body').addEventListener('toggle', (e) => {
    const d = e.target.closest('details[data-group]');
    if (d) ui.openGroups[d.dataset.group] = d.open;
  }, true);

  // Header: project / area fields
  const head = $('#view-head');
  const onHead = (e) => {
    const el = e.target;
    const textual = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'date');
    if ((e.type === 'input') !== textual) return;
    if (el.dataset.pfield) {
      let v = el.value;
      if (el.dataset.pfield === 'notionUrl') { v = v.trim() || null; syncNotionButton(el, v); }
      else if (el.dataset.pfield !== 'name' && el.dataset.pfield !== 'notes') v = v || null;
      if (el.dataset.pfield === 'name' && !v.trim()) v = 'Untitled project';
      store.updateProject(ui.route.id, { [el.dataset.pfield]: v });
      if (el.dataset.pfield === 'areaId') $('#p-ring')?.style.setProperty('--c', areaColor(store.area(v)));
      if (el.dataset.pfield === 'notes') autosize(el);
    } else if (el.dataset.afield) {
      let v = el.value;
      if (el.dataset.afield === 'notionUrl') { v = v.trim() || null; syncNotionButton(el, v); }
      if (el.dataset.afield === 'targetHours') { store.updateArea(ui.route.id, { targetHours: Number(v) > 0 ? Number(v) : null }); return; }
      store.updateArea(ui.route.id, { [el.dataset.afield]: v || (el.dataset.afield === 'name' ? 'Untitled area' : null) });
    }
  };
  head.addEventListener('input', onHead);
  head.addEventListener('change', (e) => {
    if (e.target.id === 'activity-file' && e.target.files.length) { importActivity([...e.target.files]); e.target.value = ''; }
  });
  head.addEventListener('change', onHead);
  head.addEventListener('click', (e) => {
    const dy = e.target.closest('[data-day]');
    if (dy) { shiftDay(store, ui, Number(dy.dataset.day)); renderAll(true); refreshActivity(); return; }
    const hact = e.target.closest('[data-act]');
    if (hact && ui.route.view === 'journal') { journalAction(hact.dataset.act, hact); return; }
    const wk = e.target.closest('[data-week]');
    if (wk) {
      const cur = ui.week || weekStart(store.today());
      ui.week = wk.dataset.week === '0' ? weekStart(store.today()) : addDays(cur, 7 * Number(wk.dataset.week));
      renderHead();
      renderBody();
      return;
    }
    if (e.target.closest('[data-export-week]')) { exportWeek(store, ui); return; }
    const sw = e.target.closest('[data-color]');
    if (sw) { store.updateArea(ui.route.id, { color: sw.dataset.color }); renderHead(); return; }
    const np = e.target.closest('[data-new-project]');
    if (np) { newProject(np.dataset.newProject); return; }
    if (e.target.closest('[data-import-notion]')) { pickNotionCsv(); return; }
    if (e.target.closest('#delete-project')) {
      const p = store.project(ui.route.id);
      const n = store.projectStats(p.id).open;
      if (confirm(`Delete “${p.name}”?${n ? ` Its ${n} open task${n === 1 ? '' : 's'} will move to the Inbox.` : ''}`)) { store.deleteProject(p.id); go('projects'); }
      return;
    }
    if (e.target.closest('#delete-area')) {
      const a = store.area(ui.route.id);
      if (confirm(`Delete the area “${a.name}”? Its projects and tasks are kept, without an area.`)) { store.deleteArea(a.id); go('projects'); }
    }
  });

  // Detail pane
  const detail = $('#detail');
  const onDetail = (e) => {
    const el = e.target;
    const f = el.dataset.field;
    if (!f || !ui.selected) return;
    const textual = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'date' && el.type !== 'time');
    if ((e.type === 'input') !== textual) return;
    let v = el.value;
    if (f === 'estimate') v = v ? Number(v) : null;
    else if (f === 'title') { autosize(el); if (!v.trim()) return; }
    else if (f === 'notionUrl') { v = v.trim() || null; syncNotionButton(el, v); }
    else if (f !== 'notes') v = v || null;
    store.updateTask(ui.selected, { [f]: v });
    if (f === 'projectId' || f === 'areaId' || f === 'when') renderDetail(true);
  };
  detail.addEventListener('input', onDetail);
  detail.addEventListener('change', onDetail);
  detail.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-log-form]');
    if (!form || !ui.selected) return;
    e.preventDefault();
    const mins = parseDuration(form.mins.value);
    if (!mins) { form.mins.setAttribute('aria-invalid', 'true'); form.mins.focus(); return; }
    store.logTime(ui.selected, mins, { day: form.day.value || store.today() });
    toast(`Logged ${hours(mins)}`);
    renderDetail(true);
  });
  detail.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('d-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  detail.addEventListener('click', (e) => {
    const id = ui.selected;
    if (!id) return;
    if (e.target.closest('#d-close')) { closeDetail(); return; }
    const w = e.target.closest('[data-when]')?.dataset.when;
    if (w) {
      const d = store.today();
      setWhen(id, { today: d, tomorrow: addDays(d, 1), nextweek: nextMonday(d), clear: null }[w]);
      return;
    }
    const pr = e.target.closest('[data-priority]');
    if (pr) {
      store.updateTask(id, { priority: Number(pr.dataset.priority) });
      $$('[data-priority]', detail).forEach((b) => b.setAttribute('aria-pressed', b === pr));
      return;
    }
    const del = e.target.closest('[data-entry-del]');
    if (del) {
      const gone = store.deleteEntry(del.dataset.entryDel);
      renderDetail(true);
      if (gone) toast(`Removed ${hours(store.entryMinutes(gone))} of time`, () => { store.restore('entry', gone); renderDetail(true); });
      return;
    }
    const deep = e.target.closest('[data-entry-deep]');
    if (deep) { const en = store.entry(deep.dataset.entryDeep); store.updateEntry(en.id, { deep: !en.deep }); renderDetail(true); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle') completeTask(id);
    else if (action === 'timer') { toggleTimer(id); renderDetail(true); }
    else if (action === 'delete') deleteTask(id);
    else if (action === 'keep') { store.updateTask(id, { inbox: false }); renderDetail(true); toast('Kept in Anytime'); }
  });

  // Palette
  $('#palette-input').addEventListener('input', () => { palette.index = 0; renderPalette(); });
  $('#palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palette.index = Math.min(palette.index + 1, palette.items.length - 1); renderPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palette.index = Math.max(palette.index - 1, 0); renderPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickPalette(palette.index); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  $('#palette-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) pickPalette(Number(li.dataset.i));
  });
  $('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });

  document.addEventListener('keydown', onKey);
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (['time', 'insights'].includes(ui.route.view)) renderBody(); }, 150);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    checkDay();
    if (ui.route.view === 'journal') refreshActivity();
  });
  setInterval(checkDay, 60_000);
}

function syncNotionButton(input, url) {
  const btn = input.parentElement.querySelector('.notion-open');
  if (!btn) return;
  const ok = url && isNotionUrl(url);
  btn.hidden = !ok;
  btn.href = ok ? notionAppUrl(url) : '#';
}

function closeDetail() {
  ui.detail = false;
  renderDetail(true);
  if (ui.selected) $(`.task[data-id="${ui.selected}"]`)?.focus?.();
}

function checkDay() {
  const d = store.today();
  if (ui.lastDay && ui.lastDay !== d) renderAll(true);
  ui.lastDay = d;
}

let gPending = 0;
function onKey(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (!$('#palette').hidden || document.querySelector('dialog[open]')) return;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette('Go to a list, area, project or task…', gotoSource); return; }
  const el = e.target;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
  if (e.key === 'Escape') {
    if (typing) {
      if (el.id === 'qa-input') { el.value = ''; updatePreview(); }
      el.blur();
    } else if (ui.detail) closeDetail();
    else if (ui.selected) { ui.selected = null; renderBody(); }
    return;
  }
  if (mod && e.key.toLowerCase() === 'z' && !typing) { if (undoLast()) e.preventDefault(); return; }
  if (typing || mod || e.altKey) return;

  if (gPending) {
    clearTimeout(gPending);
    gPending = 0;
    const dest = { i: 'inbox', t: 'today', u: 'upcoming', a: 'anytime', p: 'projects', l: 'logbook', m: 'time', s: 'insights', j: 'journal', r: 'review', c: 'connections' }[e.key.toLowerCase()];
    if (dest) { e.preventDefault(); go(dest); }
    return;
  }
  const id = ui.selected;
  switch (e.key) {
    case 'n': case 'N': case '/': e.preventDefault(); $('#qa-input').focus(); return;
    case 's': if (!id && store.running()) { e.preventDefault(); toggleTimer(store.running().taskId); return; } break;
    case 'g': gPending = setTimeout(() => { gPending = 0; }, 1200); return;
    case '?': e.preventDefault(); $('#help').showModal(); return;
    case 'j': case 'ArrowDown': e.preventDefault(); moveSelection(1); return;
    case 'k': case 'ArrowUp': e.preventDefault(); moveSelection(-1); return;
  }
  if (!id) return;
  switch (e.key) {
    case 'Enter': case 'e': e.preventDefault(); ui.detail = true; renderDetail(true); $('#detail .d-title')?.focus(); break;
    case 'x': case ' ': e.preventDefault(); completeTask(id); break;
    case 's': e.preventDefault(); toggleTimer(id); if (ui.detail) renderDetail(true); break;
    case 't': e.preventDefault(); setWhen(id, store.today()); break;
    case 'T': e.preventDefault(); setWhen(id, addDays(store.today(), 1)); break;
    case 'm': e.preventDefault(); openPalette('Move to project or area…', moveSource(id)); break;
    case 'Backspace': case 'Delete': e.preventDefault(); deleteTask(id); break;
  }
}

/* ---------- start ---------- */
async function boot() {
  storage = await openStorage();
  store = createStore({ save: storage.save, remove: storage.remove });
  store.load(storage.data);
  if (!store.state.settings.seeded && !store.state.tasks.length && !store.state.projects.length) seed(store);
  if (!storage.ok) banner('Storage is unavailable in this window (private browsing?), so changes will not be kept.');
  ui.lastDay = store.today();
  setInterval(tick, 1000);
  store.subscribe(() => renderAll(false));
  await loadFolder();
  bind();
  onRoute();
  scheduleAutoSync();
  if (store.state.settings.notion.autoSync) runNotionSync(null, { quiet: true });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.journeyman = store; // handy from the browser console
}
boot();
