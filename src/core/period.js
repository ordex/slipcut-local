// @ts-check
/**
 * The pay period a payslip covers.
 *
 * Used to file the split PDFs and to fill the payment reference, so it has to
 * come out as an unambiguous year and month rather than as printed text.
 */

/** @type {Record<string, string>} */
const MONTHS = {
  GENNAIO: '01',
  FEBBRAIO: '02',
  MARZO: '03',
  APRILE: '04',
  MAGGIO: '05',
  GIUGNO: '06',
  LUGLIO: '07',
  AGOSTO: '08',
  SETTEMBRE: '09',
  OTTOBRE: '10',
  NOVEMBRE: '11',
  DICEMBRE: '12',
};

const MONTH_NAME = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\s+((?:19|20)\\d{2})\\b`, 'i');
const PRINTED_DATE = /\b(\d{2})\/(\d{2})\/((?:19|20)\d{2})\b/g;

/**
 * @typedef {object} Period
 * @property {string} year four digits
 * @property {string} month two digits, `01`–`12`
 * @property {string} yyyymm year and month concatenated, for sorting and paths
 * @property {string} label how to show it to a human
 */

/**
 * @param {string} year
 * @param {string} month
 * @param {string} label
 * @returns {Period}
 */
function period(year, month, label) {
  return { year, month, yyyymm: `${year}${month}`, label };
}

/**
 * @param {string} monthName upper-cased Italian month name
 * @returns {string} capitalised
 */
function capitalise(monthName) {
  return monthName[0] + monthName.slice(1).toLowerCase();
}

/**
 * Read the pay period from a page of extracted text.
 *
 * A spelled-out month wins, because that is the period heading payroll prints.
 *
 * Failing that, the *latest* printed date is used, not the last one on the page.
 * A payslip's dates run from the hiring date to the period end, so the latest is
 * the one wanted — and reading order is no guide at all, because the last thing
 * printed is often a footer: one Italian payroll vendor ends every page with its
 * own INAIL authorisation, dated 2009, which read as a period seventeen years off.
 *
 * @param {string} text
 * @returns {Period | null}
 */
export function findPeriod(text) {
  const normalised = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  const byName = normalised.match(MONTH_NAME);
  if (byName) {
    const monthName = byName[1].toUpperCase();
    const year = byName[2];
    return period(year, MONTHS[monthName], `${capitalise(monthName)} ${year}`);
  }

  const dates = [...normalised.matchAll(PRINTED_DATE)]
    .map(([, day, month, year]) => ({ day, month, year }))
    .filter((date) => Number(date.month) >= 1 && Number(date.month) <= 12)
    .sort((a, b) => `${a.year}${a.month}${a.day}`.localeCompare(`${b.year}${b.month}${b.day}`));

  // One date on its own is as likely to be a hiring date as a period.
  if (dates.length >= 2) {
    const latest = dates[dates.length - 1];
    return period(latest.year, latest.month, `${latest.month}/${latest.year}`);
  }

  return null;
}
