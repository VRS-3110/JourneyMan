// JourneyMan — Connections: the bridge (your own proxy for Notion and Claude), linked Notion
// databases, the Notion journal, and Mac activity rules.

import { esc, icon } from '../ui.js';
import { targetName } from '../activity.js';
import { summaryText } from '../atlas.js';

const FIELD_LABELS = [
  ['title', 'Task name', ['title']],
  ['status', 'Done (status)', ['status', 'select', 'checkbox']],
  ['due', 'Deadline', ['date']],
  ['estimate', 'Estimate', ['number']],
  ['notes', 'Notes', ['rich_text']],
  ['time', 'Time tracked (written back)', ['number']],
];

export function connectionsHead(extra = '') {
  return `<div class="title-row"><span class="view-icon v-insights">${icon('link')}</span><h1>Connections</h1></div>
    <p class="view-sub">Notion, your Mac's activity${extra}. Keys stay on this Mac.</p>`;
}

function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago`;
}
function resultText(r) {
  if (!r) return '';
  const bits = [];
  if (r.created) bits.push(`${r.created} new from Notion`);
  if (r.createdInNotion) bits.push(`${r.createdInNotion} added to Notion`);
  if (r.pulled) bits.push(`${r.pulled} updated here`);
  if (r.pushed) bits.push(`${r.pushed} updated in Notion`);
  if (r.time) bits.push(`${r.time} time totals written`);
  if (r.archived) bits.push(`${r.archived} archived in Notion`);
  if (r.removed) bits.push(`${r.removed} removed here`);
  if (r.unlinked) bits.push(`${r.unlinked} unlinked`);
  if (r.conflicts) bits.push(`${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'} (newer edit kept)`);
  return bits.length ? bits.join(' · ') : 'Already in step';
}

export function bridgeSection(store, ui) {
  const n = store.state.settings.notion;
  const h = ui.bridgeHealth;
  return `<section class="card" id="bridge">
    <h2 class="card-title">${icon('link')} Your bridge</h2>
    <p class="card-sub">Notion and Claude can't be called straight from a web page, and their keys must stay secret. The bridge is a tiny Cloudflare Worker you deploy once (free). It holds the keys and passes JourneyMan's calls on. Setup steps are in <code>worker/README.md</code>.</p>
    <div class="form-grid">
      <label class="field"><span>Bridge URL</span><input type="url" data-set="notion.workerUrl" value="${esc(n.workerUrl)}" placeholder="https://journeyman-bridge.you.workers.dev"></label>
      <label class="field"><span>App key</span><input type="password" data-set="notion.appKey" value="${esc(n.appKey)}" placeholder="The APP_KEY you set on the bridge" autocomplete="off"></label>
    </div>
    <div class="row-actions-inline">
      <button type="button" class="btn small" data-act="test-bridge">Test connection</button>
      ${h ? (h.error ? `<span class="late-text">${icon('warn')} ${esc(h.error)}</span>`
        : `<span>${h.notion ? `<span class="good-text">${icon('ok')} Notion</span>` : `<span class="muted">${icon('pause')} Notion not set up</span>`} · ${h.ai ? `<span class="good-text">${icon('ok')} Claude</span>` : `<span class="muted">${icon('pause')} Claude not set up</span>`}</span>`) : ''}
    </div>
  </section>`;
}

