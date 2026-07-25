// @ts-check
import { assert, test } from './harness.js';
import {
  formatIbanMappingCsv,
  mappingStatus,
  mappingsFromPages,
  mergeMappings,
  normaliseRecipientType,
  parseIbanMappingCsv,
} from '../src/core/iban-mapping.js';
import { readPayslipPage } from '../src/core/payslip.js';

const IBAN = 'IT60X0542811101000000123456';

test('parseIbanMappingCsv reads the documented header', () => {
  const csv = `codice_fiscale,beneficiary_name,iban,recipient_type,email
RSSMRA80A01H501U,Mario Rossi,${IBAN},INDIVIDUAL,mario@example.com`;
  assert.deepEqual(parseIbanMappingCsv(csv), [
    {
      codiceFiscale: 'RSSMRA80A01H501U',
      beneficiaryName: 'Mario Rossi',
      iban: IBAN,
      recipientType: 'INDIVIDUAL',
      email: 'mario@example.com',
    },
  ]);
});

test('parseIbanMappingCsv accepts columns in any order under any alias', () => {
  const csv = `IBAN;Nome Beneficiario;CF
${IBAN};Mario Rossi;RSSMRA80A01H501U`;
  const [row] = parseIbanMappingCsv(csv);
  assert.equal(row.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(row.beneficiaryName, 'Mario Rossi');
  assert.equal(row.iban, IBAN);
});

test('parseIbanMappingCsv normalises what it reads', () => {
  const csv = `cf,name,iban,type
 rssmra80a01h501u , Mario Rossi ,it60 x054 2811 1010 0000 0123 456 ,azienda`;
  const [row] = parseIbanMappingCsv(csv);
  assert.equal(row.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(row.beneficiaryName, 'Mario Rossi');
  assert.equal(row.iban, IBAN);
  assert.equal(row.recipientType, 'BUSINESS');
});

test('parseIbanMappingCsv reads a file with no header in written order', () => {
  const csv = `RSSMRA80A01H501U,Mario Rossi,${IBAN},INDIVIDUAL,mario@example.com`;
  const [row] = parseIbanMappingCsv(csv);
  assert.equal(row.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(row.beneficiaryName, 'Mario Rossi');
  assert.equal(row.iban, IBAN);
});

test('parseIbanMappingCsv defaults a missing recipient type to INDIVIDUAL', () => {
  const [row] = parseIbanMappingCsv(`cf,iban\nRSSMRA80A01H501U,${IBAN}`);
  assert.equal(row.recipientType, 'INDIVIDUAL');
  assert.equal(row.email, '');
});

test('parseIbanMappingCsv drops rows with nothing in them', () => {
  const csv = `codice_fiscale,iban\nRSSMRA80A01H501U,${IBAN}\n,\n`;
  assert.equal(parseIbanMappingCsv(csv).length, 1);
  assert.deepEqual(parseIbanMappingCsv(''), []);
});

test('normaliseRecipientType recognises the business spellings', () => {
  assert.equal(normaliseRecipientType('BUSINESS'), 'BUSINESS');
  assert.equal(normaliseRecipientType('company'), 'BUSINESS');
  assert.equal(normaliseRecipientType(' Azienda '), 'BUSINESS');
  assert.equal(normaliseRecipientType('INDIVIDUAL'), 'INDIVIDUAL');
  assert.equal(normaliseRecipientType('qualcosa'), 'INDIVIDUAL');
  assert.equal(normaliseRecipientType(''), 'INDIVIDUAL');
});

test('what formatIbanMappingCsv writes, parseIbanMappingCsv reads back', () => {
  const mappings = [
    {
      codiceFiscale: 'RSSMRA80A01H501U',
      beneficiaryName: 'Rossi, Mario',
      iban: IBAN,
      recipientType: /** @type {const} */ ('BUSINESS'),
      email: 'mario@example.com',
    },
  ];
  assert.deepEqual(parseIbanMappingCsv(formatIbanMappingCsv(mappings)), mappings);
});

test('formatIbanMappingCsv writes the header even with no rows', () => {
  assert.equal(formatIbanMappingCsv([]), 'codice_fiscale,beneficiary_name,iban,recipient_type,email\n');
});

test('mappingsFromPages seeds one row per person', () => {
  const pages = [
    readPayslipPage({ pageNumber: 1, text: 'COD. FISC. FRMFRC91P22D086S\nFORMICA FEDERICO\nGIUGNO 2026' }),
    readPayslipPage({ pageNumber: 2, text: 'COD. FISC. RSSMRA80A01H501U\nROSSI MARIO\nGIUGNO 2026' }),
    readPayslipPage({ pageNumber: 3, text: 'COD. FISC. FRMFRC91P22D086S\nFORMICA FEDERICO\nLUGLIO 2026' }),
  ];
  const mappings = mappingsFromPages(pages);
  assert.equal(mappings.length, 2, 'the same person twice is one row');
  assert.equal(mappings[0].codiceFiscale, 'FRMFRC91P22D086S');
  assert.equal(mappings[0].beneficiaryName, 'FORMICA FEDERICO');
  assert.equal(mappings[0].iban, '', 'left for the operator');
});

test('mappingsFromPages skips pages with no code', () => {
  const pages = [readPayslipPage({ pageNumber: 1, text: 'PAGINA VUOTA' })];
  assert.deepEqual(mappingsFromPages(pages), []);
});

test('mergeMappings keeps saved bank details and adds new people', () => {
  const saved = parseIbanMappingCsv(`cf,name,iban\nRSSMRA80A01H501U,Mario Rossi,${IBAN}`);
  const fromPayslips = parseIbanMappingCsv('cf,name\nFRMFRC91P22D086S,FORMICA FEDERICO');
  const merged = mergeMappings(saved, fromPayslips);
  assert.equal(merged.length, 2);
  const mario = merged.find((row) => row.codiceFiscale === 'RSSMRA80A01H501U');
  assert.equal(mario?.iban, IBAN, 'saved IBAN survives');
  const federico = merged.find((row) => row.codiceFiscale === 'FRMFRC91P22D086S');
  assert.equal(federico?.iban, '', 'the new person needs one');
});

test('mergeMappings does not let a sparse import wipe details', () => {
  const imported = parseIbanMappingCsv('cf,name\nRSSMRA80A01H501U,Mario Rossi');
  const existing = parseIbanMappingCsv(`cf,iban,email\nRSSMRA80A01H501U,${IBAN},mario@example.com`);
  const [row] = mergeMappings(imported, existing);
  assert.equal(row.iban, IBAN);
  assert.equal(row.email, 'mario@example.com');
  assert.equal(row.beneficiaryName, 'Mario Rossi', 'the import still wins where it says something');
});

test('mergeMappings sorts by name then code', () => {
  const rows = parseIbanMappingCsv(
    'cf,name\nZZZMRA80A01H501U,Zeta\nAAAMRA80A01H501U,Alfa\nBBBMRA80A01H501U,Alfa',
  );
  assert.deepEqual(
    mergeMappings(rows, []).map((row) => row.codiceFiscale),
    ['AAAMRA80A01H501U', 'BBBMRA80A01H501U', 'ZZZMRA80A01H501U'],
  );
});

test('mergeMappings ignores rows with no code', () => {
  const rows = parseIbanMappingCsv(`cf,iban\n,${IBAN}`);
  assert.deepEqual(mergeMappings(rows, []), []);
});

test('mappingStatus reports what the operator has to fix', () => {
  const base = {
    codiceFiscale: 'RSSMRA80A01H501U',
    beneficiaryName: 'Mario Rossi',
    recipientType: /** @type {const} */ ('INDIVIDUAL'),
    email: '',
  };
  assert.equal(mappingStatus({ ...base, iban: IBAN }), 'ok');
  assert.equal(mappingStatus({ ...base, iban: '' }), 'missing');
  assert.equal(mappingStatus({ ...base, iban: 'IT61X0542811101000000123456' }), 'invalid');
});
