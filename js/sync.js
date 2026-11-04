// JourneyMan — sync across devices (phase 5) through your own Supabase project.
// Offline-first: this device's IndexedDB stays the working copy. Sync pushes what changed here since the
// last push, then pulls what other devices changed since the last pull. The newer edit always wins,
// on the server (push_records only replaces older rows) and here (a pulled record only replaces an older one).

const KINDS = { area: 'areas', project: 'projects', task: 'tasks', entry: 'entries', journal: 'journals' };
/* Settings that follow you between devices. Keys and per-device state stay put. */
const SHARED_PREFS = ['hoursPerDay', 'daysPerWeek', 'adjustEstimates', 'reviews', 'activityRules', 'activityIgnore'];

/* A Supabase REST + auth caller. `fetchImpl` is injectable for tests. */
export function supabase({ url, anonKey }, fetchImpl = globalThis.fetch) {
  const base = String(url || '').replace(/\/+$/, '');
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { apikey: anonKey, authorization: `Bearer ${token || anonKey}`, 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error((data && (data.msg || data.message || data.error_description || data.error)) || `Supabase said ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  };
  return {
    /* Emails a sign-in link and a 6-digit code. */
    sendCode: (email, redirectTo) => call('POST', `/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo || '')}`, { body: { email, create_user: true } }),
    verifyCode: (email, token) => call('POST', '/auth/v1/verify', { body: { type: 'email', email, token } }),
    refresh: (refreshToken) => call('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } }),
    push: (token, rows) => call('POST', '/rest/v1/rpc/push_records', { token, body: { rows } }),
    pull: (token, since, limit = 500) => call('GET',
      `/rest/v1/records?select=kind,id,data,deleted,updated_at,server_updated_at&order=server_updated_at.asc&limit=${limit}${since ? `&server_updated_at=gt.${encodeURIComponent(since)}` : ''}`,
      { token }),
  };
}

/* A session from Supabase's auth answer (verify, refresh, or the #access_token=… of a sign-in link). */
export function toSession(auth, now = Date.now()) {
  if (!auth || !auth.access_token) return null;
  const expiresIn = Number(auth.expires_in) || 3600;
  return {
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at: auth.expires_at ? Number(auth.expires_at) * 1000 : now + expiresIn * 1000,
    email: auth.user?.email || auth.email || null,
  };
}
export function sessionFromHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (!p.get('access_token')) return null;
  return toSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in'), expires_at: p.get('expires_at') });
}

/* A valid access token, refreshing it if it expires within a minute. Returns { token, session }. */
export async function ensureToken(api, session, now = Date.now()) {
  if (!session) throw new Error('Sign in first.');
  if (session.expires_at - now > 60_000) return { token: session.access_token, session };
  const next = toSession(await api.refresh(session.refresh_token), now);
  next.email = next.email || session.email;
  return { token: next.access_token, session: next };
}

function sharedPrefs(settings) {
  return Object.fromEntries(SHARED_PREFS.map((k) => [k, settings[k]]));
}

/*
  One round: push local changes since `state.lastPush`, then pull remote changes since `state.cursor`.
  Returns the new sync state and a summary. `stamp()` is this device's clock (ISO).
*/
export async function syncOnce(store, api, token, state = {}, stamp = () => new Date().toISOString()) {
  const started = stamp();
  const since = state.lastPush || '';
  const rows = [];
  for (const [kind, list] of Object.entries(KINDS)) {
    for (const rec of store.state[list]) {
      if (rec.updatedAt && rec.updatedAt > since) rows.push({ kind, id: rec.id, data: rec, deleted: false, updated_at: rec.updatedAt });
    }
  }
  for (const t of store.state.tombstones) {
    if (KINDS[t.kind] && t.deletedAt > since) rows.push({ kind: t.kind, id: t.id, data: null, deleted: true, updated_at: t.deletedAt });
  }
  // Shared settings travel as one record, stamped when they last changed here.
  const prefs = sharedPrefs(store.state.settings);
  const prefsJson = JSON.stringify(prefs);
  let prefsAt = state.prefsAt || null;
  if (prefsJson !== state.prefsJson) { prefsAt = started; rows.push({ kind: 'prefs', id: 'prefs', data: prefs, deleted: false, updated_at: prefsAt }); }

  let pushed = 0;
  for (let i = 0; i < rows.length; i += 200) pushed += Number(await api.push(token, rows.slice(i, i + 200))) || 0;

  // Pull everything the server accepted since our cursor (including our own echoes, which change nothing).
  let cursor = state.cursor || '';
  let pulled = 0, removed = 0;
  for (;;) {
    const page = await api.pull(token, cursor);
    for (const r of page) {
      cursor = r.server_updated_at;
      // Postgres writes times as …+00:00, this app as …Z: compare instants, not strings.
      const remoteAt = Date.parse(r.updated_at);
      if (r.kind === 'prefs') {
        if (!prefsAt || remoteAt > Date.parse(prefsAt)) {
          store.updateSettings({ ...r.data }, { silent: true });
          prefsAt = new Date(remoteAt).toISOString();
          pulled++;
        }
        continue;
      }
      const list = KINDS[r.kind];
      if (!list) continue;
      const local = store.state[list].find((x) => x.id === r.id);
      const tomb = store.state.tombstones.find((t) => t.id === r.id);
      const localAt = local ? local.updatedAt || '' : tomb ? tomb.deletedAt : '';
      if (localAt && Date.parse(localAt) >= remoteAt) continue; // ours is as new or newer
      if (r.deleted) {
        if (local) { store.removeRemote(r.kind, r.id); removed++; }
      } else {
        store.applyRemote(r.kind, { ...r.data, updatedAt: new Date(remoteAt).toISOString() });
        pulled++;
      }
    }
    if (page.length < 500) break;
  }
  if (pulled || removed) store.notify();
  return {
    state: { lastPush: started, cursor, prefsJson: JSON.stringify(sharedPrefs(store.state.settings)), prefsAt, lastSync: stamp() },
    summary: { pushed, pulled, removed },
  };
}
