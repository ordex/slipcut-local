// @ts-check
import { assert, test } from './harness.js';
import {
  findAmountsInText,
  formatDecimalComma,
  formatDecimalDot,
  formatEuro,
  formatItalian,
  formatWholeEuro,
  isExactAmount,
  parseItalianAmount,
  sumCents,
} from '../src/core/money.js';

test('parseItalianAmount reads printed payroll amounts', () => {
  assert.equal(parseItalianAmount('1.234,56'), 123456);
  assert.equal(parseItalianAmount('2.056,00'), 205600);
  assert.equal(parseItalianAmount('2056,00'), 205600);
  assert.equal(parseItalianAmount('0,01'), 1);
  assert.equal(parseItalianAmount('1.234.567,89'), 123456789);
  assert.equal(parseItalianAmount('12'), 1200);
});

test('parseItalianAmount handles signs, spaces and the euro sign', () => {
  assert.equal(parseItalianAmount('-2.056,00'), -205600);
  assert.equal(parseItalianAmount('  1.234,56  '), 123456);
  assert.equal(parseItalianAmount('€ 1.234,56'), 123456);
  assert.equal(parseItalianAmount('1 234,56'), 123456);
});

test('parseItalianAmount rejects anything that is not an amount', () => {
  assert.equal(parseItalianAmount('abc'), null);
  assert.equal(parseItalianAmount(''), null);
  assert.equal(parseItalianAmount('1,234.56'), null, 'English notation is not accepted');
  assert.equal(parseItalianAmount('1.23,45'), null, 'malformed grouping');
  assert.equal(parseItalianAmount('12.34'), null, 'a dot cannot separate decimals');
});

test('parseItalianAmount rounds extra decimals half away from zero', () => {
  assert.equal(parseItalianAmount('1,005'), 101);
  assert.equal(parseItalianAmount('1,004'), 100);
  assert.equal(parseItalianAmount('0,125'), 13, 'the case where Number.toFixed and Rust disagree');
  assert.equal(parseItalianAmount('-0,125'), -13);
});

test('parseItalianAmount is exact where a float would not be', () => {
  // 0.1 + 0.2 in cents is plain integer arithmetic.
  const total = sumCents([parseItalianAmount('0,10') ?? 0, parseItalianAmount('0,20') ?? 0]);
  assert.equal(total, 30);
  assert.equal(formatDecimalDot(total), '0.30');
});

test('formatItalian groups thousands and keeps two decimals', () => {
  assert.equal(formatItalian(123456), '1.234,56');
  assert.equal(formatItalian(123456789), '1.234.567,89');
  assert.equal(formatItalian(99900), '999,00');
  assert.equal(formatItalian(5), '0,05');
  assert.equal(formatItalian(-123456), '-1.234,56');
  assert.equal(formatItalian(0), '0,00');
});

test('formatEuro matches it-IT currency output, non-breaking space included', () => {
  assert.equal(formatEuro(123456), '1.234,56 €');
  assert.equal(formatEuro(-205600), '-2.056,00 €');
});

test('formatDecimalDot and formatDecimalComma drop grouping', () => {
  assert.equal(formatDecimalDot(123456), '1234.56');
  assert.equal(formatDecimalDot(205600), '2056.00');
  assert.equal(formatDecimalDot(-5), '-0.05');
  assert.equal(formatDecimalComma(123456), '1234,56');
  assert.equal(formatDecimalComma(205600), '2056,00');
});

test('formatWholeEuro rounds half away from zero', () => {
  assert.equal(formatWholeEuro(123456), '1235');
  assert.equal(formatWholeEuro(123449), '1234');
  assert.equal(formatWholeEuro(123450), '1235');
  assert.equal(formatWholeEuro(-123450), '-1235');
});

test('sumCents totals exactly', () => {
  assert.equal(sumCents([]), 0);
  assert.equal(sumCents([205600, 185100, 183900]), 574600);
  assert.equal(formatDecimalDot(sumCents([205600, 185100, 183900])), '5746.00');
});

test('findAmountsInText returns every amount in order', () => {
  const found = findAmountsInText('1 RETRIBUZIONE ORDINARIA 3.000,00 IMPONIBILE 2.500,00 NETTO 2.056,00');
  assert.deepEqual(
    found.map((entry) => entry.cents),
    [300000, 250000, 205600],
  );
  assert.equal(found[0].raw, '3.000,00');
  assert.ok(found[0].index < found[1].index);
});

test('findAmountsInText ignores bare integers and page numbers', () => {
  assert.deepEqual(findAmountsInText('pagina 3 di 12'), []);
  assert.deepEqual(
    findAmountsInText('12 LIVELLO 4 1.100,00').map((entry) => entry.cents),
    [110000],
  );
});

test('isExactAmount accepts only a full amount', () => {
  assert.equal(isExactAmount('2.056,00'), true);
  assert.equal(isExactAmount(' -2.056,00 '), true);
  assert.equal(isExactAmount('NETTO 2.056,00'), false);
  assert.equal(isExactAmount('2.056'), false);
  assert.equal(isExactAmount('2056'), false);
});

test('an amount printed with its currency is still an amount', () => {
  // The payable net on a real payslip arrives as "2.845,00 €".
  assert.equal(isExactAmount('2.845,00 €'), true);
  assert.equal(isExactAmount('€ 1.234,56'), true);
  assert.equal(isExactAmount('1.234,56 EUR'), true);
  assert.equal(parseItalianAmount('2.845,00 €'), 284500);
  assert.equal(parseItalianAmount('1.234,56 EUR'), 123456);
});

test('an ungrouped amount is still a printed amount', () => {
  // Not every payroll prints the thousands separator.
  assert.equal(isExactAmount('2056,00'), true);
  assert.equal(isExactAmount('2845,00'), true);
  assert.equal(parseItalianAmount('2056,00'), 205600);
});

test('isExactAmount rejects what is not one printed amount', () => {
  assert.equal(isExactAmount('1.23,45'), false, 'grouping must be in threes');
  assert.equal(isExactAmount('2.056'), false, 'decimals are required');
  assert.equal(isExactAmount('2056'), false);
  assert.equal(isExactAmount('1,005'), false, 'exactly two decimals');
  assert.equal(isExactAmount('NETTO 2.056,00'), false);
  assert.equal(isExactAmount('1,234.56'), false, 'English notation');
  assert.equal(isExactAmount(''), false);
});

test('everything isExactAmount accepts, the parser also parses', () => {
  const accepted = ['2.845,00 €', '€ 1.234,56', '1.234,56', '2056,00', '-2.056,00', '1.234,56 EUR'];
  for (const sample of accepted) {
    assert.equal(isExactAmount(sample), true, `should be accepted: ${sample}`);
    assert.ok(parseItalianAmount(sample) !== null, `should parse: ${sample}`);
  }
});
