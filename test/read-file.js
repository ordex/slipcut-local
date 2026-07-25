// @ts-check
/**
 * Read a repository file from a test, in whichever runner is executing.
 *
 * The browser has `fetch` and Node has `fs`; neither has both for local paths,
 * so tests that need a shipped file go through here.
 */

/** True when running under Node rather than in a page. */
const IN_NODE =
  typeof process !== 'undefined' && process.versions !== undefined && process.versions.node !== undefined;

/**
 * @param {string} relativePath relative to the repository root
 * @returns {Promise<string>}
 */
export async function readRepoFile(relativePath) {
  const url = new URL(`../${relativePath}`, import.meta.url);
  if (IN_NODE) {
    const [{ readFile }, { fileURLToPath }] = await Promise.all([
      import('node:fs/promises'),
      import('node:url'),
    ]);
    return readFile(fileURLToPath(url), 'utf8');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${relativePath}: HTTP ${response.status}`);
  return response.text();
}
