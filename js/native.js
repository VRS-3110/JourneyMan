// JourneyMan — the Mac app's bridge. Inside the JourneyMan Mac app (mac/), native code gives the page what a
// browser can't: the ~/Documents/JourneyMan folders without a folder picker, and the Mac's own calendars
// (whatever the Calendar app shows, Google included) without a Google sign-in.
// In a browser `native` is null and nothing here runs.

export const APP_HOME = 'journeyman://localhost/index.html';

/*
  Folder handles shaped like the File System Access API ones the app already uses
  (getFileHandle, getDirectoryHandle, getFile, createWritable), so the same code reads the Mac
  activity folder and the Atlas folder in Chrome and in the Mac app. Paths are relative to
  ~/Documents/JourneyMan.
*/
const notFound = (path) => new DOMException(`${path} doesn't exist`, 'NotFoundError');

export function dirHandle(call, path) {
  return {
    kind: 'directory',
    name: path.split('/').pop(),
    path,
    native: true,
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getFileHandle(name, { create = false } = {}) {
      const p = `${path}/${name}`;
      const st = await call('fs.stat', { path: p });
      if (!st.exists && !create) throw notFound(p);
      return fileHandle(call, p);
    },
    async getDirectoryHandle(name, { create = false } = {}) {
      const p = `${path}/${name}`;
      const st = await call('fs.stat', { path: p });
      if (!st.exists || !st.isDir) {
        if (!create) throw notFound(p);
        await call('fs.mkdir', { path: p });
      }
      return dirHandle(call, p);
    },
  };
}

export function fileHandle(call, path) {
  const name = path.split('/').pop();
  return {
    kind: 'file',
    name,
    async getFile() {
      const r = await call('fs.read', { path });
      return { name, lastModified: r.mtime, text: async () => r.text };
    },
    async createWritable() {
      let text = '';
      return {
        async write(data) { text += typeof data === 'string' ? data : await new Blob([data]).text(); },
        async close() { await call('fs.write', { path, text }); },
      };
    },
  };
}

/* The link a time block carries back to its task, and reading it again. */
export const taskLink = (taskId) => `${APP_HOME}#task/${encodeURIComponent(taskId)}`;
export function taskFromLink(url) {
  const m = /^journeyman:[^#]*#task\/(.+)$/i.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/*
  A Mac calendar event, as the native side describes it:
    { id, title, start, end (ISO), allDay, startDay, endDay (YYYY-MM-DD, end exclusive),
      free, declined, cancelled, url }
  turned into the Google Calendar shape the rest of JourneyMan reads (calendar.js normalizeEvents).
*/
export function toGoogleEvent(e) {
  const task = taskFromLink(e.url);
  const ev = {
    id: e.id,
    status: e.cancelled ? 'cancelled' : 'confirmed',
    summary: e.title || '',
    start: e.allDay ? { date: e.startDay } : { dateTime: e.start },
    end: e.allDay ? { date: e.endDay } : { dateTime: e.end },
    transparency: e.free ? 'transparent' : 'opaque',
    htmlLink: null,
  };
  if (e.declined) ev.attendees = [{ self: true, responseStatus: 'declined' }];
  if (task) ev.extendedProperties = { private: { journeymanTask: task } };
  return ev;
}

/* The same four calls as gcal.js calendarApi, answered by the Mac's calendars. */
export function macCalendarApi(call) {
  return {
    async calendars() {
      return (await call('calendar.list')).map((c) => ({
        id: c.id, summary: c.title, primary: !!c.isDefault, selected: true, backgroundColor: c.color || null,
      }));
    },
    async events(calendarId, timeMin, timeMax) {
      return (await call('calendar.events', { calendarId, from: timeMin, to: timeMax })).map(toGoogleEvent);
    },
    async createEvent(calendarId, body) {
      const task = body.extendedProperties?.private?.journeymanTask;
      const e = await call('calendar.create', {
        calendarId: calendarId === 'primary' ? '' : calendarId,
        title: body.summary || '',
        notes: body.description || '',
        start: body.start.dateTime,
        end: body.end.dateTime,
        url: task ? taskLink(task) : '',
      });
      return toGoogleEvent(e);
    },
    async deleteEvent(calendarId, eventId) {
      await call('calendar.delete', { id: eventId });
      return {};
    },
  };
}

export function makeNative(call, info = {}) {
  return {
    info,
    folder: (path) => dirHandle(call, path),
    async ensureFolder(path) {
      await call('fs.mkdir', { path });
      return dirHandle(call, path);
    },
    /* 'granted' or 'denied'. Asks the first time. */
    calendarAccess: () => call('calendar.access'),
    calendarApi: () => macCalendarApi(call),
  };
}

const handler = globalThis.webkit?.messageHandlers?.journeyman;
export const native = globalThis.journeymanApp && handler
  ? makeNative((op, args = {}) => handler.postMessage({ op, ...args }), globalThis.journeymanApp)
  : null;
