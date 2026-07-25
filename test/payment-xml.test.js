// @ts-check
import { assert, test } from './harness.js';
import {
  generatePaymentXml,
  PAYMENT_XML_PROFILES,
  profileById,
  sanitiseText,
} from '../src/core/payment-xml.js';

const IBAN = 'IT60X0542811101000000123456';
const DEBTOR_IBAN = 'DE89370400440532013000';

/** @type {import('../src/core/payment-rows.js').PaymentRow[]} */
const PAYMENTS = [
  {
    codiceFiscale: 'FRMFRC91P22D086S',
    beneficiaryName: 'FORMICA FEDERICO',
    recipientType: 'INDIVIDUAL',
    email: 'federico@example.com',
    iban: IBAN,
    amount: 205600,
    period: '202606',
    remittanceInformation: 'Stipendio 202606',
    sourcePage: 1,
  },
  {
    codiceFiscale: 'RSSMRA80A01H501U',
    beneficiaryName: 'ROSSI MARIO',
    recipientType: 'BUSINESS',
    email: '',
    iban: DEBTOR_IBAN,
    amount: 185100,
    period: '202606',
    remittanceInformation: 'Stipendio 202606',
    sourcePage: 2,
  },
];

/** @type {import('../src/core/payment-xml.js').DebtorConfig} */
const CONFIG = {
  debtorName: 'Red Yard Research SRL',
  debtorIban: DEBTOR_IBAN,
  messageId: 'SLIPCUT-20260630120000',
  paymentInfoId: 'SLIPCUT-20260630120000-PMT',
  requestedExecutionDate: '2026-07-01',
  createdAt: new Date('2026-06-30T12:00:00.000Z'),
};

/**
 * Collapse the whitespace between tags, so structural assertions do not depend
 * on how the writer indents.
 * @param {string} xml
 * @returns {string}
 */
function compact(xml) {
  return xml.replace(/>\s+</g, '><');
}

/**
 * Element names in document order, so tests can assert schema sequence.
 * @param {string} xml
 * @returns {string[]}
 */
function tagsInOrder(xml) {
  return [...xml.matchAll(/<([A-Za-z][A-Za-z0-9]*)[ />]/g)].map((match) => match[1]);
}

/**
 * @param {string} xml
 * @param {string} tag
 * @returns {string[]}
 */
function textOf(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map(
    (match) => match[1],
  );
}

test('every profile generates a document', () => {
  for (const profile of PAYMENT_XML_PROFILES) {
    const xml = generatePaymentXml({ ...CONFIG, profileId: profile.id }, PAYMENTS);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), profile.id);
    assert.ok(xml.includes(`xmlns="${profile.namespace}"`), profile.id);
    assert.ok(xml.includes('<CstmrCdtTrfInitn>'), profile.id);
  }
});

test('the control sum equals the sum of the transactions', () => {
  const xml = generatePaymentXml(CONFIG, PAYMENTS);
  const controlSums = textOf(xml, 'CtrlSum');
  assert.deepEqual(controlSums, ['3907.00', '3907.00'], 'group header and payment information');
  const amounts = textOf(xml, 'InstdAmt');
  assert.deepEqual(amounts, ['2056.00', '1851.00']);
  const total = amounts.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0);
  assert.equal(total, 390700);
});

test('the transaction count is stated twice and agrees', () => {
  const xml = generatePaymentXml(CONFIG, PAYMENTS);
  assert.deepEqual(textOf(xml, 'NbOfTxs'), ['2', '2']);
});

test('a person is identified privately and a company as an organisation', () => {
  const xml = generatePaymentXml(CONFIG, PAYMENTS);
  assert.ok(xml.includes('<PrvtId>'), 'the employee');
  assert.ok(xml.includes('<OrgId>'), 'the contractor');
  assert.deepEqual(textOf(xml, 'Prtry'), ['CODICE_FISCALE', 'CODICE_FISCALE']);
  assert.ok(xml.includes('<Id>FRMFRC91P22D086S</Id>'));
});

test('the payment is marked as salary', () => {
  const xml = generatePaymentXml(CONFIG, PAYMENTS);
  assert.ok(compact(xml).includes('<CtgyPurp><Cd>SALA</Cd></CtgyPurp>'), 'salary category');
});

