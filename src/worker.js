// @ts-check
/**
 * The whole document pipeline, off the UI thread.
 *
 * Reading two hundred pages and rewriting them into an archive takes seconds of
 * solid work; on the main thread that is a frozen window and a browser offering
 * to kill the tab. The worker also keeps the file bytes out of the page.
 *
 * Loaded as a module worker, so it imports the same modules as everything else.
 */

import { readPayslipPage } from './core/payslip.js';
import { splitIntoArchive } from './pdf/split.js';
import { openPdf } from './pdf/text.js';

/**
 * Beyond this the wait stops being reasonable and the memory stops being
 * predictable, so the rest is left unread and reported as such.
 */
export const MAX_PAGES = 250;

/**
 * @typedef {object} ProcessRequest
 * @property {'process'} type
 * @property {ArrayBuffer} bytes
 * @property {string} fileName
 */

/**
 * @typedef {object} ProgressMessage
 * @property {'progress'} type
 * @property {'reading' | 'splitting'} phase
 * @property {number} done
 * @property {number} total
 */

/**
 * @typedef {object} DoneMessage
 * @property {'done'} type
 * @property {import('./core/payslip.js').PayslipPage[]} pages
 * @property {Blob} archive
 * @property {number[]} skippedPages
 * @property {number} fileCount
 * @property {number} processedPages
 * @property {number} totalPages pages in the source, which may exceed the above
 */

/**
 * @typedef {object} FailedMessage
 * @property {'failed'} type
 * @property {string} message
 */

/** @typedef {ProgressMessage | DoneMessage | FailedMessage} WorkerMessage */

/** @param {WorkerMessage} message */
function post(message) {
  self.postMessage(message);
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 * @returns {Promise<DoneMessage>}
 */
async function process(buffer, fileName) {
  const bytes = new Uint8Array(buffer);

  // pdf.js takes ownership of the buffer it parses, so it gets a copy and the
  // original stays available for the split.
  const pdf = await openPdf(bytes.slice());
  const totalPages = pdf.pageCount;
  const processedPages = Math.min(totalPages, MAX_PAGES);

  /** @type {import('./core/payslip.js').PayslipPage[]} */
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= processedPages; pageNumber += 1) {
      const items = await pdf.itemsOfPage(pageNumber);
      pages.push(readPayslipPage({ pageNumber, items }));
      post({ type: 'progress', phase: 'reading', done: pageNumber, total: processedPages });
    }
  } finally {
    await pdf.close();
  }

  const { archive, skippedPages, fileCount } = await splitIntoArchive({
    bytes,
    pages,
    fileName,
    totalPages,
    onProgress: (done, total) => post({ type: 'progress', phase: 'splitting', done, total }),
  });

  return {
    type: 'done',
    pages,
    archive,
    skippedPages,
    fileCount,
    processedPages,
    totalPages,
  };
}

self.addEventListener('message', async (event) => {
  const request = /** @type {ProcessRequest} */ (event.data);
  if (request?.type !== 'process') return;

  try {
    post(await process(request.bytes, request.fileName));
  } catch (error) {
    // A password-protected or damaged file is a normal thing for a user to
    // drop in, so it comes back as a message rather than an unhandled rejection.
    post({
      type: 'failed',
      message: error instanceof Error ? error.message : 'Errore durante la lettura del PDF',
    });
  }
});
