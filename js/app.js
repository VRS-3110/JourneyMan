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
import { connectionsHead, bridgeSection, notionSection, activitySection, atlasSection } from './views/connections.js';
import { parseActivity, toSessions, applyActivity, rollForward, suggestRule, journalText, targetName } from './activity.js';
import { makeApi, syncLink, inspectDatabase, journalMap, notionId, writeJournal } from './notion.js';
import { localDay } from './reports.js';
import { callAi } from './ai.js';
import { supabase, syncOnce, sessionFromHash, toSession, ensureToken } from './sync.js';
import { nextUp } from './insights.js';
import { findByName } from './parse.js';
import { describeRepeat } from './recurrence.js';
import { eventsOn, findSlot, normalizeEvents } from './calendar.js';
import { authorize, revoke, tokenValid, calendarApi, readCalendar, blockBody } from './gcal.js';
import { native } from './native.js';
import { ATLAS_FILE, ATLAS_PREFIX, JOURNEYMAN_FILE, parseAtlasExport, importAtlas, journeymanExport, exportKey, summaryText, atlasTaskId, atlasLink, atlasNodeOf } from './atlas.js';

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
  if (location.hash.startsWith('#task/')) { routeToTask(decodeURIComponent(location.hash.slice(6))); return; }
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
  $('#brain-dump').hidden = !aiReady();
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
        ${aiReady() ? `<button type="button" class="btn small" data-ai="breakdown">${icon('sparkle')} Suggest next steps</button>` : ''}
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

