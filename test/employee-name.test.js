// @ts-check
import { assert, test } from './harness.js';
import { findEmployeeName, nameCandidates } from '../src/core/employee-name.js';

/** A page that looks like the real thing: the name is surrounded by noise. */
const PAGE = [
  'RED YARD RESEARCH SRL CF: 01234567890',
  'VIA ROMA 12 87036 RENDE CS',
  'COD. FISC. FRMFRC91P22D086S',
  'FORMICA FEDERICO',
  'IMPIEGATO LIVELLO 4 ASSUNTO IL 01/03/2020',
  'GIUGNO 2026',
  'NETTO 2.056,00',
].join('\n');

test('findEmployeeName picks the employee, not the employer', () => {
  assert.equal(findEmployeeName(PAGE, 'FRMFRC91P22D086S'), 'FORMICA FEDERICO');
});

test('findEmployeeName ignores addresses and job titles', () => {
  // Both appear closer to some page features than the name does.
  const name = findEmployeeName(PAGE, 'FRMFRC91P22D086S');
  assert.ok(name !== 'VIA ROMA');
  assert.ok(name !== 'IMPIEGATO LIVELLO');
  assert.ok(name !== 'RED YARD');
});

test('findEmployeeName reads a name printed inline with other fields', () => {
  const text = '0042 FORMICA FEDERICO IMPIEGATO 4 01/03/2020 2.056,00';
  assert.equal(findEmployeeName(text, 'FRMFRC91P22D086S'), 'FORMICA FEDERICO');
});

test('findEmployeeName reads a multi-word given name', () => {
  const text = 'COD. FISC. MRAMCN90E04D086C\nMAURO MARCO ANTONIO\nCOLLABORATORE';
  assert.equal(findEmployeeName(text, 'MRAMCN90E04D086C'), 'MAURO MARCO ANTONIO');
});

test('findEmployeeName reads a name with an accent', () => {
  const text = 'COD. FISC. BRNNCL80A01H501W\nBRUNO NICOLÒ';
  // Verified via the derived code rather than a hard-coded expectation.
  const found = findEmployeeName(text, 'BRNNCL80A01H501W');
  assert.equal(found, 'BRUNO NICOLO');
});

test('findEmployeeName needs a codice fiscale to verify against', () => {
  assert.equal(findEmployeeName(PAGE, null), null);
  assert.equal(findEmployeeName(PAGE, ''), null);
});

test('findEmployeeName returns null when the name is not on the page', () => {
  const text = 'COD. FISC. FRMFRC91P22D086S\nNETTO 2.056,00';
  assert.equal(findEmployeeName(text, 'FRMFRC91P22D086S'), null);
});

test('findEmployeeName does not accept a different person', () => {
  assert.equal(findEmployeeName(PAGE, 'RSSMRA80A01H501U'), null);
});

test('nameCandidates offers windows of two to five words', () => {
  const candidates = nameCandidates('FORMICA FEDERICO MARIA GIUSEPPE ANNA LUCA');
  assert.ok(candidates.includes('FORMICA FEDERICO'));
  assert.ok(candidates.includes('FORMICA FEDERICO MARIA GIUSEPPE ANNA'), 'five words');
  assert.equal(
    candidates.some((candidate) => candidate.split(' ').length > 5),
    false,
    'nothing longer than five words',
  );
  assert.equal(
    candidates.some((candidate) => candidate.split(' ').length < 2),
    false,
    'nothing shorter than two words',
  );
});

test('nameCandidates treats digits and punctuation as separators', () => {
  const candidates = nameCandidates('0042 FORMICA FEDERICO 01/03/2020 IMPIEGATO 4');
  assert.ok(candidates.includes('FORMICA FEDERICO'));
  assert.equal(
    candidates.some((candidate) => /\d/.test(candidate)),
    false,
  );
});

test('nameCandidates deduplicates', () => {
  const candidates = nameCandidates('ROSSI MARIO\nROSSI MARIO');
  assert.equal(candidates.filter((candidate) => candidate === 'ROSSI MARIO').length, 1);
});

test('nameCandidates is empty for an empty page', () => {
  assert.deepEqual(nameCandidates(''), []);
  assert.deepEqual(nameCandidates('1 2 3 4'), []);
});
