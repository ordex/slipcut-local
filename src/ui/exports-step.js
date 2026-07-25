// @ts-check
/**
 * Turning the read payslips into files for the bank.
 *
 * Two formats, configured separately: a CSV whose layout comes from JSON, and an
 * ISO 20022 payment file. Both are built from the same payment rows, so what the
 * table shows is what the file contains.
 */

import {
  formatConfigJson,
  renderPaymentsCsv,
  templateById,
  validateTemplateConfig,
} from '../core/export-templates.js';
import { buildPaymentRows } from '../core/payment-rows.js';
import { generatePaymentXml, PAYMENT_XML_PROFILES, profileById } from '../core/payment-xml.js';
import { currentAddressBook, whenAddressBookChanges } from './address-book-step.js';
import { byId, h, replaceChildren, setStatus, setVisible } from './dom.js';
import { downloadText } from './download.js';
import {
  emptySettings,
  forgetSettings,
  forgetTemplates,
  loadSettings,
  loadTemplates,
  saveSettings,
  saveTemplates,
} from './storage.js';
import { renderPaymentMessages, renderPaymentsTable } from './views/payments-table.js';

/** @typedef {import('../core/payslip.js').PayslipPage} PayslipPage */
/** @typedef {import('../core/payment-rows.js').PaymentRow} PaymentRow */
/** @typedef {import('../core/export-templates.js').TemplateConfig} TemplateConfig */

/** Where the CSV layouts came from, so the operator knows what they are editing. */
const SOURCE_LABELS = {
  browser: 'configurazione salvata in questo browser',
  deployment: 'configurazione di questa installazione',
  default: 'configurazione predefinita',
};

const elements = {
  tabCsv: byId('tab-csv'),
  tabXml: byId('tab-xml'),
  panelCsv: byId('panel-csv'),
  panelXml: byId('panel-xml'),

  csvTemplate: /** @type {HTMLSelectElement} */ (byId('csv-template')),
  csvTemplateDescription: byId('csv-template-description'),
  csvTemplateEditor: /** @type {HTMLTextAreaElement} */ (byId('csv-template-editor')),
  saveTemplates: byId('save-templates'),
  loadTemplatesFile: byId('load-templates-file'),
  exportTemplates: byId('export-templates'),
  resetTemplates: byId('reset-templates'),
  templatesFile: /** @type {HTMLInputElement} */ (byId('templates-file')),
  templatesMessage: byId('templates-message'),

  xmlProfile: /** @type {HTMLSelectElement} */ (byId('xml-profile')),
  xmlProfileHint: byId('xml-profile-hint'),
  debtorName: /** @type {HTMLInputElement} */ (byId('debtor-name')),
  debtorIban: /** @type {HTMLInputElement} */ (byId('debtor-iban')),
  debtorBic: /** @type {HTMLInputElement} */ (byId('debtor-bic')),
  debtorAbi: /** @type {HTMLInputElement} */ (byId('debtor-abi')),
  debtorCuc: /** @type {HTMLInputElement} */ (byId('debtor-cuc')),
  executionDate: /** @type {HTMLInputElement} */ (byId('execution-date')),
  messageId: /** @type {HTMLInputElement} */ (byId('message-id')),
  paymentInfoId: /** @type {HTMLInputElement} */ (byId('payment-info-id')),
  saveSettings: byId('save-settings'),
  clearSettings: byId('clear-settings'),
  settingsMessage: byId('settings-message'),

  remittanceTemplate: /** @type {HTMLInputElement} */ (byId('remittance-template')),
  buildPayments: /** @type {HTMLButtonElement} */ (byId('build-payments')),
  downloadCsv: /** @type {HTMLButtonElement} */ (byId('download-csv')),
  downloadXml: /** @type {HTMLButtonElement} */ (byId('download-xml')),
  paymentMessages: byId('payment-messages'),
  paymentsTable: byId('payments-table'),
  paymentRows: byId('payment-rows'),
};

/** @type {PayslipPage[]} */
let pages = [];

/** @type {PaymentRow[]} */
let payments = [];

/** @type {TemplateConfig | null} */
let templates = null;

/**
 * Tell the step which payslips are being paid. Any payments prepared for an
 * earlier document are dropped: they no longer describe what is on screen.
 * @param {PayslipPage[]} readPages
 */
export function setPages(readPages) {
  pages = readPages;
  clearPayments();
}

function clearPayments() {
  payments = [];
  renderPaymentsTable(elements.paymentRows, payments);
  setVisible(elements.paymentsTable, false);
  replaceChildren(elements.paymentMessages, []);
  elements.downloadCsv.disabled = true;
  elements.downloadXml.disabled = true;
}

// --- CSV layouts ----------------------------------------------------------

/**
 * Load the layouts: what this browser has saved, else what this installation
 * ships, else the built-in defaults.
 * @returns {Promise<{ config: TemplateConfig, source: keyof typeof SOURCE_LABELS }>}
 */