/* Where an Atlas task came from, and a way back. */
function atlasRow(t) {
  const node = atlasNodeOf(t);
  if (!node) return '';
  const map = t.atlasMapId && store.state.projects.find((p) => p.atlasMapId === t.atlasMapId);
  const where = !t.atlasId ? 'No longer in Atlas. Kept for its tracked time.'
    : `From ${map ? `the “${esc(map.atlasMapName || map.name)}” map` : 'the Atlas planner'}. Name and dates follow Atlas; done and time go both ways.`;
  return `<div class="d-notion d-atlas"><span class="d-label">${icon('map')} Atlas</span>
    <span class="notion-row"><small class="muted grow">${where}</small>${t.atlasId ? `<a class="btn small" href="${atlasLink(node)}">Open in Atlas</a>` : ''}</span></div>`;
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
      <span>${icon('clock')} <b>${formatMinutes(c.planned) || '0m'}</b> planned of ${formatMinutes(c.available)}${c.meetings ? ` free (${formatMinutes(store.state.settings.hoursPerDay * 60)} minus ${formatMinutes(Math.round(c.meetings))} of meetings)` : ''}${over ? ` · <b class="late-text">${formatMinutes(c.planned - c.available)} over</b>` : ''}${c.unestimated ? ` · ${c.unestimated} without an estimate` : ''}</span></div>` : '';
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
  if (t.repeat) chips.push(`<span class="chip" title="${esc(describeRepeat(t.repeat))}">${icon('repeat')}${esc(describeRepeat(t.repeat, { short: true }))}</span>`);
  if (t.block && !t.done) chips.push(`<span class="chip" title="Time blocked in your calendar">${icon('upcoming')}${hmOf(t.block.start)}</span>`);
  if (t.notes) chips.push(`<span class="chip icon-only" title="Has notes">${icon('note')}</span>`);
  if (t.notionUrl) chips.push(`<a class="chip notion" href="${esc(notionAppUrl(t.notionUrl))}" title="Open in Notion" aria-label="Open in Notion">${icon('notion')}</a>`);
  if (t.atlasId) chips.push(`<a class="chip notion" href="${atlasLink(t.atlasId)}" title="Open in Atlas" aria-label="Open in Atlas">${icon('map')}</a>`);
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
      html += calendarCard();
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
      body.innerHTML = reviewBody(store, { notion: !!(store.state.settings.notion.journal && bridgeReady()), ai: aiReady() });
      return;
    }
    case 'connections': {
      body.innerHTML = bridgeSection(store, ui) + notionSection(store, ui) + activitySection(store, ui) + extraConnections();
      return;
    }
    case 'upcoming': {
      const groups = new Map(store.upcoming(14).map((g) => [g.day, { tasks: g.tasks, ghosts: [] }]));
      for (const g of store.upcomingRepeats(14)) {
        if (!groups.has(g.day)) groups.set(g.day, { tasks: [], ghosts: [] });
        groups.get(g.day).ghosts.push(g.task);
      }
      const days = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      const ghostRow = (t) => `<li class="task ghost" data-ghost="${t.id}" title="Repeats: created when you finish the current one">
        <span class="ghost-icon">${icon('repeat')}</span><div class="task-main"><span class="task-title">${esc(t.title)}</span>
        <span class="task-meta"><span class="chip">${esc(describeRepeat(t.repeat, { short: true }))}</span>${t.estimate ? `<span class="chip">${icon('clock')}${formatMinutes(t.estimate)}</span>` : ''}</span></div></li>`;
      html = days.length
        ? days.map(([day, g]) => {
          const meet = store.meetings(day);
          return `<section class="day"><h2 class="list-head"><b>${formatDay(day, today)}</b> <span>${longDate(day)}${meet ? ` · ${hours(meet)} of meetings` : ''}</span></h2>
            ${g.tasks.length ? taskList(g.tasks, { when: false }) : ''}${g.ghosts.length ? `<ul class="tasks">${g.ghosts.map(ghostRow).join('')}</ul>` : ''}</section>`;
        }).join('')
        : empty('Nothing scheduled', 'Add a date when you capture, like <code>fri</code> or <code>dec 5</code>, or a repeat like <code>every mon</code>.');
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
      ${atlasRow(t)}
    </div>
    ${repeatSection(t)}
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
      ${store.state.calendar && !t.done ? (t.block
        ? `<p class="block-line">${icon('upcoming')} Blocked ${esc(formatDay(todayOf(new Date(t.block.start)), store.today()))} ${hmOf(t.block.start)}–${hmOf(t.block.end)}${t.block.link ? ` · <a href="${esc(t.block.link)}" target="_blank" rel="noopener">Open</a>` : ''} <button type="button" class="btn small ghost" data-action="unblock">Remove</button></p>`
        : `<button type="button" class="btn small" data-action="block">${icon('upcoming')} Block ${hours(t.estimate || 30)} in Calendar</button>`) : ''}
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
const homeOf = (t) => (t.done ? 'logbook' : t.projectId ? 'project/' + t.projectId : t.inbox ? 'inbox'
  : t.when && t.when <= store.today() ? 'today' : t.when ? 'upcoming' : t.areaId ? 'area/' + t.areaId : 'anytime');
function openTask(id) {
  const t = store.task(id);
  if (!t) return;
  const home = homeOf(t);
  if (location.hash.slice(1) === home) { select(t.id, true); return; }
  ui.pendingSelect = t.id;
  go(home);
}

/*
  A link to one task, #task/<id>, as Atlas's "Open in JourneyMan" makes. The address is swapped for the
  task's home list (so Back doesn't bounce), and an Atlas task not seen yet is looked for in the Atlas folder first.
*/
function routeToTask(raw) {
  const id = raw.toLowerCase().startsWith(ATLAS_PREFIX) ? atlasTaskId(raw.slice(ATLAS_PREFIX.length)) : raw;
  const t = store.task(id);
  if (t) ui.pendingSelect = t.id;
  history.replaceState(null, '', '#' + (t ? homeOf(t) : 'today'));
  onRoute();
  if (t) return;
  if (!id.startsWith(ATLAS_PREFIX)) { toast('That task isn’t in JourneyMan.'); return; }
  if (ui.atlas !== 'granted') { toast('That Atlas task isn’t here yet. Connect the Atlas folder in Connections.'); return; }
  runAtlasSync({ force: true }).then(() => (store.task(id) ? openTask(id) : toast('That Atlas task isn’t in JourneyMan yet. Is sharing on in Atlas → Settings?')));
}

/* ---------- phase 4: Notion bridge, journal, review ---------- */
const bridgeReady = () => !!(store.state.settings.notion.workerUrl && store.state.settings.notion.appKey);
const notionApi = () => makeApi(store.state.settings.notion);
function connectionsExtra() { return ', Atlas, Google Calendar, device sync and Claude'; }
function extraConnections() { return atlasSection(store, ui, { canPick: canPickFolder(), native: !!native }) + gcalSection() + syncSection() + aiSection(); }

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
  // In the Mac app the folder is always there: ~/Documents/JourneyMan/activity, read directly.
  if (native) { ui.folderHandle = native.folder('activity'); ui.folder = 'granted'; return; }
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
    if (native) {
      ui.folderHandle = await native.ensureFolder('activity');
      ui.folder = 'granted';
    } else if (reconnect && ui.folderHandle) {
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
/* ---------- Atlas: tasks.json in, journeyman.json out, through a shared folder ---------- */
const canPickFolder = () => !!native || (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function');
const setAtlas = (fields) => store.updateSettings({ atlas: { ...store.state.settings.atlas, ...fields } }, { silent: true });
async function loadAtlasFolder() {
  // The Mac app uses ~/Documents/JourneyMan/atlas directly, unless you disconnected it.
  if (native) {
    const on = !store.state.settings.atlas.off;
    ui.atlasHandle = on ? native.folder('atlas') : null;
    ui.atlas = on ? 'granted' : null;
    return;
  }
  const rec = await storage.getMeta('atlasDir');
  ui.atlasHandle = rec ? rec.handle : null;
  ui.atlas = null;
  if (ui.atlasHandle && ui.atlasHandle.queryPermission) {
    try { ui.atlas = await ui.atlasHandle.queryPermission({ mode: 'readwrite' }); } catch { ui.atlas = null; }
  }
}
/* Picking ~/Documents/JourneyMan itself works too: its atlas folder is used (and made, if Atlas hasn't yet). */
async function atlasFolderIn(handle) {
  try { await handle.getFileHandle(ATLAS_FILE); return handle; } catch { /* not here */ }
  try { return await handle.getDirectoryHandle('atlas'); } catch { /* none */ }
  if (handle.name === 'JourneyMan') { try { return await handle.getDirectoryHandle('atlas', { create: true }); } catch { /* read-only */ } }
  return handle;
}
async function connectAtlas(reconnect) {
  try {
    if (native) {
      ui.atlasHandle = await native.ensureFolder('atlas');
      ui.atlas = 'granted';
      setAtlas({ off: false });
    } else if (reconnect && ui.atlasHandle) {
      ui.atlas = await ui.atlasHandle.requestPermission({ mode: 'readwrite' });
    } else {
      const picked = await window.showDirectoryPicker({ id: 'journeyman-atlas', mode: 'readwrite', startIn: 'documents' });
      ui.atlasHandle = await atlasFolderIn(picked);
      ui.atlas = 'granted';
      storage.save('meta', { id: 'atlasDir', handle: ui.atlasHandle });
    }
  } catch { return; }
  ui.atlasFileTime = 0;
  ui.atlasWritten = null;
  await runAtlasSync({ quiet: false });
}
function disconnectAtlas() {
  storage.remove('meta', 'atlasDir');
  ui.atlasHandle = null;
  ui.atlas = null;
  ui.atlasWaiting = false;
  setAtlas({ lastError: null, off: true });
  renderBody();
  toast('Atlas folder disconnected. Tasks already here stay.');
}
function applyAtlas(data, { quiet }) {
  const sum = importAtlas(store, data);
  setAtlas({ lastImport: new Date().toISOString(), lastResult: sum, lastError: null, exportedAt: data.exportedAt });
  if (!quiet) toast(`Atlas: ${summaryText(sum)}`);
  return sum;
}
/* Reads tasks.json when Atlas has rewritten it, then writes journeyman.json if anything here changed. */
async function runAtlasSync({ quiet = true, force = false } = {}) {
  if (ui.atlas !== 'granted' || !ui.atlasHandle || ui.atlasBusy) return;
  ui.atlasBusy = true;
  try {
    let file = null;
    try { file = await (await ui.atlasHandle.getFileHandle(ATLAS_FILE)).getFile(); } catch { file = null; }
    ui.atlasWaiting = !file;
    if (file && (force || !quiet || file.lastModified !== ui.atlasFileTime)) {
      const data = parseAtlasExport(await file.text());
      ui.atlasFileTime = file.lastModified;
      applyAtlas(data, { quiet });
    } else if (!file && !quiet) toast('No tasks.json from Atlas in that folder yet.');
    await writeAtlasFile();
  } catch (err) {
    setAtlas({ lastError: err.message });
    if (!quiet) toast(`Atlas: ${err.message}`);
  } finally {
    ui.atlasBusy = false;
  }
  if (ui.route.view === 'connections') renderBody();
}
async function writeAtlasFile() {
  if (ui.atlas !== 'granted' || !ui.atlasHandle) return;
  const data = journeymanExport(store, { appUrl: location.href });
  const key = exportKey(data);
  if (key === ui.atlasWritten) return;
  const fh = await ui.atlasHandle.getFileHandle(JOURNEYMAN_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(data, null, 2) + '\n');
  await w.close();
  ui.atlasWritten = key;
}
let atlasWriteTimer = 0;
function soonAtlasWrite() {
  if (ui.atlas !== 'granted') return;
  clearTimeout(atlasWriteTimer);
  atlasWriteTimer = setTimeout(() => writeAtlasFile().catch((err) => setAtlas({ lastError: err.message })), 1500);
}
async function atlasAction(act) {
  if (act === 'connect') return connectAtlas(false);
  if (act === 'reconnect') return connectAtlas(true);
  if (act === 'sync') return runAtlasSync({ quiet: false, force: true });
  if (act === 'disconnect') return disconnectAtlas();
  if (act === 'download') download(JOURNEYMAN_FILE, JSON.stringify(journeymanExport(store, { appUrl: location.href }), null, 2) + '\n', 'application/json');
}
async function importAtlasFile(file) {
  try {
    applyAtlas(parseAtlasExport(await file.text()), { quiet: false });
  } catch (err) {
    setAtlas({ lastError: err.message });
    toast(`Atlas: ${err.message}`);
  }
  renderBody();
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
      if (res.ok) store.updateSettings({ ai: { ...store.state.settings.ai, available: !!data.ai } });
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
  } else if (act === 'sync-send') {
    const cfg = store.state.settings.sync;
    if (!cfg.url || !cfg.anonKey) { toast('Add your Supabase project URL and anon key first.'); return; }
    if (!/.+@.+\..+/.test(cfg.email || '')) { toast('Enter your email first.'); return; }
    try {
      await supabase(cfg).sendCode(cfg.email.trim(), location.href.split('#')[0]);
      ui.codeSent = true;
      toast('Check your email for a 6-digit code (or open the link on this device).');
      renderBody();
    } catch (err) { toast(`Supabase: ${err.message}`); }
  } else if (act === 'sync-verify') {
    const cfg = store.state.settings.sync;
    const code = ($('#sync-code')?.value || '').trim();
    if (!code) { toast('Enter the code from the email.'); return; }
    try {
      const session = toSession(await supabase(cfg).verifyCode(cfg.email.trim(), code));
      await signedIn(session);
    } catch (err) { toast(`Supabase: ${err.message}`); }
  } else if (act === 'sync-now') {
    await runDeviceSync();
  } else if (act === 'sync-signout') {
    store.updateSettings({ sync: { ...store.state.settings.sync, session: null, state: {}, lastResult: null, lastError: null } });
    ui.codeSent = false;
    toast('Signed out. This device keeps its data.');
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
  } else if (act === 'ai-review') {
    el.disabled = true;
    try {
      const notes = $('#review-notes').value.trim();
      const out = await callAi(store.state.settings.notion, 'review', { summary: reviewSummary(store, ''), notes });
      $('#review-notes').value = `${out.reflection}\n\nFocus next week:\n${(out.focus || []).map((f) => `- ${f}`).join('\n')}${notes ? `\n\n${notes}` : ''}`;
    } catch (err) { toast(err.message); } finally { el.disabled = false; }
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
  if (path === 'sync.auto') scheduleDeviceSync();
}

let autoTimer = 0;
function scheduleAutoSync() {
  clearInterval(autoTimer);
  if (store.state.settings.notion.autoSync && bridgeReady()) autoTimer = setInterval(() => runNotionSync(null, { quiet: true }), 10 * 60_000);
}

/* ---------- phase 5: Claude ---------- */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function aiReady() { return bridgeReady() && !!store.state.settings.ai?.available; }
const isDay = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);

let aiFlow = null;
function openAiDialog(title, html, goLabel, onGo) {
  $('#ai-title').textContent = title;
  $('#ai-body').innerHTML = html;
  $('#ai-status').textContent = '';
  $('#ai-go').textContent = goLabel;
  $('#ai-go').hidden = !onGo;
  aiFlow = onGo;
  if (!$('#ai-dialog').open) $('#ai-dialog').showModal();
}
/* A checklist of suggested tasks; `add(picked)` creates the ticked ones. */
function showSuggestions(title, items, add) {
  const chips = (t) => [
    t.project && `<span class="chip where">${esc(t.project)}</span>`,
    t.area && !t.project && `<span class="chip where">${esc(t.area)}</span>`,
    t.when && `<span class="chip">${esc(formatDay(t.when, store.today()))}</span>`,
    t.deadline && `<span class="chip deadline">${icon('flag')}${esc(formatDay(t.deadline, store.today()))}</span>`,
    t.estimate && `<span class="chip">${icon('clock')}${formatMinutes(t.estimate)}</span>`,
    t.priority && `<span class="chip prio-chip">${'!'.repeat(t.priority)}</span>`,
  ].filter(Boolean).join('');
  const label = () => { const n = $$('#ai-body [data-pick]:checked').length; return `Add ${n} task${n === 1 ? '' : 's'}`; };
  openAiDialog(title, items.length
    ? `<ul class="suggest">${items.map((t, i) => `<li><label><input type="checkbox" data-pick="${i}" checked>
      <span><b>${esc(t.title)}</b>${t.notes ? `<small class="muted">${esc(t.notes)}</small>` : ''}<span class="task-meta">${chips(t)}</span></span></label></li>`).join('')}</ul>`
    : '<p class="hint">Claude had nothing to suggest.</p>',
  `Add ${items.length} task${items.length === 1 ? '' : 's'}`, async () => {
    const picked = $$('#ai-body [data-pick]:checked').map((c) => items[Number(c.dataset.pick)]);
    add(picked);
    $('#ai-dialog').close();
    toast(`Added ${picked.length} task${picked.length === 1 ? '' : 's'}`);
  });
  $('#ai-go').hidden = !items.length;
  $('#ai-body').onchange = () => { $('#ai-go').textContent = label(); };
}
function addSuggested(t, projectId = null) {
  let pid = projectId, aid = null;
  if (!pid && t.project) {
    const p = findByName(store.state.projects, t.project);
    pid = p ? p.id : store.addProject(t.project, { areaId: t.area ? findByName(store.state.areas, t.area)?.id || null : null }).id;
  }
  if (!pid && t.area) aid = findByName(store.state.areas, t.area)?.id || null;
  store.addTask({ title: t.title, projectId: pid, areaId: pid ? null : aid, when: t.when, deadline: t.deadline, estimate: t.estimate || null, priority: t.priority || 0, notes: t.notes || '' });
}

function brainDump() {
  openAiDialog('Brain dump', `<p class="hint">Type or paste everything on your mind. Claude splits it into tasks with projects, dates and estimates, and you choose which to add.</p>
    <textarea id="dump-text" class="journal-text" rows="9" placeholder="call bank about card, finish NLSC lit review by friday, gym 3x this week, buy notebook…"></textarea>`,
  'Turn into tasks', async () => {
    const text = $('#dump-text').value.trim();
    if (!text) return;
    $('#ai-status').textContent = 'Asking Claude…';
    const today = store.today();
    const out = await callAi(store.state.settings.notion, 'plan', {
      text, today, weekday: WEEKDAYS[fromISO(today).getDay()],
      areas: store.state.areas.map((a) => a.name),
      projects: store.state.projects.filter((p) => p.status === 'active').map((p) => p.name),
    });
    showSuggestions('Add these tasks?', (out.tasks || []).map((t) => ({
      title: t.title, project: t.project || '', area: t.area || '', when: isDay(t.when), deadline: isDay(t.deadline),
      estimate: t.estimate_minutes > 0 ? t.estimate_minutes : null, priority: Math.max(0, Math.min(3, t.priority || 0)), notes: t.notes || '',
    })), (picked) => picked.forEach((t) => addSuggested(t)));
  });
  setTimeout(() => $('#dump-text')?.focus(), 0);
}

async function suggestSteps() {
  const p = store.project(ui.route.id);
  if (!p) return;
  const { open, done } = store.projectTasks(p.id);
  openAiDialog(`Next steps for ${p.name}`, '<p class="hint">Asking Claude…</p>', '', null);
  try {
    const out = await callAi(store.state.settings.notion, 'breakdown', {
      today: store.today(), project: p.name, area: store.area(p.areaId)?.name || '', deadline: p.deadline || '', notes: p.notes || '',
      open: open.map((t) => t.title), done: done.slice(0, 20).map((t) => t.title),
    });
    showSuggestions(`Next steps for ${p.name}`, (out.steps || []).map((x) => ({ title: x.title, estimate: x.estimate_minutes > 0 ? x.estimate_minutes : null, notes: x.notes || '' })),
      (picked) => picked.forEach((t) => addSuggested(t, p.id)));
  } catch (err) { $('#ai-body').innerHTML = `<p class="late-text">${esc(err.message)}</p>`; }
}

async function askNow() {
  const minutes = Number($('#now-min')?.value || 30);
  const energy = $('#now-energy')?.value || 'medium';
  ui.aiNowHtml = `<p class="hint">${icon('sparkle')} Asking Claude…</p>`;
  renderBody();
  const now = store.now();
  const candidates = nextUp(store, { limit: 12 }).map((x) => {
    const p = store.projectOf(x.task);
    return { id: x.task.id, title: x.task.title, project: p ? p.name : '', estimate: x.task.estimate || 0, deadline: x.task.deadline || p?.deadline || '', reasons: x.reasons.join('; ') };
  });
  if (!candidates.length) { ui.aiNowHtml = '<p class="hint">Nothing open to choose from.</p>'; renderBody(); return; }
  try {
    const out = await callAi(store.state.settings.notion, 'now', {
      minutes, energy, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, weekday: WEEKDAYS[now.getDay()], candidates,
    });
    const t = store.task(out.task_id) || store.task(candidates[0].id);
    ui.aiNowHtml = `<div class="ai-pick" data-id="${t.id}"><b>${icon('sparkle')} ${esc(t.title)}</b>
      <p>${esc(out.reason)}</p><p class="muted">First step: ${esc(out.first_step)}</p>
      <div class="row-actions-inline"><button type="button" class="btn small primary" data-nu="start">${icon('play')} Start</button><button type="button" class="btn small ghost" data-ai="now-close">Close</button></div></div>`;
  } catch (err) {
    ui.aiNowHtml = `<p class="late-text">${esc(err.message)}</p><button type="button" class="btn small ghost" data-ai="now-close">Close</button>`;
  }
  renderBody();
}

async function aiJournal() {
  const day = ui.journalDay || store.today();
  const btn = $('[data-act="ai-journal"]');
  if (btn) btn.disabled = true;
  try {
    const out = await callAi(store.state.settings.notion, 'journal', { day: longDay(day), facts: $('#journal-text').value, notes: $('#journal-notes').value });
    $('#journal-text').value = out.entry;
    toast('Draft written. Edit it, then Save.');
  } catch (err) { toast(err.message); } finally { if (btn) btn.disabled = false; }
}

function onAi(kind) {
  if (kind === 'journal') return aiJournal();
  if (kind === 'breakdown') return suggestSteps();
  if (kind === 'now-go') return askNow();
  if (kind === 'now-close') { ui.aiNowHtml = ''; renderBody(); return; }
  if (kind === 'now') {
    ui.aiNowHtml = `<div class="ai-now-form">${icon('sparkle')} I have
      <select id="now-min">${[15, 30, 45, 60, 90, 120].map((m) => `<option value="${m}"${m === 30 ? ' selected' : ''}>${formatMinutes(m)}</option>`).join('')}</select>
      and my energy is <select id="now-energy"><option>low</option><option selected>medium</option><option>high</option></select>
      <button type="button" class="btn small primary" data-ai="now-go">Ask Claude</button>
      <button type="button" class="btn small ghost" data-ai="now-close">Cancel</button></div>`;
    renderBody();
  }
}

function aiSection() {
  const ok = aiReady();
  return `<section class="card" id="ai">
    <h2 class="card-title">${icon('sparkle')} Claude</h2>
    <p class="card-sub">With <code>ANTHROPIC_API_KEY</code> set on your bridge, JourneyMan can turn a brain dump into tasks, suggest a project's next steps, pick what to do now from your Next up list, and draft your journal entry and weekly reflection. It uses Claude Opus 5.5 with structured answers, and if Claude declines a request, Anthropic's recommended fallback model answers it.</p>
    <p class="card-sub">What goes to Anthropic, through your bridge: the text you type for it, plus the task titles, project and area names, dates and estimates each feature needs. Nothing is sent unless you press a Claude button.</p>
    <p>${ok ? `<span class="good-text">${icon('ok')} Ready.</span> Look for ✨ in quick add, on project pages, in Next up, the Journal and the Review.` : `${icon('pause')} Not set up. Add the key on the bridge, then <b>Test connection</b> above.`}</p>
  </section>`;
}

/* ---------- phase 5: sync across devices ---------- */
const syncCfg = () => store.state.settings.sync;
const syncReady = () => !!(syncCfg().url && syncCfg().anonKey && syncCfg().session);

async function signedIn(session) {
  const cfg = syncCfg();
  session.email = session.email || cfg.email;
  // A device that already has data and has never synced: merge it in, or start from the synced copy.
  if (!cfg.state?.cursor && store.state.tasks.length) {
    const merge = confirm(`This device already has ${store.state.tasks.length} tasks.\n\nOK: add them to your synced data.\nCancel: replace them with your synced data.`);
    if (!merge) {
      const keep = store.state.settings;
      await storage.replaceAll({ settings: keep });
      store.load({ settings: keep });
    }
  }
  store.updateSettings({ sync: { ...syncCfg(), session, state: syncCfg().state || {} } }, { silent: true });
  ui.codeSent = false;
  scheduleDeviceSync();
  await runDeviceSync();
}

async function runDeviceSync({ quiet = false } = {}) {
  if (ui.deviceSyncing || !syncReady() || !navigator.onLine) return;
  ui.deviceSyncing = true;
  const api = supabase(syncCfg());
  try {
    const { token, session } = await ensureToken(api, syncCfg().session);
    const { state, summary } = await syncOnce(store, api, token, syncCfg().state || {});
    store.updateSettings({ sync: { ...syncCfg(), session, state, lastResult: summary, lastError: null } }, { silent: true });
    if (!quiet) toast(summary.pushed + summary.pulled + summary.removed ? `Synced: ${summary.pushed} sent, ${summary.pulled} received${summary.removed ? `, ${summary.removed} removed` : ''}` : 'Everything is in sync');
  } catch (err) {
    const signedOut = err.status === 401 || /refresh token/i.test(err.message);
    store.updateSettings({ sync: { ...syncCfg(), lastError: err.message, ...(signedOut ? { session: null } : {}) } }, { silent: true });
    if (!quiet || signedOut) toast(signedOut ? 'Sync: please sign in again.' : `Sync: ${err.message}`);
  } finally {
    ui.deviceSyncing = false;
    if (ui.route.view === 'connections') renderBody();
  }
}

let deviceTimer = 0, deviceSoon = 0;
function scheduleDeviceSync() {
  clearInterval(deviceTimer);
  if (syncCfg().auto && syncReady()) deviceTimer = setInterval(() => runDeviceSync({ quiet: true }), 2 * 60_000);
}
/* After a local change, sync again in 20 seconds (batched). */
function soonDeviceSync() {
  if (!syncCfg().auto || !syncReady() || ui.deviceSyncing) return;
  clearTimeout(deviceSoon);
  deviceSoon = setTimeout(() => runDeviceSync({ quiet: true }), 20_000);
}

function syncSection() {
  const cfg = syncCfg();
  const s = cfg.session;
  const r = cfg.lastResult;
  return `<section class="card" id="sync">
    <h2 class="card-title">${icon('sync')} Sync across devices</h2>
    <p class="card-sub">Use JourneyMan on your Mac and your phone. Tasks, projects, areas, time, journals and shared settings sync through your own free Supabase project. Each device keeps working offline, and the newer edit always wins. Setup steps are in <code>supabase/README.md</code>.</p>
    <div class="form-grid">
      <label class="field"><span>Supabase project URL</span><input type="url" data-set="sync.url" value="${esc(cfg.url)}" placeholder="https://abcd.supabase.co"></label>
      <label class="field"><span>Anon (public) key</span><input type="password" data-set="sync.anonKey" value="${esc(cfg.anonKey)}" autocomplete="off"></label>
    </div>
    ${s ? `<p class="sync-status">${icon('ok')} Signed in as <b>${esc(s.email || cfg.email || 'you')}</b> · last sync ${cfg.state?.lastSync ? esc(new Date(cfg.state.lastSync).toLocaleTimeString()) : 'not yet'}${r ? ` · ${r.pushed} sent, ${r.pulled} received` : ''}${cfg.lastError ? ` · <span class="late-text">${esc(cfg.lastError)}</span>` : ''}</p>
      <div class="row-actions-inline">
        <button type="button" class="btn small" data-act="sync-now">${icon('sync')} Sync now</button>
        <label class="check-field"><input type="checkbox" data-set="sync.auto"${cfg.auto ? ' checked' : ''}> Sync automatically</label>
        <button type="button" class="btn small ghost" data-act="sync-signout">Sign out</button>
      </div>`
    : `<div class="row-actions-inline">
        <input type="email" data-set="sync.email" value="${esc(cfg.email || '')}" placeholder="you@example.com" class="grow" autocomplete="email">
        <button type="button" class="btn small" data-act="sync-send">Email me a code</button>
      </div>
      ${ui.codeSent ? `<div class="row-actions-inline"><input type="text" id="sync-code" inputmode="numeric" placeholder="6-digit code" autocomplete="one-time-code"><button type="button" class="btn small primary" data-act="sync-verify">Sign in</button></div>` : ''}`}
  </section>`;
}

/* ---------- repeating tasks ---------- */
const PRESETS = [['', 'Never'], ['day', 'Every day'], ['weekday', 'Every weekday'], ['week', 'Every week'], ['2week', 'Every 2 weeks'], ['month', 'Every month'], ['year', 'Every year'], ['custom', 'Custom…']];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function presetOf(r) {
  if (!r) return '';
  const days = r.days || [];
  if (r.unit === 'day' && r.every === 1) return 'day';
  if (r.unit === 'week' && r.every === 1 && days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'weekday';
  if (r.unit === 'week' && days.length <= 1) return r.every === 1 ? 'week' : r.every === 2 ? '2week' : 'custom';
  if (r.unit === 'month' && r.every === 1) return 'month';
  if (r.unit === 'year' && r.every === 1) return 'year';
  return 'custom';
}

function repeatSection(t) {
  const r = t.repeat;
  const base = t.when || t.deadline || store.today();
  const wd = fromISO(base).getDay();
  const p = presetOf(r);
  const label = (v, l) => (v === 'week' ? `Every week on ${DAY_NAME[wd]}` : v === '2week' ? `Every 2 weeks on ${DAY_NAME[wd]}` : l);
  return `<div class="d-repeat">
    <label><span>${icon('repeat')} Repeat</span>
      <select data-rep="preset">${PRESETS.map(([v, l]) => `<option value="${v}"${v === p ? ' selected' : ''}>${esc(label(v, l))}</option>`).join('')}</select></label>
    ${r ? `<div class="rep-custom">
      <span class="rep-every">Every <input type="number" min="1" max="99" data-rep="every" value="${r.every || 1}" aria-label="Every how many">
        <select data-rep="unit" aria-label="Unit">${[['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']].map(([v, l]) => `<option value="${v}"${v === r.unit ? ' selected' : ''}>${l}</option>`).join('')}</select></span>
      ${r.unit === 'week' ? `<span class="rep-days" role="group" aria-label="Days of the week">${WEEK_ORDER.map((d) => `<button type="button" data-rep-day="${d}" aria-pressed="${!!(r.days || []).includes(d)}" title="${DAY_NAME[d]}">${DAY_LETTER[d]}</button>`).join('')}</span>` : ''}
      <label class="check-field"><input type="checkbox" data-rep="after"${r.afterDone ? ' checked' : ''}> Count from when I finish</label>
      <label class="rep-until">Until <input type="date" data-rep="until" value="${r.until || ''}"></label>
      <p class="hint">${esc(describeRepeat(r))}. Finishing it creates the next one.</p>
    </div>` : ''}
  </div>`;
}

function onRepeat(el) {
  const t = store.task(ui.selected);
  if (!t) return;
  const base = t.when || t.deadline || store.today();
  const wd = fromISO(base).getDay();
  let r = t.repeat ? { ...t.repeat } : null;
  const kind = el.dataset.rep || (el.dataset.repDay != null ? 'day' : '');
  if (kind === 'preset') {
    const keep = r ? { afterDone: r.afterDone, until: r.until } : {};
    const map = {
      '': null, day: { unit: 'day', every: 1 }, weekday: { unit: 'week', every: 1, days: [1, 2, 3, 4, 5] },
      week: { unit: 'week', every: 1, days: [wd] }, '2week': { unit: 'week', every: 2, days: [wd] },
      month: { unit: 'month', every: 1 }, year: { unit: 'year', every: 1 },
      custom: r || { unit: 'week', every: 1, days: [wd] },
    };
    r = map[el.value] ? { ...map[el.value], ...(el.value === 'custom' ? {} : keep) } : null;
  } else if (!r) return;
  else if (kind === 'every') r.every = Math.max(1, Math.min(99, Number(el.value) || 1));
  else if (kind === 'unit') {
    r.unit = el.value;
    delete r.dom; delete r.month; delete r.anchor;
    if (r.unit === 'week') r.days = [wd]; else delete r.days;
  } else if (kind === 'after') r.afterDone = el.checked;
  else if (kind === 'until') r.until = el.value || null;
  else if (kind === 'day') {
    const d = Number(el.dataset.repDay);
    const days = new Set(r.days || []);
    if (days.has(d)) days.delete(d); else days.add(d);
    r.days = [...days].sort();
    if (!r.days.length) delete r.days;
  }
  if (r && r.unit === 'week' && r.every > 1) delete r.anchor;
  store.setRepeat(t.id, r);
  renderDetail(true);
}

/* ---------- Google Calendar ---------- */
const gcfg = () => store.state.settings.gcal;
/* The Mac app reads the Mac's calendars (EventKit) instead of signing in to Google. */
const calLabel = () => (native ? 'Calendar' : 'Google Calendar');
const calOn = () => (native ? !!gcfg().mac : !!gcfg().clientId);
const calApi = (token) => (native ? native.calendarApi() : calendarApi(token));

async function calendarToken(interactive, consent = false) {
  if (native) {
    if (!interactive) return gcfg().mac ? { native: true } : null;
    if (await native.calendarAccess() !== 'granted') {
      throw new Error('JourneyMan can’t see your calendars. Turn it on in System Settings ▸ Privacy & Security ▸ Calendars, then try again.');
    }
    if (!gcfg().mac) store.updateSettings({ gcal: { ...gcfg(), mac: true } }, { silent: true });
    return { native: true };
  }
  if (tokenValid(ui.gcalToken)) return ui.gcalToken;
  if (!interactive) return null;
  const tok = await authorize(gcfg().clientId, { prompt: consent ? 'consent' : '' });
  ui.gcalToken = tok;
  storage.save('meta', { id: 'gcalToken', ...tok });
  return tok;
}

/* Re-reads the next 4 weeks. `interactive` may open Google's sign-in (only call that from a click). */
async function refreshCalendar({ interactive = false, consent = false } = {}) {
  if ((!native && !gcfg().clientId) || ui.gcalBusy) return;
  ui.gcalBusy = true;
  try {
    const token = await calendarToken(interactive, consent);
    if (!token) return;
    const cal = await readCalendar(calApi(token), { selected: gcfg().calendars, days: 28 });
    store.setCalendar(cal);
    if (interactive) toast(`Calendar read: ${cal.events.filter((e) => !e.allDay).length} events in the next 4 weeks`);
  } catch (err) {
    if (err.status === 401) { ui.gcalToken = null; storage.remove('meta', 'gcalToken'); }
    if (interactive) toast(`${calLabel()}: ${err.message}`);
  } finally {
    ui.gcalBusy = false;
    if (ui.route.view === 'connections') renderBody();
  }
}

const hmOf = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function agoText(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago`;
}

