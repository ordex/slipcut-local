// @ts-check
/**
 * Splitting the source PDF into one file per payslip, packed into an archive.
 *
 * Pages are filed under `CODICEFISCALE/YYYYMM/`, which is what makes the result
 * useful: an archive that can be handed to whoever asks for one person's
 * payslips without going back to the original.
 *
 * A page that cannot be filed is listed rather than dropped silently.
 */

import { PDFDocument } from '../../vendor/pdf-lib.mjs';
import { payslipFolder } from '../core/payslip.js';
import { formatExtractionSummaryCsv } from '../core/summary-csv.js';
import { ZipWriter } from '../zip.js';

/** @typedef {import('../core/payslip.js').PayslipPage} PayslipPage */

/**
 * Strip anything that would change where a file lands.
 * @param {string} name
 * @returns {string}
 */
export function safeBaseName(name) {
  const cleaned = String(name ?? '')
    .replace(/\.pdf$/i, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^\w.\-àèéìòùÀÈÉÌÒÙ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'cedolini';
}

/**
 * @typedef {object} SplitResult
 * @property {Blob} archive
 * @property {number[]} skippedPages pages that could not be filed
 * @property {number} fileCount payslip PDFs written
 */

/**
 * Build the archive.
 *
 * @param {object} input
 * @param {Uint8Array} input.bytes the original PDF
 * @param {PayslipPage[]} input.pages what was read from it, in page order
 * @param {string} input.fileName the uploaded name, used to name the outputs
 * @param {number} [input.totalPages] page count of the source, when more than
 *   the pages that were processed
 * @param {(done: number, total: number) => void} [input.onProgress]
 * @returns {Promise<SplitResult>}
 */
export async function splitIntoArchive({ bytes, pages, fileName, totalPages, onProgress }) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const baseName = safeBaseName(fileName);
  const zip = new ZipWriter();

  /** @type {number[]} */
  const skippedPages = [];
  let fileCount = 0;

  for (const [index, page] of pages.entries()) {
    const folder = payslipFolder(page);
    if (folder === null) {
      skippedPages.push(page.pageNumber);
    } else {
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(source, [page.pageNumber - 1]);
      single.addPage(copied);
      await zip.file(
        `${folder}/${baseName}_pagina_${page.pageNumber}.pdf`,
        await single.save(),
        // A PDF is already compressed; deflating it again buys nothing and costs
        // time on every page.
        { compress: false },
      );
      fileCount += 1;
    }
    onProgress?.(index + 1, pages.length);
  }

  await zip.file('riepilogo.csv', formatExtractionSummaryCsv(pages));

  if (skippedPages.length > 0) {
    await zip.file(
      'pagine_scartate.txt',
      [
        'Pagine non archiviate perché prive di Codice Fiscale o periodo:',
        skippedPages.join(', '),
        '',
        'Le trovi elencate in riepilogo.csv con il motivo.',
        '',
      ].join('\n'),
    );
  }

  if (totalPages !== undefined && totalPages > pages.length) {
    await zip.file(
      'nota.txt',
      `Il PDF di origine ha ${totalPages} pagine; sono state elaborate le prime ${pages.length}.\n`,
    );
  }

  return { archive: zip.finish(), skippedPages, fileCount };
}
