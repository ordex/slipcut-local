// @ts-check
import { assert, test } from './harness.js';
import { listRepoFiles, readRepoFile } from './read-file.js';

/**
 * The precache list in sw.js is maintained by hand — there is no build step to
 * generate it — so these tests are what keeps it from drifting. A missing entry
 * silently breaks offline use; a stale one makes `addAll` reject and disables
 * the service worker altogether.
 */

/** @returns {Promise<{ source: string, precache: string[], cacheName: string }>} */
async function readServiceWorker() {
  const source = await readRepoFile('sw.js');
  const listMatch = source.match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(listMatch, 'PRECACHE array not found in sw.js');
  const precache = [...listMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const nameMatch = source.match(/const CACHE_NAME = '([^']+)'/);
  assert.ok(nameMatch, 'CACHE_NAME not found in sw.js');
  return { source, precache, cacheName: nameMatch[1] };
}

test('the precache list has no duplicates', async () => {
  const { precache } = await readServiceWorker();
  assert.equal(new Set(precache).size, precache.length);
});

test('the cache name is versioned', async () => {
  const { cacheName } = await readServiceWorker();
  assert.ok(/-v\d+$/.test(cacheName), `${cacheName} should end in a version`);
});

test('every precached path exists', async () => {
  const { precache } = await readServiceWorker();
  for (const path of precache) {
    if (path === './') continue;
    // Throws if the file is not there, in either runner.
    await readRepoFile(path.replace(/^\.\//, ''));
  }
});

test('every application module is precached', async () => {
  const modules = await listRepoFiles('src', '.js');
  if (modules === null) return; // browser: cannot list directories

  const { precache } = await readServiceWorker();
  const listed = new Set(precache.map((path) => path.replace(/^\.\//, '')));
  const missing = modules.map((path) => path.replace(/^src\//, 'src/')).filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `not precached: ${missing.join(', ')}`);
});

test('every vendored library is precached', async () => {
  const vendored = await listRepoFiles('vendor', '.mjs');
  if (vendored === null) return;

  const { precache } = await readServiceWorker();
  const listed = new Set(precache.map((path) => path.replace(/^\.\//, '')));
  const missing = vendored.filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `not precached: ${missing.join(', ')}`);
});

test('the app shell is precached', async () => {
  const { precache } = await readServiceWorker();
  for (const required of ['./', './index.html', './style.css', './manifest.webmanifest']) {
    assert.ok(precache.includes(required), `${required} must be precached`);
  }
});