/* Today's meetings, on Today. */
function calendarCard() {
  const cal = store.state.calendar;
  if (!cal) return calOn() ? `<section class="cal-card"><p class="hint">${icon('upcoming')} ${calLabel()} isn't read yet. <button type="button" class="link-btn" data-gcal="refresh">Read it now</button></p></section>` : '';
  const day = store.today();
  const evs = eventsOn(cal.events, day);
  const now = Date.now();
  const meet = store.meetings(day);
  const rows = evs.filter((e) => !e.allDay).map((e) => {
    const past = Date.parse(e.end) <= now, live = Date.parse(e.start) <= now && now < Date.parse(e.end);
    return `<li class="${past ? 'past' : ''}${live ? ' live' : ''}${e.busy === false ? ' free' : ''}"><span class="ev-time">${hmOf(e.start)}–${hmOf(e.end)}</span><span class="ev-title">${esc(e.title)}</span>${live ? '<span class="ev-now">now</span>' : ''}${e.busy === false ? '<span class="muted">free</span>' : ''}</li>`;
  }).join('');
  const allDay = evs.filter((e) => e.allDay).map((e) => `<span class="chip">${esc(e.title)}</span>`).join('');
  const stale = now - Date.parse(cal.fetchedAt) > 60 * 60_000;
  return `<section class="cal-card">
    <div class="cal-head"><h2>${icon('upcoming')} Calendar today</h2><span class="muted">${meet ? `${hours(meet)} of meetings in work hours` : 'No meetings'} · read ${agoText(cal.fetchedAt)}</span>
      <button type="button" class="btn small ghost" data-gcal="refresh"${stale ? ' data-stale' : ''}>${icon('sync')} Refresh</button></div>
    ${allDay ? `<div class="task-meta">${allDay}</div>` : ''}
    ${rows ? `<ul class="cal-list">${rows}</ul>` : ''}
  </section>`;
}