export function notionSection(store, ui) {
  const n = store.state.settings.notion;
  const projects = store.state.projects.filter((p) => p.status !== 'archived');
  const links = n.links.map((l, i) => {
    const p = store.project(l.projectId);
    const mapped = FIELD_LABELS.filter(([k]) => l.map[k]).map(([k, label]) => `${label} ← ${esc(l.map[k])}`).join(' · ');
    return `<li>
      <div class="link-main"><span><b>${icon('notion')} ${esc(l.title || 'Notion database')}</b> ↔ ${p ? `<a href="#project/${p.id}">${esc(p.name)}</a>` : '<span class="late-text">project deleted</span>'}</span>
        <small class="muted">${mapped}</small>
        <small class="muted">Last sync ${ago(l.lastSync)}${l.lastResult ? ': ' + resultText(l.lastResult) : ''}${l.lastError ? ` · <span class="late-text">${esc(l.lastError)}</span>` : ''}</small></div>
      <button type="button" class="btn small" data-act="sync-one" data-i="${i}">${icon('sync')} Sync</button>
      <button type="button" class="btn small ghost danger" data-act="unlink" data-i="${i}">Unlink</button></li>`;
  }).join('');

  const draft = ui.notionDraft;
  let draftHtml = '';
  if (draft) {
    const props = Object.entries(draft.properties);
    const opts = (types, cur) => `<option value="">Not synced</option>` + props.filter(([, p]) => types.includes(p.type))
      .map(([name]) => `<option value="${esc(name)}"${name === cur ? ' selected' : ''}>${esc(name)}</option>`).join('');
    const statusProp = draft.properties[draft.map.status];
    const statusOpts = statusProp && statusProp.type !== 'checkbox'
      ? ((statusProp.status || statusProp.select || {}).options || []).map((o) => o.name) : [];
    const valueSelect = (key, cur) => `<select data-map="${key}">${statusOpts.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    draftHtml = `<div class="draft">
      <h3>${icon('notion')} ${esc(draft.title)}</h3>
      <div class="form-grid">
        ${FIELD_LABELS.map(([k, label, types]) => `<label class="field"><span>${label}</span><select data-map="${k}">${opts(types, draft.map[k])}</select></label>`).join('')}
        ${statusOpts.length ? `<label class="field"><span>Status that means done</span>${valueSelect('doneValue', draft.map.doneValue)}</label>
          <label class="field"><span>Status for not done</span>${valueSelect('todoValue', draft.map.todoValue)}</label>` : ''}
        ${draft.map.estimate ? `<label class="field"><span>Estimate is in</span><select data-map="estimateUnit"><option value="hours"${draft.map.estimateUnit === 'hours' ? ' selected' : ''}>hours</option><option value="minutes"${draft.map.estimateUnit === 'minutes' ? ' selected' : ''}>minutes</option></select></label>` : ''}
        <label class="field"><span>Sync with project</span><select id="link-project"><option value="">New project “${esc(draft.title)}”</option>${projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      </div>
      ${draft.map.time ? '' : '<p class="hint">Tip: add a number property called “Time spent” in Notion and JourneyMan will write tracked hours into it.</p>'}
      <div class="row-actions-inline"><button type="button" class="btn primary small" data-act="link-save">Link and sync</button><button type="button" class="btn ghost small" data-act="link-cancel">Cancel</button></div>
    </div>`;
  }
  const j = n.journal;
  return `<section class="card" id="notion">
    <h2 class="card-title">${icon('notion')} Notion databases</h2>
    <p class="card-sub">Link a Notion task database to a project. Changes go both ways: names, done, deadlines, estimates and notes. Tracked time is written back, deleting here archives the page there, and if both sides changed, the newer edit wins. In Notion, share each database with your integration (••• → Connections).</p>
    ${links ? `<ul class="links">${links}</ul>` : ''}
    <div class="row-actions-inline">
      <input type="url" id="link-url" placeholder="Paste a Notion database link" class="grow">
      <button type="button" class="btn small" data-act="link-inspect">Look up</button>
      ${n.links.length ? `<button type="button" class="btn small" data-act="sync-all">${icon('sync')} Sync all</button>
      <label class="check-field"><input type="checkbox" data-set="notion.autoSync"${n.autoSync ? ' checked' : ''}> Sync every 10 minutes while open</label>` : ''}
    </div>
    ${draftHtml}
    <h3>Journal database</h3>
    <p class="card-sub">Day journals and weekly reviews can be added to a Notion database with a title and a date property, such as your Daily Journal. One page per day: JourneyMan adds to that day's page if it exists.</p>
    ${j ? `<p>${icon('ok')} <b>${esc(j.title || 'Journal')}</b> <span class="muted">title “${esc(j.titleProp || '—')}”, date “${esc(j.dateProp || '—')}”</span>
      <button type="button" class="btn small ghost danger" data-act="journal-clear">Remove</button></p>` : `<div class="row-actions-inline">
      <input type="url" id="journal-url" placeholder="Paste your journal database link" class="grow">
      <button type="button" class="btn small" data-act="journal-set">Use this database</button></div>`}
  </section>`;
}

export function activitySection(store, ui) {
  const rules = store.state.settings.activityRules || [];
  return `<section class="card" id="activity">
    <h2 class="card-title">${icon('time')} Mac activity</h2>
    <p class="card-sub">The helper in <code>mac-agent/</code> records the app and window you're in every 30 seconds, kept only on your Mac. The Journal matches it to your work.</p>
    <p>${ui.folder === 'granted' ? `${icon('ok')} Activity folder connected.` : ui.folder === 'prompt' ? 'Activity folder needs reconnecting (open the Journal).' : 'No activity folder connected. Connect one from the Journal (Chrome), or import files there.'}</p>
    <h3>Matching rules</h3>
    ${rules.length ? `<ul class="rules">${rules.map((r, i) => `<li><span>${r.field === 'app' ? 'App' : 'Window title'} contains “<b>${esc(r.contains)}</b>”</span> → <span>${esc(targetName(store, r.target))}</span>
      <button type="button" class="icon-btn" data-act="rule-del" data-i="${i}" aria-label="Delete rule">${icon('close')}</button></li>`).join('')}</ul>`
      : '<p class="hint">No rules yet. Use Assign… on unmatched time in the Journal. Window titles that contain a task, project or area name match on their own.</p>'}
    <label class="field"><span>Apps to ignore (comma-separated)</span><input type="text" data-set="activityIgnore" value="${esc((store.state.settings.activityIgnore || []).join(', '))}"></label>
  </section>`;
}

export function atlasSection(store, ui, { canPick = false } = {}) {
  const a = store.state.settings.atlas || {};
  const linked = store.state.tasks.filter((t) => t.atlasId);
  const open = linked.filter((t) => !t.done).length;
  const maps = store.state.projects.filter((p) => p.atlasMapId).length;
  const status = ui.atlas === 'granted' ? `${icon('ok')} Connected to the <b>${esc(ui.atlasHandle?.name || 'atlas')}</b> folder.`
    : ui.atlas === 'prompt' ? `${icon('pause')} The Atlas folder needs reconnecting (the browser asks again after a restart).`
      : 'Not connected.';
  const buttons = !canPick ? ''
    : ui.atlas === 'granted' ? `<button type="button" class="btn small" data-atlas="sync">${icon('sync')} Sync now</button>
      <button type="button" class="btn small ghost danger" data-atlas="disconnect">Disconnect</button>`
      : ui.atlas === 'prompt' ? '<button type="button" class="btn small primary" data-atlas="reconnect">Reconnect</button>'
        : '<button type="button" class="btn small primary" data-atlas="connect">Connect the Atlas folder</button>';
  return `<section class="card" id="atlas">
    <h2 class="card-title">${icon('map')} Atlas</h2>
    <p class="card-sub">Tasks from your Atlas mind maps show up here, with a project for each map. Names, dates and estimates come from Atlas. Done and time go both ways: tick a task in either app, and focus time from Atlas lands in Time as deep work. The two apps share the folder <code>Documents/JourneyMan/atlas</code>. In Atlas, open Settings → JourneyMan and turn on sharing, then connect that folder here. More in <code>docs/ATLAS.md</code>.</p>
    <p>${status}${linked.length ? ` ${linked.length} linked task${linked.length === 1 ? '' : 's'} (${open} open) from ${maps} map${maps === 1 ? '' : 's'}.` : ''}</p>
    ${ui.atlas === 'granted' && ui.atlasWaiting ? '<p class="hint">No tasks.json in that folder yet. Turn on sharing in Atlas → Settings → JourneyMan, or check you picked Documents/JourneyMan/atlas.</p>' : ''}
    ${a.lastImport ? `<p class="muted">Last read ${ago(a.lastImport)}: ${esc(summaryText(a.lastResult))}${a.exportedAt ? ` · Atlas wrote it ${ago(a.exportedAt)}` : ''}</p>` : ''}
    ${a.lastError ? `<p class="late-text">${icon('warn')} ${esc(a.lastError)}</p>` : ''}
    <div class="row-actions-inline">
      ${buttons}
      <label class="btn small ghost" for="atlas-file">Import tasks.json…</label>
      <input type="file" id="atlas-file" accept=".json,application/json" hidden>
      <button type="button" class="btn small ghost" data-atlas="download">Save journeyman.json</button>
    </div>
    ${canPick ? '' : `<p class="hint">This browser can't keep a folder connected (Chrome can). Import Atlas's tasks.json here, and save journeyman.json into the same folder for Atlas to read.</p>`}
  </section>`;
}
