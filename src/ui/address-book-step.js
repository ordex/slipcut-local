// @ts-check
/**
 * The address book, as the page uses it: state, dialog and persistence.
 *
 * The book is the one piece of data the app keeps between visits, and the one
 * piece it never invents. Rows appear because a payslip named that person or
 * because the operator imported them; the bank details are always typed.
 */

import {
  formatIbanMappingCsv,
  mappingsFromPages,
  mergeMappings,
  parseIbanMappingCsv,
} from '../core/iban-mapping.js';
import { byId, setStatus } from './dom.js';
import { downloadText } from './download.js';
import { forgetAddressBook, loadAddressBook, saveAddressBook } from './storage.js';
import { addressBookSummary, renderAddressBook } from './views/address-book.js';

/** @typedef {import('../core/iban-mapping.js').IbanMapping} IbanMapping */
/** @typedef {import('../core/payslip.js').PayslipPage} PayslipPage */

const elements = {
  summary: byId('address-book-summary'),
  open: byId('open-address-book'),
  importButton: byId('import-address-book'),
  importInput: /** @type {HTMLInputElement} */ (byId('address-book-file')),
  dialog: /** @type {HTMLDialogElement} */ (byId('address-book-dialog')),
  rows: byId('address-book-rows'),
  status: byId('address-book-status'),
  seed: byId('seed-address-book'),
  save: byId('save-address-book'),
  export: byId('export-address-book'),
  forget: byId('forget-address-book'),
};

/** @type {IbanMapping[]} */
let mappings = loadAddressBook();

/** @type {PayslipPage[]} */
let pages = [];

/** @type {() => void} */
let notifyChanged = () => {};

/** Codici fiscali that actually need an IBAN this run. */
function neededCodes() {
  return [...new Set(pages.map((page) => page.codiceFiscale).filter(Boolean))].map(String);
}

/** Refresh both summaries without rebuilding the editable rows. */
function refreshSummaries() {
  elements.summary.textContent = addressBookSummary(mappings, neededCodes());
  notifyChanged();
}

/** @param {string} [message] */
function refreshAll(message) {
  renderAddressBook(elements.rows, mappings, refreshSummaries);
  refreshSummaries();
  if (message !== undefined) setStatus(elements.status, message);
}

/** Add a row for anybody on the payslips who is not in the book yet. */
function seedFromPages() {
  mappings = mergeMappings(mappings, mappingsFromPages(pages));
}

/**
 * Tell the step which payslips are being paid.
 * @param {PayslipPage[]} readPages
 */
export function setPages(readPages) {
  pages = readPages;
  seedFromPages();
  refreshAll();
}

/** @returns {IbanMapping[]} */
export function currentAddressBook() {
  return mappings;
}

/**
 * Run something whenever the book changes, so the payment step can react.
 * @param {() => void} handler
 */
export function whenAddressBookChanges(handler) {
  notifyChanged = handler;
}

elements.open.addEventListener('click', () => {
  seedFromPages();
  refreshAll(
    mappings.length === 0
      ? 'Nessun beneficiario: elabora un PDF oppure importa un CSV.'
      : `${mappings.length} righe.`,
  );
  elements.dialog.showModal();
});

elements.seed.addEventListener('click', () => {
  const before = mappings.length;
  seedFromPages();
  refreshAll(
    mappings.length === before
      ? 'Nessun nuovo beneficiario dai cedolini.'
      : `Aggiunte ${mappings.length - before} righe dai cedolini.`,
  );
});

elements.save.addEventListener('click', () => {
  const stored = saveAddressBook(mappings);
  setStatus(
    elements.status,
    stored
      ? 'Rubrica salvata in questo browser.'
      : 'Impossibile salvare: la memoria del browser non è disponibile.',
    stored ? 'ok' : 'error',
  );
});

elements.export.addEventListener('click', () => {
  downloadText(formatIbanMappingCsv(mappings), 'rubrica-iban.csv', 'text/csv;charset=utf-8');
});

elements.forget.addEventListener('click', () => {
  forgetAddressBook();
  // What was typed this session stays on screen; only the stored copy is gone.
  setStatus(elements.status, 'Copia salvata cancellata dal browser.', 'ok');
});

elements.importButton.addEventListener('click', () => elements.importInput.click());

elements.importInput.addEventListener('change', async () => {
  const file = elements.importInput.files?.[0];
  elements.importInput.value = '';
  if (!file) return;

  try {
    const imported = parseIbanMappingCsv(await file.text());
    if (imported.length === 0) {
      setStatus(elements.summary, `${file.name} non contiene righe utilizzabili.`, 'error');
      return;
    }
    // The import wins on the fields it fills; the rest of the book survives.
    mappings = mergeMappings(imported, mappings);
    seedFromPages();
    refreshAll(`Importate ${imported.length} righe da ${file.name}.`);
    setStatus(elements.summary, addressBookSummary(mappings, neededCodes()));
  } catch (error) {
    setStatus(
      elements.summary,
      error instanceof Error ? error.message : 'CSV della rubrica non leggibile.',
      'error',
    );
  }
});

refreshAll();
