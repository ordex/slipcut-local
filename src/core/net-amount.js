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

/**
 * Two layouts put an amount with its label, and only two.
 *
 * *Beside*: the amount is on the label's baseline, to its right — `NETTO
 * 2.056,00`.
 *
 * *Below*: the label is a heading and the value sits under it, roughly in its
 * column. Real payslips do this with a shaded `NETTO DEL MESE` bar above the
 * figure.
 *
 * What an amount may never be is meaningfully *above* its label. Allowing that
 * is how a payslip whose layout reads
 *
 *     TOTALE TRATTENUTE   1.155,00
 *     ARROTONDAMENTO          0,73
 *     NETTO DEL MESE
 *          2.845,00 €
 *
 * gets read as paying out the withholdings.
 */

/** Baselines within this are the same line; beyond it the amount is above or below. */
const BESIDE_DY = 4;
/** Beside: how far right of the label's end the amount may start. */
const DX_MIN = -4;
const DX_MAX = 220;
/** Beside: where the amount usually starts, used to score rather than to exclude. */
const DX_TYPICAL = 45;
/** Below: how far under the label the value may sit. */
const BELOW_MAX = 58;
/** Below: how far the value may be offset from the label's column. */
const COLUMN_SLACK = 60;

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
 * How well an amount's position fits one of the two layouts, or null when it fits
 * neither and is therefore not this label's value.
 *
 * @param {PositionedItem} label
 * @param {PositionedItem} amount
 * @returns {number | null} higher is a better fit
 */
function positionScore(label, amount) {
  const labelEnd = label.x + Math.max(label.width, 0);
  const below = label.y - amount.y;

  if (Math.abs(below) <= BESIDE_DY) {
    const dx = amount.x - labelEnd;
    if (dx < DX_MIN || dx > DX_MAX) return null;
    return Math.max(0, 90 - Math.abs(dx - DX_TYPICAL)) + 80;
  }

  if (below > BESIDE_DY && below <= BELOW_MAX) {
    // In the label's column: the value may be centred, indented or right-aligned
    // under it, but it does not wander off into a neighbouring box.
    const startsBeforeColumn = amount.x + amount.width < label.x - COLUMN_SLACK;
    const startsAfterColumn = amount.x > labelEnd + DX_MAX;
    if (startsBeforeColumn || startsAfterColumn) return null;
    return Math.max(0, 80 - below) + Math.max(0, 60 - Math.abs(amount.x - label.x) / 2);
  }

  // Above the label, or too far below it.
  return null;
}

/**
 * Locate the amount belonging to a `NETTO` label.
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
    const paidOutBonus = /NETTO\s+(?:CORRISPOSTO|DEL\s+MESE)/.test(context) ? 40 : 0;

    for (const { item: amount, cents } of candidates) {
      const fit = positionScore(label, amount);
      if (fit === null) continue;

      const score =
        exactLabelBonus +
        paidOutBonus +
        fit +
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