test('version 3 writes a bare execution date and BIC', () => {
  const xml = generatePaymentXml({ ...CONFIG, profileId: 'pain001-v3', debtorBic: 'unctitmm' }, PAYMENTS);
  assert.ok(xml.includes('<ReqdExctnDt>2026-07-01</ReqdExctnDt>'));
  assert.ok(xml.includes('<BIC>UNCTITMM</BIC>'), 'upper-cased');
  assert.equal(xml.includes('<BICFI>'), false);
});

test('version 9 wraps the date and renames the BIC element', () => {
  const xml = generatePaymentXml({ ...CONFIG, profileId: 'pain001-v9', debtorBic: 'UNCRITMM' }, PAYMENTS);
  assert.ok(compact(xml).includes('<ReqdExctnDt><Dt>2026-07-01</Dt></ReqdExctnDt>'), 'structured date');
  assert.ok(xml.includes('<BICFI>UNCRITMM</BICFI>'));
});

test('without a BIC the bank is left to the IBAN', () => {
  const xml = generatePaymentXml(CONFIG, PAYMENTS);
  assert.ok(xml.includes('<Id>NOTPROVIDED</Id>'));
});

test('an ABI is used when there is no BIC', () => {
  const xml = generatePaymentXml({ ...CONFIG, debtorAbi: '03069' }, PAYMENTS);
  assert.ok(xml.includes('<Id>03069</Id>'));
  assert.ok(xml.includes('<Prtry>ABI</Prtry>'));
});

test('the CBI profile adds the local instrument', () => {
  const xml = generatePaymentXml({ ...CONFIG, profileId: 'cbi-pain001-v9' }, PAYMENTS);
  assert.ok(compact(xml).includes('<LclInstrm><Prtry>CBI</Prtry></LclInstrm>'), 'CBI local instrument');
});

test('the CBI client code is attached to both parties', () => {
  const xml = generatePaymentXml({ ...CONFIG, profileId: 'cbi-pain001-v9', debtorCuc: 'ABC1234567' }, PAYMENTS);
  assert.equal(textOf(xml, 'Id').filter((id) => id === 'ABC1234567').length, 2);
  assert.ok(xml.includes('<Prtry>CBI</Prtry>'));
});

test('the CBI code is not emitted by the generic profiles', () => {
  const xml = generatePaymentXml({ ...CONFIG, profileId: 'pain001-v9', debtorCuc: 'ABC1234567' }, PAYMENTS);
  assert.equal(xml.includes('ABC1234567'), false);
});

test('elements follow the schema sequence', () => {
  const xml = generatePaymentXml(CONFIG, PAYMENTS);
  const tags = tagsInOrder(xml);
  /** @param {string} tag */
  const at = (tag) => tags.indexOf(tag);
  assert.ok(at('MsgId') < at('CreDtTm'), 'MsgId before CreDtTm');
  assert.ok(at('CreDtTm') < at('NbOfTxs'), 'CreDtTm before NbOfTxs');
  assert.ok(at('NbOfTxs') < at('CtrlSum'), 'NbOfTxs before CtrlSum');
  assert.ok(at('CtrlSum') < at('InitgPty'), 'CtrlSum before InitgPty');
  assert.ok(at('PmtInfId') < at('PmtMtd'), 'PmtInfId before PmtMtd');
  assert.ok(at('PmtTpInf') < at('ReqdExctnDt'), 'PmtTpInf before ReqdExctnDt');
  assert.ok(at('ReqdExctnDt') < at('Dbtr'), 'ReqdExctnDt before Dbtr');
  assert.ok(at('DbtrAcct') < at('DbtrAgt'), 'DbtrAcct before DbtrAgt');
  assert.ok(at('DbtrAgt') < at('ChrgBr'), 'DbtrAgt before ChrgBr');
  assert.ok(at('ChrgBr') < at('CdtTrfTxInf'), 'ChrgBr before the transactions');
  assert.ok(at('SvcLvl') < at('CtgyPurp'), 'SvcLvl before CtgyPurp');
  assert.ok(at('Cdtr') < at('CdtrAcct'), 'Cdtr before CdtrAcct');
  assert.ok(at('RltdRmtInf') < at('RmtInf'), 'RltdRmtInf before RmtInf');
});

