// JourneyMan — the interface. Data and rules live in model.js; storage in db.js.

import { createStore, seed, AREA_COLORS } from './model.js';
import { openStorage } from './db.js';
import { parseQuickAdd, formatMinutes, formatDay, addDays, nextMonday, fromISO, notionAppUrl, isNotionUrl } from './parse.js';
import { notionCsvToTasks } from './importers.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  inbox: '<path d="M2 9h3l1 2h4l1-2h3"/><path d="M3.6 3h8.8L14 9v4H2V9z"/>',
  today: '<path d="M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5z"/>',
  upcoming: '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>',
  anytime: '<path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3"/><path d="M2 11l6 3 6-3"/>',
  projects: '<rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/>',
  logbook: '<path d="M3 2.5h8.5A1.5 1.5 0 0 1 13 4v9.5H4.5A1.5 1.5 0 0 1 3 12z"/><path d="M5.5 7.2l1.6 1.6 3-3.1"/>',
  notion: '<rect x="2" y="2" width="12" height="12" rx="2.5"/><path d="M5.5 11V5l5 6V5"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.3 1.4"/>',
  flag: '<path d="M3.5 14V2.5M3.5 3h8L10 6l1.5 3h-8"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  note: '<path d="M3 3h10v10H3z"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;

const VIEWS = {
  inbox: { title: 'Inbox', icon: 'inbox' },
  today: { title: 'Today', icon: 'today' },
  upcoming: { title: 'Upcoming', icon: 'upcoming' },
  anytime: { title: 'Anytime', icon: 'anytime' },
  projects: { title: 'Projects', icon: 'projects' },
  logbook: { title: 'Logbook', icon: 'logbook' },
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
  ui.selected = null;
  ui.detail = false;
  renderAll(true);
  $('#main').scrollTop = 0;
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
  renderBody();
  renderDetail(full);
  if (full) {
    const ctx = context();
    $('#qa-input').placeholder = `Add to ${ctx.label}…  try: Plan the week #project ~30m tomorrow`;
    updatePreview();
  }
}

const areaColor = (a) => (a ? a.color : 'var(--ink-3)');
const sortedAreas = () => [...store.state.areas].sort((a, b) => a.order - b.order);

