// @ts-check
import { assert, test } from './harness.js';
import {
  detectDelimiter,
  escapeCsvValue,
  fieldByHeader,
  formatCsv,
  normaliseHeader,
  parseCsv,
} from '../src/core/csv.js';

test('parseCsv reads a simple file', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('parseCsv keeps the delimiter inside quotes', () => {
  assert.deepEqual(parseCsv('name,note\n"Rossi, Mario",ok'), [
    ['name', 'note'],
    ['Rossi, Mario', 'ok'],
  ]);
});

test('parseCsv unescapes doubled quotes', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
});

test('parseCsv keeps a newline inside a quoted field', () => {
  assert.deepEqual(parseCsv('a,b\n"line1\nline2",x'), [
    ['a', 'b'],
    ['line1\nline2', 'x'],
  ]);
});

test('parseCsv accepts CRLF endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('parseCsv strips a UTF-8 BOM', () => {
  assert.deepEqual(parseCsv('﻿codice_fiscale,iban\nRSSMRA80A01H501U,IT60'), [
    ['codice_fiscale', 'iban'],
    ['RSSMRA80A01H501U', 'IT60'],
  ]);
});

test('parseCsv trims unquoted fields but not quoted ones', () => {
  assert.deepEqual(parseCsv('a, b ," c "'), [['a', 'b', ' c ']]);
});

test('parseCsv keeps empty fields inside a row', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  assert.deepEqual(parseCsv('cf,name,iban\nRSSMRA80A01H501U,,IT60'), [
    ['cf', 'name', 'iban'],
    ['RSSMRA80A01H501U', '', 'IT60'],
  ]);
});

test('parseCsv drops rows that hold nothing', () => {
  assert.deepEqual(parseCsv('a,b\n\n1,2\n\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('\n\n'), []);
});

test('parseCsv reads a file written with semicolons', () => {
  assert.deepEqual(parseCsv('nome;iban\nMario;IT60'), [
    ['nome', 'iban'],
    ['Mario', 'IT60'],
  ]);
});

test('parseCsv accepts an explicit delimiter', () => {
  assert.deepEqual(parseCsv('a;b,c', { delimiter: ';' }), [['a', 'b,c']]);
});

test('a quote in the middle of a field is literal', () => {
  // What a spreadsheet emits for an unquoted 12" monitor.
  assert.deepEqual(parseCsv('monitor 12" nero,x'), [['monitor 12" nero', 'x']]);
});

test('detectDelimiter guesses from the header line', () => {
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a'), ',', 'a single column defaults to comma');
  assert.equal(detectDelimiter(''), ',');
});

test('detectDelimiter ignores delimiters inside quotes', () => {
  // One real semicolon, two commas that are part of a quoted value.
  assert.equal(detectDelimiter('"a,b,c";d'), ';');
});

test('escapeCsvValue quotes only when needed', () => {
  assert.equal(escapeCsvValue('plain'), 'plain');
  assert.equal(escapeCsvValue('with,comma'), '"with,comma"');
  assert.equal(escapeCsvValue('with;semicolon'), '"with;semicolon"');
  assert.equal(escapeCsvValue('with"quote'), '"with""quote"');
  assert.equal(escapeCsvValue('with\nnewline'), '"with\nnewline"');
  assert.equal(escapeCsvValue(null), '');
  assert.equal(escapeCsvValue(undefined), '');
  assert.equal(escapeCsvValue(1234.56), '1234.56');
});

test('formatCsv renders rows', () => {
  assert.equal(formatCsv([['a', 'b'], [1, 2]]), 'a,b\n1,2');
  assert.equal(formatCsv([['a', 'b']], { delimiter: ';' }), 'a;b');
  assert.equal(formatCsv([['a'], ['b']], { eol: '\r\n' }), 'a\r\nb');
  assert.equal(formatCsv([]), '');
});

test('what formatCsv writes, parseCsv reads back', () => {
  const rows = [
    ['name', 'note', 'amount'],
    ['Rossi, Mario', 'say "hi"', '1234.56'],
    ['Multi\nline', '', '0.00'],
  ];
  assert.deepEqual(parseCsv(formatCsv(rows)), rows);
});

test('normaliseHeader folds spelling differences', () => {
  assert.equal(normaliseHeader('Codice Fiscale'), 'codice_fiscale');
  assert.equal(normaliseHeader('  IBAN  '), 'iban');
  assert.equal(normaliseHeader('Partita IVA o CF (Opzionale)'), 'partita_iva_o_cf_opzionale');
  assert.equal(normaliseHeader(''), '');
});

test('fieldByHeader finds a column by any accepted name', () => {
  const headers = ['cf', 'beneficiary_name', 'iban'];
  const values = ['RSSMRA80A01H501U', 'Mario Rossi', 'IT60'];
  assert.equal(fieldByHeader(headers, values, ['codice_fiscale', 'cf']), 'RSSMRA80A01H501U');
  assert.equal(fieldByHeader(headers, values, ['name', 'beneficiary_name']), 'Mario Rossi');
  assert.equal(fieldByHeader(headers, values, ['email']), '', 'absent column reads empty');
});

test('fieldByHeader tolerates a short row', () => {
  assert.equal(fieldByHeader(['cf', 'iban'], ['RSSMRA80A01H501U'], ['iban']), '');
});