test('the advice address is written per version', () => {
  const v3 = generatePaymentXml({ ...CONFIG, profileId: 'pain001-v3' }, PAYMENTS);
  assert.ok(v3.includes('<RmtLctnMtd>EMAL</RmtLctnMtd>'));
  assert.ok(v3.includes('<RmtLctnElctrncAdr>federico@example.com</RmtLctnElctrncAdr>'));

  const v9 = generatePaymentXml({ ...CONFIG, profileId: 'pain001-v9' }, PAYMENTS);
  assert.ok(v9.includes('<Mtd>EMAL</Mtd>'));
  assert.ok(v9.includes('<ElctrncAdr>federico@example.com</ElctrncAdr>'));
});

test('no advice block without an address', () => {
  const withoutEmail = [{ ...PAYMENTS[0], email: '' }];
  const xml = generatePaymentXml(CONFIG, withoutEmail);
  assert.equal(xml.includes('RltdRmtInf'), false);
});

test('end-to-end references are unique', () => {
  const xml = generatePaymentXml(CONFIG, PAYMENTS);
  const references = textOf(xml, 'EndToEndId');
  assert.equal(references.length, 2);
  assert.equal(new Set(references).size, 2);
  assert.ok(references.every((reference) => reference.length <= 35));
});

test('sanitiseText folds accents and drops disallowed characters', () => {
  assert.equal(sanitiseText('Società Nicolò & Figli', 70), 'Societa Nicolo Figli');
  assert.equal(sanitiseText('a\tb\nc', 70), 'a b c');
  assert.equal(sanitiseText('Röck Döts', 70), 'Rock Dots');
  assert.equal(sanitiseText('ok/fine-(1):2,3.4+5?', 70), 'ok/fine-(1):2,3.4+5?');
});

test('long text is truncated to the schema limits', () => {
  const xml = generatePaymentXml(
    { ...CONFIG, debtorName: 'A'.repeat(200) },
    [{ ...PAYMENTS[0], beneficiaryName: 'B'.repeat(200), remittanceInformation: 'C'.repeat(300) }],
  );
  assert.equal(textOf(xml, 'Nm')[0].length, 70, 'debtor name');
  assert.equal(textOf(xml, 'Ustrd')[0].length, 140, 'remittance');
  assert.ok(textOf(xml, 'MsgId')[0].length <= 35);
});

test('markup in a name cannot break the document', () => {
  const xml = generatePaymentXml(CONFIG, [
    { ...PAYMENTS[0], beneficiaryName: 'Rossi <b>&</b> Figli', remittanceInformation: 'a & b' },
  ]);
  assert.equal(xml.includes('<b>'), false, 'stripped by the character set');
  assert.ok(xml.includes('<Ustrd>a b</Ustrd>'), 'ampersand is not an allowed character');
});

test('the creation timestamp has no fractional seconds', () => {
  const xml = generatePaymentXml(CONFIG, PAYMENTS);
  assert.deepEqual(textOf(xml, 'CreDtTm'), ['2026-06-30T12:00:00Z']);
});

test('generatePaymentXml refuses to build an unusable file', () => {
  assert.throws(() => generatePaymentXml({ ...CONFIG, debtorName: '' }, PAYMENTS), /nome/);
  assert.throws(() => generatePaymentXml({ ...CONFIG, debtorIban: '' }, PAYMENTS), /IBAN/);
  assert.throws(() => generatePaymentXml({ ...CONFIG, debtorIban: 'IT99X' }, PAYMENTS), /non valido/);
  assert.throws(() => generatePaymentXml({ ...CONFIG, requestedExecutionDate: '01/07/2026' }, PAYMENTS), /Data/);
  assert.throws(() => generatePaymentXml(CONFIG, []), /Nessun pagamento/);
});

test('profileById falls back to the first profile', () => {
  assert.equal(profileById('pain001-v9').id, 'pain001-v9');
  assert.equal(profileById(undefined).id, 'pain001-v3');
  assert.equal(
    profileById(/** @type {import('../src/core/payment-xml.js').PaymentXmlProfileId} */ ('nope')).id,
    'pain001-v3',
  );
});

test('IBANs are written without their printed spacing', () => {
  const xml = generatePaymentXml({ ...CONFIG, debtorIban: 'DE89 3704 0044 0532 0130 00' }, [
    { ...PAYMENTS[0], iban: 'IT60 X054 2811 1010 0000 0123 456' },
  ]);
  assert.deepEqual(textOf(xml, 'IBAN'), ['DE89370400440532013000', IBAN]);
});
