// @ts-check
/**
 * The IBAN address book, as an editable table.
 *
 * Rows are not re-rendered while they are being edited — retyping an IBAN with
 * the cursor jumping back to the start is unusable — so each row updates its own
 * status cell as the value changes and the table is rebuilt only when the set of
 * rows itself changes.
 */

import { mappingStatus } from '../../core/iban-mapping.js';
import { emptyRow, h, replaceChildren } from '../dom.js';

/** @typedef {import('../../core/iban-mapping.js').IbanMapping} IbanMapping */

const COLUMN_COUNT = 6;

/** @type {Record<ReturnType<typeof mappingStatus>, { label: string, tone: string, row: string }>} */
const STATUS = {
  ok: { label: 'OK', tone: 'ok', row: '' },
  missing: { label: 'IBAN mancante', tone: 'warn', row: 'row-warning' },
  invalid: { label: 'IBAN non valido', tone: 'error', row: 'row-error' },
};

/**
 * @param {IbanMapping} mapping
 * @param {HTMLElement} row
 * @param {HTMLElement} statusCell
 */
function refreshStatus(mapping, row, statusCell) {
  const status = STATUS[mappingStatus(mapping)];
  row.className = status.row;
  replaceChildren(statusCell, [h('span', { className: `tag ${status.tone}`, textContent: status.label })]);
}

/**
 * Build one editable row. Edits are written straight into the mapping object the
 * caller owns, which is why no callback is needed for the value itself.
 *
 * @param {IbanMapping} mapping
 * @param {() => void} onChange called after any edit, to refresh the summary
 * @returns {HTMLElement}
 */
function row(mapping, onChange) {
  const statusCell = h('td');
  const tableRow = h('tr');

  const update = () => {
    refreshStatus(mapping, tableRow, statusCell);
    onChange();
  };

  const nameInput = h('input', {
    type: 'text',
    value: mapping.beneficiaryName,
    'aria-label': `Beneficiario di ${mapping.codiceFiscale}`,
  });
  nameInput.addEventListener('input', () => {
    mapping.beneficiaryName = /** @type {HTMLInputElement} */ (nameInput).value.trim();
    onChange();
  });

  const ibanInput = h('input', {
    type: 'text',
    className: 'iban',
    value: mapping.iban,
    placeholder: 'IT…',
    spellcheck: false,
    'aria-label': `IBAN di ${mapping.codiceFiscale}`,
  });
  ibanInput.addEventListener('input', () => {
    const field = /** @type {HTMLInputElement} */ (ibanInput);
    // Normalised as typed, so what is shown is what will be used.
    const cleaned = field.value.replace(/\s+/g, '').toUpperCase();
    if (cleaned !== field.value) {
      const caret = field.selectionStart;
      field.value = cleaned;
      if (caret !== null) field.setSelectionRange(caret, caret);
    }
    mapping.iban = cleaned;
    update();
  });

  const emailInput = h('input', {
    type: 'email',
    value: mapping.email,
    placeholder: 'nome@azienda.it',
    'aria-label': `Email avviso di ${mapping.codiceFiscale}`,
  });
  emailInput.addEventListener('input', () => {
    mapping.email = /** @type {HTMLInputElement} */ (emailInput).value.trim();
    onChange();
  });

  const typeSelect = h('select', { 'aria-label': `Tipo destinatario di ${mapping.codiceFiscale}` }, [
    h('option', { value: 'INDIVIDUAL', textContent: 'Persona', selected: mapping.recipientType === 'INDIVIDUAL' }),
    h('option', { value: 'BUSINESS', textContent: 'Azienda', selected: mapping.recipientType === 'BUSINESS' }),
  ]);
  typeSelect.addEventListener('change', () => {
    mapping.recipientType =
      /** @type {HTMLSelectElement} */ (typeSelect).value === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';
    onChange();
  });

  replaceChildren(tableRow, [
    h('td', {}, [h('code', { textContent: mapping.codiceFiscale })]),
    h('td', {}, [nameInput]),
    h('td', {}, [ibanInput]),
    h('td', {}, [emailInput]),
    h('td', {}, [typeSelect]),
    statusCell,
  ]);

  refreshStatus(mapping, tableRow, statusCell);
  return tableRow;
}

/**
 * @param {HTMLElement} tbody
 * @param {IbanMapping[]} mappings edited in place
 * @param {() => void} onChange
 */
export function renderAddressBook(tbody, mappings, onChange) {
  if (mappings.length === 0) {
    replaceChildren(tbody, [
      emptyRow(COLUMN_COUNT, 'Nessuna riga. Popola dai cedolini oppure importa un CSV.'),
    ]);
    return;
  }
  replaceChildren(
    tbody,
    mappings.map((mapping) => row(mapping, onChange)),
  );
}

/**
 * How ready the book is, counted against the people who actually need paying.
 *
 * @param {IbanMapping[]} mappings
 * @param {string[]} neededCodes codici fiscali found on the payslips
 * @returns {string}
 */
export function addressBookSummary(mappings, neededCodes) {
  if (mappings.length === 0 && neededCodes.length === 0) {
    return 'Nessuna rubrica caricata.';
  }

  const byCode = new Map(mappings.map((mapping) => [mapping.codiceFiscale, mapping]));
  const ready = neededCodes.filter((code) => {
    const mapping = byCode.get(code);
    return mapping !== undefined && mappingStatus(mapping) === 'ok';
  }).length;

  const parts = [];
  if (neededCodes.length > 0) {
    parts.push(`${ready}/${neededCodes.length} beneficiari con IBAN pronto`);
  } else {
    parts.push(`${mappings.length} righe in rubrica`);
  }

  const invalid = mappings.filter((mapping) => mappingStatus(mapping) === 'invalid').length;
  if (invalid > 0) parts.push(`${invalid} IBAN non validi`);

  return parts.join(' · ');
}
