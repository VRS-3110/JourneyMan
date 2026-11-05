// JourneyMan — Google Calendar, straight from the browser (no server).
// Sign-in uses Google Identity Services with your own OAuth client ID (setup: docs/GOOGLE_CALENDAR.md).
// Access tokens last about an hour; JourneyMan keeps the last calendar read on this device, so meetings
// still count when the token has run out, and a click on Refresh gets a fresh one.

import { normalizeEvents } from './calendar.js';
import { toISO, addDays, fromISO } from './parse.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/calendar/v3';
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly', // which calendars you have
  'https://www.googleapis.com/auth/calendar.events', // read events, and add/remove time blocks
].join(' ');

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Couldn’t load Google sign-in. Are you online?'));
    document.head.appendChild(s);
  });
}

/* Opens Google's sign-in (call it from a click). Resolves to { access_token, expires_at }. */
export async function authorize(clientId, { prompt = '' } = {}) {
  if (!clientId) throw new Error('Add your Google OAuth client ID first.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt,
      callback: (resp) => {
        if (resp.error) reject(new Error(resp.error_description || resp.error));
        else resolve({ access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
      },
      error_callback: (err) => reject(new Error(err?.type === 'popup_closed' ? 'Google sign-in was closed.' : err?.message || 'Google sign-in failed.')),
    });
    client.requestAccessToken();
  });
}

export function revoke(token) {
  try { globalThis.google?.accounts?.oauth2?.revoke(token.access_token, () => {}); } catch { /* already gone */ }
}

export const tokenValid = (token, now = Date.now()) => !!(token && token.access_token && token.expires_at - now > 60_000);

/* A small Calendar API client. */
export function calendarApi(token, fetchImpl = globalThis.fetch) {
  const call = async (method, path, { params = {}, body } = {}) => {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    const res = await fetchImpl(url.toString(), {
      method,
      headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(res.status === 401 ? 'Google sign-in has expired. Choose Refresh.' : data.error?.message || `Google Calendar said ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  };
  return {
    async calendars() {
      return (await call('GET', '/users/me/calendarList', { params: { minAccessRole: 'reader', maxResults: 250 } })).items || [];
    },
    async events(calendarId, timeMin, timeMax) {
      const items = [];
      let pageToken;
      do {
        const r = await call('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, {
          params: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: 250, pageToken },
        });
        items.push(...(r.items || []));
        pageToken = r.nextPageToken;
      } while (pageToken);
      return items;
    },
    createEvent: (calendarId, body) => call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, { body }),
    deleteEvent: (calendarId, eventId) => call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`),
  };
}

/*
  Reads your calendars and the next `days` days of events from the ones that count.
  `selected` = calendar ids chosen in Connections; null means your primary calendar plus the ones
  shown in Google Calendar.
*/
export async function readCalendar(api, { selected = null, days = 28, now = new Date() } = {}) {
  const list = await api.calendars();
  const calendars = list.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, shown: c.selected !== false, color: c.backgroundColor || null }));
  const use = calendars.filter((c) => (selected ? selected.includes(c.id) : c.primary || c.shown));
  const start = fromISO(toISO(now));
  const end = fromISO(addDays(toISO(now), days));
  const events = [];
  for (const c of use) {
    const items = await api.events(c.id, start.toISOString(), end.toISOString());
    events.push(...normalizeEvents(items, c.id, c.name));
  }
  events.sort((a, b) => (a.start < b.start ? -1 : 1));
  return { events, calendars, used: use.map((c) => c.id), fetchedAt: new Date().toISOString() };
}

/* A time block for a task, as a Google Calendar event. */
export function blockBody(task, slot, { appUrl = '' } = {}) {
  return {
    summary: task.title,
    description: `Time blocked from JourneyMan${task.notes ? `\n\n${task.notes}` : ''}${appUrl ? `\n\n${appUrl}` : ''}`,
    start: { dateTime: slot.start },
    end: { dateTime: slot.end },
    transparency: 'opaque',
    extendedProperties: { private: { journeymanTask: task.id } },
  };
}
