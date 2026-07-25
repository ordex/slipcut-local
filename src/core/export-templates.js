// @ts-check
/**
 * Bank CSV formats, described by configuration rather than by code.
 *
 * Every bank and payment platform wants a different column layout, so the
 * layouts live in JSON that a deployment can override and an operator can edit.
 *
 * The validator is deliberately strict, and in particular an unknown column
 * source is rejected when the configuration is loaded. Accepting it and
 * rendering an empty cell would produce a CSV that imports cleanly and pays the
 * wrong thing, which is the worst available outcome.
 */

import { escapeCsvValue } from './csv.js';
import { formatDecimalComma, formatDecimalDot, formatItalian, formatWholeEuro } from './money.js';
import { ibanCountry } from './iban.js';

/** @typedef {import('./payment-rows.js').PaymentRow} PaymentRow */

/** Every value a column can be filled from. */
export const CSV_SOURCES = /** @type {const} */ ([
  'beneficiaryName',
  'recipientType',
  'email',
  'codiceFiscale',
  'iban',
  'recipientBankCountry',
  'currency',
  'amount',
  'period',
  'remittanceInformation',
  'sourcePage',
]);

/** How an amount is written. */
export const AMOUNT_FORMATS = /** @type {const} */ ([
  'decimal-dot',
  'decimal-comma',
  'italian',
  'integer',
]);

const DELIMITERS = [',', ';', '\t'];

/** @typedef {(typeof CSV_SOURCES)[number]} CsvSource */
/** @typedef {(typeof AMOUNT_FORMATS)[number]} AmountFormat */

/**
 * @typedef {object} TemplateColumn
 * @property {string} header
 * @property {CsvSource} [source] where the value comes from
 * @property {string} [fixed] a constant, for flag columns a bank requires
 * @property {AmountFormat} [format] only meaningful with `source: 'amount'`
 */

/**
 * @typedef {object} ExportTemplate
 * @property {string} id
 * @property {string} label
 * @property {string} [description]
 * @property {string} [delimiter]
 * @property {TemplateColumn[]} columns
 */

/**
 * @typedef {object} TemplateConfig
 * @property {1} schemaVersion
 * @property {ExportTemplate[]} templates
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate one column.
 * @param {unknown} value
 * @param {string} where for the error message
 * @returns {TemplateColumn}
 */
function validateColumn(value, where) {
  if (!isObject(value)) throw new Error(`${where}: ogni colonna deve essere un oggetto`);
  const column = /** @type {Record<string, unknown>} */ (value);

  if (typeof column.header !== 'string' || column.header.trim() === '') {
    throw new Error(`${where}: manca "header"`);
  }

  const hasSource = column.source !== undefined;
  const hasFixed = column.fixed !== undefined;
  if (hasSource === hasFixed) {
    throw new Error(`${where} "${column.header}": indicare "source" oppure "fixed", non entrambi`);
  }

  if (hasFixed) {
    const fixed = column.fixed;
    if (typeof fixed !== 'string' && typeof fixed !== 'number' && typeof fixed !== 'boolean') {
      throw new Error(`${where} "${column.header}": "fixed" deve essere testo, numero o booleano`);
    }
    return { header: column.header, fixed: typeof fixed === 'boolean' ? (fixed ? 'TRUE' : 'FALSE') : String(fixed) };
  }

  if (typeof column.source !== 'string' || !CSV_SOURCES.includes(/** @type {CsvSource} */ (column.source))) {
    throw new Error(
      `${where} "${column.header}": "source" non riconosciuta (${String(column.source)}). Valori ammessi: ${CSV_SOURCES.join(', ')}`,
    );
  }

  const format = column.format ?? 'decimal-dot';
  if (typeof format !== 'string' || !AMOUNT_FORMATS.includes(/** @type {AmountFormat} */ (format))) {
    throw new Error(
      `${where} "${column.header}": "format" non riconosciuto (${String(column.format)}). Valori ammessi: ${AMOUNT_FORMATS.join(', ')}`,
    );
  }

  return {
    header: column.header,
    source: /** @type {CsvSource} */ (column.source),
    format: /** @type {AmountFormat} */ (format),
  };
}

/**
 * Validate a whole configuration, or explain why it is not usable.
 *
 * @param {unknown} value parsed JSON
 * @returns {TemplateConfig}
 * @throws {Error} with a message meant for the operator
 */
