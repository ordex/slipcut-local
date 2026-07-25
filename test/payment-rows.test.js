// @ts-check
import { assert, test } from './harness.js';
import { parseIbanMappingCsv } from '../src/core/iban-mapping.js';
import { buildPaymentRows, renderRemittance } from '../src/core/payment-rows.js';
import { readPayslipPage } from '../src/core/payslip.js';

const IBAN = 'IT60X0542811101000000123456';
const OTHER_IBAN = 'DE89370400440532013000';

/**
 * @param {number} pageNumber
 * @param {string} codiceFiscale
 * @param {string} name
 * @param {string} [amount]
 * @param {string} [period]
 */
function page(pageNumber, codiceFiscale, name, amount = '2.056,00', period = 'GIUGNO 2026') {
  const lines = [`COD. FISC. ${codiceFiscale}`, name, period];
  if (amount) lines.push(`NETTO ${amount}`);
  return readPayslipPage({ pageNumber, text: lines.join('\n') });
}

const FEDERICO = page(1, 'FRMFRC91P22D086S', 'FORMICA FEDERICO');
const MARIO = page(2, 'RSSMRA80A01H501U', 'ROSSI MARIO', '1.851,00');

const BOOK = parseIbanMappingCsv(
  `codice_fiscale,beneficiary_name,iban,recipient_type,email
FRMFRC91P22D086S,FORMICA FEDERICO,${IBAN},INDIVIDUAL,federico@example.com
RSSMRA80A01H501U,ROSSI MARIO,${OTHER_IBAN},BUSINESS,`,
);

test('buildPaymentRows produces one payment per payable page', () => {
  const { payments, problems, total } = buildPaymentRows({
    pages: [FEDERICO, MARIO],
    mappings: BOOK,
  });
  assert.deepEqual(problems, []);
  assert.equal(payments.length, 2);
  assert.equal(total, 205600 + 185100);
  assert.deepEqual(payments[0], {
    codiceFiscale: 'FRMFRC91P22D086S',
    beneficiaryName: 'FORMICA FEDERICO',
    recipientType: 'INDIVIDUAL',
    email: 'federico@example.com',
    iban: IBAN,
    amount: 205600,
    period: '202606',
    remittanceInformation: 'Stipendio 202606',
    sourcePage: 1,
  });
});

test('buildPaymentRows carries the recipient type through', () => {
  const { payments } = buildPaymentRows({ pages: [MARIO], mappings: BOOK });
  assert.equal(payments[0].recipientType, 'BUSINESS');
  assert.equal(payments[0].email, '');
});

test('buildPaymentRows totals exactly', () => {
  const cents = ['1.234,56', '2.345,67', '3.456,78'];
  const pages = cents.map((amount, index) => page(index + 1, 'FRMFRC91P22D086S', 'FORMICA FEDERICO', amount));
  const { total } = buildPaymentRows({ pages, mappings: BOOK });
  assert.equal(total, 123456 + 234567 + 345678);
});

test('buildPaymentRows reports a missing IBAN instead of paying', () => {
  const { payments, problems } = buildPaymentRows({ pages: [FEDERICO], mappings: [] });
  assert.deepEqual(payments, []);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'missing-iban');
  assert.equal(problems[0].pageNumber, 1);
  assert.ok(problems[0].message.includes('FORMICA FEDERICO'));
});

test('buildPaymentRows reports an invalid IBAN', () => {
  const mappings = parseIbanMappingCsv('cf,iban\nFRMFRC91P22D086S,IT61X0542811101000000123456');
  const { payments, problems } = buildPaymentRows({ pages: [FEDERICO], mappings });
  assert.deepEqual(payments, []);
  assert.equal(problems[0].kind, 'invalid-iban');
});

test('buildPaymentRows reports a missing amount', () => {
  const withoutAmount = page(4, 'FRMFRC91P22D086S', 'FORMICA FEDERICO', '');
  const { payments, problems } = buildPaymentRows({ pages: [withoutAmount], mappings: BOOK });
  assert.deepEqual(payments, []);
  assert.equal(problems[0].kind, 'missing-amount');
  assert.equal(problems[0].pageNumber, 4);
});

