// @ts-check
/**
 * Dependency-free test harness.
 *
 * Runs unchanged in a browser (test/index.html) and in Node (test/run.mjs).
 * It touches neither `process` nor `document`, so it stays usable in both.
 */

/** @typedef {{ name: string, fn: () => void | Promise<void> }} TestCase */
/** @typedef {{ name: string, error: Error | null }} TestResult */
/** @typedef {{ total: number, passed: number, failed: number, results: TestResult[] }} Summary */

/** @type {TestCase[]} */
const cases = [];

/**
 * Register a test case.
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
export function test(name, fn) {
  cases.push({ name, fn });
}

export class AssertionError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined || value === null || typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Structural comparison. Handles plain objects, arrays, Maps, Sets and NaN.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key) || !deepEqual(value, b.get(key))) return false;
    }
    return true;
  }

  if (a instanceof Set && b instanceof Set) {
    return a.size === b.size && [...a].every((value) => b.has(value));
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual(/** @type {any} */ (a)[key], /** @type {any} */ (b)[key]),
  );
}

export const assert = {
  /**
   * @param {unknown} value
   * @param {string} [message]
   */
  ok(value, message) {
    if (!value) throw new AssertionError(message ?? `expected truthy, got ${show(value)}`);
  },

  /**
   * @param {unknown} actual
   * @param {unknown} expected
   * @param {string} [message]
   */
  equal(actual, expected, message) {
    if (!Object.is(actual, expected)) {
      throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
    }
  },

  /**
   * @param {unknown} actual
   * @param {unknown} expected
   * @param {string} [message]
   */
  deepEqual(actual, expected, message) {
    if (!deepEqual(actual, expected)) {
      throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
    }
  },

  /**
   * @param {() => unknown} fn
   * @param {RegExp} [expected] pattern the thrown message must match
   */
  throws(fn, expected) {
    let thrown = null;
    try {
      fn();
    } catch (error) {
      thrown = error;
    }
    if (thrown === null) throw new AssertionError('expected the call to throw');
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (expected && !expected.test(message)) {
      throw new AssertionError(`thrown message ${show(message)} does not match ${expected}`);
    }
  },
};

/**
 * Run every registered case in registration order.
 * @param {{ onResult?: (result: TestResult) => void }} [options]
 * @returns {Promise<Summary>}
 */
export async function run(options = {}) {
  /** @type {TestResult[]} */
  const results = [];

  for (const testCase of cases) {
    /** @type {TestResult} */
    let result;
    try {
      await testCase.fn();
      result = { name: testCase.name, error: null };
    } catch (error) {
      result = {
        name: testCase.name,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
    results.push(result);
    options.onResult?.(result);
  }

  const failed = results.filter((r) => r.error !== null).length;
  return { total: results.length, passed: results.length - failed, failed, results };
}