export function validateTemplateConfig(value) {
  if (!isObject(value)) throw new Error('La configurazione deve essere un oggetto JSON');
  const config = /** @type {Record<string, unknown>} */ (value);

  if (!Array.isArray(config.templates) || config.templates.length === 0) {
    throw new Error('La configurazione deve contenere un elenco "templates" non vuoto');
  }

  const seen = new Set();
  const templates = config.templates.map((entry, index) => {
    const where = `Formato ${index + 1}`;
    if (!isObject(entry)) throw new Error(`${where}: deve essere un oggetto`);
    const template = /** @type {Record<string, unknown>} */ (entry);

    if (typeof template.id !== 'string' || template.id.trim() === '') {
      throw new Error(`${where}: manca "id"`);
    }
    if (typeof template.label !== 'string' || template.label.trim() === '') {
      throw new Error(`${where} "${template.id}": manca "label"`);
    }
    if (seen.has(template.id)) throw new Error(`${where}: "id" duplicato (${template.id})`);
    seen.add(template.id);

    if (!Array.isArray(template.columns) || template.columns.length === 0) {
      throw new Error(`${where} "${template.id}": manca l'elenco "columns"`);
    }

    const delimiter = template.delimiter ?? ',';
    if (typeof delimiter !== 'string' || !DELIMITERS.includes(delimiter)) {
      throw new Error(`${where} "${template.id}": "delimiter" deve essere "," ";" o tabulazione`);
    }

    return {
      id: template.id,
      label: template.label,
      ...(typeof template.description === 'string' ? { description: template.description } : {}),
      delimiter,
      columns: template.columns.map((column, columnIndex) =>
        validateColumn(column, `${where} "${template.id}", colonna ${columnIndex + 1}`),
      ),
    };
  });

  return { schemaVersion: 1, templates };
}

/**
 * @param {import('./money.js').Cents} amount
 * @param {AmountFormat} format
 * @returns {string}
 */
function renderAmount(amount, format) {
  switch (format) {
    case 'decimal-dot':
      return formatDecimalDot(amount);
    case 'decimal-comma':
      return formatDecimalComma(amount);
    case 'italian':
      return formatItalian(amount);
    case 'integer':
      return formatWholeEuro(amount);
    default:
      // Unreachable: the format was validated on load.
      throw new Error(`Formato importo non gestito: ${format}`);
  }
}

/**
 * The value of one column for one payment.
 *
 * @param {PaymentRow} payment
 * @param {TemplateColumn} column
 * @returns {string}
 */
export function valueForColumn(payment, column) {
  if (column.fixed !== undefined) return column.fixed;

  switch (column.source) {
    case 'beneficiaryName':
      return payment.beneficiaryName;
    case 'recipientType':
      return payment.recipientType;
    case 'email':
      return payment.email;
    case 'codiceFiscale':
      return payment.codiceFiscale;
    case 'iban':
      return payment.iban;
    case 'recipientBankCountry':
      return ibanCountry(payment.iban);
    case 'currency':
      return 'EUR';
    case 'amount':
      return renderAmount(payment.amount, column.format ?? 'decimal-dot');
    case 'period':
      return payment.period;
    case 'remittanceInformation':
      return payment.remittanceInformation;
    case 'sourcePage':
      return String(payment.sourcePage);
    default:
      // Unreachable: the source was validated on load. Throwing rather than
      // returning '' keeps a bad configuration from silently paying wrongly.
      throw new Error(`Sorgente colonna non gestita: ${String(column.source)}`);
  }
}

/**
 * Render the payments in a template's layout.
 *
 * @param {PaymentRow[]} payments
 * @param {ExportTemplate} template
 * @returns {string}
 */
export function renderPaymentsCsv(payments, template) {
  const delimiter = template.delimiter ?? ',';
  const header = template.columns.map((column) => escapeCsvValue(column.header)).join(delimiter);
  const lines = payments.map((payment) =>
    template.columns.map((column) => escapeCsvValue(valueForColumn(payment, column))).join(delimiter),
  );
  return `${[header, ...lines].join('\n')}\n`;
}

/**
 * @param {TemplateConfig} config
 * @param {string | undefined} id
 * @returns {ExportTemplate | null} the first template when `id` is unknown
 */
export function templateById(config, id) {
  return config.templates.find((template) => template.id === id) ?? config.templates[0] ?? null;
}

/**
 * Serialise a configuration for editing or download.
 * @param {TemplateConfig} config
 * @returns {string}
 */
export function formatConfigJson(config) {
  return `${JSON.stringify(validateTemplateConfig(config), null, 2)}\n`;
}