async function loadTemplateConfig() {
  const stored = loadTemplates();
  if (stored !== null) return { config: stored, source: 'browser' };

  /** @type {Array<[string, keyof typeof SOURCE_LABELS]>} */
  const candidates = [
    ['./config/export-templates.json', 'deployment'],
    ['./config/export-templates.default.json', 'default'],
  ];

  for (const [url, source] of candidates) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      return { config: validateTemplateConfig(await response.json()), source };
    } catch {
      // A deployment override is optional; a broken one falls through to the
      // defaults rather than taking the app down.
    }
  }

  throw new Error('Nessuna configurazione dei tracciati CSV disponibile.');
}

/** @param {string} [preferredId] */
function fillTemplateSelect(preferredId) {
  if (templates === null) return;
  replaceChildren(
    elements.csvTemplate,
    templates.templates.map((template) =>
      h('option', { value: template.id, textContent: template.label }),
    ),
  );
  if (preferredId && templates.templates.some((template) => template.id === preferredId)) {
    elements.csvTemplate.value = preferredId;
  }
  describeSelectedTemplate();
}

function describeSelectedTemplate() {
  if (templates === null) return;
  const template = templateById(templates, elements.csvTemplate.value);
  const columns = template ? `${template.columns.length} colonne` : '';
  elements.csvTemplateDescription.textContent = [template?.description, columns]
    .filter(Boolean)
    .join(' · ');
}

/**
 * @param {string} [preferredId]
 */
async function refreshTemplates(preferredId) {
  try {
    const { config, source } = await loadTemplateConfig();
    templates = config;
    fillTemplateSelect(preferredId ?? elements.csvTemplate.value);
    elements.csvTemplateEditor.value = formatConfigJson(config);
    setStatus(elements.templatesMessage, SOURCE_LABELS[source]);
  } catch (error) {
    templates = null;
    setStatus(
      elements.templatesMessage,
      error instanceof Error ? error.message : 'Tracciati CSV non disponibili.',
      'error',
    );
  }
}

elements.csvTemplate.addEventListener('change', describeSelectedTemplate);

elements.saveTemplates.addEventListener('click', () => {
  try {
    const config = validateTemplateConfig(JSON.parse(elements.csvTemplateEditor.value));
    const stored = saveTemplates(config);
    templates = config;
    fillTemplateSelect(elements.csvTemplate.value);
    setStatus(
      elements.templatesMessage,
      stored ? 'Tracciati salvati in questo browser.' : 'Tracciati validi ma non salvabili.',
      stored ? 'ok' : 'error',
    );
  } catch (error) {
    setStatus(
      elements.templatesMessage,
      error instanceof Error ? error.message : 'JSON non valido.',
      'error',
    );
  }
});

elements.loadTemplatesFile.addEventListener('click', () => elements.templatesFile.click());

elements.templatesFile.addEventListener('change', async () => {
  const file = elements.templatesFile.files?.[0];
  elements.templatesFile.value = '';
  if (!file) return;
  try {
    const config = validateTemplateConfig(JSON.parse(await file.text()));
    elements.csvTemplateEditor.value = formatConfigJson(config);
    setStatus(elements.templatesMessage, `${file.name} caricato: premi Salva per usarlo sempre.`);
  } catch (error) {
    setStatus(elements.templatesMessage, error instanceof Error ? error.message : 'JSON non valido.', 'error');
  }
});

elements.exportTemplates.addEventListener('click', () => {
  if (templates === null) return;
  downloadText(formatConfigJson(templates), 'export-templates.json', 'application/json;charset=utf-8');
});

elements.resetTemplates.addEventListener('click', async () => {
  forgetTemplates();
  await refreshTemplates();
  setStatus(elements.templatesMessage, 'Tracciati personalizzati cancellati.', 'ok');
});

// --- XML profile and ordering party --------------------------------------

function fillProfileSelect() {
  replaceChildren(
    elements.xmlProfile,
    PAYMENT_XML_PROFILES.map((profile) =>
      h('option', { value: profile.id, textContent: profile.label }),
    ),
  );
}

function describeSelectedProfile() {
  const profile = profileById(
    /** @type {import('../core/payment-xml.js').PaymentXmlProfileId} */ (elements.xmlProfile.value),
  );
  elements.xmlProfileHint.textContent = profile.cbi
    ? 'Compila CUC e/o ABI se la tua banca li richiede. Valida il file col portale prima di usarlo in produzione.'
    : 'Valida il file col portale della banca prima di usarlo in produzione.';
}

elements.xmlProfile.addEventListener('change', describeSelectedProfile);

/** @returns {import('./storage.js').Settings} */
function readForm() {
  return {
    debtorName: elements.debtorName.value.trim(),
    debtorIban: elements.debtorIban.value.trim(),
    debtorBic: elements.debtorBic.value.trim(),
    debtorAbi: elements.debtorAbi.value.trim(),
    debtorCuc: elements.debtorCuc.value.trim(),
    remittanceTemplate: elements.remittanceTemplate.value.trim() || 'Stipendio {period}',
    csvTemplateId: elements.csvTemplate.value,
    xmlProfileId: /** @type {import('../core/payment-xml.js').PaymentXmlProfileId} */ (
      elements.xmlProfile.value
    ),
  };
}

