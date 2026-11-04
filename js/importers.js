// JourneyMan — bring a Notion database in from its CSV export (Notion: ••• → Export → Markdown & CSV).
// No DOM here, so it runs in Node tests too.

import { toISO } from './parse.js';

/* RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/* Notion writes dates as shown in the app: "November 12, 2026", "12 November 2026", "2026/11/12", "2026-11-12",
   sometimes with a time ("November 12, 2026 3:00 PM") or as a range ("… → …"). Keeps the first date. */
export function parseNotionDate(value) {
  const v = String(value || '').split('→')[0].trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return iso(+m[1], +m[2] - 1, +m[3]);
  m = v.match(/^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})/);
  if (m && month(m[1]) >= 0) return iso(+m[3], month(m[1]), +m[2]);
  m = v.match(/^(\d{1,2}) ([A-Za-z]+)\.?,? (\d{4})/);
  if (m && month(m[2]) >= 0) return iso(+m[3], month(m[2]), +m[1]);
  return null;
}
function month(word) {
  const w = word.toLowerCase();
  return w.length >= 3 ? MONTHS.findIndex((x) => x.startsWith(w.slice(0, 3)) && x.startsWith(w)) : -1;
}
function iso(y, m, d) {
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? toISO(dt) : null;
}

const DONE = /^(done|complete|completed|finished|yes|true|checked|✓|✔)$/i;

/* "EC1002 Study Tasks 69789a25954144b283010287ce581403_all.csv" → "EC1002 Study Tasks" */
export function projectNameFromFile(fileName) {
  return String(fileName || 'Imported from Notion')
    .replace(/\.csv$/i, '')
    .replace(/_all$/i, '')
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .trim() || 'Imported from Notion';
}

/*
  Maps the columns of a Notion database export to tasks:
    Name / Task / Title (or the first column) → title
    Status / Done / Complete                  → done
    Due / Deadline / Date                     → deadline
    Do date / Scheduled / When                → when
    Est. hours / Estimate / Minutes           → estimate (minutes)
    Notes / Description                       → notes
  Returns { projectName, tasks, columns } where columns says which header fed which field.
*/
export function notionCsvToTasks(text, fileName) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { projectName: projectNameFromFile(fileName), tasks: [], columns: {} };
  const header = rows[0].map((h) => h.trim());
  const find = (re) => header.findIndex((h) => re.test(h));
  const col = {
    title: Math.max(find(/^(name|task|title|to-?do)$/i), 0),
    done: find(/^(status|done|complete|completed|state)$/i),
    deadline: find(/^(due|due date|deadline|date)$/i),
    when: find(/^(do date|scheduled|when|start|start date)$/i),
    estimate: find(/(est|estimate|hours|minutes|duration)/i),
    notes: find(/^(notes?|description|details)$/i),
  };
  const estHeader = col.estimate >= 0 ? header[col.estimate] : '';
  const estMultiplier = /min/i.test(estHeader) ? 1 : 60; // hours unless the column says minutes
  const get = (r, k) => (col[k] >= 0 ? (r[col[k]] || '').trim() : '');

  const tasks = [];
  for (const r of rows.slice(1)) {
    const title = get(r, 'title');
    if (!title) continue;
    const est = parseFloat(get(r, 'estimate').replace(',', '.'));
    tasks.push({
      title,
      done: DONE.test(get(r, 'done')),
      deadline: parseNotionDate(get(r, 'deadline')),
      when: parseNotionDate(get(r, 'when')),
      estimate: isFinite(est) && est > 0 ? Math.round(est * estMultiplier) : null,
      notes: get(r, 'notes'),
    });
  }
  const columns = Object.fromEntries(Object.entries(col).filter(([, i]) => i >= 0).map(([k, i]) => [k, header[i]]));
  return { projectName: projectNameFromFile(fileName), tasks, columns };
}
