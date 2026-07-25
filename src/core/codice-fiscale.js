// @ts-check
/**
 * Codice Fiscale: recognition inside extracted text, and check character
 * validation.
 *
 * A payslip page carries at least two tax identifiers — the employer's and the
 * employee's — so recognition alone is not enough to pick the right one. The
 * check character is what makes a candidate trustworthy; callers still decide
 * which of the valid ones they want.
 */

/**
 * Structure of a personal Codice Fiscale: six name consonants, two year digits,
 * a month letter, two day digits, a four-character place code, one check
 * character. Digits in the numeric positions may be substituted by letters
 * (omocodia), which is why the classes are wider than `[0-9]`.
 *
 * Matched against already upper-cased text.
 */
const CODICE_FISCALE =
  /(?:[A-Z][AEIOU][AEIOUX]|[AEIOU]X{2}|[B-DF-HJ-NP-TV-Z]{2}[A-Z]){2}(?:[0-9LMNP-V]{2}(?:[A-EHLMPR-T](?:[04LQ][1-9MNP-V]|[15MR][0-9LMNP-V]|[26NS][0-8LMNP-U])|[DHPS][37PT][0L]|[ACELMRT][37PT][01LM]|[AC-EHLMPR-T][26NS][9V])|(?:[02468LNQSU][048LQU]|[13579MPRTV][26NS])B[26NS][9V])(?:[A-MZ][1-9MNP-V][0-9LMNP-V]{2}|[A-M][0L](?:[1-9MNP-V][0-9LMNP-V]|[0L][1-9MNP-V]))[A-Z]/g;

/**
 * Weights for the odd positions (1-based) of the check character algorithm.
 * @type {Record<string, number>}
 */
const ODD_WEIGHTS = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4,
  M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22,
  X: 25, Y: 24, Z: 23,
};

/**
 * Weight for an even position: digits count as themselves, letters as their
 * alphabet index.
 * @param {string} character
 * @returns {number | null}
 */
function evenWeight(character) {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 65;
  return null;
}

/**
 * Keep only the characters a Codice Fiscale can contain.
 * @param {string} input
 * @returns {string}
 */
export function normaliseCodiceFiscale(input) {
  return String(input ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

/**
 * Validate the sixteenth character against the other fifteen.
 * @param {string} input
 * @returns {boolean}
 */
export function hasValidCheckCharacter(input) {
  const codiceFiscale = normaliseCodiceFiscale(input);
  if (!/^[A-Z0-9]{16}$/.test(codiceFiscale)) return false;

  let sum = 0;
  for (let position = 0; position < 15; position += 1) {
    const character = codiceFiscale[position];
    // Positions are 1-based in the specification: index 0 is an odd position.
    const weight = position % 2 === 0 ? ODD_WEIGHTS[character] : evenWeight(character);
    if (weight === undefined || weight === null) return false;
    sum += weight;
  }

  return codiceFiscale[15] === String.fromCharCode(65 + (sum % 26));
}

/**
 * Scan already-upper-cased text for valid codes, in order, without duplicates.
 * @param {string} text
 * @returns {string[]}
 */
function scan(text) {
  const seen = new Set();
  /** @type {string[]} */
  const found = [];
  for (const match of text.matchAll(CODICE_FISCALE)) {
    const codiceFiscale = match[0];
    if (!seen.has(codiceFiscale) && hasValidCheckCharacter(codiceFiscale)) {
      seen.add(codiceFiscale);
      found.push(codiceFiscale);
    }
  }
  return found;
}

/**
 * Every distinct valid Codice Fiscale in the text, in the order they appear.
 *
 * If the plain scan finds nothing, it retries with all whitespace removed: PDF
 * text extraction sometimes splits a code across fragments, and a page whose
 * code goes unrecognised is a page the caller has to skip entirely. The retry is
 * a fallback rather than the default because joining unrelated tokens could
 * synthesise a code that was never printed.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function findCodiciFiscali(text) {
  const upper = String(text ?? '').toUpperCase();
  const spaced = scan(upper.replace(/\s+/g, ' '));
  return spaced.length > 0 ? spaced : scan(upper.replace(/\s+/g, ''));
}

/**
 * The first valid Codice Fiscale in the text, if any.
 * @param {string} text
 * @returns {string | null}
 */
export function findFirstCodiceFiscale(text) {
  return findCodiciFiscali(text)[0] ?? null;
}
