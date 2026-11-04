// JourneyMan bridge: a small Cloudflare Worker that holds your secrets so the web app never sees them.
//   /health            → which services are set up
//   /notion/v1/…       → Notion API (only the calls JourneyMan makes), with your NOTION_TOKEN
//   /ai/messages       → Claude (phase 5), with your ANTHROPIC_API_KEY
// Every call needs `Authorization: Bearer <APP_KEY>`, and only ALLOWED_ORIGINS may call from a browser.

const NOTION = 'https://api.notion.com/v1/';
const DEFAULT_NOTION_VERSION = '2022-06-28';

/* The Notion calls JourneyMan makes. Anything else is refused. */
const NOTION_ROUTES = [
  ['GET', /^databases\/[0-9a-f-]{32,36}$/],
  ['POST', /^databases\/[0-9a-f-]{32,36}\/query$/],
  ['POST', /^pages$/],
  ['GET', /^pages\/[0-9a-f-]{32,36}$/],
  ['PATCH', /^pages\/[0-9a-f-]{32,36}$/],
  ['PATCH', /^blocks\/[0-9a-f-]{32,36}\/children$/],
];

function cors(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    ok: ok || !origin, // no Origin header = not a browser (e.g. curl), still needs the app key
    headers: {
      'access-control-allow-origin': ok ? origin || '*' : 'null',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    },
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/* Constant-time compare so the key can't be guessed by timing. */
function sameKey(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const c = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
    if (!c.ok) return json({ error: 'This origin is not allowed. Add it to ALLOWED_ORIGINS.' }, 403, c.headers);

    const url = new URL(request.url);
    const key = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!sameKey(key, env.APP_KEY || '')) return json({ error: 'Wrong or missing app key.' }, 401, c.headers);

    if (url.pathname === '/health') {
      return json({ ok: true, notion: !!env.NOTION_TOKEN, ai: !!env.ANTHROPIC_API_KEY }, 200, c.headers);
    }

    if (url.pathname.startsWith('/notion/v1/')) {
      if (!env.NOTION_TOKEN) return json({ error: 'NOTION_TOKEN is not set on the bridge.' }, 501, c.headers);
      const path = url.pathname.slice('/notion/v1/'.length);
      if (!NOTION_ROUTES.some(([m, re]) => m === request.method && re.test(path))) return json({ error: 'That Notion call is not allowed.' }, 403, c.headers);
      const res = await fetch(NOTION + path, {
        method: request.method,
        headers: {
          authorization: `Bearer ${env.NOTION_TOKEN}`,
          'notion-version': env.NOTION_VERSION || DEFAULT_NOTION_VERSION,
          'content-type': 'application/json',
        },
        body: request.method === 'GET' ? undefined : await request.text(),
      });
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json', ...c.headers } });
    }

    if (url.pathname === '/ai/messages' && request.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set on the bridge.' }, 501, c.headers);
      return handleAi(request, env, c.headers);
    }

    return json({ error: 'Not found.' }, 404, c.headers);
  },
};

/* Phase 5 fills this in. */
async function handleAi(request, env, headers) {
  return json({ error: 'AI is not set up in this version of the bridge.' }, 501, headers);
}
