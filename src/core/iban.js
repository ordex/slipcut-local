// @ts-check
/**
 * IBAN validation, ISO 13616 / ISO 7064 MOD-97-10.
 *
 * Structural check only: it proves the account number is internally consistent,
 * not that the account exists.
 */

/** Country code, check digits, then 11–30 alphanumerics. */
const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/**
 * Strip formatting spaces and upper-case. Users paste IBANs in printed groups
 * of four.
 * @param {string} iban
 * @returns {string}
 */
export function normaliseIban(iban) {
  return String(iban ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * MOD-97-10 over the rearranged IBAN, computed digit by digit so no
 * intermediate value can exceed a safe integer.
 * @param {string} iban already normalised and shape-checked
 * @returns {number} remainder, 1 for a valid IBAN
 */
function mod97(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    // A–Z expand to 10–35, each expansion consumed one digit at a time.
    const expanded =
      character >= 'A' && character <= 'Z'
        ? String(character.charCodeAt(0) - 55)
        : character;
    for (const digit of expanded) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

/**
 * @param {string} input
 * @returns {boolean}
 */
export function isValidIban(input) {
  const iban = normaliseIban(input);
  return IBAN_SHAPE.test(iban) && mod97(iban) === 1;
}

/**
 * The country the account sits in, taken from the IBAN itself. Bank CSV formats
 * ask for it as a separate column.
 * @param {string} input
 * @returns {string} two-letter code, empty when the input is too short
 */
export function ibanCountry(input) {
  return normaliseIban(input).slice(0, 2);
}

/**
 * Shorten for display, so a full account number never sits in the DOM longer
 * than it must: `IT60…3456`.
 * @param {string} input
 * @returns {string}
 */
export function maskIban(input) {
  const iban = normaliseIban(input);
  return iban.length <= 8 ? iban : `${iban.slice(0, 4)}…${iban.slice(-4)}`;
}
