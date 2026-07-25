// @ts-check
/**
 * The Codice Fiscale → IBAN address book.
 *
 * A payslip does not carry the employee's bank details, so the operator
 * supplies them once and reuses them every month. This module reads and writes
 * that list, and merges an imported one with the people found on the payslips.
 */

import { fieldByHeader, formatCsv, normaliseHeader, parseCsv } from './csv.js';
import { isValidIban, normaliseIban } from './iban.js';

/** @typedef {import('./payslip.js').PayslipPage} PayslipPage */

/**
 * Whether the payee is a person or a company. Contractors invoicing through a
 * company are paid to a business account, and ISO 20022 identifies the two
 * differently.
 * @typedef {'INDIVIDUAL' | 'BUSINESS'} RecipientType
 */

/**
 * @typedef {object} IbanMapping
 * @property {string} codiceFiscale
 * @property {string} beneficiaryName
 * @property {string} iban
 * @property {RecipientType} recipientType
 * @property {string} email for the payment advice, optional
 */

/** Column order used when writing, and when reading a file with no header. */
export const MAPPING_COLUMNS = ['codice_fiscale', 'beneficiary_name', 'iban', 'recipient_type', 'email'];

/** Accepted spellings per column. */
const ALIASES = {
  codiceFiscale: ['codice_fiscale', 'cf', 'tax_code', 'fiscal_code', 'codice_fiscale_cf'],
  beneficiaryName: ['beneficiary_name', 'name', 'nome', 'beneficiario', 'nome_beneficiario', 'recipient_name'],
  iban: ['iban'],
  recipientType: ['recipient_type', 'tipo', 'tipo_destinatario', 'type'],
  email: ['email', 'e_mail', 'mail', 'indirizzo_email', 'remittance_email'],
};

/**
 * @param {string} value
 * @returns {RecipientType}
 */
export function normaliseRecipientType(value) {
  const cleaned = String(value ?? '').trim().toUpperCase();
  return ['BUSINESS', 'COMPANY', 'ORGANIZATION', 'ORG', 'AZIENDA', 'SOCIETA'].includes(cleaned)
    ? 'BUSINESS'
    : 'INDIVIDUAL';
}

/**
 * @param {Partial<IbanMapping>} row
 * @returns {IbanMapping}
 */
function cleanMapping(row) {
  return {
    codiceFiscale: String(row.codiceFiscale ?? '').replace(/\s+/g, '').toUpperCase(),
    beneficiaryName: String(row.beneficiaryName ?? '').trim(),
    iban: normaliseIban(row.iban ?? ''),
    recipientType: normaliseRecipientType(row.recipientType ?? ''),
    email: String(row.email ?? '').trim(),
  };
}

/**
 * Does the first row name columns, or is it already data?
 * @param {string[]} headers normalised
 * @returns {boolean}
 */
function looksLikeHeader(headers) {
  const known = new Set(Object.values(ALIASES).flat());
  return headers.some((header) => known.has(header));
}

/**
 * Read an address book.
 *
 * Columns may appear in any order and under any accepted name. A file with no
 * header is read in the order this module writes: code, name, IBAN, type, email.
 *
 * @param {string} text
 * @returns {IbanMapping[]}
 */
export function parseIbanMappingCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map(normaliseHeader);
  const hasHeader = looksLikeHeader(headers);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((values) =>
      hasHeader
        ? cleanMapping({
            codiceFiscale: fieldByHeader(headers, values, ALIASES.codiceFiscale),
            beneficiaryName: fieldByHeader(headers, values, ALIASES.beneficiaryName),
            iban: fieldByHeader(headers, values, ALIASES.iban),
            recipientType: /** @type {RecipientType} */ (
              fieldByHeader(headers, values, ALIASES.recipientType)
            ),
            email: fieldByHeader(headers, values, ALIASES.email),
          })
        : cleanMapping({
            codiceFiscale: values[0],
            beneficiaryName: values[1],
            iban: values[2],
            recipientType: /** @type {RecipientType} */ (values[3]),
            email: values[4],
          }),
    )
    .filter((row) => row.codiceFiscale || row.iban || row.beneficiaryName);
}

/**
 * Write an address book, header included.
 * @param {IbanMapping[]} mappings
 * @returns {string}
 */
export function formatIbanMappingCsv(mappings) {
  const rows = mappings.map((row) => [
    row.codiceFiscale,
    row.beneficiaryName,
    row.iban,
    row.recipientType,
    row.email,
  ]);
  return `${formatCsv([MAPPING_COLUMNS, ...rows])}\n`;
}

/**
 * Seed an address book from the people found on the payslips: one row each,
 * with the bank details left blank for the operator to fill in.
 *
 * @param {PayslipPage[]} pages
 * @returns {IbanMapping[]}
 */
export function mappingsFromPages(pages) {
  const seen = new Set();
  /** @type {IbanMapping[]} */
  const mappings = [];
  for (const page of pages) {
    if (!page.codiceFiscale || seen.has(page.codiceFiscale)) continue;
    seen.add(page.codiceFiscale);
    mappings.push(
      cleanMapping({
        codiceFiscale: page.codiceFiscale,
        beneficiaryName: page.employeeName ?? '',
      }),
    );
  }
  return mappings;
}

/**
 * Merge two address books, keyed by Codice Fiscale.
 *
 * `primary` wins on every field it fills in; `fallback` supplies the rest. This
 * is what keeps a saved book from losing the people who appear on this month's
 * payslips, and keeps a fresh import from wiping details it does not carry.
 *
 * @param {IbanMapping[]} primary
 * @param {IbanMapping[]} fallback
 * @returns {IbanMapping[]} sorted by name, then code
 */
export function mergeMappings(primary, fallback) {
  /** @type {Map<string, IbanMapping>} */
  const byCode = new Map();

  for (const row of [...fallback, ...primary]) {
    const clean = cleanMapping(row);
    if (!clean.codiceFiscale) continue;
    const existing = byCode.get(clean.codiceFiscale);
    byCode.set(clean.codiceFiscale, {
      codiceFiscale: clean.codiceFiscale,
      beneficiaryName: clean.beneficiaryName || existing?.beneficiaryName || '',
      iban: clean.iban || existing?.iban || '',
      recipientType: clean.recipientType,
      email: clean.email || existing?.email || '',
    });
  }

  return [...byCode.values()].sort(
    (a, b) =>
      a.beneficiaryName.localeCompare(b.beneficiaryName, 'it') ||
      a.codiceFiscale.localeCompare(b.codiceFiscale),
  );
}

/**
 * How usable a row is, for display and for counting.
 * @param {IbanMapping} mapping
 * @returns {'ok' | 'missing' | 'invalid'}
 */
export function mappingStatus(mapping) {
  if (!mapping.iban) return 'missing';
  return isValidIban(mapping.iban) ? 'ok' : 'invalid';
}
