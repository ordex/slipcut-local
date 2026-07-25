// @ts-check
import { assert, test } from './harness.js';
import { findPeriod } from '../src/core/period.js';

test('findPeriod reads a spelled-out month', () => {
  assert.deepEqual(findPeriod('GIUGNO 2026'), {
    year: '2026',
    month: '06',
    yyyymm: '202606',
    label: 'Giugno 2026',
  });
  assert.equal(findPeriod('Cedolino di Dicembre 2025')?.yyyymm, '202512');
  assert.equal(findPeriod('gennaio 2026')?.yyyymm, '202601');
});

test('findPeriod covers every month name', () => {
  const names = [
    'GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO',
    'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE',
  ];
  names.forEach((name, index) => {
    const expected = String(index + 1).padStart(2, '0');
    assert.equal(findPeriod(`${name} 2026`)?.month, expected, name);
  });
});

test('findPeriod prefers the month name over printed dates', () => {
  const text = 'Assunto il 01/03/2020 Periodo GIUGNO 2026 Scadenza 30/06/2026';
  assert.equal(findPeriod(text)?.yyyymm, '202606');
});

test('findPeriod falls back to the last printed date', () => {
  const text = 'Assunto il 01/03/2020 al 30/06/2026';
  assert.deepEqual(findPeriod(text), {
    year: '2026',
    month: '06',
    yyyymm: '202606',
    label: '06/2026',
  });
});

test('findPeriod ignores a single date', () => {
  // One date on its own is as likely to be the hiring date as the period.
  assert.equal(findPeriod('Assunto il 01/03/2020'), null);
});

test('findPeriod tolerates whitespace and newlines', () => {
  assert.equal(findPeriod('PERIODO\n  GIUGNO   2026')?.yyyymm, '202606');
});

test('findPeriod rejects an impossible month', () => {
  assert.equal(findPeriod('01/13/2026 e 02/13/2026'), null);
});

test('findPeriod returns null when there is no period', () => {
  assert.equal(findPeriod(''), null);
  assert.equal(findPeriod('NESSUNA DATA QUI'), null);
  assert.equal(findPeriod('GIUGNO senza anno'), null);
});

test('findPeriod does not read a year out of range', () => {
  assert.equal(findPeriod('GIUGNO 1899'), null);
  assert.equal(findPeriod('GIUGNO 2126'), null);
});
