// @ts-check
/**
 * SEPA credit transfer initiation, ISO 20022 `pain.001`.
 *
 * Three profiles: the widely accepted version 3, version 9, and a CBI-flavoured
 * version 9 for Italian bank portals that ask for it.
 *
 * Two things here are not cosmetic. Element order is fixed by the schema, so the
 * builders below follow the sequence of the message definition rather than a
 * convenient one. And text is constrained: names, references and identifiers
 * have maximum lengths and a restricted character set, and a bank rejects the
 * whole file over one stray character — so text is folded and truncated on the
 * way in rather than being passed through.
 *
 * Generated files should still be validated against the target bank's schema
 * before production use; portals apply rules beyond the published XSD.
 */

import { isValidIban, normaliseIban } from './iban.js';
import { formatDecimalDot, sumCents } from './money.js';
import { el, leaf, serialiseXml } from './xml.js';

/** @typedef {import('./payment-rows.js').PaymentRow} PaymentRow */
/** @typedef {import('./money.js').Cents} Cents */

/** @typedef {'pain001-v3' | 'pain001-v9' | 'cbi-pain001-v9'} PaymentXmlProfileId */

/**
 * @typedef {object} PaymentXmlProfile
 * @property {PaymentXmlProfileId} id
 * @property {string} label
 * @property {string} fileName
 * @property {string} namespace
 * @property {'BIC' | 'BICFI'} bicElement renamed between the two versions
 * @property {boolean} structuredExecutionDate version 9 wraps the date in `<Dt>`
 * @property {boolean} cbi adds the CBI local instrument and client code
 */

/** @type {PaymentXmlProfile[]} */
export const PAYMENT_XML_PROFILES = [
  {
    id: 'pain001-v3',
    label: 'PAIN.001 generico (v3)',
    fileName: 'pain001-v3.xml',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03',
    bicElement: 'BIC',
    structuredExecutionDate: false,
    cbi: false,
  },
  {
    id: 'pain001-v9',
    label: 'PAIN.001 generico (v9)',
    fileName: 'pain001-v9.xml',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
    bicElement: 'BICFI',
    structuredExecutionDate: true,
    cbi: false,
  },
  {
    id: 'cbi-pain001-v9',
    label: 'CBI Italia (v9)',
    fileName: 'cbi-pain001-v9.xml',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
    bicElement: 'BICFI',
    structuredExecutionDate: true,
    cbi: true,
  },
];

/**
 * @param {PaymentXmlProfileId | undefined} id
 * @returns {PaymentXmlProfile}
 */
export function profileById(id) {
  return PAYMENT_XML_PROFILES.find((profile) => profile.id === id) ?? PAYMENT_XML_PROFILES[0];
}

/** Lengths the schema imposes. */
const MAX_ID = 35;
const MAX_NAME = 70;
const MAX_REMITTANCE = 140;
const MAX_ADDRESS = 2048;