/* Puts a task's estimate (or 30 minutes) into the first free slot, as a calendar event. */
async function blockTime(id) {
  const t = store.task(id);
  if (!t) return;
  const mins = t.estimate || 30;
  try {
    const token = await calendarToken(true);
    const slot = findSlot(store.state.calendar?.events || [], mins, Date.now(), gcfg());
    if (!slot) { toast('No free slot in your work hours this week.'); return; }
    const calId = gcfg().blockCalendar || 'primary';
    const ev = await calApi(token).createEvent(calId, blockBody(t, slot, { appUrl: location.href.split('#')[0] }));
    store.updateTask(id, { block: { eventId: ev.id, calendarId: calId, start: slot.start, end: slot.end, link: ev.htmlLink || null }, when: slot.day, time: hmOf(slot.start) });
    const cal = store.state.calendar || { events: [], calendars: [], used: [], fetchedAt: new Date().toISOString() };
    store.setCalendar({ ...cal, events: [...cal.events, ...normalizeEvents([ev], calId, 'JourneyMan')].sort((a, b) => (a.start < b.start ? -1 : 1)) });
    toast(`Blocked ${formatDay(slot.day, store.today())} ${hmOf(slot.start)}–${hmOf(slot.end)} in your calendar`);
    renderDetail(true);
  } catch (err) { toast(`${calLabel()}: ${err.message}`); }
}
async function unblock(id) {
  const t = store.task(id);
  if (!t || !t.block) return;
  try {
    const token = await calendarToken(true);
    await calApi(token).deleteEvent(t.block.calendarId, t.block.eventId).catch((err) => { if (err.status !== 404 && err.status !== 410) throw err; });
    const cal = store.state.calendar;
    if (cal) store.setCalendar({ ...cal, events: cal.events.filter((e) => e.id !== t.block.eventId) });
    store.updateTask(id, { block: null });
    toast('Time block removed');
    renderDetail(true);
  } catch (err) { toast(`${calLabel()}: ${err.message}`); }
}

