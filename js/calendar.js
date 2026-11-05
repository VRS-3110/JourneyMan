// JourneyMan — calendar maths: meetings, free time and slots. No DOM, no network.
// Events are normalised to { id, calendarId, calendar, title, start, end (ISO), allDay, busy }.

import { toISO, addDays, fromISO } from './parse.js';

/* Google Calendar event resources → JourneyMan events. Cancelled and declined events are dropped. */
export function normalizeEvents(items, calendarId, calendarName = '') {
  const out = [];
  for (const e of items || []) {
    if (!e || e.status === 'cancelled' || !e.start) continue;
    const me = (e.attendees || []).find((a) => a.self);
    if (me && me.responseStatus === 'declined') continue;
    const allDay = !!e.start.date && !e.start.dateTime;
    out.push({
      id: e.id, calendarId, calendar: calendarName,
      title: e.summary || '(busy)',
      start: allDay ? e.start.date : new Date(e.start.dateTime).toISOString(),
      end: allDay ? (e.end && e.end.date) || e.start.date : new Date(e.end.dateTime).toISOString(),
      allDay,
      busy: e.transparency !== 'transparent',
      block: !!e.extendedProperties?.private?.journeymanTask, // a time block made from JourneyMan
      link: e.htmlLink || null,
    });
  }
  return out;
}

/*
  Busy time as merged [startMs, endMs] intervals (timed, busy events only). JourneyMan's own time blocks
  are left out by default: the task's estimate already counts, so counting the block too would be double.
  Finding a free slot includes them, so two blocks never land on top of each other.
*/
export function busyIntervals(events, { includeBlocks = false } = {}) {
  const list = (events || []).filter((e) => !e.allDay && e.busy !== false && (includeBlocks || !e.block))
    .map((e) => [Date.parse(e.start), Date.parse(e.end)]).filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of list) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/* A local day's work window as [startMs, endMs], from "09:00"–"18:00" settings. */
export function workWindow(day, { workStart = '09:00', workEnd = '18:00' } = {}) {
  const [y, m, d] = day.split('-').map(Number);
  const at = (hhmm) => { const [h, mi] = hhmm.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };
  return [at(workStart), at(workEnd)];
}

const overlap = ([a, b], [c, d]) => Math.max(0, Math.min(b, d) - Math.max(a, c));

/* Minutes of meetings on `day` inside work hours. With `fromMs`, only what's left after that moment. */
export function meetingMinutes(intervals, day, settings, fromMs = null) {
  let [ws, we] = workWindow(day, settings);
  if (fromMs != null) ws = Math.max(ws, fromMs);
  if (we <= ws) return 0;
  return intervals.reduce((s, iv) => s + overlap(iv, [ws, we]), 0) / 60_000;
}

/* Events on a local day (timed ones that touch it, and all-day ones that cover it), in order. */
export function eventsOn(events, day) {
  const start = fromISO(day).getTime(), end = fromISO(addDays(day, 1)).getTime();
  return (events || []).filter((e) => (e.allDay ? e.start <= day && day < e.end : Date.parse(e.start) < end && Date.parse(e.end) > start))
    .sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : a.allDay ? -1 : 1));
}

/* The next busy event starting after `nowMs` today, and the minutes until it (or until work ends). */
export function nextMeeting(events, nowMs, settings) {
  const day = toISO(new Date(nowMs));
  const [, we] = workWindow(day, settings);
  const inMeeting = busyIntervals(events).find(([a, b]) => a <= nowMs && nowMs < b);
  const upcoming = (events || []).filter((e) => !e.allDay && e.busy !== false && !e.block && Date.parse(e.start) > nowMs && Date.parse(e.start) < we)
    .sort((a, b) => (a.start < b.start ? -1 : 1))[0] || null;
  const limit = upcoming ? Date.parse(upcoming.start) : we;
  return { event: upcoming, inMeeting: !!inMeeting, minutes: inMeeting ? 0 : Math.max(0, (limit - nowMs) / 60_000) };
}

/* Free gaps on `day` between work hours and meetings (from `nowMs` on, for today). */
export function freeSlots(intervals, day, settings, nowMs = null) {
  let [ws, we] = workWindow(day, settings);
  if (nowMs != null) ws = Math.max(ws, roundUp(nowMs, 5));
  const gaps = [];
  let cur = ws;
  for (const [a, b] of intervals) {
    if (b <= cur || a >= we) continue;
    if (a > cur) gaps.push([cur, Math.min(a, we)]);
    cur = Math.max(cur, b);
  }
  if (cur < we) gaps.push([cur, we]);
  return gaps.filter(([a, b]) => b - a >= 5 * 60_000);
}
const roundUp = (ms, mins) => Math.ceil(ms / (mins * 60_000)) * mins * 60_000;

/* The first free slot of `minutes` from now, today or on the next 6 days. */
export function findSlot(events, minutes, nowMs, settings) {
  const intervals = busyIntervals(events, { includeBlocks: true });
  const today = toISO(new Date(nowMs));
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    for (const [a, b] of freeSlots(intervals, day, settings, i === 0 ? nowMs : null)) {
      if (b - a >= minutes * 60_000) return { start: new Date(a).toISOString(), end: new Date(a + minutes * 60_000).toISOString(), day };
    }
  }
  return null;
}
