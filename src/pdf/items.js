// @ts-check
/**
 * Converting pdf.js text fragments into the shape the extraction rules read.
 *
 * Deliberately free of any pdf.js import: this is the part worth testing outside
 * a browser, and `src/pdf/text.js` is the part that needs the library.
 */

/** @typedef {import('../core/text-geometry.js').PositionedItem} PositionedItem */

/**
 * One text fragment as pdf.js reports it.
 *
 * `transform` is the text matrix. Entries 4 and 5 are the position, in PDF user
 * space, where y grows *upwards* from the bottom of the page — which is the
 * convention the extraction rules assume, so it is passed through unflipped.
 *
 * @typedef {object} PdfTextItem
 * @property {string} [str]
 * @property {number[]} [transform]
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Convert fragments, dropping the blank ones.
 *
 * Everything is defended against being absent: this is the boundary with a
 * library whose output shape is its own business, and one odd fragment must not
 * take down a 250-page run.
 *
 * @param {unknown[]} items as returned by `getTextContent()`
 * @returns {PositionedItem[]}
 */
export function toPositionedItems(items) {
  /** @type {PositionedItem[]} */
  const positioned = [];
  for (const raw of items ?? []) {
    if (raw === null || typeof raw !== 'object') continue;
    const item = /** @type {PdfTextItem} */ (raw);
    const text = String(item.str ?? '').trim();
    if (text.length === 0) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    positioned.push({
      text,
      x: finiteNumber(transform[4], 0),
      y: finiteNumber(transform[5], 0),
      width: finiteNumber(item.width, 0),
      // pdf.js reports height as the font size; the matrix's vertical scale is
      // the fallback when it does not.
      height: finiteNumber(item.height, finiteNumber(transform[3], 0)),
    });
  }
  return positioned;
}