function gcalSection() {
  const g = gcfg();
  const cal = store.state.calendar;
  const used = cal ? new Set(cal.used || []) : new Set();
  const how = native
    ? 'JourneyMan reads the calendars on this Mac, the same ones the Calendar app shows. To include Google Calendar, add your Google account in System Settings ▸ Internet Accounts. Nothing leaves this Mac.'
    : 'JourneyMan talks to Google straight from this browser with your own OAuth client ID. Setup takes about 5 minutes: <code>docs/GOOGLE_CALENDAR.md</code>. The next 4 weeks of events are kept only on this device.';
  return `<section class="card" id="gcal">
    <h2 class="card-title">${icon('upcoming')} ${calLabel()}</h2>
    <p class="card-sub">Meetings come out of your daily hours. Next up checks what fits before your next meeting, the forecast subtracts meeting time, the journal lists your meetings, and a task can get a time block in your calendar. ${how}</p>
    <div class="form-grid">
      ${native ? '' : `<label class="field"><span>OAuth client ID</span><input type="text" data-set="gcal.clientId" value="${esc(g.clientId)}" placeholder="1234…apps.googleusercontent.com" autocomplete="off"></label>`}
      <label class="field"><span>Work day starts</span><input type="time" data-set="gcal.workStart" value="${esc(g.workStart)}"></label>
      <label class="field"><span>Work day ends</span><input type="time" data-set="gcal.workEnd" value="${esc(g.workEnd)}"></label>
    </div>
    <div class="row-actions-inline">
      <button type="button" class="btn small${cal ? '' : ' primary'}" data-gcal="${cal ? 'refresh' : 'connect'}">${cal ? `${icon('sync')} Refresh` : `Connect ${native ? 'your calendars' : 'Google Calendar'}`}</button>
      ${cal ? `<span>${icon('ok')} ${cal.events.filter((e) => !e.allDay).length} events from ${used.size} calendar${used.size === 1 ? '' : 's'} · read ${agoText(cal.fetchedAt)}</span>
        <button type="button" class="btn small ghost danger" data-gcal="disconnect">Disconnect</button>` : ''}
    </div>
    ${cal && cal.calendars?.length ? `<h3>Calendars that count as busy</h3>
      <ul class="cal-pick">${cal.calendars.map((c) => `<li><label class="check-field"><input type="checkbox" data-gcal-cal="${esc(c.id)}"${used.has(c.id) ? ' checked' : ''}>
        <i class="dot" style="--c:${esc(c.color || 'var(--c1)')}"></i>${esc(c.name)}${c.primary ? ' <span class="muted">(primary)</span>' : ''}</label></li>`).join('')}</ul>
      <label class="field narrow-field"><span>Time blocks go to</span><select data-set="gcal.blockCalendar">${cal.calendars.map((c) => `<option value="${esc(c.primary ? 'primary' : c.id)}"${(g.blockCalendar || 'primary') === (c.primary ? 'primary' : c.id) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
  </section>`;
}

async function gcalAction(act, el) {
  if (act === 'connect' || act === 'refresh') return refreshCalendar({ interactive: true, consent: act === 'connect' && !tokenValid(ui.gcalToken) });
  if (act === 'disconnect') {
    if (!confirm(`Disconnect ${calLabel()}? Meetings stop counting, and time blocks already made stay in your calendar.`)) return;
    if (native) store.updateSettings({ gcal: { ...gcfg(), mac: false } }, { silent: true });
    if (ui.gcalToken) revoke(ui.gcalToken);
    ui.gcalToken = null;
    storage.remove('meta', 'gcalToken');
    store.setCalendar(null);
    toast(`${calLabel()} disconnected`);
  }
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
  return $$('#view-body .task:not(.ghost)').filter((li) => !li.closest('details:not([open])')).map((li) => li.dataset.id);
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
  // Undo: re-completing recreates the same next occurrence (its id is fixed); un-completing removes it.
  const undo = () => (before.done ? store.updateTask(id, { done: true }) : store.undoComplete(before));
  const msg = t.done ? 'Marked as not done' : `Completed “${t.title}”`;
  if (!t.done && t.repeat) {
    setTimeout(() => {
      const next = store.task(store.task(id)?.nextId);
      toast(next ? `Completed. Next one: ${formatDay(next.when || next.deadline, store.today())}` : 'Completed. That was the last one.', undo);
    }, 300);
    return;
  }
  toast(msg, undo);
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
  if (p.repeat) chips.push(`<span class="chip new">${icon('repeat')}${esc(describeRepeat(p.repeat))}</span>`);
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
  $('#brain-dump').addEventListener('click', brainDump);
  $('#ai-go').addEventListener('click', async () => {
    if (!aiFlow) return;
    const btn = $('#ai-go');
    btn.disabled = true;
    try { await aiFlow(); } catch (err) { $('#ai-status').textContent = err.message; } finally { btn.disabled = false; }
  });

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
    const gh = e.target.closest('[data-ghost]');
    if (gh) { openTask(gh.dataset.ghost); return; }
    const gc = e.target.closest('[data-gcal]');
    if (gc) { gcalAction(gc.dataset.gcal, gc); return; }
    const at = e.target.closest('[data-atlas]');
    if (at) { atlasAction(at.dataset.atlas); return; }
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
    if (el.id === 'atlas-file') { if (el.files.length) importAtlasFile(el.files[0]); el.value = ''; return; }
    if (el.dataset.gcalCal != null && e.type === 'change') {
      const ids = $$('[data-gcal-cal]').filter((c) => c.checked).map((c) => c.dataset.gcalCal);
      store.updateSettings({ gcal: { ...store.state.settings.gcal, calendars: ids } }, { silent: true });
      if (native || tokenValid(ui.gcalToken)) refreshCalendar(); else toast('Choose Refresh to apply.');
      return;
    }
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
    if (e.target.closest('[data-ai]')) { onAi(e.target.closest('[data-ai]').dataset.ai); return; }
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
  detail.addEventListener('change', (e) => {
    if (e.target.dataset.rep) { onRepeat(e.target); return; }
    onDetail(e);
  });
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
    const rd = e.target.closest('[data-rep-day]');
    if (rd) { onRepeat(rd); return; }
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
    else if (action === 'block') blockTime(id);
    else if (action === 'unblock') unblock(id);
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
    runDeviceSync({ quiet: true });
    runAtlasSync({ quiet: true });
    if (store.state.calendar && Date.now() - Date.parse(store.state.calendar.fetchedAt) > 15 * 60_000) refreshCalendar();
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
  // Coming back from a Supabase sign-in link: #access_token=…
  const linkSession = sessionFromHash(location.hash);
  if (linkSession) {
    history.replaceState(null, '', location.pathname + '#connections');
    ui.pendingSession = linkSession;
  }
  store.subscribe(() => renderAll(false));
  await loadFolder();
  await loadAtlasFolder();
  const tok = await storage.getMeta('gcalToken');
  if (tok) { delete tok.id; ui.gcalToken = tok; }
  const calStale = () => !store.state.calendar || Date.now() - Date.parse(store.state.calendar.fetchedAt) > 15 * 60_000;
  setInterval(() => { if (calStale()) refreshCalendar(); }, 5 * 60_000);
  bind();
  onRoute();
  scheduleAutoSync();
  if (store.state.settings.notion.autoSync) runNotionSync(null, { quiet: true });
  if (ui.pendingSession) { const sess = ui.pendingSession; ui.pendingSession = null; signedIn(sess); }
  scheduleDeviceSync();
  runDeviceSync({ quiet: true });
  if (calStale()) refreshCalendar();
  store.subscribe(soonDeviceSync);
  runAtlasSync({ quiet: true });
  setInterval(() => runAtlasSync({ quiet: true }), 60_000);
  store.subscribe(soonAtlasWrite);
  window.addEventListener('online', () => runDeviceSync({ quiet: true }));
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.journeyman = store; // handy from the browser console
}
boot();
