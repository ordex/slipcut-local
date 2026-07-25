// @ts-check
/**
 * The application: what the buttons do.
 *
 * Wiring only. Every rule lives in `core/`, every PDF concern in `pdf/`, and the
 * document work happens in the worker; this module holds the state the page is
 * showing and moves data between them.
 */

import { formatExtractionSummaryCsv } from './core/summary-csv.js';
import { byId, setStatus, setVisible } from './ui/dom.js';
import { downloadBlob, downloadText } from './ui/download.js';
import { extractionSummary, renderExtractionTable } from './ui/views/extraction-table.js';

/** @typedef {import('./core/payslip.js').PayslipPage} PayslipPage */

/** Larger than this is not a month of payslips, it is a mistake. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * @typedef {object} AppState
 * @property {File | null} file
 * @property {PayslipPage[]} pages
 * @property {Blob | null} archive
 * @property {string} archiveName
 */

/** @type {AppState} */
const state = {
  file: null,
  pages: [],
  archive: null,
  archiveName: 'cedolini.zip',
};

const elements = {
  dropZone: byId('drop-zone'),
  pickFile: byId('pick-file'),
  fileInput: /** @type {HTMLInputElement} */ (byId('file-input')),
  fileStatus: byId('file-status'),
  progress: byId('progress'),
  progressBar: byId('progress-bar'),
  progressLabel: byId('progress-label'),
  extractionSection: byId('extraction-section'),
  extractionSummary: byId('extraction-summary'),
  extractionRows: byId('extraction-rows'),
  downloadArchive: /** @type {HTMLButtonElement} */ (byId('download-archive')),
  downloadSummary: /** @type {HTMLButtonElement} */ (byId('download-summary')),
};

/**
 * @param {number} done
 * @param {number} total
 * @param {string} label
 */
function showProgress(done, total, label) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  setVisible(elements.progress, true);
  elements.progressBar.style.width = `${percent}%`;
  elements.progressLabel.textContent = `${label} ${done}/${total}`;
}

function hideProgress() {
  setVisible(elements.progress, false);
  elements.progressBar.style.width = '0%';
}

function resetResults() {
  state.pages = [];
  state.archive = null;
  setVisible(elements.extractionSection, false);
  renderExtractionTable(elements.extractionRows, []);
}

/**
 * @param {File} file
 * @returns {string | null} the reason it cannot be used
 */
function rejectionReason(file) {
  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) return 'Il file selezionato non è un PDF.';
  if (file.size > MAX_FILE_BYTES) {
    return `Il file supera ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`;
  }
  if (file.size === 0) return 'Il file è vuoto.';
  return null;
}

/**
 * Run the document through the worker.
 *
 * @param {File} file
 * @returns {Promise<import('./worker.js').DoneMessage>}
 */
function runWorker(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

    /** @param {Error} error */
    const fail = (error) => {
      worker.terminate();
      reject(error);
    };

    worker.addEventListener('message', (event) => {
      const message = /** @type {import('./worker.js').WorkerMessage} */ (event.data);
      switch (message.type) {
        case 'progress':
          showProgress(
            message.done,
            message.total,
            message.phase === 'reading' ? 'Lettura pagina' : 'Archiviazione pagina',
          );
          return;
        case 'done':
          worker.terminate();
          resolve(message);
          return;
        case 'failed':
          fail(new Error(message.message));
          return;
        default:
          // Not ours: a nested library posting diagnostics, for instance.
          return;
      }
    });

    worker.addEventListener('error', (event) => {
      fail(new Error(event.message || 'Il worker di elaborazione non è disponibile.'));
    });

    file
      .arrayBuffer()
      .then((bytes) => worker.postMessage({ type: 'process', bytes, fileName: file.name }, [bytes]))
      .catch(fail);
  });
}

/** @param {File} file */
async function processFile(file) {
  const reason = rejectionReason(file);
  if (reason !== null) {
    state.file = null;
    resetResults();
    setStatus(elements.fileStatus, reason, 'error');
    return;
  }

  state.file = file;
  resetResults();
  setStatus(elements.fileStatus, `Elaborazione di ${file.name}…`);
  showProgress(0, 1, 'Apertura');

  try {
    const result = await runWorker(file);
    state.pages = result.pages;
    state.archive = result.archive;
    state.archiveName = `${file.name.replace(/\.pdf$/i, '')}-cedolini.zip`;

    renderExtractionTable(elements.extractionRows, result.pages);
    elements.extractionSummary.textContent = extractionSummary(result);
    setVisible(elements.extractionSection, true);
    setStatus(elements.fileStatus, `${file.name} elaborato.`, 'ok');
    onExtractionReady(result.pages);
  } catch (error) {
    setStatus(
      elements.fileStatus,
      error instanceof Error ? error.message : 'Errore durante l’elaborazione.',
      'error',
    );
  } finally {
    hideProgress();
  }
}

/**
 * Extension point for the payment step, which is wired separately.
 * @type {(pages: PayslipPage[]) => void}
 */
let onExtractionReady = () => {};

/** @param {(pages: PayslipPage[]) => void} handler */
export function whenExtractionReady(handler) {
  onExtractionReady = handler;
}

/** @returns {PayslipPage[]} */
export function currentPages() {
  return state.pages;
}

// --- upload ---------------------------------------------------------------

elements.pickFile.addEventListener('click', (event) => {
  event.stopPropagation();
  elements.fileInput.click();
});

elements.dropZone.addEventListener('click', () => elements.fileInput.click());

elements.dropZone.addEventListener('keydown', (event) => {
  const key = /** @type {KeyboardEvent} */ (event).key;
  if (key === 'Enter' || key === ' ') {
    event.preventDefault();
    elements.fileInput.click();
  }
});

elements.fileInput.addEventListener('change', () => {
  const file = elements.fileInput.files?.[0];
  if (file) void processFile(file);
  // Cleared so choosing the same file again still fires a change event.
  elements.fileInput.value = '';
});

for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    elements.dropZone.classList.toggle(
      'dragging',
      eventName === 'dragenter' || eventName === 'dragover',
    );
  });
}

elements.dropZone.addEventListener('drop', (event) => {
  const file = /** @type {DragEvent} */ (event).dataTransfer?.files?.[0];
  if (file) void processFile(file);
});

// --- downloads ------------------------------------------------------------

elements.downloadArchive.addEventListener('click', () => {
  if (state.archive === null) return;
  downloadBlob(state.archive, state.archiveName);
});

elements.downloadSummary.addEventListener('click', () => {
  if (state.pages.length === 0) return;
  downloadText(formatExtractionSummaryCsv(state.pages), 'riepilogo-estrazione.csv', 'text/csv;charset=utf-8');
});
