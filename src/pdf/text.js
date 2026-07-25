// @ts-check
/**
 * Reading positioned text out of a PDF with pdf.js.
 *
 * The only module that knows pdf.js exists.
 */

import * as pdfjs from '../../vendor/pdf.js';
import { toPositionedItems } from './items.js';

/** @typedef {import('../core/text-geometry.js').PositionedItem} PositionedItem */

/**
 * pdf.js parses in a worker of its own and has to be told where that file is.
 * Resolved relative to this module, so the app keeps working when served from a
 * subdirectory.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.js', import.meta.url).href;

export const pdfjsVersion = pdfjs.version;

/**
 * @typedef {object} PdfPages
 * @property {number} pageCount
 * @property {(pageNumber: number) => Promise<PositionedItem[]>} itemsOfPage
 * @property {() => Promise<void>} close
 */

/**
 * Open a document for reading text.
 *
 * pdf.js takes ownership of the buffer it is given, so a caller that needs the
 * bytes afterwards has to pass a copy.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<PdfPages>}
 */
export async function openPdf(bytes) {
  const task = pdfjs.getDocument({
    data: bytes,
    // Nothing about a payslip should reach the network, and an XFA form is not
    // something this app can read anyway.
    isEvalSupported: false,
    enableXfa: false,
  });
  const document = await task.promise;

  return {
    pageCount: document.numPages,

    async itemsOfPage(pageNumber) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        return toPositionedItems(content.items);
      } finally {
        // Pages hold onto their operator lists; 250 of them need releasing as
        // the run goes rather than at the end.
        page.cleanup();
      }
    },

    async close() {
      // Releasing goes through the loading task, not the document.
      await task.destroy();
    },
  };
}
