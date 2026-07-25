// @ts-check
/**
 * What the browser remembers between visits, and nothing more.
 *
 * Three things are stored, all in `localStorage`, all only when the user asks:
 * the ordering party's details, the IBAN address book, and any custom CSV
 * layouts. Nothing is sent anywhere and nothing is stored automatically.
 *
 * Everything read back is *decoded* rather than trusted. Stored data is input
 * like any other: it survives across versions, users edit it, and another tab
 * can have written nonsense. A wrong shape is discarded, not passed on.
 */

import { validateTemplateConfig } from '../core/export-templates.js';
import { parseIbanMappingCsv, formatIbanMappingCsv } from '../core/iban-mapping.js';
import { PAYMENT_XML_PROFILES } from '../core/payment-xml.js';

const KEYS = {
  settings: 'slipcut.settings.v1',
  addressBook: 'slipcut.address-book.v1',
  templates: 'slipcut.csv-templates.v1',
};

/**
 * @typedef {object} Settings
 * @property {string} debtorName
 * @property {string} debtorIban
 * @property {string} debtorBic
 * @property {string} debtorAbi
 * @property {string} debtorCuc
 * @property {string} remittanceTemplate
 * @property {string} csvTemplateId
 * @property {import('../core/payment-xml.js').PaymentXmlProfileId} xmlProfileId
 */

/** @returns {Settings} */
export function emptySettings() {
  return {
    debtorName: '',
    debtorIban: '',
    debtorBic: '',
    debtorAbi: '',
    debtorCuc: '',
    remittanceTemplate: 'Stipendio {period}',
    csvTemplateId: '',
    xmlProfileId: 'pain001-v3',
  };
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Decode stored settings, keeping only fields of the right type.
 *
 * Exported separately from the storage access so it can be tested without a
 * browser.
 *
 * @param {string | null} raw
 * @returns {Settings | null} null when there is nothing usable
 */
export function decodeSettings(raw) {
  if (raw === null || raw === '') return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const source = /** @type {Record<string, unknown>} */ (parsed);
  const defaults = emptySettings();
  const profileId = asString(source.xmlProfileId);

  return {
    debtorName: asString(source.debtorName),
    debtorIban: asString(source.debtorIban),
    debtorBic: asString(source.debtorBic),
    debtorAbi: asString(source.debtorAbi),
    debtorCuc: asString(source.debtorCuc),
    remittanceTemplate: asString(source.remittanceTemplate, defaults.remittanceTemplate),
    csvTemplateId: asString(source.csvTemplateId),
    xmlProfileId: PAYMENT_XML_PROFILES.some((profile) => profile.id === profileId)
      ? /** @type {import('../core/payment-xml.js').PaymentXmlProfileId} */ (profileId)
      : defaults.xmlProfileId,
  };
}

/**
 * Read a key, treating an unavailable store as an empty one. Private browsing
 * modes throw on access rather than returning null.
 * @param {string} key
 * @returns {string | null}
 */
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {boolean} whether it was stored
 */
function write(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} key */
function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do: the value is already unreachable.
  }
}

/** @returns {Settings | null} */
export function loadSettings() {
  return decodeSettings(read(KEYS.settings));
}

/**
 * @param {Settings} settings
 * @returns {boolean}
 */
export function saveSettings(settings) {
  return write(KEYS.settings, JSON.stringify(settings));
}

export function forgetSettings() {
  remove(KEYS.settings);
}

/**
 * The address book is stored as the same CSV the user can export, so what is
 * saved and what is downloaded cannot drift apart.
 * @returns {import('../core/iban-mapping.js').IbanMapping[]}
 */
export function loadAddressBook() {
  const raw = read(KEYS.addressBook);
  if (raw === null) return [];
  try {
    return parseIbanMappingCsv(raw);
  } catch {
    remove(KEYS.addressBook);
    return [];
  }
}

/**
 * @param {import('../core/iban-mapping.js').IbanMapping[]} mappings
 * @returns {boolean}
 */
export function saveAddressBook(mappings) {
  return write(KEYS.addressBook, formatIbanMappingCsv(mappings));
}

export function forgetAddressBook() {
  remove(KEYS.addressBook);
}

/** @returns {import('../core/export-templates.js').TemplateConfig | null} */
export function loadTemplates() {
  const raw = read(KEYS.templates);
  if (raw === null) return null;
  try {
    return validateTemplateConfig(JSON.parse(raw));
  } catch {
    // A configuration that no longer validates would break every export; drop it
    // and fall back to the shipped defaults.
    remove(KEYS.templates);
    return null;
  }
}

/**
 * @param {import('../core/export-templates.js').TemplateConfig} config
 * @returns {boolean}
 */
export function saveTemplates(config) {
  return write(KEYS.templates, JSON.stringify(validateTemplateConfig(config), null, 2));
}

export function forgetTemplates() {
  remove(KEYS.templates);
}
