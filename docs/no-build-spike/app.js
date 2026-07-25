// The SlipCut Local pipeline with no build step, no npm, no Node:
// native ES modules, vendored libraries, platform deflate.
//
// Note the imports: plain relative paths the browser resolves itself. There is
// no bundler, no `node_modules` resolution, no transpiler.
import * as pdfjsLib from './vendor/pdf.min.mjs';
import { PDFDocument } from './vendor/pdf-lib.esm.min.js';
import { ZipWriter } from './zip.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

const log = (line) => {
  document.querySelector('#out').textContent += `${line}\n`;
  results.lines.push(line);
};

// Exposed so Playwright (or a human) can read the outcome.
const results = { lines: [], ok: false, zipBase64: null, items: [] };
window.slipcutResults = results;

/** pdfWorker.ts:52-67 — items with geometry, unchanged logic. */
function toPositionedTextItems(items) {
  return items
    .map((item) => {
      const transform = item.transform ?? [];
      return {
        str: String(item.str ?? '').trim(),
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0),
        width: Number(item.width ?? 0),
        height: Number(item.height ?? transform[3] ?? 0),
      };
    })
    .filter((item) => item.str.length > 0);
}

/** pdfWorker.ts:69-82 — line reconstruction, unchanged logic. */
function reconstructLines(positioned) {
  const buckets = new Map();
  for (const item of positioned) {
    const yBucket = Math.round(item.y / 3) * 3;
    const line = buckets.get(yBucket) ?? [];
    line.push(item);
    buckets.set(yBucket, line);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, line]) => line.sort((a, b) => a.x - b.x).map((i) => i.str).join(' '))
    .join('\n');
}

async function run() {
  try {
    log(`pdf.js ${pdfjsLib.version} loaded as a native ES module (no bundler)`);

    const bytes = new Uint8Array(await (await fetch('./sample.pdf')).arrayBuffer());

    // --- text + geometry, via vendored pdf.js ---
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    log(`pages: ${pdf.numPages}`);

    const page = await pdf.getPage(1);
    const positioned = toPositionedTextItems((await page.getTextContent()).items);
    results.items = positioned;
    for (const it of positioned) {
      log(`x=${it.x.toFixed(2).padStart(7)} y=${it.y.toFixed(2).padStart(7)} w=${it.width.toFixed(2).padStart(6)} ${JSON.stringify(it.str)}`);
    }

    const netto = positioned.find((i) => i.str === 'NETTO');
    const amount = positioned.find((i) => i.str === '2.056,00');
    const dx = amount.x - (netto.x + netto.width);
    log(`\nNETTO -> amount dx = ${dx.toFixed(2)} (same baseline: ${Math.abs(netto.y - amount.y) < 1})`);
    log(`reconstructed lines:\n${reconstructLines(positioned)}`);

    // --- split, via vendored pdf-lib ---
    const source = await PDFDocument.load(bytes.slice());
    const zip = new ZipWriter();
    let allSingle = true;
    for (let i = 0; i < source.getPageCount(); i += 1) {
      const out = await PDFDocument.create();
      const [copied] = await out.copyPages(source, [i]);
      out.addPage(copied);
      const saved = await out.save();
      await zip.file(`page_${i + 1}.pdf`, saved);
      const reopened = await PDFDocument.load(saved);
      if (reopened.getPageCount() !== 1) allSingle = false;
    }
    await zip.file('extraction_rows.json', JSON.stringify({ pages: source.getPageCount() }, null, 2));

    // --- zip, with no jszip: platform deflate ---
    const blob = zip.finish();
    const zipBytes = new Uint8Array(await blob.arrayBuffer());
    log(`\nzip: ${zipBytes.length} bytes, entries written with CompressionStream('deflate-raw')`);
    log(`every split file is a valid 1-page PDF: ${allSingle}`);

    let binary = '';
    for (const b of zipBytes) binary += String.fromCharCode(b);
    results.zipBase64 = btoa(binary);

    results.ok = allSingle && dx > 30 && dx < 33 && pdf.numPages === 2;
    log(results.ok ? '\nOK — pipeline complete with no build step' : '\nFAILED');
  } catch (error) {
    log(`ERROR: ${error && error.stack ? error.stack : error}`);
    results.ok = false;
  } finally {
    results.done = true;
  }
}

run();
