// @ts-check
/**
 * Finding the amount actually payable to the employee.
 *
 * This is the number that gets transferred, so it is the one place where being
 * approximately right is worthless. A payslip prints many amounts — gross,
 * taxable, withholdings, roundings, year-to-date totals — and reading them in
 * text order picks the wrong one, because fragment order in a PDF is not visual
 * order.
 *
 * So the amount is located *geometrically*: find the `NETTO` label, then take
 * the amount sitting in the same box to its right. The text fallbacks below
 * exist for pages where that fails, and they report themselves as fallbacks so
 * the caller can tell the user to check.
 */

import { findAmountsInText, isExactAmount, parseItalianAmount } from './money.js';
import { textAround, usefulLines } from './text-geometry.js';

/** @typedef {import('./text-geometry.js').PositionedItem} PositionedItem */
/** @typedef {import('./money.js').Cents} Cents */

/**
 * How the amount was found. Anything other than `netto-box` means the geometry
 * did not resolve and a human should look at the page.
 * @typedef {'netto-box' | 'label-line' | 'label-window' | 'not-found'} NetAmountSource
 */

/** A net pay of less than €100 or more than €50 000 is not what we are looking for. */
const MIN_PLAUSIBLE = 10_000;
const MAX_PLAUSIBLE = 5_000_000;

/** Most net salaries land here; used only to break ties. */
const TYPICAL_MIN = 50_000;
const TYPICAL_MAX = 1_000_000;

const NET_LABEL = /\bNETTO\b/;

/**
 * Labels that contain "NETTO" but do not label the payable amount: net
 * withholding, previous rounding, year-to-date columns.
 */
const NOT_A_NET_LABEL = /NON\s*ARROT|ARROT\.?\s*PREC|RITENUT|CONGUAGLI|PROGRESSIV|IMPONIBIL/;

/** How far right of the label its amount may sit. */
const DX_MIN = -4;
const DX_MAX = 220;
/** Where the amount usually sits, used to score rather than to exclude. */
const DX_TYPICAL = 45;
/** Same baseline, or slightly below it inside the same box. */
const DY_MAX = 26;
const BELOW_MAX = 58;

/**
 * Is this fragment a label for the payable amount?
 * @param {PositionedItem[]} items
 * @param {PositionedItem} candidate
 * @returns {boolean}
 */
function isNetLabel(items, candidate) {
  const own = candidate.text.toUpperCase();
  if (!own.includes('NETTO')) return false;
  if (NOT_A_NET_LABEL.test(own)) return false;

  // The label may be split across fragments, so judge it with its neighbours:
  // "NETTO" alone reads very differently from "RITENUTA NETTA" or "NON ARROT.".
  const context = textAround(items, candidate, 85);
  return NET_LABEL.test(context) && !NOT_A_NET_LABEL.test(context);
}

/**
 * Amount candidates on the page.
 *
 * Besides whole fragments, adjacent fragments on one line are joined and
 * retried: extraction sometimes breaks `2.056,00` into `2.056` and `,00`, and
 * either half alone is not an amount.
 *
 * @param {PositionedItem[]} items
 * @returns {Array<{ item: PositionedItem, cents: Cents }>}
 */
function amountCandidates(items) {
  /** @type {Array<{ item: PositionedItem, cents: Cents }>} */
  const candidates = [];

  for (const item of items) {
    if (!isExactAmount(item.text)) continue;
    const cents = parseItalianAmount(item.text);
    if (cents !== null) candidates.push({ item, cents });
  }

  const byBaseline = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (let index = 0; index < byBaseline.length - 1; index += 1) {
    const left = byBaseline[index];
    const right = byBaseline[index + 1];
    if (Math.abs(left.y - right.y) > 1) continue;
    const joined = `${left.text.trim()}${right.text.trim()}`;
    if (!isExactAmount(joined)) continue;
    const cents = parseItalianAmount(joined);
    if (cents === null) continue;
    candidates.push({
      item: { ...left, text: joined, width: right.x + right.width - left.x },
      cents,
    });
  }

  return candidates.filter(
    ({ cents }) => Math.abs(cents) >= MIN_PLAUSIBLE && Math.abs(cents) <= MAX_PLAUSIBLE,
  );
}

