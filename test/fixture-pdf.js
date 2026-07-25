// @ts-check
/**
 * Build a payslip-shaped PDF for the tests.
 *
 * Real payslips carry personal data and cannot live in a repository, so the
 * suite generates its own: uncompressed, one standard font, text placed at the
 * coordinates a real extraction reports for this layout.
 *
 * Written here rather than committed as a binary so it stays reviewable, and
 * generated in JavaScript so both runners can use it with no external tool.
 */

/** @typedef {{ x: number, y: number, size: number, text: string }} Placed */

/**
 * The employee layout: payable amount bottom right, gross and taxable above it
 * as decoys.
 * @type {Placed[]}
 */
export const EMPLOYEE_PAGE = [
  { x: 60, y: 760, size: 10, text: 'RED YARD RESEARCH SRL  CF: 01234567890' },
  { x: 60, y: 730, size: 10, text: 'COD. FISC. FRMFRC91P22D086S' },
  { x: 60, y: 710, size: 10, text: 'FORMICA FEDERICO' },
  { x: 60, y: 690, size: 10, text: 'GIUGNO 2026' },
  { x: 60, y: 400, size: 9, text: '1 RETRIBUZIONE ORDINARIA' },
  { x: 300, y: 400, size: 9, text: '3.000,00' },
  { x: 60, y: 200, size: 9, text: 'IMPONIBILE' },
  { x: 300, y: 200, size: 9, text: '2.500,00' },
  { x: 380, y: 100, size: 10, text: 'NETTO' },
  { x: 445, y: 100, size: 10, text: '2.056,00' },
];

/** The contractor layout: the label reads NETTO CORRISPOSTO, in two fragments. */
/** @type {Placed[]} */
export const COLLABORATOR_PAGE = [
  { x: 60, y: 760, size: 10, text: 'RED YARD RESEARCH SRL  CF: 01234567890' },
  { x: 60, y: 730, size: 10, text: 'PERCIPIENTE PERIODO COMPENSO' },
  { x: 60, y: 710, size: 10, text: 'MAURO MARCO ANTONIO' },
  { x: 60, y: 690, size: 10, text: 'COD. FISC. MRAMCN90E04D086C' },
  { x: 60, y: 670, size: 10, text: 'GIUGNO 2026' },
  { x: 60, y: 400, size: 9, text: '1352 COMPENSO LORDO' },
  { x: 300, y: 400, size: 9, text: '2.400,00' },
  { x: 330, y: 100, size: 10, text: 'NETTO' },
  { x: 366, y: 100, size: 10, text: 'CORRISPOSTO' },
  { x: 460, y: 100, size: 10, text: '1.851,00' },
];

/** A page with nothing identifying on it, as cover sheets are. */
/** @type {Placed[]} */
export const COVER_PAGE = [
  { x: 60, y: 760, size: 12, text: 'RIEPILOGO MENSILE' },
  { x: 60, y: 700, size: 10, text: 'TOTALE NETTI 3.907,00' },
];

/**
 * @param {string} text
 * @returns {string}
 */
function escapePdfString(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * @param {Placed[]} placed
 * @returns {string}
 */
function contentStream(placed) {
  const lines = placed.map(
    (item) => `/F1 ${item.size} Tf 1 0 0 1 ${item.x} ${item.y} Tm (${escapePdfString(item.text)}) Tj`,
  );
  return ['BT', ...lines, 'ET'].join('\n');
}

/**
 * Build an uncompressed PDF containing the given pages.
 *
 * @param {Placed[][]} pages
 * @returns {Uint8Array}
 */
export function buildFixturePdf(pages) {
  const encoder = new TextEncoder();
  /** @type {Map<number, string>} */
  const objects = new Map();

  const kids = pages.map((_, index) => `${4 + 2 * index} 0 R`).join(' ');
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pages.forEach((placed, index) => {
    const pageId = 4 + 2 * index;
    const streamId = 5 + 2 * index;
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    const stream = contentStream(placed);
    objects.set(
      streamId,
      `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`,
    );
  });

  /** @type {number[]} */
  const bytes = [];
  /** @param {string} text */
  const push = (text) => {
    for (const byte of encoder.encode(text)) bytes.push(byte);
  };

  push('%PDF-1.4\n');

  /** @type {Map<number, number>} */
  const offsets = new Map();
  const numbers = [...objects.keys()].sort((a, b) => a - b);
  for (const number of numbers) {
    offsets.set(number, bytes.length);
    push(`${number} 0 obj\n${objects.get(number)}\nendobj\n`);
  }

  const xrefOffset = bytes.length;
  const highest = numbers[numbers.length - 1];
  push(`xref\n0 ${highest + 1}\n`);
  push('0000000000 65535 f \n');
  for (let number = 1; number <= highest; number += 1) {
    push(`${String(offsets.get(number) ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${highest + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Uint8Array(bytes);
}

/** The document the tests use: two payslips and a cover sheet. */
export function buildPayslipFixture() {
  return buildFixturePdf([EMPLOYEE_PAGE, COLLABORATOR_PAGE, COVER_PAGE]);
}
