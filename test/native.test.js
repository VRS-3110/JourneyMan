import test from 'node:test';
import assert from 'node:assert/strict';
import { makeNative, toGoogleEvent, taskFromLink, taskLink, native } from '../js/native.js';
import { normalizeEvents } from '../js/calendar.js';
import { readCalendar, blockBody } from '../js/gcal.js';

/* A stand-in for the Mac app's native side: a folder in memory and one calendar. */
function fakeMac() {
  const files = new Map([['activity/2026-11-05.jsonl', { text: '{"t":"x"}\n', mtime: 1000 }]]);
  const dirs = new Set(['activity']);
  const events = [
    { id: 'e1', title: 'Standup', start: '2026-11-05T09:00:00.000Z', end: '2026-11-05T09:15:00.000Z', allDay: false, free: false, declined: false, cancelled: false },
    { id: 'e2', title: 'Holiday', allDay: true, startDay: '2026-11-06', endDay: '2026-11-07', start: '', end: '' },
    { id: 'e3', title: 'Declined', start: '2026-11-05T11:00:00.000Z', end: '2026-11-05T12:00:00.000Z', declined: true },
  ];
  const calls = [];
  const call = async (op, a = {}) => {
    calls.push([op, a]);
    switch (op) {
      case 'fs.stat': return { exists: files.has(a.path) || dirs.has(a.path), isDir: dirs.has(a.path), mtime: files.get(a.path)?.mtime ?? null };
      case 'fs.read': if (!files.has(a.path)) throw new Error('not found'); return files.get(a.path);
      case 'fs.write': files.set(a.path, { text: a.text, mtime: 2000 }); return null;
      case 'fs.mkdir': dirs.add(a.path); return null;
      case 'calendar.list': return [{ id: 'cal1', title: 'Work', color: '#3366FF', isDefault: true }, { id: 'cal2', title: 'Birthdays', isDefault: false }];
      case 'calendar.events': return a.calendarId === 'cal1' ? events : [];
      case 'calendar.create': return { id: 'new1', title: a.title, start: a.start, end: a.end, allDay: false, url: a.url };
      case 'calendar.delete': return true;
      case 'calendar.access': return 'granted';
      default: throw new Error(`unknown ${op}`);
    }
  };
  return { call, files, dirs, calls };
}

test('outside the Mac app there is no bridge', () => {
  assert.equal(native, null);
});

test('folder handles read and write like the File System Access API', async () => {
  const mac = fakeMac();
  const n = makeNative(mac.call);
  const activity = n.folder('activity');
  assert.equal(activity.name, 'activity');
  assert.equal(await activity.queryPermission({ mode: 'read' }), 'granted');
  const f = await (await activity.getFileHandle('2026-11-05.jsonl')).getFile();
  assert.equal(await f.text(), '{"t":"x"}\n');
  assert.equal(f.lastModified, 1000);
  await assert.rejects(activity.getFileHandle('missing.jsonl'), { name: 'NotFoundError' });

  const atlas = await n.ensureFolder('atlas');
  assert.ok(mac.dirs.has('atlas'));
  const w = await (await atlas.getFileHandle('journeyman.json', { create: true })).createWritable();
  await w.write('{"a":');
  await w.write('1}\n');
  await w.close();
  assert.equal(mac.files.get('atlas/journeyman.json').text, '{"a":1}\n');
  await assert.rejects(atlas.getDirectoryHandle('nope'), { name: 'NotFoundError' });
  const sub = await atlas.getDirectoryHandle('sub', { create: true });
  assert.equal(sub.path, 'atlas/sub');
});

test('time-block links go to the task and back', () => {
  assert.equal(taskLink('atlas:ABC'), 'journeyman://localhost/index.html#task/atlas%3AABC');
  assert.equal(taskFromLink(taskLink('atlas:ABC')), 'atlas:ABC');
  assert.equal(taskFromLink('https://example.com/#task/x'), null);
  assert.equal(taskFromLink(undefined), null);
});

test('Mac events read like Google events', () => {
  const g = toGoogleEvent({ id: 'e1', title: 'Busy', start: 'S', end: 'E', allDay: false, free: true, declined: true, url: taskLink('t1') });
  assert.deepEqual(g.start, { dateTime: 'S' });
  assert.equal(g.transparency, 'transparent');
  assert.equal(g.attendees[0].responseStatus, 'declined');
  assert.equal(g.extendedProperties.private.journeymanTask, 't1');
  const day = toGoogleEvent({ id: 'e2', title: 'Off', allDay: true, startDay: '2026-11-06', endDay: '2026-11-07' });
  assert.deepEqual([day.start, day.end], [{ date: '2026-11-06' }, { date: '2026-11-07' }]);
});

test('readCalendar works unchanged on the Mac calendars', async () => {
  const mac = fakeMac();
  const cal = await readCalendar(makeNative(mac.call).calendarApi(), { now: new Date('2026-11-05T08:00:00Z') });
  assert.deepEqual(cal.used, ['cal1', 'cal2']); // every Mac calendar counts until you untick one
  assert.equal(cal.calendars[0].name, 'Work');
  assert.equal(cal.calendars[0].primary, true);
  assert.deepEqual(cal.events.map((e) => e.title).sort(), ['Holiday', 'Standup']); // declined dropped
  const holiday = cal.events.find((e) => e.title === 'Holiday');
  assert.equal(holiday.allDay, true);
});

test('time blocks are made in the default calendar and marked as blocks', async () => {
  const mac = fakeMac();
  const api = makeNative(mac.call).calendarApi();
  const task = { id: 'atlas:ABC', title: 'Write', notes: '' };
  const ev = await api.createEvent('primary', blockBody(task, { start: '2026-11-05T10:00:00.000Z', end: '2026-11-05T10:30:00.000Z' }));
  const [, args] = mac.calls.find(([op]) => op === 'calendar.create');
  assert.equal(args.calendarId, '');
  assert.equal(args.url, 'journeyman://localhost/index.html#task/atlas%3AABC');
  const [norm] = normalizeEvents([ev], 'primary', 'JourneyMan');
  assert.equal(norm.block, true);
  assert.equal(norm.title, 'Write');
  await api.deleteEvent('primary', ev.id);
  assert.deepEqual(mac.calls.at(-1), ['calendar.delete', { id: 'new1' }]);
});