/**
 * Locate the amount in the same visual box as a `NETTO` label.
 * @param {PositionedItem[]} items
 * @returns {Cents | null}
 */
export function findNetAmountByGeometry(items) {
  if (!items || items.length === 0) return null;

  const withText = items.filter((item) => item.text.trim().length > 0);
  const labels = withText.filter((item) => isNetLabel(withText, item));
  if (labels.length === 0) return null;

  const candidates = amountCandidates(withText);
  /** @type {{ cents: Cents, score: number } | null} */
  let best = null;

  for (const label of labels) {
    const context = textAround(withText, label, 80);
    // A label reading exactly "NETTO" is a stronger signal than one where the
    // word only appears among other text.
    const exactLabelBonus = NET_LABEL.test(context) ? 100 : 0;
    const paidOutBonus = /NETTO\s+CORRISPOSTO/.test(context) ? 40 : 0;

    for (const { item: amount, cents } of candidates) {
      const dx = amount.x - (label.x + Math.max(label.width, 0));
      const dy = Math.abs(amount.y - label.y);
      const below = label.y - amount.y;

      const toTheRight = dx >= DX_MIN && dx <= DX_MAX;
      const sameBox = dy <= DY_MAX || (below >= 0 && below <= BELOW_MAX);
      if (!toTheRight || !sameBox) continue;

      const score =
        exactLabelBonus +
        paidOutBonus +
        Math.max(0, 90 - Math.abs(dx - DX_TYPICAL)) +
        Math.max(0, 80 - dy * 2) +
        (cents >= TYPICAL_MIN && cents <= TYPICAL_MAX ? 25 : 0);

      if (best === null || score > best.score) best = { cents, score };
    }
  }

  return best?.cents ?? null;
}

/**
 * @param {Cents} cents
 * @returns {boolean}
 */
function isPlausible(cents) {
  return Math.abs(cents) >= MIN_PLAUSIBLE && Math.abs(cents) <= MAX_PLAUSIBLE;
}

/**
 * Last plausible amount on the first line that carries a `NETTO` label.
 * @param {string[]} lines
 * @returns {Cents | null}
 */
function findOnLabelLine(lines) {
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (!NET_LABEL.test(upper) || NOT_A_NET_LABEL.test(upper)) continue;
    const amounts = findAmountsInText(line).filter((entry) => isPlausible(entry.cents));
    if (amounts.length > 0) return amounts[amounts.length - 1].cents;
  }
  return null;
}

/**
 * Last plausible amount in the few lines following a `NETTO` label — for layouts
 * that print the label above its value rather than beside it.
 * @param {string[]} lines
 * @param {number} [lookahead]
 * @returns {Cents | null}
 */
function findAfterLabel(lines, lookahead = 4) {
  for (let index = 0; index < lines.length; index += 1) {
    const upper = lines[index].toUpperCase();
    if (!NET_LABEL.test(upper) || NOT_A_NET_LABEL.test(upper)) continue;
    const window = lines.slice(index + 1, index + 1 + lookahead).join(' ');
    const amounts = findAmountsInText(window).filter((entry) => isPlausible(entry.cents));
    if (amounts.length > 0) return amounts[amounts.length - 1].cents;
  }
  return null;
}

/**
 * Find the payable amount, reporting how it was found.
 *
 * @param {object} page
 * @param {PositionedItem[]} [page.items] positioned fragments, when available
 * @param {string} [page.text] the page as reconstructed text
 * @returns {{ cents: Cents | null, source: NetAmountSource }}
 */
export function findNetAmount({ items = [], text = '' }) {
  const byGeometry = findNetAmountByGeometry(items);
  if (byGeometry !== null) return { cents: byGeometry, source: 'netto-box' };

  const lines = usefulLines(text);

  const onLine = findOnLabelLine(lines);
  if (onLine !== null) return { cents: onLine, source: 'label-line' };

  const afterLabel = findAfterLabel(lines);
  if (afterLabel !== null) return { cents: afterLabel, source: 'label-window' };

  return { cents: null, source: 'not-found' };
}
