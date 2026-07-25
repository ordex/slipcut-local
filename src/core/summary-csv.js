// @ts-check
/**
 * The extraction summary: what was read from every page, as a spreadsheet.
 *
 * This is the artefact an operator checks before anybody gets paid, so it lists
 * every page — including the ones that failed — and says how each amount was
 * found.
 */

import { formatCsv } from './csv.js';
import { formatItalian } from './money.js';

/** @typedef {import('./payslip.js').PayslipPage} PayslipPage */

export const SUMMARY_COLUMNS = [
  'pagina',
  'tipo',
  'confidenza',
  'codice_fiscale',
  'nome',
  'periodo',
  'lordo',
  'netto',
  'origine_netto',
  'note',
];

/**
 * @param {PayslipPage[]} pages
 * @returns {string}
 */
export function formatExtractionSummaryCsv(pages) {
  const rows = pages.map((page) => [
    page.pageNumber,
    page.layout,
    `${Math.round(page.confidence * 100)}%`,
    page.codiceFiscale ?? '',
    page.employeeName ?? '',
    page.period?.yyyymm ?? '',
    page.grossAmount === null ? '' : formatItalian(page.grossAmount),
    page.netAmount === null ? '' : formatItalian(page.netAmount),
    page.netAmountSource,
    page.warnings.join(' | '),
  ]);
  return `${formatCsv([SUMMARY_COLUMNS, ...rows])}\n`;
}
