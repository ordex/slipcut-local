// @ts-check
import { assert, test } from './harness.js';
import {
  detectLayout,
  findGrossAmount,
  payslipFolder,
  readPayslipPage,
} from '../src/core/payslip.js';

/**
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} [width]
 * @returns {import('../src/core/text-geometry.js').PositionedItem}
 */
const item = (text, x, y, width = text.length * 5) => ({ text, x, y, width, height: 10 });

/** A complete, readable employee page. */
const EMPLOYEE_ITEMS = [
  item('RED YARD RESEARCH SRL CF: 01234567890', 60, 760, 218),
  item('COD. FISC. FRMFRC91P22D086S', 60, 730, 158),
  item('FORMICA FEDERICO', 60, 710, 101),
  item('GIUGNO 2026', 60, 690, 66),
  item('1 RETRIBUZIONE ORDINARIA', 60, 400, 127),
  item('3.000,00', 300, 400, 35),
  item('NETTO', 380, 100, 34),
  item('2.056,00', 445, 100, 39),
];

test('detectLayout recognises the two payslip kinds', () => {
  assert.equal(detectLayout('PERCIPIENTE PERIODO COMPENSO'), 'collaborator');
  assert.equal(detectLayout('1352 COMPENSO LORDO'), 'collaborator');
  assert.equal(detectLayout('COD. FISC. RSSMRA80A01H501U RETRIBUZIONE ORDINARIA'), 'employee');
  assert.equal(detectLayout('QUALIFICA IMPIEGATO'), 'employee');
  assert.equal(detectLayout('una pagina qualunque'), 'unknown');
  assert.equal(detectLayout(''), 'unknown');
});

test('findGrossAmount reads the labelled line', () => {
  assert.equal(findGrossAmount('1 RETRIBUZIONE ORDINARIA 3.000,00'), 300000);
  assert.equal(findGrossAmount('1352 COMPENSO LORDO 2.400,00'), 240000);
  assert.equal(findGrossAmount('TOTALE COMPETENZE 3.100,00'), 310000);
  assert.equal(findGrossAmount('NETTO 2.056,00'), null, 'the net line is not the gross line');
  assert.equal(findGrossAmount(''), null);
});

test('readPayslipPage reads a complete page', () => {
  const page = readPayslipPage({ pageNumber: 1, items: EMPLOYEE_ITEMS });
  assert.equal(page.pageNumber, 1);
  assert.equal(page.layout, 'employee');
  assert.equal(page.codiceFiscale, 'FRMFRC91P22D086S');
  assert.equal(page.employeeName, 'FORMICA FEDERICO');
  assert.equal(page.period?.yyyymm, '202606');
  assert.equal(page.netAmount, 205600);
  assert.equal(page.netAmountSource, 'netto-box');
  assert.equal(page.grossAmount, 300000);
  assert.deepEqual(page.warnings, []);
  assert.equal(page.confidence, 1);
});

test('readPayslipPage renders the page text in reading order', () => {
  const page = readPayslipPage({ pageNumber: 1, items: EMPLOYEE_ITEMS });
  assert.ok(page.text.includes('1 RETRIBUZIONE ORDINARIA 3.000,00'));
  assert.ok(page.text.endsWith('NETTO 2.056,00'));
});

test('readPayslipPage accepts text without geometry, and warns', () => {
  const page = readPayslipPage({
    pageNumber: 3,
    text: 'COD. FISC. FRMFRC91P22D086S\nFORMICA FEDERICO\nGIUGNO 2026\nNETTO 2.056,00',
  });
  assert.equal(page.netAmount, 205600);
  assert.equal(page.netAmountSource, 'label-line');
  assert.equal(page.warnings.length, 1);
  assert.ok(page.warnings[0].includes('verificare'));
  assert.ok(page.confidence < 1);
});

test('readPayslipPage warns per missing field instead of failing', () => {
  const page = readPayslipPage({ pageNumber: 7, text: 'PAGINA VUOTA' });
  assert.equal(page.codiceFiscale, null);
  assert.equal(page.employeeName, null);
  assert.equal(page.period, null);
  assert.equal(page.netAmount, null);
  assert.equal(page.netAmountSource, 'not-found');
  assert.equal(page.warnings.length, 4);
  assert.equal(page.confidence, 0);
});

test('readPayslipPage does not report a name it could not verify', () => {
  // The name is on the page but belongs to somebody else.
  const page = readPayslipPage({
    pageNumber: 1,
    text: 'COD. FISC. FRMFRC91P22D086S\nROSSI MARIO\nGIUGNO 2026',
  });
  assert.equal(page.employeeName, null);
  assert.ok(page.warnings.some((warning) => warning.includes('Nome')));
});

test('readPayslipPage scores partial pages between 0 and 1', () => {
  const page = readPayslipPage({
    pageNumber: 2,
    text: 'COD. FISC. FRMFRC91P22D086S\nGIUGNO 2026',
  });
  assert.ok(page.confidence > 0 && page.confidence < 1, `got ${page.confidence}`);
});

test('payslipFolder files a page by code and period', () => {
  const page = readPayslipPage({ pageNumber: 1, items: EMPLOYEE_ITEMS });
  assert.equal(payslipFolder(page), 'FRMFRC91P22D086S/202606');
});

test('payslipFolder refuses a page that cannot be filed', () => {
  assert.equal(payslipFolder(readPayslipPage({ pageNumber: 1, text: 'GIUGNO 2026' })), null);
  assert.equal(
    payslipFolder(readPayslipPage({ pageNumber: 1, text: 'COD. FISC. FRMFRC91P22D086S' })),
    null,
    'a period is required too',
  );
});

test('readPayslipPage handles a collaborator page', () => {
  const items = [
    item('PERCIPIENTE PERIODO COMPENSO', 60, 760, 150),
    item('COD. FISC. MRAMCN90E04D086C', 60, 730, 158),
    item('MAURO MARCO ANTONIO', 60, 710, 110),
    item('GIUGNO 2026', 60, 690, 66),
    item('1352 COMPENSO LORDO', 60, 400, 100),
    item('2.400,00', 300, 400, 35),
    item('NETTO', 330, 100, 34),
    item('CORRISPOSTO', 366, 100, 60),
    item('1.851,00', 460, 100, 39),
  ];
  const page = readPayslipPage({ pageNumber: 2, items });
  assert.equal(page.layout, 'collaborator');
  assert.equal(page.employeeName, 'MAURO MARCO ANTONIO');
  assert.equal(page.netAmount, 185100);
  assert.equal(page.netAmountSource, 'netto-box');
  assert.equal(page.grossAmount, 240000);
  assert.deepEqual(page.warnings, []);
});

test('only a geometric amount reaches full confidence', () => {
  const geometric = readPayslipPage({ pageNumber: 1, items: EMPLOYEE_ITEMS });
  const textual = readPayslipPage({ pageNumber: 1, text: geometric.text });
  assert.equal(geometric.netAmount, textual.netAmount, 'same amount either way');
  assert.equal(geometric.confidence, 1);
  assert.ok(textual.confidence < geometric.confidence, `${textual.confidence} vs ${geometric.confidence}`);
});
