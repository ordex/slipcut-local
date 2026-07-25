// @ts-check
import { assert, test } from './harness.js';
import { findNetAmount, findNetAmountByGeometry } from '../src/core/net-amount.js';

/**
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} [width]
 * @returns {import('../src/core/text-geometry.js').PositionedItem}
 */
const item = (text, x, y, width = text.length * 5) => ({ text, x, y, width, height: 10 });

/**
 * An employee payslip: the payable amount is bottom right, with a gross amount
 * and a taxable amount higher up as decoys. Coordinates are the ones a real
 * extraction produces for this layout.
 */
const EMPLOYEE_PAGE = [
  item('RED YARD RESEARCH SRL CF: 01234567890', 60, 760, 218),
  item('COD. FISC. FRMFRC91P22D086S', 60, 730, 158),
  item('GIUGNO 2026', 60, 690, 66),
  item('1 RETRIBUZIONE ORDINARIA', 60, 400, 127),
  item('3.000,00', 300, 400, 35),
  item('IMPONIBILE', 60, 200, 52),
  item('2.500,00', 300, 200, 35),
  item('NETTO', 380, 100, 34),
  item('2.056,00', 445, 100, 39),
];

/** A collaborator payslip: the label reads "NETTO CORRISPOSTO", split in two. */
const COLLABORATOR_PAGE = [
  item('1352 COMPENSO LORDO', 60, 400, 100),
  item('2.400,00', 300, 400, 35),
  item('NETTO', 330, 100, 34),
  item('CORRISPOSTO', 366, 100, 60),
  item('1.851,00', 460, 100, 39),
];

test('geometry picks the amount beside the NETTO label', () => {
  assert.equal(findNetAmountByGeometry(EMPLOYEE_PAGE), 205600);
});

test('geometry ignores gross and taxable amounts elsewhere on the page', () => {
  const found = findNetAmountByGeometry(EMPLOYEE_PAGE);
  assert.ok(found !== 300000, 'picked the gross amount');
  assert.ok(found !== 250000, 'picked the taxable amount');
});

test('geometry handles a label split across fragments', () => {
  assert.equal(findNetAmountByGeometry(COLLABORATOR_PAGE), 185100);
});

test('geometry reads an amount typeset slightly below its label', () => {
  const page = [item('NETTO', 380, 100, 34), item('2.056,00', 445, 82, 39)];
  assert.equal(findNetAmountByGeometry(page), 205600);
});

test('geometry rejects an amount too far to the right', () => {
  const page = [item('NETTO', 380, 100, 34), item('2.056,00', 700, 100, 39)];
  assert.equal(findNetAmountByGeometry(page), null);
});

test('geometry rejects an amount to the left of the label', () => {
  const page = [item('NETTO', 380, 100, 34), item('2.056,00', 300, 100, 39)];
  assert.equal(findNetAmountByGeometry(page), null);
});

test('geometry ignores labels that only look like a net label', () => {
  const page = [
    item('RITENUTA NETTA', 60, 300, 70),
    item('412,00', 200, 300, 30),
    item('ARROT. PREC. NETTO', 60, 200, 90),
    item('150,00', 200, 200, 30),
  ];
  assert.equal(findNetAmountByGeometry(page), null);
});

test('geometry prefers the payable label over a year-to-date one', () => {
  const page = [
    item('PROGRESSIVO NETTO', 60, 300, 90),
    item('12.000,00', 200, 300, 40),
    item('NETTO', 380, 100, 34),
    item('2.056,00', 445, 100, 39),
  ];
  assert.equal(findNetAmountByGeometry(page), 205600);
});

test('geometry joins an amount broken across two fragments', () => {
  const page = [item('NETTO', 380, 100, 34), item('2.056', 445, 100, 25), item(',00', 470, 100, 12)];
  assert.equal(findNetAmountByGeometry(page), 205600);
});

test('geometry ignores implausible amounts', () => {
  const tooSmall = [item('NETTO', 380, 100, 34), item('12,00', 445, 100, 25)];
  const tooLarge = [item('NETTO', 380, 100, 34), item('980.000,00', 445, 100, 45)];
  assert.equal(findNetAmountByGeometry(tooSmall), null);
  assert.equal(findNetAmountByGeometry(tooLarge), null);
});

