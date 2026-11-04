import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseNotionDate, notionCsvToTasks, projectNameFromFile } from '../js/importers.js';
import { parseQuickAdd, isNotionUrl, notionPageId, notionAppUrl } from '../js/parse.js';

test('CSV with quotes, commas and newlines', () => {
  const rows = parseCSV('a,b\n"x, y","say ""hi""\nthere"\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"\nthere']]);
});

test('Notion date formats', () => {
  assert.equal(parseNotionDate('November 12, 2026'), '2026-11-12');
  assert.equal(parseNotionDate('12 November 2026'), '2026-11-12');
  assert.equal(parseNotionDate('2026/11/12'), '2026-11-12');
  assert.equal(parseNotionDate('Nov 12, 2026 3:00 PM'), '2026-11-12');
  assert.equal(parseNotionDate('November 4, 2026 → November 6, 2026'), '2026-11-04');
  assert.equal(parseNotionDate(''), null);
  assert.equal(parseNotionDate('soon'), null);
});

test('a Notion study-task export becomes a project', () => {
  const csv = '﻿Task,Area,Due,Est. hours,Last reviewed,Notes,Reading/Resource,Status,Topic\n' +
    'Introduction: Economics & the economy,Introduction,"August 20, 2026",1.5,,PPF,,Done,Scarcity\n' +
    'Supply and demand,Microeconomics,"November 12, 2026",2,,,,Studying,Markets\n' +
    ',,,,,,,,\n';
  const r = notionCsvToTasks(csv, 'EC1002 Study Tasks 69789a25954144b283010287ce581403_all.csv');
  assert.equal(r.projectName, 'EC1002 Study Tasks');
  assert.equal(r.tasks.length, 2);
  assert.deepEqual(r.tasks[0], { title: 'Introduction: Economics & the economy', done: true, deadline: '2026-08-20', when: null, estimate: 90, notes: 'PPF' });
  assert.equal(r.tasks[1].done, false);
  assert.equal(r.tasks[1].estimate, 120);
  assert.equal(r.columns.title, 'Task');
  assert.equal(r.columns.estimate, 'Est. hours');
});

test('file names', () => {
  assert.equal(projectNameFromFile('Reading list 0123456789abcdef0123456789abcdef.csv'), 'Reading list');
  assert.equal(projectNameFromFile(''), 'Imported from Notion');
});

test('Notion links in quick add', () => {
  const url = 'https://www.notion.so/My-page-3357686bc433806bbe6bd2d690806556';
  assert.ok(isNotionUrl(url));
  assert.ok(isNotionUrl('https://app.notion.com/p/3357686bc433806bbe6bd2d690806556?pvs=204'));
  assert.ok(!isNotionUrl('https://example.com/notion.so'));
  assert.equal(notionPageId(url), '3357686bc433806bbe6bd2d690806556');
  assert.equal(notionPageId('https://www.notion.so/3357686b-c433-806b-be6b-d2d690806556'), '3357686bc433806bbe6bd2d690806556');
  assert.equal(notionAppUrl(url), 'notion://www.notion.so/3357686bc433806bbe6bd2d690806556');
  const r = parseQuickAdd(`Read crypto notes ${url} ~20m`, { today: '2026-11-04' });
  assert.equal(r.title, 'Read crypto notes');
  assert.equal(r.notionUrl, url);
  assert.equal(r.estimate, 20);
});
