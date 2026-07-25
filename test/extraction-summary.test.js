// @ts-check
import { assert, test } from './harness.js';
import { readPayslipPage } from '../src/core/payslip.js';
import { extractionSummary, plural } from '../src/ui/views/extraction-table.js';

const GOOD = readPayslipPage({
  pageNumber: 1,
  items: [
    { text: 'COD. FISC. FRMFRC91P22D086S', x: 60, y: 730, width: 158, height: 10 },
    { text: 'FORMICA FEDERICO', x: 60, y: 710, width: 101, height: 10 },
    { text: 'GIUGNO 2026', x: 60, y: 690, width: 66, height: 10 },
    { text: 'NETTO', x: 380, y: 100, width: 34, height: 10 },
    { text: '2.056,00', x: 445, y: 100, width: 39, height: 10 },
  ],
});

const FALLBACK = readPayslipPage({
  pageNumber: 2,
  text: 'COD. FISC. RSSMRA80A01H501U\nROSSI MARIO\nGIUGNO 2026\nNETTO 1.851,00',
});

const EMPTY = readPayslipPage({ pageNumber: 3, text: 'RIEPILOGO' });

test('plural picks the right form', () => {
  assert.equal(plural(1, 'pagina', 'pagine'), '1 pagina');
  assert.equal(plural(3, 'pagina', 'pagine'), '3 pagine');
  assert.equal(plural(0, 'pagina', 'pagine'), '0 pagine');
});

test('the summary leads with what worked', () => {
  const summary = extractionSummary({
    pages: [GOOD, GOOD],
    fileCount: 2,
    skippedPages: [],
    processedPages: 2,
    totalPages: 2,
  });
  assert.equal(summary, '2 cedolini archiviati su 2 pagine lette');
});

test('the summary counts what needs attention', () => {
  const summary = extractionSummary({
    pages: [GOOD, FALLBACK, EMPTY],
    fileCount: 2,
    skippedPages: [3],
    processedPages: 3,
    totalPages: 3,
  });
  assert.ok(summary.includes('2 cedolini archiviati su 3 pagine lette'), summary);
  assert.ok(summary.includes('1 pagina non archiviabile'), summary);
  assert.ok(summary.includes('1 senza netto'), summary);
  assert.ok(summary.includes('1 con netto da verificare'), summary);
});

test('the summary says when pages were left unread', () => {
  const summary = extractionSummary({
    pages: [GOOD],
    fileCount: 1,
    skippedPages: [],
    processedPages: 250,
    totalPages: 251,
  });
  assert.ok(summary.includes('1 pagina non elaborata'), summary);
});

test('a clean single-page run reads naturally', () => {
  const summary = extractionSummary({
    pages: [GOOD],
    fileCount: 1,
    skippedPages: [],
    processedPages: 1,
    totalPages: 1,
  });
  assert.equal(summary, '1 cedolino archiviato su 1 pagina letta');
});
