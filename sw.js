/**
 * Service worker: makes the app usable offline and stops it re-downloading
 * 2 MB of PDF libraries on every visit.
 *
 * Hand-written, because there is no build step to generate one — and because
 * what it needs to do is small enough to read in one sitting.
 *
 * Strategy:
 * - the app shell and the libraries are precached on install;
 * - requests are served cache-first, since every cached file is versioned by
 *   CACHE_NAME and never mutates within a version;
 * - a new version deletes the old caches when it takes over.
 *
 * **Bump CACHE_NAME on every release.** Without a bundler there are no hashed
 * filenames, so the cache name is the only thing distinguishing one deployment
 * from the next: forget it and users keep the old app.
 */

const CACHE_NAME = 'slipcut-v1';

/**
 * Everything needed to start with no network. Listed by hand: it is short, and a
 * wrong entry fails loudly at install rather than quietly at runtime.
 */
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './config/export-templates.default.json',
  './src/app.js',
  './src/worker.js',
  './src/zip.js',
  './src/core/codice-fiscale.js',
  './src/core/csv.js',
  './src/core/employee-name.js',
  './src/core/export-templates.js',
  './src/core/iban-mapping.js',
  './src/core/iban.js',
  './src/core/money.js',
  './src/core/net-amount.js',
  './src/core/payment-rows.js',
  './src/core/payment-xml.js',
  './src/core/payslip.js',
  './src/core/period.js',
  './src/core/person-name.js',
  './src/core/summary-csv.js',
  './src/core/text-geometry.js',
  './src/core/xml.js',
  './src/pdf/items.js',
  './src/pdf/split.js',
  './src/pdf/text.js',
  './src/ui/address-book-step.js',
  './src/ui/dom.js',
  './src/ui/download.js',
  './src/ui/exports-step.js',
  './src/ui/storage.js',
  './src/ui/views/address-book.js',
  './src/ui/views/extraction-table.js',
  './src/ui/views/payments-table.js',
  './vendor/pdf.js',
  './vendor/pdf.worker.js',
  './vendor/pdf-lib.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only ever serve this app's own GETs from the cache.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache what turns out to be reachable, so a file added after install
          // is available next time; opaque and error responses are not cached.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and not cached: a navigation still gets the app shell.
          if (request.mode === 'navigate') return caches.match('./index.html');
          throw new Error(`Non disponibile offline: ${request.url}`);
        });
    }),
  );
});
