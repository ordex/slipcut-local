// @ts-check
import { assert, test } from './harness.js';
import { buildPayslipFixture } from './fixture-pdf.js';
import { readPayslipPage } from '../src/core/payslip.js';
import { safeBaseName, splitIntoArchive } from '../src/pdf/split.js';

test('safeBaseName drops the extension', () => {
  assert.equal(safeBaseName('cedolini giugno.pdf'), 'cedolini giugno');
  assert.equal(safeBaseName('CEDOLINI.PDF'), 'CEDOLINI');
});

test('safeBaseName cannot escape its folder', () => {
  assert.equal(safeBaseName('a/b\\c.pdf'), 'a-b-c');
  assert.equal(safeBaseName('/absolute/path.pdf'), '-absolute-path');
  assert.equal(safeBaseName('../../etc/passwd').includes('/'), false);
});

test('safeBaseName keeps Italian letters and strips the rest', () => {
  assert.equal(safeBaseName('cedolini città più.pdf'), 'cedolini città più');
  assert.equal(safeBaseName('bozze "red" (24).pdf'), 'bozze red 24');
});

test('safeBaseName always returns something usable', () => {
  assert.equal(safeBaseName(''), 'cedolini');
  assert.equal(safeBaseName('.pdf'), 'cedolini');
  assert.equal(safeBaseName('???'), 'cedolini');
});

/** The three pages of the fixture, as the app would have read them. */
const PAGES = [
  readPayslipPage({
    pageNumber: 1,
    text: 'COD. FISC. FRMFRC91P22D086S\nFORMICA FEDERICO\nGIUGNO 2026\nNETTO 2.056,00',
  }),
  readPayslipPage({
    pageNumber: 2,
    text: 'COD. FISC. MRAMCN90E04D086C\nMAURO MARCO ANTONIO\nGIUGNO 2026\nNETTO CORRISPOSTO 1.851,00',
  }),
  readPayslipPage({ pageNumber: 3, text: 'RIEPILOGO MENSILE\nTOTALE NETTI 3.907,00' }),
];

/**
 * Entry names of a finished archive, read back from its central directory.
 * @param {Blob} archive
 * @returns {Promise<string[]>}
 */
async function entryNames(archive) {
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  const count = view.getUint16(end + 8, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  /** @type {string[]} */
  const names = [];
  for (let index = 0; index < count; index += 1) {
    const nameLength = view.getUint16(cursor + 28, true);
    names.push(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)));
    cursor += 46 + nameLength;
  }
  return names;
}

test('splitIntoArchive files each payslip under its code and period', async () => {
  const { archive, fileCount, skippedPages } = await splitIntoArchive({
    bytes: buildPayslipFixture(),
    pages: PAGES,
    fileName: 'cedolini giugno.pdf',
  });

  assert.equal(fileCount, 2);
  assert.deepEqual(skippedPages, [3], 'the cover sheet cannot be filed');

  const names = await entryNames(archive);
  assert.ok(names.includes('FRMFRC91P22D086S/202606/cedolini giugno_pagina_1.pdf'), names.join(', '));
  assert.ok(names.includes('MRAMCN90E04D086C/202606/cedolini giugno_pagina_2.pdf'), names.join(', '));
});

test('the archive carries the summary and the list of skipped pages', async () => {
  const { archive } = await splitIntoArchive({
    bytes: buildPayslipFixture(),
    pages: PAGES,
    fileName: 'cedolini.pdf',
  });
  const names = await entryNames(archive);
  assert.ok(names.includes('riepilogo.csv'));
  assert.ok(names.includes('pagine_scartate.txt'));
});

test('no skipped-pages file when every page was filed', async () => {
  const { archive, skippedPages } = await splitIntoArchive({
    bytes: buildPayslipFixture(),
    pages: PAGES.slice(0, 2),
    fileName: 'cedolini.pdf',
  });
  assert.deepEqual(skippedPages, []);
  assert.equal((await entryNames(archive)).includes('pagine_scartate.txt'), false);
});

test('a truncated run is recorded in the archive', async () => {
  const { archive } = await splitIntoArchive({
    bytes: buildPayslipFixture(),
    pages: PAGES.slice(0, 2),
    fileName: 'cedolini.pdf',
    totalPages: 300,
  });
  assert.ok((await entryNames(archive)).includes('nota.txt'));
});

test('each split file is a single-page PDF', async () => {
  const { archive } = await splitIntoArchive({
    bytes: buildPayslipFixture(),
    pages: PAGES,
    fileName: 'cedolini.pdf',
  });

  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  const count = view.getUint16(end + 8, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();

  const { PDFDocument } = await import('../vendor/pdf-lib.js');
  let checked = 0;
  for (let index = 0; index < count; index += 1) {
    const nameLength = view.getUint16(cursor + 28, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const compressedSize = view.getUint32(cursor + 20, true);
    const localOffset = view.getUint32(cursor + 42, true);
    cursor += 46 + nameLength;
    if (!name.endsWith('.pdf')) continue;

    const localNameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + extraLength;
    // Split PDFs are stored, not deflated, so the bytes are readable directly.
    const document = await PDFDocument.load(bytes.subarray(start, start + compressedSize));
    assert.equal(document.getPageCount(), 1, `${name} should hold exactly one page`);
    checked += 1;
  }
  assert.equal(checked, 2);
});

test('splitIntoArchive reports progress once per page', async () => {
  /** @type {Array<[number, number]>} */
  const progress = [];
  await splitIntoArchive({
    bytes: buildPayslipFixture(),
    pages: PAGES,
    fileName: 'cedolini.pdf',
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.deepEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});