function renderNav() {
  const r = ui.route, c = store.counts(), today = store.today();
  const late = store.todayList().some((t) => (t.when && t.when < today) || (t.deadline && t.deadline < today));
  const item = (view, count, cls = '') => {
    const v = VIEWS[view], active = r.view === view;
    return `<a href="#${view}" class="nav-item${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>${icon(v.icon)}<span>${v.title}</span>${count ? `<b class="count ${cls}">${count}</b>` : ''}</a>`;
  };
  $('#nav-views').innerHTML = item('inbox', c.inbox) + item('today', c.today, late ? 'late' : '') + item('upcoming') + item('anytime') + item('projects') + item('logbook');

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
      <i class="dot" style="--c:${a.color}" aria-hidden="true"></i><span>${esc(a.name)}</span></a>${projects.map((p) => projLink(p, a.color)).join('')}</div>`;
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
      <div class="title-row"><i class="dot big" style="--c:${a.color}" aria-hidden="true"></i>
        <input class="title-input" value="${esc(a.name)}" aria-label="Area name" data-afield="name"></div>
      <div class="head-fields">
        <div class="swatches" role="group" aria-label="Colour">${AREA_COLORS.map((c) => `<button type="button" class="swatch${c === a.color ? ' on' : ''}" style="--c:${c}" data-color="${c}" aria-label="Colour ${c}" aria-pressed="${c === a.color}"></button>`).join('')}</div>
        ${notionField(a.notionUrl, 'afield')}
        <button type="button" class="btn small" data-new-project="${a.id}">New project</button>
        <button type="button" class="btn small ghost danger" id="delete-area">Delete area</button>
      </div>`;
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
    el.innerHTML = `<div class="progress"><div class="bar"><i style="width:${(s.progress * 100).toFixed(1)}%"></i></div><span>${bits.join(' · ')}</span></div>`;
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
  if (t.estimate) chips.push(`<span class="chip">${icon('clock')}${formatMinutes(t.estimate)}</span>`);
  if (t.notes) chips.push(`<span class="chip icon-only" title="Has notes">${icon('note')}</span>`);
  if (t.notionUrl) chips.push(`<a class="chip notion" href="${esc(notionAppUrl(t.notionUrl))}" title="Open in Notion" aria-label="Open in Notion">${icon('notion')}</a>`);
  const triage = opts.triage
    ? `<span class="row-actions"><button type="button" data-action="today">Today</button><button type="button" data-action="move">Move…</button><button type="button" data-action="keep" title="No project or date: keep it in Anytime">Keep</button></span>`
    : '';
  return `<li class="task${t.done ? ' done' : ''}${ui.selected === t.id ? ' selected' : ''}" data-id="${t.id}">
    <button type="button" class="check" data-action="toggle" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark not done' : 'Complete'}: ${esc(t.title)}">${icon('check')}</button>
    <div class="task-main"><span class="task-title">${esc(t.title)}</span>${chips.length ? `<span class="task-meta">${chips.join('')}</span>` : ''}</div>
    ${t.priority ? `<span class="prio p${t.priority}" title="Priority ${t.priority}">${'!'.repeat(t.priority)}</span>` : ''}${triage}
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
  const badge = p.status !== 'active' ? `<span class="badge">${{ someday: 'Someday', done: 'Completed', archived: 'Archived' }[p.status]}</span>` : '';
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
      const list = store.todayList();
      const late = list.filter((t) => (t.when && t.when < today) || (!t.when && t.deadline && t.deadline < today));
      const now = list.filter((t) => !late.includes(t));
      if (late.length) html += `<h2 class="list-head late-text">Overdue</h2>${taskList(late)}`;
      if (now.length) html += `${late.length ? '<h2 class="list-head">Today</h2>' : ''}${taskList(now, { when: false })}`;
      if (!list.length) html += empty('Nothing planned for today', 'Add something above, or pick from Anytime and press <kbd>T</kbd>.');
      const done = store.doneToday();
      if (done.length) html += group('done-today', 'Done today', done.length, taskList(done, { when: false }));
      break;
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
        return `<section class="area-block"><h2 class="list-head"><i class="dot" style="--c:${a.color}"></i><a href="#area/${a.id}">${esc(a.name)}</a></h2>
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
  toast(`Deleted “${gone.title}”`, () => store.restore('task', gone));
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
  if (p.areaId) chips.push(`<span class="chip where"><i class="dot" style="--c:${store.area(p.areaId).color}"></i>${esc(store.area(p.areaId).name)}</span>`);
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
  for (const a of sortedAreas()) if (m(a.name)) items.push({ label: a.name, color: a.color, sub: 'Area', run: () => go('area/' + a.id) });
  for (const p of store.state.projects) if (m(p.name) && p.status !== 'archived') items.push({ label: p.name, color: areaColor(store.area(p.areaId)), sub: 'Project', run: () => go('project/' + p.id) });
  if (q.trim()) {
    for (const t of store.state.tasks) {
      if (!m(t.title + ' ' + t.notes)) continue;
      const p = store.projectOf(t);
      items.push({
        label: t.title, icon: t.done ? 'logbook' : 'check', sub: p ? p.name : t.inbox ? 'Inbox' : '',
        run: () => {
          const home = t.done ? 'logbook' : p ? 'project/' + p.id : t.inbox ? 'inbox' : t.when && t.when <= store.today() ? 'today' : t.when ? 'upcoming' : t.areaId ? 'area/' + t.areaId : 'anytime';
          go(home);
          setTimeout(() => select(t.id, true), 0);
        },
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
        if (m(p.name) || m(a.name)) items.push({ label: p.name, sub: a.name, color: a.color, run: () => movedTo(taskId, { projectId: p.id }, p.name) });
      }
      if (m(a.name)) items.push({ label: a.name, sub: 'Area, no project', color: a.color, run: () => movedTo(taskId, { projectId: null, areaId: a.id }, a.name) });
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
  const n = store.state.tasks.length;
  $('#storage-status').textContent = storage.ok
    ? `${n} task${n === 1 ? '' : 's'} and ${store.state.projects.length} projects are saved in this browser on this Mac. Export a backup now and then.`
    : 'Storage is unavailable in this window, so nothing is being saved. Export before you close it.';
  $('#settings').showModal();
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
  $('#set-hours').addEventListener('change', (e) => {
    const h = Number(e.target.value);
    if (h > 0 && h <= 24) store.updateSettings({ hoursPerDay: h });
  });
  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  $('#import-notion-btn').addEventListener('click', () => { $('#settings').close(); pickNotionCsv(); });
  $('#toast').addEventListener('click', (e) => { if (e.target.closest('#toast-undo')) undoLast(); });

  // List clicks
  $('#view-body').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const np = e.target.closest('[data-new-project]');
    if (np) { newProject(np.dataset.newProject); return; }
    const row = e.target.closest('.task');
    if (!row) return;
    const id = row.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle') completeTask(id);
    else if (action === 'today') setWhen(id, store.today());
    else if (action === 'move') openPalette('Move to project or area…', moveSource(id));
    else if (action === 'keep') { store.updateTask(id, { inbox: false }); toast('Kept in Anytime'); }
    else select(id, true);
  });
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
      store.updateArea(ui.route.id, { [el.dataset.afield]: v || (el.dataset.afield === 'name' ? 'Untitled area' : null) });
    }
  };
  head.addEventListener('input', onHead);
  head.addEventListener('change', onHead);
  head.addEventListener('click', (e) => {
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
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle') completeTask(id);
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
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
    const dest = { i: 'inbox', t: 'today', u: 'upcoming', a: 'anytime', p: 'projects', l: 'logbook' }[e.key.toLowerCase()];
    if (dest) { e.preventDefault(); go(dest); }
    return;
  }
  const id = ui.selected;
  switch (e.key) {
    case 'n': case 'N': case '/': e.preventDefault(); $('#qa-input').focus(); return;
    case 'g': gPending = setTimeout(() => { gPending = 0; }, 1200); return;
    case '?': e.preventDefault(); $('#help').showModal(); return;
    case 'j': case 'ArrowDown': e.preventDefault(); moveSelection(1); return;
    case 'k': case 'ArrowUp': e.preventDefault(); moveSelection(-1); return;
  }
  if (!id) return;
  switch (e.key) {
    case 'Enter': case 'e': e.preventDefault(); ui.detail = true; renderDetail(true); $('#detail .d-title')?.focus(); break;
    case 'x': case ' ': e.preventDefault(); completeTask(id); break;
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
  store.subscribe(() => renderAll(false));
  bind();
  onRoute();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.journeyman = store; // handy from the browser console
}
boot();
