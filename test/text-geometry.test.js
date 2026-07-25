// @ts-check
import { assert, test } from './harness.js';
import {
  groupIntoLines,
  textAround,
  toLines,
  toText,
  usefulLines,
} from '../src/core/text-geometry.js';

/**
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} [width]
 * @returns {import('../src/core/text-geometry.js').PositionedItem}
 */
const item = (text, x, y, width = 10) => ({ text, x, y, width, height: 10 });

/** A page shaped like the payslips this reads, in PDF coordinates (y up). */
const PAGE = [
  item('COD. FISC. FRMFRC91P22D086S', 60, 730, 158),
  item('GIUGNO 2026', 60, 690, 66),
  item('3.000,00', 300, 400, 35),
  item('1 RETRIBUZIONE ORDINARIA', 60, 400, 127),
  item('NETTO', 380, 100, 34),
  item('2.056,00', 445, 100, 39),
];

test('groupIntoLines orders lines top to bottom', () => {
  const lines = groupIntoLines(PAGE);
  assert.deepEqual(
    lines.map((line) => line[0].y),
    [730, 690, 400, 100],
  );
});

test('groupIntoLines orders each line left to right', () => {
  // The gross amount is stored before its label; reading order must fix that.
  const lines = groupIntoLines(PAGE);
  const grossLine = lines.find((line) => line[0].y === 400);
  assert.deepEqual(grossLine?.map((entry) => entry.text), ['1 RETRIBUZIONE ORDINARIA', '3.000,00']);
});

test('groupIntoLines keeps slightly offset baselines together', () => {
  // An amount is often typeset a fraction below its label.
  const lines = groupIntoLines([item('NETTO', 380, 100), item('2.056,00', 445, 98.5)]);
  assert.equal(lines.length, 1);
});

test('groupIntoLines separates genuinely different lines', () => {
  const lines = groupIntoLines([item('NETTO', 380, 100), item('2.056,00', 445, 90)]);
  assert.equal(lines.length, 2);
});

test('groupIntoLines drops blank fragments', () => {
  const lines = groupIntoLines([item('  ', 10, 100), item('NETTO', 380, 100)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 1);
});

test('groupIntoLines accepts an empty page', () => {
  assert.deepEqual(groupIntoLines([]), []);
  assert.deepEqual(toLines([]), []);
  assert.equal(toText([]), '');
});

test('toLines renders the page in reading order', () => {
  assert.deepEqual(toLines(PAGE), [
    'COD. FISC. FRMFRC91P22D086S',
    'GIUGNO 2026',
    '1 RETRIBUZIONE ORDINARIA 3.000,00',
    'NETTO 2.056,00',
  ]);
});

test('toText joins lines with newlines', () => {
  assert.equal(toText(PAGE).split('\n').length, 4);
  assert.ok(toText(PAGE).endsWith('NETTO 2.056,00'));
});

test('usefulLines collapses whitespace and drops empties', () => {
  assert.deepEqual(usefulLines('  a  b \n\n c \n'), ['a b', 'c']);
  assert.deepEqual(usefulLines(''), []);
});

test('textAround reads the neighbours of a fragment', () => {
  const split = [item('NETTO', 330, 100, 34), item('CORRISPOSTO', 366, 100, 60), item('1.851,00', 460, 100, 39)];
  assert.equal(textAround(split, split[0], 85), 'NETTO CORRISPOSTO');
});

/**
 * @param {import('../src/core/text-geometry.js').PositionedItem[]} items
 * @param {string} text
 * @returns {import('../src/core/text-geometry.js').PositionedItem}
 */
function itemNamed(items, text) {
  const found = items.find((entry) => entry.text === text);
  if (found === undefined) throw new Error(`fixture has no item ${text}`);
  return found;
}

test('textAround stays on the anchor baseline', () => {
  const withOther = [...PAGE, item('ALTRO', 385, 140, 30)];
  const netto = itemNamed(withOther, 'NETTO');
  assert.equal(textAround(withOther, netto, 100).includes('ALTRO'), false);
});

test('textAround respects the horizontal window', () => {
  const netto = itemNamed(PAGE, 'NETTO');
  assert.equal(textAround(PAGE, netto, 100).includes('2.056,00'), true);
  assert.equal(textAround(PAGE, netto, 10).includes('2.056,00'), false);
});

test('cells of one table row stay on one line', () => {
  // Real coordinates: the row label, the column label and the figure are typeset
  // three points apart, and belong together.
  const row = [item('RATEI', 54, 132, 14), item('TOTALE COMPETENZE', 424, 131, 52), item('38.700,00', 535, 129, 33)];
  assert.deepEqual(toLines(row), ['RATEI TOTALE COMPETENZE 38.700,00']);
});

test('rows seven points apart stay apart', () => {
  // From the same payslip: the tolerance has to fit between 3 and 7.
  const rows = [
    item('ARROTONDAMENTO', 425, 108, 49),
    item('0,73', 554, 106, 14),
    item('NETTO DEL MESE', 484, 101, 44),
  ];
  assert.deepEqual(toLines(rows), ['ARROTONDAMENTO 0,73', 'NETTO DEL MESE']);
});