/** @param {import('./storage.js').Settings} settings */
function writeForm(settings) {
  elements.debtorName.value = settings.debtorName;
  elements.debtorIban.value = settings.debtorIban;
  elements.debtorBic.value = settings.debtorBic;
  elements.debtorAbi.value = settings.debtorAbi;
  elements.debtorCuc.value = settings.debtorCuc;
  elements.remittanceTemplate.value = settings.remittanceTemplate;
  elements.xmlProfile.value = settings.xmlProfileId;
  describeSelectedProfile();
}

/**
 * A reference the bank will accept and a human can still recognise.
 * @returns {string}
 */
function defaultMessageId() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  return `SLIPCUT-${stamp}`;
}

/** Salaries are paid on a future value date, so tomorrow is the useful default. */
function defaultExecutionDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, '0'),
    String(tomorrow.getDate()).padStart(2, '0'),
  ].join('-');
}

elements.saveSettings.addEventListener('click', () => {
  const stored = saveSettings(readForm());
  setStatus(
    elements.settingsMessage,
    stored ? 'Impostazioni salvate in questo browser.' : 'Impossibile salvare le impostazioni.',
    stored ? 'ok' : 'error',
  );
});

elements.clearSettings.addEventListener('click', () => {
  forgetSettings();
  setStatus(elements.settingsMessage, 'Impostazioni cancellate dal browser.', 'ok');
});

// --- tabs -----------------------------------------------------------------

/** @param {'csv' | 'xml'} which */
function selectTab(which) {
  const csv = which === 'csv';
  elements.tabCsv.setAttribute('aria-selected', String(csv));
  elements.tabXml.setAttribute('aria-selected', String(!csv));
  setVisible(elements.panelCsv, csv);
  setVisible(elements.panelXml, !csv);
}

elements.tabCsv.addEventListener('click', () => selectTab('csv'));
elements.tabXml.addEventListener('click', () => selectTab('xml'));

// --- preparing and downloading -------------------------------------------

elements.buildPayments.addEventListener('click', () => {
  if (pages.length === 0) {
    setStatus(elements.settingsMessage, 'Elabora prima un PDF.', 'error');
    return;
  }

  const result = buildPaymentRows({
    pages,
    mappings: currentAddressBook(),
    remittanceTemplate: elements.remittanceTemplate.value,
  });

  payments = result.payments;
  renderPaymentsTable(elements.paymentRows, payments);
  renderPaymentMessages(elements.paymentMessages, result);
  setVisible(elements.paymentsTable, payments.length > 0);
  elements.downloadCsv.disabled = payments.length === 0;
  elements.downloadXml.disabled = payments.length === 0;
});

elements.downloadCsv.addEventListener('click', () => {
  if (templates === null || payments.length === 0) return;
  const template = templateById(templates, elements.csvTemplate.value);
  if (template === null) return;
  downloadText(
    renderPaymentsCsv(payments, template),
    `pagamenti-${template.id}.csv`,
    'text/csv;charset=utf-8',
  );
});

elements.downloadXml.addEventListener('click', () => {
  if (payments.length === 0) return;
  const profileId = /** @type {import('../core/payment-xml.js').PaymentXmlProfileId} */ (
    elements.xmlProfile.value
  );
  const settings = readForm();

  try {
    const xml = generatePaymentXml(
      {
        debtorName: settings.debtorName,
        debtorIban: settings.debtorIban,
        debtorBic: settings.debtorBic,
        debtorAbi: settings.debtorAbi,
        debtorCuc: settings.debtorCuc,
        messageId: elements.messageId.value.trim() || defaultMessageId(),
        paymentInfoId: elements.paymentInfoId.value.trim() || `${defaultMessageId()}-PMT`,
        requestedExecutionDate: elements.executionDate.value,
        profileId,
      },
      payments,
    );
    downloadText(xml, profileById(profileId).fileName, 'application/xml;charset=utf-8');
    setStatus(elements.settingsMessage, 'File XML generato.', 'ok');
  } catch (error) {
    // The generator refuses rather than emitting a file a bank would reject.
    selectTab('xml');
    setStatus(
      elements.settingsMessage,
      error instanceof Error ? error.message : 'Impossibile generare il file XML.',
      'error',
    );
  }
});

// Payments describe a specific address book; if it changes they are stale.
whenAddressBookChanges(() => {
  if (payments.length > 0) clearPayments();
});

// --- start ----------------------------------------------------------------

fillProfileSelect();
const saved = loadSettings();
writeForm(saved ?? emptySettings());
elements.messageId.value = defaultMessageId();
elements.paymentInfoId.value = `${elements.messageId.value}-PMT`;
elements.executionDate.value = defaultExecutionDate();
selectTab('csv');
clearPayments();
await refreshTemplates(saved?.csvTemplateId);
