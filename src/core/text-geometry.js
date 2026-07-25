// @ts-check
/**
 * Turning positioned text fragments back into lines, and looking around a
 * fragment.
 *
 * A PDF stores text as fragments placed at coordinates; the order they appear in
 * the file has nothing to do with the order a human reads them. Every extraction
 * rule downstream either needs proper lines or needs to ask what sits next to
 * something, so both live here.
 *
 * Coordinates are PDF user space: x grows rightwards, **y grows upwards**, origin
 * at the bottom-left of the page.
 */

/**
 * One text fragment with its position on the page.
 * @typedef {object} PositionedItem
 * @property {string} text
 * @property {number} x left edge
 * @property {number} y baseline, growing upwards
 * @property {number} width advance width of the fragment
 * @property {number} height font size
 */

/**
 * Baselines closer than this belong to the same visual line.
 *
 * Cells in one row of a payroll table are not typeset on exactly the same
 * baseline: a real payslip prints `RATEI` at y=132, `TOTALE COMPETENZE` at 131
 * and the figure at 129. Too small a tolerance splits that row and the label
 * loses its value; too large a one merges rows, which on the same payslip are
 * only 7 points apart. It has to sit between the two.
 */
const LINE_TOLERANCE = 4;

/**
 * Group fragments into lines, top to bottom, each ordered left to right.
 *
 * Fragments are clustered by how close their baselines are rather than by
 * rounding y into fixed buckets: two fragments of one line can straddle a bucket
 * boundary and end up on separate lines, which breaks every rule that reads a
 * label and its value from the same line.
 *
 * @param {PositionedItem[]} items
 * @returns {PositionedItem[][]} one array per line
 */
export function groupIntoLines(items) {
  const sorted = [...items]
    .filter((item) => item.text.trim().length > 0)
    .sort((a, b) => b.y - a.y);

  /** @type {PositionedItem[][]} */
  const lines = [];
  let baseline = Number.NaN;

  for (const item of sorted) {
    if (lines.length === 0 || Math.abs(item.y - baseline) > LINE_TOLERANCE) {
      lines.push([item]);
      baseline = item.y;
    } else {
      lines[lines.length - 1].push(item);
    }
  }

  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * The page as text, one line per line.
 * @param {PositionedItem[]} items
 * @returns {string[]}
 */
export function toLines(items) {
  return groupIntoLines(items).map((line) =>
    line
      .map((item) => item.text.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * The page as one string, lines separated by newlines.
 * @param {PositionedItem[]} items
 * @returns {string}
 */
export function toText(items) {
  return toLines(items).join('\n');
}

/**
 * Non-empty, whitespace-collapsed lines of a text block.
 * @param {string} text
 * @returns {string[]}
 */
export function usefulLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * The text sitting on the same baseline as `anchor`, within `xWindow` either
 * side of it, in reading order.
 *
 * Payroll labels get split across fragments — `NETTO` and `CORRISPOSTO` arrive
 * separately — so deciding what a label says means reading its neighbours.
 *
 * @param {PositionedItem[]} items
 * @param {PositionedItem} anchor
 * @param {number} xWindow
 * @returns {string}
 */
export function textAround(items, anchor, xWindow) {
  return items
    .filter(
      (item) =>
        Math.abs(item.y - anchor.y) <= LINE_TOLERANCE && Math.abs(item.x - anchor.x) <= xWindow,
    )
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text.trim().toUpperCase())
    .join(' ')
    .replace(/\s+/g, ' ');
}
