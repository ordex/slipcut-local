// @ts-check
import { assert, test } from './harness.js';
import { parseIbanMappingCsv } from '../src/core/iban-mapping.js';
import { addressBookSummary } from '../src/ui/views/address-book.js';

const IBAN = 'IT60X0542811101000000123456';
const BAD_IBAN = 'IT61X0542811101000000123456';

test('the summary counts beneficiaries that are ready to pay', () => {
  const mappings = parseIbanMappingCsv(
    `cf,iban\nFRMFRC91P22D086S,${IBAN}\nRSSMRA80A01H501U,`,
  );
  assert.equal(
    addressBookSummary(mappings, ['FRMFRC91P22D086S', 'RSSMRA80A01H501U']),
    '1/2 beneficiari con IBAN pronto',
  );
});

test('the summary reports invalid IBANs separately', () => {
  const mappings = parseIbanMappingCsv(`cf,iban\nFRMFRC91P22D086S,${BAD_IBAN}`);
  const summary = addressBookSummary(mappings, ['FRMFRC91P22D086S']);
  assert.ok(summary.includes('0/1'), summary);
  assert.ok(summary.includes('1 IBAN non validi'), summary);
});

test('the summary counts rows when no payslips have been read yet', () => {
  const mappings = parseIbanMappingCsv(`cf,iban\nFRMFRC91P22D086S,${IBAN}`);
  assert.equal(addressBookSummary(mappings, []), '1 righe in rubrica');
});

test('the summary ignores rows for people not on the payslips', () => {
  const mappings = parseIbanMappingCsv(
    `cf,iban\nFRMFRC91P22D086S,${IBAN}\nCNGVCN87D10C352W,${IBAN}`,
  );
  assert.equal(addressBookSummary(mappings, ['FRMFRC91P22D086S']), '1/1 beneficiari con IBAN pronto');
});

test('an empty book with nothing to pay says so', () => {
  assert.equal(addressBookSummary([], []), 'Nessuna rubrica caricata.');
});

test('a missing person counts as not ready', () => {
  assert.equal(addressBookSummary([], ['FRMFRC91P22D086S']), '0/1 beneficiari con IBAN pronto');
});
