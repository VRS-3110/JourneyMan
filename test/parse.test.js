import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, parseEstimate, parseTime, parseDateAt, addDays, formatMinutes, formatDay, nextMonday, slugify } from '../js/parse.js';

const today = '2026-11-04'; // a Wednesday
const projects = [{ id: 'p1', name: 'Website redesign' }, { id: 'p2', name: 'Thesis' }];
const areas = [{ id: 'a1', name: 'Work' }, { id: 'a2', name: 'Health' }];
const parse = (s) => parseQuickAdd(s, { today, projects, areas });

test('estimates', () => {
  assert.equal(parseEstimate('~30m'), 30);
  assert.equal(parseEstimate('~45'), 45);
  assert.equal(parseEstimate('~1h'), 60);
  assert.equal(parseEstimate('~1h30m'), 90);
  assert.equal(parseEstimate('~1.5h'), 90);
  assert.equal(parseEstimate('~2hrs'), 120);
  assert.equal(parseEstimate('~0'), null);
  assert.equal(parseEstimate('30m'), null);
});

test('times', () => {
  assert.equal(parseTime('3pm'), '15:00');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('12pm'), '12:00');
  assert.equal(parseTime('9:30am'), '09:30');
  assert.equal(parseTime('15:45'), '15:45');
  assert.equal(parseTime('13pm'), null);
  assert.equal(parseTime('25:00'), null);
});

test('dates', () => {
  const d = (s) => (parseDateAt(s.split(' '), 0, today) || {}).iso;
  assert.equal(d('today'), today);
  assert.equal(d('tomorrow'), '2026-11-05');
  assert.equal(d('fri'), '2026-11-06');
  assert.equal(d('wed'), '2026-11-11', 'same weekday means next week, never today');
  assert.equal(d('monday'), '2026-11-09');
  assert.equal(d('next week'), '2026-11-09');
  assert.equal(nextMonday('2026-11-09'), '2026-11-16');
  assert.equal(d('in 3 days'), '2026-11-07');
  assert.equal(d('in 2 weeks'), '2026-11-18');
  assert.equal(d('dec 5'), '2026-12-05');
  assert.equal(d('5th december'), '2026-12-05');
  assert.equal(d('jan 2'), '2027-01-02', 'a date already past this year rolls to next year');
  assert.equal(d('2027-03-01'), '2027-03-01');
  assert.equal(d('2027-02-30'), undefined);
  assert.equal(d('feb 30'), undefined);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('full quick-add lines', () => {
  let r = parse('Fix login bug #website ~45m tomorrow 3pm !!');
  assert.equal(r.title, 'Fix login bug');
  assert.equal(r.projectId, 'p1');
  assert.equal(r.estimate, 45);
  assert.equal(r.when, '2026-11-05');
  assert.equal(r.time, '15:00');
  assert.equal(r.priority, 2);

  r = parse('Send report @work due fri');
  assert.equal(r.title, 'Send report');
  assert.equal(r.areaId, 'a1');
  assert.equal(r.deadline, '2026-11-06');
  assert.equal(r.when, null);

  r = parse('Call the bank today at 4pm');
  assert.equal(r.title, 'Call the bank');
  assert.equal(r.when, today);
  assert.equal(r.time, '16:00');

  r = parse('Dentist on dec 12');
  assert.equal(r.title, 'Dentist');
  assert.equal(r.when, '2026-12-12');

  r = parse('Plan trip #holiday-plans @travel');
  assert.equal(r.projectId, null);
  assert.equal(r.newProject, 'holiday plans');
  assert.equal(r.newArea, 'travel');

  r = parse('Buy \\sun cream');
  assert.equal(r.title, 'Buy sun cream');
  assert.equal(r.when, null);

  r = parse('Meeting at 2pm');
  assert.equal(r.title, 'Meeting');
  assert.equal(r.when, today, 'a time on its own means today');

  r = parse('Learn C# basics');
  assert.equal(r.title, 'Learn C# basics');
  r = parse('Read #1 book');
  assert.equal(r.title, 'Read #1 book', '#1 is not a project');
  r = parse('Call Tom about the thesis');
  assert.equal(r.when, null, 'Tom is a name, not tomorrow');
});

test('project matching by unique prefix', () => {
  assert.equal(parse('x #thes').projectId, 'p2');
  assert.equal(parse('x #Website-Redesign').projectId, 'p1');
});

test('formatting', () => {
  assert.equal(formatMinutes(45), '45m');
  assert.equal(formatMinutes(90), '1h 30m');
  assert.equal(formatMinutes(120), '2h');
  assert.equal(formatDay(today, today), 'Today');
  assert.equal(formatDay('2026-11-05', today), 'Tomorrow');
  assert.equal(formatDay('2026-11-06', today), 'Fri');
  assert.equal(formatDay('2026-11-20', today), 'Fri 20 Nov');
  assert.equal(formatDay('2027-01-02', today), 'Sat 2 Jan 2027');
  assert.equal(slugify('Website Redesign!'), 'website-redesign');
});
