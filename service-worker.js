/* ProtoLink Diagnostics — service-worker.js
 * Precaches the whole app so it runs 100% offline, then serves cache-first with background refresh.
 * Bump VERSION when you ship changes (the GitHub Actions workflow also stamps BUILD with the commit SHA).
 */
'use strict';

const VERSION = '1.2.0';
const BUILD = '__BUILD__';
const CACHE = `protolink-v${VERSION}-${BUILD}`;

// Paths are relative to this file, so the app works from a GitHub Pages sub-path (/repo-name/).
const PRECACHE = [
  './',
  'index.html',
  'offline.html',
  '404.html',
  'privacy.html',
  'style.css',
  'app.js',
  'sw-register.js',
  'manifest.webmanifest',
  'js/editor.js',
  'js/validator.js',
  'js/templates.js',
  'js/tag-converter.js',
  'js/db.js',
  'js/serial.js',
  'js/instrument.js',
  'js/subnet.js',
  'js/tag-helper.js',
  'js/export.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png.svg',
  'icons/icon-512.png.svg',
  'icons/icon-maskable-192.png.svg',
  'icons/icon-maskable-512.png.svg',
  'icons/apple-touch-icon.png.svg',
  'icons/favicon.ico.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
  );
  // No automatic skipWaiting: the page offers "Reload to update" so a field session is never interrupted.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('protolink-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function refresh(cache, request) {
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') await cache.put(request, res.clone());
    return res;
  } catch (e) {
    return null;
  }
}

async function handleNavigate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) { refresh(cache, request); return cached; }
  const url = new URL(request.url);
  if (url.pathname.endsWith('/')) {
    const idx = await cache.match('index.html');
    if (idx) return idx;
  }
  const net = await refresh(cache, request);
  if (net) return net;
  return (await cache.match('offline.html')) || Response.error();
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) { refresh(cache, request); return cached; }
  const net = await refresh(cache, request);
  return net || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(req.mode === 'navigate' ? handleNavigate(req) : handleAsset(req));
});
