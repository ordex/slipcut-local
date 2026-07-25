// @ts-check
/**
 * Money, as an integer number of cents.
 *
 * Payslip amounts end up in bank files where a rounding difference of one cent
 * makes a `CtrlSum` disagree with the sum of its transactions, and banks reject
 * the file for it. Cents are therefore parsed straight from the printed text
 * and never pass through a binary fraction.
 *
 * Italian payroll prints `1.234,56`: `.` groups thousands, `,` separates the
 * decimals.
 */

/**
 * An integer number of cents. Negative values are allowed: payslips do print
 * negative roundings.
 * @typedef {number} Cents
 */

/** Shape of a printed Italian amount, with or without thousands separators. */
const ITALIAN_AMOUNT = /^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/;

/** Amounts as they appear inside a longer line of text. */
const AMOUNT_IN_TEXT = /-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d+,\d{2}/g;

/**
 * Reduce a printed amount to its digits, separators and sign.
 *
 * Payroll prints the payable amount with its currency: the net on a real payslip
 * arrives as `2.845,00 €`. Both the parser and the shape test below go through
 * here, so they cannot disagree about what counts as an amount — an earlier
 * version had the parser accepting the euro sign while the test rejected it, and
 * the consequence was that the one amount that mattered was never a candidate.
 *
 * @param {string} text
 * @returns {string}
 */
function stripCurrency(text) {
  return String(text ?? '')
    .replace(/[€$£]|\bEUR\b/gi, '')
    .replace(/\s+/g, '');
}

/**
 * Parse a printed Italian amount into cents.
 *
 * More than two decimals are rounded half away from zero, matching how payroll
 * software prints them rather than how binary floats round.
 *
 * @param {string} text
 * @returns {Cents | null} null when `text` is not a well-formed amount
 */
export function parseItalianAmount(text) {
  const cleaned = stripCurrency(text);
  if (!ITALIAN_AMOUNT.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  const digits = cleaned.replace(/^-/, '').replace(/\./g, '');
  const [whole, fraction = ''] = digits.split(',');

  let cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  const third = fraction[2];
  if (third !== undefined && Number(third) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;

  return negative ? -cents : cents;
}

/**
 * Split cents into the pieces every formatter below needs.
 * @param {Cents} cents
 */
function parts(cents) {
  const absolute = Math.abs(Math.trunc(cents));
  return {
    sign: cents < 0 ? '-' : '',
    whole: Math.trunc(absolute / 100),
    fraction: String(absolute % 100).padStart(2, '0'),
  };
}

/**
 * `1234567` -> `"1.234.567"`
 * @param {number} whole
 * @returns {string}
 */
function group(whole) {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Italian decimal notation with thousands separators: `123456` -> `"1.234,56"`.
 * @param {Cents} cents
 * @returns {string}
 */
export function formatItalian(cents) {
  const { sign, whole, fraction } = parts(cents);
  return `${sign}${group(whole)},${fraction}`;
}

/**
 * What `toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })` renders,
 * spelled out so the output does not depend on the browser's ICU data: the
 * separator before the symbol is a non-breaking space.
 * @param {Cents} cents
 * @returns {string}
 */
export function formatEuro(cents) {
  return `${formatItalian(cents)} €`;
}

/**
 * Plain decimal with a dot and no grouping: `123456` -> `"1234.56"`.
 * The form bank CSV imports and ISO 20022 `InstdAmt` expect.
 * @param {Cents} cents
 * @returns {string}
 */
export function formatDecimalDot(cents) {
  const { sign, whole, fraction } = parts(cents);
  return `${sign}${whole}.${fraction}`;
}

/**
 * Plain decimal with a comma and no grouping: `123456` -> `"1234,56"`.
 * @param {Cents} cents
 * @returns {string}
 */
export function formatDecimalComma(cents) {
  const { sign, whole, fraction } = parts(cents);
  return `${sign}${whole},${fraction}`;
}

/**
 * Whole euros, rounded half away from zero: `123456` -> `"1235"`.
 * @param {Cents} cents
 * @returns {string}
 */
export function formatWholeEuro(cents) {
  const absolute = Math.abs(Math.trunc(cents));
  const rounded = Math.floor(absolute / 100) + (absolute % 100 >= 50 ? 1 : 0);
  return `${cents < 0 ? '-' : ''}${rounded}`;
}

/**
 * Exact total. Integer addition, so a control sum always matches the
 * transactions it covers.
 * @param {Cents[]} amounts
 * @returns {Cents}
 */
export function sumCents(amounts) {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/**
 * Every amount appearing in a line of text, in order.
 * @param {string} text
 * @returns {Array<{ raw: string, cents: Cents, index: number }>}
 */
export function findAmountsInText(text) {
  /** @type {Array<{ raw: string, cents: Cents, index: number }>} */
  const found = [];
  for (const match of String(text ?? '').matchAll(AMOUNT_IN_TEXT)) {
    const cents = parseItalianAmount(match[0]);
    if (cents !== null) found.push({ raw: match[0], cents, index: match.index ?? -1 });
  }
  return found;
}

/**
 * The shape of a printed monetary amount: exactly two decimals, thousands either
 * grouped correctly or not grouped at all. `2056,00` and `2.845,00` both count;
 * `1.23,45` does not.
 */
const PRINTED_AMOUNT = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/;

/**
 * True when the whole string is one printed amount, currency symbol and all —
 * used to reject text that merely contains a number.
 * @param {string} text
 * @returns {boolean}
 */
export function isExactAmount(text) {
  return PRINTED_AMOUNT.test(stripCurrency(text));
}
