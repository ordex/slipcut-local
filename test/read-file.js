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

/**
 * Every file under a directory, repository-relative, recursively.
 *
 * Node only: a page cannot list a server's directories. Callers use it to check
 * that hand-maintained file lists have not drifted, and skip that check in the
 * browser.
 *
 * @param {string} relativeDirectory
 * @param {string} extension
 * @returns {Promise<string[] | null>} null when not running under Node
 */
export async function listRepoFiles(relativeDirectory, extension) {
  if (!IN_NODE) return null;

  const [{ readdir }, { fileURLToPath }] = await Promise.all([
    import('node:fs/promises'),
    import('node:url'),
  ]);
  const root = fileURLToPath(new URL('../', import.meta.url));

  /**
   * @param {string} directory relative to the repository root
   * @returns {Promise<string[]>}
   */
  async function walk(directory) {
    const entries = await readdir(`${root}${directory}`, { withFileTypes: true });
    /** @type {string[]} */
    const found = [];
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) found.push(...(await walk(path)));
      else if (entry.name.endsWith(extension)) found.push(path);
    }
    return found;
  }

  return walk(relativeDirectory);
}
