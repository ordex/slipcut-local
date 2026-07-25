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

test('findPeriod falls back to the latest printed date', () => {
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

test('a footer date does not become the period', () => {
  // A real payslip ends with the payroll vendor's own INAIL authorisation,
  // dated 2009, which is the last date on the page but not the period.
  const text = [
    'Periodo 01/01/2026 - 30/04/2026',
    'Competenze 01/01/2026 - 30/04/2026',
    'Zucchetti spa, Autorizzazione Inail n. 299 del 15/01/2009',
  ].join('\n');
  assert.equal(findPeriod(text)?.yyyymm, '202604');
});

test('the period heading wins over every date, footer included', () => {
  const text = [
    'PERIODO DI RETRIBUZIONE Aprile 2026',
    'Assunto il 12/03/2019',
    'Autorizzazione Inail n. 299 del 15/01/2009',
  ].join('\n');
  assert.equal(findPeriod(text)?.yyyymm, '202604');
  assert.equal(findPeriod(text)?.label, 'Aprile 2026');
});

test('the latest date wins regardless of reading order', () => {
  assert.equal(findPeriod('30/04/2026 e poi 01/01/2026')?.yyyymm, '202604');
  assert.equal(findPeriod('01/01/2026 e poi 30/04/2026')?.yyyymm, '202604');
});

test('dates written with dashes are left alone', () => {
  // The print timestamp at the top of a real payslip is 04-05-2026, a month after
  // the period; reading it would move every payment into the wrong month.
  assert.equal(findPeriod('Stampato il 04-05-2026 16:21 periodo 01/01/2026 - 30/04/2026')?.yyyymm, '202604');
});
