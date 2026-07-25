// @ts-check
import { assert, test } from './harness.js';
import { toPositionedItems } from '../src/pdf/items.js';

/**
 * A fragment shaped the way pdf.js reports one.
 * @param {string} str
 * @param {number} x
 * @param {number} y
 * @param {number} [width]
 * @param {number} [size]
 */
const fragment = (str, x, y, width = 30, size = 10) => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});

test('toPositionedItems reads position from the text matrix', () => {
  assert.deepEqual(toPositionedItems([fragment('NETTO', 380, 100, 33.89)]), [
    { text: 'NETTO', x: 380, y: 100, width: 33.89, height: 10 },
  ]);
});

test('toPositionedItems keeps y growing upwards', () => {
  // The extraction rules assume PDF user space; nothing may be flipped here.
  const [header, footer] = toPositionedItems([fragment('HEADER', 60, 760), fragment('FOOTER', 60, 100)]);
  assert.ok(header.y > footer.y, 'the header sits higher up the page');
});

test('toPositionedItems trims and drops blank fragments', () => {
  const items = toPositionedItems([
    fragment('  NETTO  ', 380, 100),
    fragment('   ', 400, 100),
    fragment('', 410, 100),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'NETTO');
});

test('toPositionedItems falls back when the matrix scale is the only size', () => {
  const items = toPositionedItems([{ str: 'X', transform: [9, 0, 0, 9, 10, 20], width: 5 }]);
  assert.equal(items[0].height, 9);
});

test('toPositionedItems survives fragments missing their fields', () => {
  const items = toPositionedItems([
    { str: 'A' },
    { str: 'B', transform: [] },
    { str: 'C', transform: [1, 0, 0, 1, Number.NaN, Number.POSITIVE_INFINITY] },
  ]);
  assert.deepEqual(
    items.map((item) => [item.text, item.x, item.y]),
    [
      ['A', 0, 0],
      ['B', 0, 0],
      ['C', 0, 0],
    ],
  );
});

test('toPositionedItems ignores entries that are not fragments', () => {
  const items = toPositionedItems([null, undefined, 42, 'text', { str: 'OK', transform: [1, 0, 0, 1, 5, 6] }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'OK');
});

test('toPositionedItems accepts nothing at all', () => {
  assert.deepEqual(toPositionedItems([]), []);
  assert.deepEqual(toPositionedItems(/** @type {unknown[]} */ (/** @type {unknown} */ (undefined))), []);
});
