// @ts-check
/**
 * Deriving the name part of a Codice Fiscale, and matching a printed name
 * against one.
 *
 * A payslip prints the employee's name somewhere near their tax code, but so
 * does it print the employer, an address, a job title and a cost centre.
 * Picking the name by proximity guesses; deriving the six-character name code
 * from a candidate and comparing it to the code that is actually printed
 * proves it.
 */

const VOWELS = 'AEIOU';

/** Honorifics that appear before a name and are not part of it. */
const TITLES = /\b(?:SIG|SIGRA|SIGNOR|SIGNORA|DOTT|DOTTSSA|DOTTORESSA|ING|AVV|PROF|RAG)\b/g;

/**
 * Fold to the plain uppercase letters the Codice Fiscale is built from:
 * accents are dropped (NICOLÒ -> NICOLO), apostrophes and hyphens become word
 * breaks (D'ALESSIO -> D ALESSIO).
 * @param {string} input
 * @returns {string}
 */
export function normalisePersonName(input) {
  return String(input ?? '')
    .normalize('NFD')
    // Combining marks left behind by the decomposition.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z' -]/g, ' ')
    .replace(/['-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * @param {string} input
 * @returns {string} letters only, no separators
 */
function letters(input) {
  return normalisePersonName(input).replace(/[^A-Z]/g, '');
}

/**
 * @param {string} input
 * @returns {string[]}
 */
function consonantsOf(input) {
  return [...letters(input)].filter((character) => !VOWELS.includes(character));
}

/**
 * @param {string} input
 * @returns {string[]}
 */
function vowelsOf(input) {
  return [...letters(input)].filter((character) => VOWELS.includes(character));
}

/**
 * Surname code: consonants in order, then vowels, padded with X.
 * @param {string} surname
 * @returns {string} three characters
 */
export function surnameCode(surname) {
  return [...consonantsOf(surname), ...vowelsOf(surname), 'X', 'X', 'X'].slice(0, 3).join('');
}

/**
 * Given-name code: as the surname, except that a name with four or more
 * consonants contributes the first, third and fourth — never the second.
 * @param {string} givenName
 * @returns {string} three characters
 */
export function givenNameCode(givenName) {
  const consonants = consonantsOf(givenName);
  const chosen =
    consonants.length > 3 ? [consonants[0], consonants[2], consonants[3]] : consonants;
  return [...chosen, ...vowelsOf(givenName), 'X', 'X', 'X'].slice(0, 3).join('');
}

/**
 * The first six characters of the Codice Fiscale for this name.
 * @param {string} surname
 * @param {string} givenName
 * @returns {string}
 */
export function nameCode(surname, givenName) {
  return `${surnameCode(surname)}${givenNameCode(givenName)}`;
}

/**
 * @typedef {object} NameMatch
 * @property {string} fullName the candidate, normalised
 * @property {string} surname the part that matched as a surname
 * @property {string} givenName the part that matched as a given name
 */

/**
 * Match a printed name against a Codice Fiscale.
 *
 * Payroll prints `SURNAME GIVEN_NAME`, but either part can be several words
 * ("MAURO MARCO ANTONIO"), so every split is tried and the one whose derived
 * code equals the printed one wins. Ambiguity is possible in principle but the
 * check is what makes a candidate usable at all.
 *
 * @param {string} candidate
 * @param {string | null} codiceFiscale
 * @returns {NameMatch | null}
 */
export function matchNameToCodiceFiscale(candidate, codiceFiscale) {
  if (!codiceFiscale || codiceFiscale.length < 6) return null;

  const fullName = normalisePersonName(candidate).replace(TITLES, ' ').replace(/\s+/g, ' ').trim();
  const tokens = fullName.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return null;
  if (tokens.some((token) => token.length < 2)) return null;

  const expected = codiceFiscale.slice(0, 6).toUpperCase();
  for (let split = 1; split < tokens.length; split += 1) {
    const surname = tokens.slice(0, split).join(' ');
    const givenName = tokens.slice(split).join(' ');
    if (nameCode(surname, givenName) === expected) {
      return { fullName: tokens.join(' '), surname, givenName };
    }
  }

  return null;
}
