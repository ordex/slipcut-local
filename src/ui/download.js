// @ts-check
/**
 * Handing a generated file to the user.
 *
 * A blob URL and a synthetic click is the only way to save a file the page
 * produced itself without involving a server, which is the whole point here.
 */

/**
 * @param {Blob} blob
 * @param {string} fileName
 */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next turn of the event loop: Safari has not finished with the
  // URL when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * @param {string} text
 * @param {string} fileName
 * @param {string} [mimeType]
 */
export function downloadText(text, fileName, mimeType = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mimeType }), fileName);
}
