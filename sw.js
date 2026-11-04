/* JourneyMan — offline support. Serves the saved copy at once and refreshes it in the background.
   Bump CACHE when the file list changes. */
const CACHE = 'journeyman-v5';
const FILES = [
  './', 'index.html', 'css/app.css',
  'js/app.js', 'js/model.js', 'js/parse.js', 'js/db.js', 'js/importers.js', 'js/reports.js', 'js/charts.js', 'js/ui.js',
  'js/views/time.js', 'js/views/insights.js', 'js/insights.js', 'js/views/journal.js', 'js/views/review.js',
  'js/views/connections.js', 'js/activity.js', 'js/notion.js', 'js/ai.js', 'js/sync.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
