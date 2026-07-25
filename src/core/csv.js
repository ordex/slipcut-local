// @ts-check
/**
 * CSV reading and writing, RFC 4180.
 *
 * Files arrive hand-edited from spreadsheets, so the reader has to cope with
 * what those produce: a UTF-8 BOM, CRLF endings, semicolons instead of commas
 * (what Excel writes in an Italian locale), quoted fields containing the
 * delimiter or a newline, and doubled quotes inside a quoted field.
 *
 * Unquoted fields are trimmed, because a human typing `IT60 …, Mario` means the
 * name without the leading space. Quoted fields are returned exactly as written,
 * because quoting is how you say you meant the spaces.
 */

/** Delimiters worth guessing between, in order of preference. */
const CANDIDATE_DELIMITERS = [',', ';', '\t'];

/**
 * Guess the delimiter from the first line: whichever candidate occurs most
 * often outside quotes wins, with a comma as the tie-break.
 *
 * @param {string} text
 * @returns {string}
 */
export function detectDelimiter(text) {
  const firstLine = stripBom(String(text ?? '')).split(/\r?\n/, 1)[0] ?? '';

  let best = ',';
  let bestCount = 0;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let index = 0; index < firstLine.length; index += 1) {
      const character = firstLine[index];
      if (character === '"') inQuotes = !inQuotes;
      else if (character === delimiter && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse CSV into rows of fields.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.delimiter] defaults to a guess from the first line
 * @returns {string[][]} rows; empty rows are dropped
 */
export function parseCsv(text, options = {}) {
  const source = stripBom(String(text ?? ''));
  const delimiter = options.delimiter ?? detectDelimiter(source);

  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;

  /** Close the field being read and push it onto the current row. */
  const endField = () => {
    row.push(quoted ? field : field.trim());
    field = '';
    quoted = false;
  };

  /** Close the current row, dropping it if it holds nothing at all. */
  const endRow = () => {
    endField();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.trim() === '') {
      // A quote only opens a quoted field at the start of one; elsewhere it is
      // literal, which is what spreadsheets emit for `12" monitor`.
      inQuotes = true;
      quoted = true;
      field = '';
    } else if (character === delimiter) {
      endField();
    } else if (character === '\r') {
      if (source[index + 1] === '\n') index += 1;
      endRow();
    } else if (character === '\n') {
      endRow();
    } else {
      field += character;
    }
  }

  // Whatever is left after the last newline is a final row.
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

/**
 * Quote a value if it needs it. Both delimiters are treated as significant, so
 * the same output is safe to reopen with either.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /["\n\r,;\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Render rows as CSV.
 *
 * @param {Array<Array<unknown>>} rows
 * @param {object} [options]
 * @param {string} [options.delimiter]
 * @param {string} [options.eol]
 * @returns {string}
 */
export function formatCsv(rows, options = {}) {
  const delimiter = options.delimiter ?? ',';
  const eol = options.eol ?? '\n';
  return rows.map((row) => row.map(escapeCsvValue).join(delimiter)).join(eol);
}

/**
 * Fold a header cell to a comparable key: `Codice Fiscale` and `codice_fiscale`
 * are the same column.
 *
 * @param {string} header
 * @returns {string}
 */
export function normaliseHeader(header) {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Look a value up by any of several accepted header names.
 *
 * @param {string[]} headers already normalised
 * @param {string[]} values
 * @param {string[]} aliases accepted names for the column
 * @returns {string} empty when the column is absent
 */
export function fieldByHeader(headers, values, aliases) {
  const index = headers.findIndex((header) => aliases.includes(header));
  return index >= 0 ? (values[index] ?? '') : '';
}
