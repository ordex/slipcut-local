// @ts-check
import { assert, AssertionError, test } from './harness.js';

/**
 * The harness has no tests of its own to lean on, so check its assertions by
 * running them and inspecting what they throw.
 * @param {() => void} fn
 * @returns {AssertionError | null}
 */
function capture(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof AssertionError) return error;
    throw error;
  }
}

test('assert.ok accepts truthy and rejects falsy', () => {
  assert.equal(capture(() => assert.ok(1)), null);
  assert.ok(capture(() => assert.ok(0)) instanceof AssertionError);
  assert.ok(capture(() => assert.ok('')) instanceof AssertionError);
});

test('assert.equal uses Object.is', () => {
  assert.equal(capture(() => assert.equal(NaN, NaN)), null);
  assert.equal(capture(() => assert.equal(1, 1)), null);
  assert.ok(capture(() => assert.equal(0, -0)) instanceof AssertionError);
  assert.ok(capture(() => assert.equal('1', 1)) instanceof AssertionError);
});

test('assert.deepEqual compares structurally', () => {
  assert.equal(capture(() => assert.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })), null);
  assert.equal(capture(() => assert.deepEqual(new Map([['a', 1]]), new Map([['a', 1]]))), null);
  assert.equal(capture(() => assert.deepEqual(new Set([1, 2]), new Set([2, 1]))), null);
  assert.ok(capture(() => assert.deepEqual({ a: 1 }, { a: 1, b: undefined })) instanceof AssertionError);
  assert.ok(capture(() => assert.deepEqual([1, 2], [2, 1])) instanceof AssertionError);
  assert.ok(capture(() => assert.deepEqual({ a: 1 }, [1])) instanceof AssertionError);
});

test('assert.throws requires a throw and can match the message', () => {
  assert.equal(
    capture(() =>
      assert.throws(() => {
        throw new Error('boom');
      }, /boom/),
    ),
    null,
  );
  assert.ok(capture(() => assert.throws(() => undefined)) instanceof AssertionError);
  assert.ok(
    capture(() =>
      assert.throws(() => {
        throw new Error('boom');
      }, /nope/),
    ) instanceof AssertionError,
  );
});

test('failure messages name both sides', () => {
  const error = capture(() => assert.equal('got', 'want'));
  assert.ok(error !== null && error.message.includes('"want"') && error.message.includes('"got"'));
});
