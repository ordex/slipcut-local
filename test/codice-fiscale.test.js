// @ts-check
import { assert, test } from './harness.js';
import {
  findCodiciFiscali,
  findFirstCodiceFiscale,
  hasValidCheckCharacter,
  normaliseCodiceFiscale,
} from '../src/core/codice-fiscale.js';

/** Codici fiscali with a valid check character, covering both sexes and omocodia. */
const VALID = [
  'FRMFRC91P22D086S',
  'MRAMCN90E04D086C',
  'CNGVCN87D10C352W',
  'RNLDTL96B41F915U',
  'CNGRRT82H17D976X',
  'VCCLNZ00R24F839L',
  'PSQDNL94B18H769B',
  'CLCSRA94H67C978F',
  'SRGPQL94P07D086S',
  'MPRMCL93S28A512P',
  'CNDPLA95M03D086S',
  'PNAVCN92P20C352A',
  'RSSMRA80A01H501U',
];

test('normaliseCodiceFiscale keeps only alphanumerics, upper-cased', () => {
  assert.equal(normaliseCodiceFiscale('rss mra 80a01 h501u'), 'RSSMRA80A01H501U');
  assert.equal(normaliseCodiceFiscale('RSS-MRA-80A01H501U'), 'RSSMRA80A01H501U');
  assert.equal(normaliseCodiceFiscale(''), '');
});

test('hasValidCheckCharacter accepts every known-good code', () => {
  for (const codiceFiscale of VALID) {
    assert.ok(hasValidCheckCharacter(codiceFiscale), `rejected ${codiceFiscale}`);
  }
});

test('hasValidCheckCharacter rejects a wrong check character', () => {
  // Same code, last character shifted.
  assert.equal(hasValidCheckCharacter('RSSMRA80A01H501A'), false);
  assert.equal(hasValidCheckCharacter('FRMFRC91P22D086X'), false);
});

test('hasValidCheckCharacter rejects wrong length or characters', () => {
  assert.equal(hasValidCheckCharacter(''), false);
  assert.equal(hasValidCheckCharacter('RSSMRA80A01H501'), false, '15 characters');
  assert.equal(hasValidCheckCharacter('RSSMRA80A01H501UU'), false, '17 characters');
  assert.equal(hasValidCheckCharacter('RSSMRA80A01H501!'), false);
});

test('findCodiciFiscali finds a code inside payslip text', () => {
  assert.deepEqual(findCodiciFiscali('COD. FISC. FRMFRC91P22D086S LIVELLO 4'), ['FRMFRC91P22D086S']);
  assert.equal(findFirstCodiceFiscale('COD. FISC. FRMFRC91P22D086S'), 'FRMFRC91P22D086S');
});

test('findCodiciFiscali survives whitespace inside the code', () => {
  // PDF extraction splits fragments and they get joined with spaces.
  assert.deepEqual(findCodiciFiscali('CF FRMFRC91P22\nD086S'), ['FRMFRC91P22D086S']);
});

test('findCodiciFiscali keeps document order and drops duplicates', () => {
  const text = 'RSSMRA80A01H501U poi FRMFRC91P22D086S poi ancora RSSMRA80A01H501U';
  assert.deepEqual(findCodiciFiscali(text), ['RSSMRA80A01H501U', 'FRMFRC91P22D086S']);
});

test('findCodiciFiscali ignores text without a valid code', () => {
  assert.deepEqual(findCodiciFiscali('NESSUN CODICE QUI'), []);
  assert.deepEqual(findCodiciFiscali(''), []);
  assert.equal(findFirstCodiceFiscale('NESSUN CODICE'), null);
});

test('findCodiciFiscali does not accept a VAT number as a Codice Fiscale', () => {
  // The employer is identified by an 11-digit VAT number on the same page.
  assert.deepEqual(findCodiciFiscali('RED YARD RESEARCH SRL CF: 01234567890'), []);
});

test('findCodiciFiscali skips candidates whose check character is wrong', () => {
  const text = 'FRMFRC91P22D086X e RSSMRA80A01H501U';
  assert.deepEqual(findCodiciFiscali(text), ['RSSMRA80A01H501U']);
});

test('findCodiciFiscali is case-insensitive', () => {
  assert.deepEqual(findCodiciFiscali('cod. fisc. frmfrc91p22d086s'), ['FRMFRC91P22D086S']);
});

test('the whitespace fallback does not fire when a code is already found', () => {
  // "LIVELLO 4" + a valid code must not be re-scanned into something else.
  const text = 'LIVELLO 4 RSSMRA80A01H501U';
  assert.deepEqual(findCodiciFiscali(text), ['RSSMRA80A01H501U']);
});
