// EID Tracker — Service Worker
//
// HOW UPDATES WORK (read this before shipping a change):
// 1. You edit index.html (or any cached file) and change CACHE_VERSION below.
// 2. You push/upload the new files to GitHub Pages (or wherever this is hosted).
// 3. Next time ANY customer opens the app, their browser silently downloads
//    this service-worker.js in the background, notices CACHE_VERSION changed,
//    and installs the new version as "waiting".
// 4. The app (index.html) detects the waiting worker and shows an
//    "Update available" banner. When the customer taps it, the new version
//    takes over and the page reloads — now they have your change.
//
// You do NOT need to touch this file's logic for normal updates — only bump
// CACHE_VERSION every time you change any cached file, so old caches are
// thrown away and the new files are fetched.

const CACHE_VERSION = 'eid-tracker-v7';
const CACHE_NAME = `eid-tracker-cache-${CACHE_VERSION}`;

// Files that make up the "app shell". Keep this list in sync with what the
// app actually needs to work offline. index.html is the big one.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

// --- Install: download and cache the new app shell -------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // Don't auto-activate yet — wait for the page to say it's ready (see
  // the 'message' listener below). This avoids yanking the app out from
  // under a customer mid-use.
});

// --- Activate: delete old versioned caches ----------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('eid-tracker-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Let the page force this new worker to activate immediately once the
// customer taps "Update now" in the banner.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- Fetch: network-first for the HTML shell, cache-first for everything else
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // Network-first so customers get fresh HTML when online, but still
    // work offline from cache if the network fails.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest, etc.)
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
