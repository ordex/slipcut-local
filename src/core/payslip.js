// @ts-check
/**
 * One payslip page, read.
 *
 * Pulls the individual rules together into a single record per page, and says
 * how much of it to trust. Nothing here throws: a page that cannot be read
 * comes back with nulls and warnings, because one unreadable page among two
 * hundred must not fail the batch.
 */

import { findFirstCodiceFiscale } from './codice-fiscale.js';
import { findEmployeeName } from './employee-name.js';
import { findAmountsInText } from './money.js';
import { findNetAmount } from './net-amount.js';
import { findPeriod } from './period.js';
import { toText, usefulLines } from './text-geometry.js';

/** @typedef {import('./text-geometry.js').PositionedItem} PositionedItem */
/** @typedef {import('./money.js').Cents} Cents */
/** @typedef {import('./period.js').Period} Period */
/** @typedef {import('./net-amount.js').NetAmountSource} NetAmountSource */

/**
 * Which kind of payslip the page is. Employees and contractors get different
 * layouts from the same payroll software.
 * @typedef {'employee' | 'collaborator' | 'unknown'} PayslipLayout
 */

/**
 * @typedef {object} PayslipPage
 * @property {number} pageNumber 1-based
 * @property {PayslipLayout} layout
 * @property {string | null} codiceFiscale
 * @property {string | null} employeeName
 * @property {Period | null} period
 * @property {Cents | null} netAmount what to pay
 * @property {NetAmountSource} netAmountSource how it was found
 * @property {Cents | null} grossAmount informational
 * @property {number} confidence 0..1
 * @property {string[]} warnings for the operator, in Italian
 * @property {string} text the page in reading order
 */

const COLLABORATOR_MARKERS = /PERCIPIENTE|COMPENSO\s+LORDO|COLLABORAT|PRESTAZIONE\s+OCCASIONALE/;
const EMPLOYEE_MARKERS = /RETRIBUZIONE|QUALIFICA|LIVELLO|COD\.?\s*FISC|NETTO/;

/** Labels whose line carries the gross figure. */
const GROSS_LABEL = /COMPENSO\s+LORDO|RETRIBUZIONE\s+ORDINARIA|TOTALE\s+COMPETENZE/;

/**
 * @param {string} text
 * @returns {PayslipLayout}
 */
export function detectLayout(text) {
  const upper = String(text ?? '').toUpperCase();
  if (COLLABORATOR_MARKERS.test(upper)) return 'collaborator';
  if (EMPLOYEE_MARKERS.test(upper)) return 'employee';
  return 'unknown';
}

/**
 * The gross figure, read off the line that labels it.
 *
 * Shown in the summary only — never paid — so a miss costs nothing and no
 * geometric search is warranted.
 *
 * @param {string} text
 * @returns {Cents | null}
 */
export function findGrossAmount(text) {
  for (const line of usefulLines(text)) {
    if (!GROSS_LABEL.test(line.toUpperCase())) continue;
    const amounts = findAmountsInText(line);
    if (amounts.length > 0) return amounts[amounts.length - 1].cents;
  }
  return null;
}

/**
 * How much of the page was understood.
 *
 * The two fields a page cannot be filed without weigh most; the amount and the
 * name add to it; a recognised layout and a geometric — rather than textual —
 * amount are the remaining signals.
 *
 * The weights total exactly 1, so only a page whose amount came from the
 * geometry can reach full confidence.
 *
 * @param {object} parts
 * @param {boolean} parts.hasCodiceFiscale
 * @param {boolean} parts.hasPeriod
 * @param {boolean} parts.hasName
 * @param {boolean} parts.hasAmount
 * @param {boolean} parts.knownLayout
 * @param {boolean} parts.amountFromGeometry
 * @returns {number} 0..1
 */
function scoreConfidence({
  hasCodiceFiscale,
  hasPeriod,
  hasName,
  hasAmount,
  knownLayout,
  amountFromGeometry,
}) {
  const score =
    (hasCodiceFiscale ? 0.3 : 0) +
    (hasPeriod ? 0.3 : 0) +
    (hasName ? 0.15 : 0) +
    (hasAmount ? 0.15 : 0) +
    (knownLayout ? 0.05 : 0) +
    (amountFromGeometry ? 0.05 : 0);
  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Read one page.
 *
 * @param {object} page
 * @param {number} page.pageNumber 1-based
 * @param {PositionedItem[]} [page.items] positioned fragments from the PDF
 * @param {string} [page.text] pre-rendered text; derived from `items` when absent
 * @returns {PayslipPage}
 */
export function readPayslipPage({ pageNumber, items = [], text }) {
  const pageText = text ?? toText(items);
  const layout = detectLayout(pageText);
  const codiceFiscale = findFirstCodiceFiscale(pageText);
  const period = findPeriod(pageText);
  const employeeName = findEmployeeName(pageText, codiceFiscale);
  const net = findNetAmount({ items, text: pageText });
  const grossAmount = findGrossAmount(pageText);

  /** @type {string[]} */
  const warnings = [];
  if (!codiceFiscale) warnings.push('Codice Fiscale non trovato o non valido');
  if (!period) warnings.push('Periodo non trovato');
  if (!employeeName) warnings.push('Nome non trovato o non corrispondente al Codice Fiscale');
  if (net.cents === null) warnings.push('Netto non trovato');
  else if (net.source !== 'netto-box') {
    warnings.push(`Netto trovato senza geometria (${net.source}): verificare l'importo`);
  }

  return {
    pageNumber,
    layout,
    codiceFiscale,
    employeeName,
    period,
    netAmount: net.cents,
    netAmountSource: net.source,
    grossAmount,
    confidence: scoreConfidence({
      hasCodiceFiscale: codiceFiscale !== null,
      hasPeriod: period !== null,
      hasName: employeeName !== null,
      hasAmount: net.cents !== null,
      knownLayout: layout !== 'unknown',
      amountFromGeometry: net.source === 'netto-box',
    }),
    warnings,
    text: pageText,
  };
}

/**
 * Where a page's PDF belongs in the archive: `CODICEFISCALE/YYYYMM`.
 *
 * Null when the page lacks either, which is also the signal that it cannot be
 * filed and should be reported as skipped.
 *
 * @param {PayslipPage} page
 * @returns {string | null}
 */
export function payslipFolder(page) {
  if (!page.codiceFiscale || !page.period) return null;
  return `${page.codiceFiscale}/${page.period.yyyymm}`;
}