test('buildPaymentRows reports a missing period', () => {
  const withoutPeriod = readPayslipPage({
    pageNumber: 5,
    text: 'COD. FISC. FRMFRC91P22D086S\nFORMICA FEDERICO\nNETTO 2.056,00',
  });
  const { problems } = buildPaymentRows({ pages: [withoutPeriod], mappings: BOOK });
  assert.equal(problems[0].kind, 'missing-period');
});

test('buildPaymentRows ignores pages that are not payslips', () => {
  const cover = readPayslipPage({ pageNumber: 1, text: 'RIEPILOGO MENSILE\nTOTALE 12.345,00' });
  const { payments, problems } = buildPaymentRows({ pages: [cover], mappings: BOOK });
  assert.deepEqual(payments, []);
  assert.deepEqual(problems, [], 'a page with no code is not a complaint');
});

test('buildPaymentRows reports a duplicated mapping and uses the last', () => {
  const mappings = parseIbanMappingCsv(
    `cf,iban\nFRMFRC91P22D086S,${OTHER_IBAN}\nFRMFRC91P22D086S,${IBAN}`,
  );
  const { payments, problems } = buildPaymentRows({ pages: [FEDERICO], mappings });
  assert.equal(problems.filter((problem) => problem.kind === 'duplicate-mapping').length, 1);
  assert.equal(payments[0].iban, IBAN);
});

test('buildPaymentRows keeps paying the pages it can', () => {
  const unpayable = page(9, 'CNGVCN87D10C352W', 'CONIGLIO VINCENZO');
  const { payments, problems } = buildPaymentRows({
    pages: [FEDERICO, unpayable, MARIO],
    mappings: BOOK,
  });
  assert.equal(payments.length, 2);
  assert.equal(problems.length, 1);
});

test('buildPaymentRows falls back for the beneficiary name', () => {
  const mappings = parseIbanMappingCsv(`cf,iban\nFRMFRC91P22D086S,${IBAN}`);
  const { payments } = buildPaymentRows({ pages: [FEDERICO], mappings });
  assert.equal(payments[0].beneficiaryName, 'FORMICA FEDERICO', 'from the payslip');

  const anonymous = readPayslipPage({
    pageNumber: 1,
    text: 'COD. FISC. FRMFRC91P22D086S\nGIUGNO 2026\nNETTO 2.056,00',
  });
  const { payments: fallback } = buildPaymentRows({ pages: [anonymous], mappings });
  assert.equal(fallback[0].beneficiaryName, 'FRMFRC91P22D086S', 'last resort is the code');
});

test('renderRemittance fills the placeholders', () => {
  const values = { period: '202606', name: 'FORMICA FEDERICO', codiceFiscale: 'FRMFRC91P22D086S' };
  assert.equal(renderRemittance('Stipendio {period}', values), 'Stipendio 202606');
  assert.equal(renderRemittance('{name} - {period}', values), 'FORMICA FEDERICO - 202606');
  assert.equal(renderRemittance('CF {cf}', values), 'CF FRMFRC91P22D086S');
  assert.equal(renderRemittance('Retribuzione {period} {period}', values), 'Retribuzione 202606 202606');
});

test('renderRemittance tidies the result', () => {
  const values = { period: '202606', name: '', codiceFiscale: 'X' };
  assert.equal(renderRemittance('  Stipendio   {name} {period} ', values), 'Stipendio 202606');
});

test('buildPaymentRows uses a custom template', () => {
  const { payments } = buildPaymentRows({
    pages: [FEDERICO],
    mappings: BOOK,
    remittanceTemplate: 'Compenso {name} {period}',
  });
  assert.equal(payments[0].remittanceInformation, 'Compenso FORMICA FEDERICO 202606');
});

test('buildPaymentRows falls back to the default template', () => {
  const { payments } = buildPaymentRows({ pages: [FEDERICO], mappings: BOOK, remittanceTemplate: '  ' });
  assert.equal(payments[0].remittanceInformation, 'Stipendio 202606');
});

test('buildPaymentRows on nothing returns nothing', () => {
  assert.deepEqual(buildPaymentRows({ pages: [], mappings: [] }), {
    payments: [],
    problems: [],
    total: 0,
  });
});
