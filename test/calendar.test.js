import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvents, busyIntervals, meetingMinutes, eventsOn, nextMeeting, freeSlots, findSlot } from '../js/calendar.js';
import { createStore } from '../js/model.js';
import { scoreTask, workloadForecast, freeToday } from '../js/insights.js';
import { journalText, summarizeDay, planVsReality } from '../js/activity.js';

const at = (d, hm) => new Date(`${d}T${hm}:00`).toISOString();
const gEvent = (summary, day, from, to, extra = {}) => ({ id: summary, summary, start: { dateTime: at(day, from) }, end: { dateTime: at(day, to) }, ...extra });

const ITEMS = [
  gEvent('Standup', '2026-11-04', '09:00', '09:15'),
  gEvent('Supervisor', '2026-11-04', '14:00', '15:00'),
  gEvent('Overlap', '2026-11-04', '14:30', '15:30'),
  gEvent('Focus (free)', '2026-11-04', '10:00', '12:00', { transparency: 'transparent' }),
  gEvent('Declined', '2026-11-04', '16:00', '17:00', { attendees: [{ self: true, responseStatus: 'declined' }] }),
  gEvent('Cancelled', '2026-11-04', '17:00', '17:30', { status: 'cancelled' }),
  { id: 'holiday', summary: 'Holiday', start: { date: '2026-11-04' }, end: { date: '2026-11-05' } },
  gEvent('Thursday class', '2026-11-05', '10:00', '12:00'),
];
const events = normalizeEvents(ITEMS, 'primary', 'Me');
const work = { workStart: '09:00', workEnd: '18:00' };

test('events: dropped, all-day, free and busy', () => {
  assert.deepEqual(events.map((e) => e.title), ['Standup', 'Supervisor', 'Overlap', 'Focus (free)', 'Holiday', 'Thursday class']);
  assert.equal(events.find((e) => e.title === 'Holiday').allDay, true);
  assert.equal(events.find((e) => e.title === 'Focus (free)').busy, false);
  const iv = busyIntervals(events);
  assert.equal(iv.length, 3, 'Supervisor and Overlap merge');
  assert.equal(meetingMinutes(iv, '2026-11-04', work), 15 + 90);
  assert.equal(meetingMinutes(iv, '2026-11-04', work, Date.parse(at('2026-11-04', '14:45'))), 45);
  assert.deepEqual(eventsOn(events, '2026-11-04').map((e) => e.title)[0], 'Holiday');
});

test('next meeting, free slots and finding a slot', () => {
  const n = nextMeeting(events, Date.parse(at('2026-11-04', '11:00')), work);
  assert.equal(n.event.title, 'Supervisor');
  assert.equal(n.minutes, 180);
  assert.equal(nextMeeting(events, Date.parse(at('2026-11-04', '14:10')), work).inMeeting, true);
  const gaps = freeSlots(busyIntervals(events), '2026-11-04', work, Date.parse(at('2026-11-04', '13:02')));
  assert.deepEqual(gaps.map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()]),
    [[at('2026-11-04', '13:05'), at('2026-11-04', '14:00')], [at('2026-11-04', '15:30'), at('2026-11-04', '18:00')]]);
  const slot = findSlot(events, 90, Date.parse(at('2026-11-04', '13:02')), work);
  assert.equal(slot.start, at('2026-11-04', '15:30'));
  const late = findSlot(events, 60, Date.parse(at('2026-11-04', '17:30')), work);
  assert.equal(late.start, at('2026-11-05', '09:00'), 'rolls to tomorrow when today is full');
});

test('JourneyMan time blocks are not meetings, but do block slots', () => {
  const block = normalizeEvents([{ ...gEvent('Gym', '2026-11-04', '11:00', '12:00'), extendedProperties: { private: { journeymanTask: 't1' } } }], 'primary')[0];
  assert.equal(block.block, true);
  const all = [...events, block];
  assert.equal(meetingMinutes(busyIntervals(all), '2026-11-04', work), 105, 'unchanged by the block');
  const slot = findSlot(all, 60, Date.parse(at('2026-11-04', '11:00')), work);
  assert.equal(slot.start, at('2026-11-04', '12:00'), 'a second block goes after the first');
});

test('meetings come out of today, the forecast, Next up and the journal', () => {
  let now = new Date('2026-11-04T11:00:00');
  const store = createStore({ now: () => now });
  store.setCalendar({ events, fetchedAt: now.toISOString() });
  const cap = store.capacity();
  assert.equal(cap.meetings, 105);
  assert.equal(cap.available, 360 - 105);
  assert.equal(freeToday(store), 360 - 90, 'only meetings still ahead count');
  const a = store.addArea('Study');
  const t = store.addTask({ title: 'Read', areaId: a.id, estimate: 60, when: '2026-11-04' });
  const s = scoreTask(store, t);
  assert.ok(s.reasons.includes('Fits before Supervisor at 14:00'), s.reasons.join('; '));
  const f = workloadForecast(store, 1);
  assert.equal(Math.round(f[0].meetings), 105 + 120);
  const sum = summarizeDay(store, []);
  const text = journalText(store, '2026-11-04', sum, planVsReality(store, '2026-11-04', sum), null);
  assert.match(text, /Meetings: 1h 45m \(Standup, Supervisor, Overlap\)/);
});
