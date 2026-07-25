// @ts-check
import { assert, test } from './harness.js';
import { parseCsv } from '../src/core/csv.js';
import { readPayslipPage } from '../src/core/payslip.js';
import { formatExtractionSummaryCsv, SUMMARY_COLUMNS } from '../src/core/summary-csv.js';

const GOOD = readPayslipPage({
  pageNumber: 1,
  text: [
    'COD. FISC. FRMFRC91P22D086S',
    'FORMICA FEDERICO',
    'GIUGNO 2026',
    '1 RETRIBUZIONE ORDINARIA 3.000,00',
    'NETTO 2.056,00',
  ].join('\n'),
});

const EMPTY = readPayslipPage({ pageNumber: 2, text: 'PAGINA VUOTA' });

test('the summary has a header and one row per page', () => {
  const rows = parseCsv(formatExtractionSummaryCsv([GOOD, EMPTY]));
  assert.deepEqual(rows[0], SUMMARY_COLUMNS);
  assert.equal(rows.length, 3);
});

test('the summary reports what was read', () => {
  const [, row] = parseCsv(formatExtractionSummaryCsv([GOOD]));
  assert.deepEqual(row, [
    '1',
    'employee',
    '95%',
    'FRMFRC91P22D086S',
    'FORMICA FEDERICO',
    '202606',
    '3.000,00',
    '2.056,00',
    'label-line',
    "Netto trovato senza geometria (label-line): verificare l'importo",
  ]);
});

test('the summary lists failed pages too', () => {
  const [, row] = parseCsv(formatExtractionSummaryCsv([EMPTY]));
  assert.equal(row[0], '2');
  assert.equal(row[3], '', 'no codice fiscale');
  assert.equal(row[7], '', 'no amount');
  assert.equal(row[8], 'not-found');
  assert.ok(row[9].includes('Codice Fiscale non trovato'));
});

test('amounts are written in Italian notation', () => {
  const page = readPayslipPage({
    pageNumber: 1,
    text: 'COD. FISC. FRMFRC91P22D086S\nGIUGNO 2026\nNETTO 12.345,67',
  });
  const [, row] = parseCsv(formatExtractionSummaryCsv([page]));
  assert.equal(row[7], '12.345,67');
});

test('several warnings stay readable in one cell', () => {
  const [, row] = parseCsv(formatExtractionSummaryCsv([EMPTY]));
  assert.equal(row[9].split(' | ').length, 4);
});

test('the summary of nothing is just a header', () => {
  assert.equal(formatExtractionSummaryCsv([]), `${SUMMARY_COLUMNS.join(',')}\n`);
});
