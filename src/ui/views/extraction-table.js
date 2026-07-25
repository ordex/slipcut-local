// @ts-check
/**
 * The table the operator checks before anybody gets paid.
 *
 * It shows every page, including the ones that failed, and marks how each amount
 * was found: an amount the geometry did not resolve is the one most likely to be
 * wrong, so it is called out rather than blended in with the rest.
 */

import { formatEuro } from '../../core/money.js';
import { emptyRow, h, replaceChildren } from '../dom.js';

/** @typedef {import('../../core/payslip.js').PayslipPage} PayslipPage */

const COLUMN_COUNT = 8;

/** @type {Record<PayslipPage['layout'], string>} */
const LAYOUT_LABELS = {
  employee: 'Dipendente',
  collaborator: 'Collaboratore',
  unknown: 'Non riconosciuto',
};

/**
 * @param {PayslipPage} page
 * @returns {HTMLElement}
 */
function noteCell(page) {
  if (page.warnings.length === 0) {
    return h('td', {}, [h('span', { className: 'tag ok', textContent: 'OK' })]);
  }
  return h('td', { className: 'wrap-cell', textContent: page.warnings.join(' · ') });
}

/**
 * @param {PayslipPage} page
 * @returns {HTMLElement}
 */
function row(page) {
  const unfilable = !page.codiceFiscale || !page.period;
  const className = unfilable ? 'row-error' : page.warnings.length > 0 ? 'row-warning' : '';

  return h('tr', { className }, [
    h('td', { className: 'numeric', textContent: String(page.pageNumber) }),
    h('td', { textContent: LAYOUT_LABELS[page.layout] }),
    h('td', { textContent: page.codiceFiscale ?? '—' }),
    h('td', { textContent: page.employeeName ?? '—' }),
    h('td', { textContent: page.period?.yyyymm ?? '—' }),
    h('td', {
      className: 'numeric',
      textContent: page.netAmount === null ? '—' : formatEuro(page.netAmount),
      title: page.netAmountSource === 'netto-box' ? 'Individuato dalla posizione del NETTO' : `Individuato dal testo (${page.netAmountSource})`,
    }),
    h('td', { className: 'numeric', textContent: `${Math.round(page.confidence * 100)}%` }),
    noteCell(page),
  ]);
}

/**
 * @param {HTMLElement} tbody
 * @param {PayslipPage[]} pages
 */
export function renderExtractionTable(tbody, pages) {
  if (pages.length === 0) {
    replaceChildren(tbody, [emptyRow(COLUMN_COUNT, 'Nessuna pagina letta.')]);
    return;
  }
  replaceChildren(tbody, pages.map(row));
}

/**
 * `1 pagina` but `3 pagine`. Worth the six lines: these strings are the ones an
 * operator reads on every run.
 *
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
export function plural(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * One line summarising the run, in the order an operator wants it: what worked,
 * then what needs attention.
 *
 * @param {object} result
 * @param {PayslipPage[]} result.pages
 * @param {number} result.fileCount
 * @param {number[]} result.skippedPages
 * @param {number} result.processedPages
 * @param {number} result.totalPages
 * @returns {string}
 */
export function extractionSummary({ pages, fileCount, skippedPages, processedPages, totalPages }) {
  const missingAmount = pages.filter((page) => page.netAmount === null).length;
  const fallbackAmount = pages.filter(
    (page) => page.netAmount !== null && page.netAmountSource !== 'netto-box',
  ).length;

  const parts = [
    `${plural(fileCount, 'cedolino archiviato', 'cedolini archiviati')} su ${plural(processedPages, 'pagina letta', 'pagine lette')}`,
  ];
  if (totalPages > processedPages) {
    parts.push(`${plural(totalPages - processedPages, 'pagina non elaborata', 'pagine non elaborate')}`);
  }
  if (skippedPages.length > 0) {
    parts.push(plural(skippedPages.length, 'pagina non archiviabile', 'pagine non archiviabili'));
  }
  if (missingAmount > 0) parts.push(`${missingAmount} senza netto`);
  if (fallbackAmount > 0) parts.push(`${fallbackAmount} con netto da verificare`);
  return parts.join(' · ');
}