/** Characters SEPA messages allow outside of quoted content. */
const DISALLOWED = /[^A-Za-z0-9/\-?:().,'+ ]/g;

/**
 * Fold text to what the schema accepts, and truncate it.
 *
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitiseText(value, maxLength) {
  return String(value ?? '')
    .normalize('NFD')
    // Combining marks left behind by the decomposition.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(DISALLOWED, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * As `sanitiseText`, but for identifiers, which additionally may not be empty.
 * @param {string} value
 * @param {string} fallback used when nothing usable survives
 * @returns {string}
 */
function sanitiseId(value, fallback) {
  const cleaned = sanitiseText(value, MAX_ID).replace(/\s+/g, '-');
  return cleaned || fallback;
}

/**
 * @typedef {object} DebtorConfig
 * @property {string} debtorName the ordering party
 * @property {string} debtorIban the account to debit
 * @property {string} [debtorBic]
 * @property {string} [debtorAbi] Italian bank code, when the bank asks for it
 * @property {string} [debtorCuc] CBI client code, when the bank asks for it
 * @property {string} messageId
 * @property {string} paymentInfoId
 * @property {string} requestedExecutionDate `YYYY-MM-DD`
 * @property {PaymentXmlProfileId} [profileId]
 * @property {Date} [createdAt] defaults to now; injectable so output is testable
 */

/**
 * Check the inputs a bank file cannot be built without.
 * @param {DebtorConfig} config
 * @param {PaymentRow[]} payments
 */
function assertUsable(config, payments) {
  if (!config.debtorName?.trim()) throw new Error('Manca il nome dell’ordinante');
  if (!config.debtorIban?.trim()) throw new Error('Manca l’IBAN dell’ordinante');
  if (!isValidIban(config.debtorIban)) throw new Error('IBAN dell’ordinante non valido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.requestedExecutionDate ?? '')) {
    throw new Error('Data di esecuzione mancante o non valida (formato AAAA-MM-GG)');
  }
  if (payments.length === 0) throw new Error('Nessun pagamento da esportare');
}

/**
 * `<Othr>` with a proprietary scheme name, the ISO 20022 way of carrying a
 * national identifier.
 * @param {string} id
 * @param {string} schemeName
 */
function otherId(id, schemeName) {
  return el('Othr', [leaf('Id', sanitiseText(id, MAX_ID)), el('SchmeNm', [leaf('Prtry', schemeName)])]);
}

/**
 * The party identifier for a creditor: a person is identified privately, a
 * company as an organisation.
 * @param {PaymentRow} payment
 */
function creditorId(payment) {
  const identifier = otherId(payment.codiceFiscale, 'CODICE_FISCALE');
  return el('Id', [
    payment.recipientType === 'BUSINESS' ? el('OrgId', [identifier]) : el('PrvtId', [identifier]),
  ]);
}

/**
 * The ordering party's organisation identifier, when the bank requires one.
 * @param {DebtorConfig} config
 * @returns {import('./xml.js').XmlElement | null}
 */
function debtorOrganisationId(config) {
  const cuc = config.debtorCuc?.trim();
  const abi = config.debtorAbi?.trim();
  if (!cuc && !abi) return null;
  return el('Id', [el('OrgId', [cuc ? otherId(cuc, 'CBI') : otherId(String(abi), 'ABI')])]);
}

/**
 * The debtor's bank. `NOTPROVIDED` is the accepted way of saying "derive it from
 * the IBAN", which SEPA banks do.
 * @param {DebtorConfig} config
 * @param {PaymentXmlProfile} profile
 */
function debtorAgent(config, profile) {
  const bic = config.debtorBic?.trim().toUpperCase();
  const abi = config.debtorAbi?.trim();
  const identification = bic
    ? leaf(profile.bicElement, bic)
    : abi
      ? otherId(abi, 'ABI')
      : el('Othr', [leaf('Id', 'NOTPROVIDED')]);
  return el('DbtrAgt', [el('FinInstnId', [identification])]);
}

/**
 * The payment advice address, whose shape differs between the two versions.
 * @param {PaymentRow} payment
 * @param {PaymentXmlProfile} profile
 * @returns {import('./xml.js').XmlElement | null}
 */
function relatedRemittance(payment, profile) {
  if (!payment.email) return null;
  // Not run through `sanitiseText`: the SEPA character set excludes `@`, while
  // the electronic address field is a free-text field that needs it.
  const address = payment.email.trim().slice(0, MAX_ADDRESS);
  return profile.structuredExecutionDate
    ? el('RltdRmtInf', [el('RmtLctnDtls', [leaf('Mtd', 'EMAL'), leaf('ElctrncAdr', address)])])
    : el('RltdRmtInf', [leaf('RmtLctnMtd', 'EMAL'), leaf('RmtLctnElctrncAdr', address)]);
}

/**
 * One credit transfer.
 * @param {PaymentRow} payment
 * @param {number} index
 * @param {string} messageId
 * @param {PaymentXmlProfile} profile
 */
function creditTransfer(payment, index, messageId, profile) {
  return el('CdtTrfTxInf', [
    el('PmtId', [leaf('EndToEndId', sanitiseId(`${messageId}-${index + 1}`, `TX-${index + 1}`))]),
    el('Amt', [leaf('InstdAmt', formatDecimalDot(payment.amount), { Ccy: 'EUR' })]),
    el('Cdtr', [leaf('Nm', sanitiseText(payment.beneficiaryName, MAX_NAME)), creditorId(payment)]),
    el('CdtrAcct', [el('Id', [leaf('IBAN', normaliseIban(payment.iban))])]),
    relatedRemittance(payment, profile),
    el('RmtInf', [leaf('Ustrd', sanitiseText(payment.remittanceInformation, MAX_REMITTANCE))]),
  ]);
}

/**
 * Build the payment file.
 *
 * @param {DebtorConfig} config
 * @param {PaymentRow[]} payments
 * @returns {string}
 * @throws {Error} when a required input is missing or invalid
 */
export function generatePaymentXml(config, payments) {
  assertUsable(config, payments);

  const profile = profileById(config.profileId);
  const messageId = sanitiseId(config.messageId, 'SLIPCUT');
  const controlSum = formatDecimalDot(sumCents(payments.map((payment) => payment.amount)));
  const createdAt = config.createdAt ?? new Date();
  const debtorName = sanitiseText(config.debtorName, MAX_NAME);
  const organisationId = profile.cbi ? debtorOrganisationId(config) : null;

  const document = el(
    'Document',
    [
      el('CstmrCdtTrfInitn', [
        el('GrpHdr', [
          leaf('MsgId', messageId),
          // Seconds precision, no fractional part: some portals reject it.
          leaf('CreDtTm', `${createdAt.toISOString().slice(0, 19)}Z`),
          leaf('NbOfTxs', payments.length),
          leaf('CtrlSum', controlSum),
          el('InitgPty', [leaf('Nm', debtorName), organisationId]),
        ]),
        el('PmtInf', [
          leaf('PmtInfId', sanitiseId(config.paymentInfoId, `${messageId}-PMT`)),
          leaf('PmtMtd', 'TRF'),
          leaf('BtchBookg', 'true'),
          leaf('NbOfTxs', payments.length),
          leaf('CtrlSum', controlSum),
          el('PmtTpInf', [
            el('SvcLvl', [leaf('Cd', 'SEPA')]),
            profile.cbi ? el('LclInstrm', [leaf('Prtry', 'CBI')]) : null,
            // Salary: banks book these differently and some require the code.
            el('CtgyPurp', [leaf('Cd', 'SALA')]),
          ]),
          profile.structuredExecutionDate
            ? el('ReqdExctnDt', [leaf('Dt', config.requestedExecutionDate)])
            : leaf('ReqdExctnDt', config.requestedExecutionDate),
          el('Dbtr', [leaf('Nm', debtorName), organisationId]),
          el('DbtrAcct', [el('Id', [leaf('IBAN', normaliseIban(config.debtorIban))])]),
          debtorAgent(config, profile),
          leaf('ChrgBr', 'SLEV'),
          ...payments.map((payment, index) => creditTransfer(payment, index, messageId, profile)),
        ]),
      ]),
    ],
    { xmlns: profile.namespace },
  );

  return serialiseXml(document);
}
