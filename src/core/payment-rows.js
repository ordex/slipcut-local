// @ts-check
/**
 * Turning read payslips plus an address book into payment instructions.
 *
 * This is the step where a mistake costs money, so nothing is inferred: a page
 * becomes a payment only when it has an amount, a period, and a valid IBAN for
 * its Codice Fiscale. Everything else is reported instead of guessed at.
 */

import { isValidIban } from './iban.js';
import { sumCents } from './money.js';

/** @typedef {import('./money.js').Cents} Cents */
/** @typedef {import('./payslip.js').PayslipPage} PayslipPage */
/** @typedef {import('./iban-mapping.js').IbanMapping} IbanMapping */
/** @typedef {import('./iban-mapping.js').RecipientType} RecipientType */

/**
 * @typedef {object} PaymentRow
 * @property {string} codiceFiscale
 * @property {string} beneficiaryName
 * @property {RecipientType} recipientType
 * @property {string} email
 * @property {string} iban
 * @property {Cents} amount
 * @property {string} period `YYYYMM`
 * @property {string} remittanceInformation what the payee sees on their statement
 * @property {number} sourcePage which page it came from
 */

/**
 * Why a page did not become a payment.
 * @typedef {'missing-amount' | 'missing-iban' | 'invalid-iban' | 'missing-period' | 'duplicate-mapping'} ProblemKind
 */

/**
 * @typedef {object} Problem
 * @property {ProblemKind} kind
 * @property {string} message in Italian, for the operator
 * @property {number} [pageNumber]
 * @property {string} [codiceFiscale]
 */

export const DEFAULT_REMITTANCE_TEMPLATE = 'Stipendio {period}';

/**
 * Fill the placeholders of a remittance template.
 * @param {string} template
 * @param {{ period: string, name: string, codiceFiscale: string }} values
 * @returns {string}
 */
export function renderRemittance(template, values) {
  return String(template ?? '')
    .replaceAll('{period}', values.period)
    .replaceAll('{name}', values.name)
    .replaceAll('{cf}', values.codiceFiscale)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Index an address book by Codice Fiscale, reporting duplicates.
 *
 * A duplicate is worth surfacing: two rows for one person means one of the two
 * IBANs is not going to be used, and the operator should know which.
 *
 * @param {IbanMapping[]} mappings
 * @param {Problem[]} problems collects what was found
 * @returns {Map<string, IbanMapping>}
 */
function indexByCodiceFiscale(mappings, problems) {
  /** @type {Map<string, IbanMapping>} */
  const byCode = new Map();
  for (const mapping of mappings) {
    if (!mapping.codiceFiscale) continue;
    if (byCode.has(mapping.codiceFiscale)) {
      problems.push({
        kind: 'duplicate-mapping',
        codiceFiscale: mapping.codiceFiscale,
        message: `Mappatura duplicata per ${mapping.codiceFiscale}: viene usata l'ultima`,
      });
    }
    byCode.set(mapping.codiceFiscale, mapping);
  }
  return byCode;
}

/**
 * Build the payment instructions.
 *
 * Pages with no Codice Fiscale are ignored without comment — they are cover
 * sheets and totals pages, not payslips. Pages that identify somebody but cannot
 * be paid are reported.
 *
 * @param {object} input
 * @param {PayslipPage[]} input.pages
 * @param {IbanMapping[]} input.mappings
 * @param {string} [input.remittanceTemplate]
 * @returns {{ payments: PaymentRow[], problems: Problem[], total: Cents }}
 */
export function buildPaymentRows({ pages, mappings, remittanceTemplate }) {
  /** @type {Problem[]} */
  const problems = [];
  const byCode = indexByCodiceFiscale(mappings, problems);
  const template = remittanceTemplate?.trim() || DEFAULT_REMITTANCE_TEMPLATE;

  /** @type {PaymentRow[]} */
  const payments = [];

  for (const page of pages) {
    if (!page.codiceFiscale) continue;

    const who = page.employeeName ?? page.codiceFiscale;

    if (!page.period) {
      problems.push({
        kind: 'missing-period',
        pageNumber: page.pageNumber,
        codiceFiscale: page.codiceFiscale,
        message: `Periodo mancante per ${who} (pagina ${page.pageNumber})`,
      });
      continue;
    }

    if (page.netAmount === null) {
      problems.push({
        kind: 'missing-amount',
        pageNumber: page.pageNumber,
        codiceFiscale: page.codiceFiscale,
        message: `Netto mancante per ${who} (pagina ${page.pageNumber})`,
      });
      continue;
    }

    const mapping = byCode.get(page.codiceFiscale);
    if (!mapping || !mapping.iban) {
      problems.push({
        kind: 'missing-iban',
        pageNumber: page.pageNumber,
        codiceFiscale: page.codiceFiscale,
        message: `IBAN mancante per ${who} (${page.codiceFiscale})`,
      });
      continue;
    }

    if (!isValidIban(mapping.iban)) {
      problems.push({
        kind: 'invalid-iban',
        pageNumber: page.pageNumber,
        codiceFiscale: page.codiceFiscale,
        message: `IBAN non valido per ${who} (${page.codiceFiscale})`,
      });
      continue;
    }

    payments.push({
      codiceFiscale: page.codiceFiscale,
      beneficiaryName: mapping.beneficiaryName || page.employeeName || page.codiceFiscale,
      recipientType: mapping.recipientType,
      email: mapping.email,
      iban: mapping.iban,
      amount: page.netAmount,
      period: page.period.yyyymm,
      remittanceInformation: renderRemittance(template, {
        period: page.period.yyyymm,
        name: page.employeeName ?? '',
        codiceFiscale: page.codiceFiscale,
      }),
      sourcePage: page.pageNumber,
    });
  }

  return { payments, problems, total: sumCents(payments.map((payment) => payment.amount)) };
}