test('geometry returns null without a label or without items', () => {
  assert.equal(findNetAmountByGeometry([]), null);
  assert.equal(findNetAmountByGeometry([item('IMPONIBILE', 60, 200, 52), item('2.500,00', 300, 200, 35)]), null);
});

test('findNetAmount reports the geometric hit as netto-box', () => {
  assert.deepEqual(findNetAmount({ items: EMPLOYEE_PAGE }), { cents: 205600, source: 'netto-box' });
});

test('findNetAmount falls back to the label line without geometry', () => {
  const text = 'COD. FISC. FRMFRC91P22D086S\nIMPONIBILE 2.500,00\nNETTO 2.056,00';
  assert.deepEqual(findNetAmount({ text }), { cents: 205600, source: 'label-line' });
});

test('findNetAmount falls back to the lines after the label', () => {
  const text = 'NETTO CORRISPOSTO\n2.056,00\nFIRMA';
  assert.deepEqual(findNetAmount({ text }), { cents: 205600, source: 'label-window' });
});

test('text fallbacks skip labels that are not the payable amount', () => {
  const text = 'RITENUTA NETTA 412,00\nPROGRESSIVO NETTO 12.000,00';
  assert.equal(findNetAmount({ text }).cents, null);
});

test('findNetAmount reports not-found on an empty page', () => {
  assert.deepEqual(findNetAmount({}), { cents: null, source: 'not-found' });
  assert.deepEqual(findNetAmount({ items: [], text: '' }), { cents: null, source: 'not-found' });
});

test('geometry wins over the text fallback when both could answer', () => {
  // The text says one thing, the geometry another; geometry is authoritative.
  const items = [item('NETTO', 380, 100, 34), item('2.056,00', 445, 100, 39)];
  const text = 'NETTO 9.999,00';
  assert.deepEqual(findNetAmount({ items, text }), { cents: 205600, source: 'netto-box' });
});

/**
 * The bottom-right block of a real payslip, at its real coordinates. The payable
 * amount sits *under* a shaded NETTO DEL MESE heading, and the withholdings total
 * sits above it — so an amount above a label must never be taken as its value.
 */
const HEADING_ABOVE_VALUE = [
  item('TOTALE', 424, 131, 19),
  item('COMPETENZE', 443, 131, 33),
  item('38.700,00', 535, 129, 33),
  item('TOTALE', 424, 119, 19),
  item('TRATTENUTE', 444, 119, 31),
  item('7.438,73', 540, 117, 29),
  item('ARROTONDAMENTO', 425, 108, 49),
  item('0,73', 554, 106, 14),
  item('NETTO DEL MESE', 484, 101, 44),
  item('31.262,00 €', 499, 89, 56),
];

test('the value under a heading is the one taken', () => {
  assert.equal(findNetAmountByGeometry(HEADING_ABOVE_VALUE), 3126200);
});

test('the withholdings total above the label is not the net', () => {
  const found = findNetAmountByGeometry(HEADING_ABOVE_VALUE);
  assert.ok(found !== 743873, 'took TOTALE TRATTENUTE');
  assert.ok(found !== 3870000, 'took TOTALE COMPETENZE');
});

test('an amount above its label is never that label’s value', () => {
  const page = [item('NETTO', 380, 100, 34), item('9.999,00', 445, 118, 39)];
  assert.equal(findNetAmountByGeometry(page), null);
});

test('a value below the label may be indented or centred under it', () => {
  const centred = [item('NETTO DEL MESE', 484, 101, 44), item('31.262,00', 499, 89, 48)];
  const indented = [item('NETTO DEL MESE', 484, 101, 44), item('31.262,00', 460, 89, 48)];
  assert.equal(findNetAmountByGeometry(centred), 3126200);
  assert.equal(findNetAmountByGeometry(indented), 3126200);
});

test('a value in a neighbouring column is not taken', () => {
  const page = [item('NETTO DEL MESE', 484, 101, 44), item('31.262,00', 60, 89, 48)];
  assert.equal(findNetAmountByGeometry(page), null);
});

test('a value too far below the label is not taken', () => {
  const page = [item('NETTO DEL MESE', 484, 101, 44), item('31.262,00', 499, 20, 48)];
  assert.equal(findNetAmountByGeometry(page), null);
});
