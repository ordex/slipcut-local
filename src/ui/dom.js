// @ts-check
/**
 * The small amount of DOM plumbing the views need.
 *
 * Everything builds nodes and sets `textContent`; nothing assembles HTML from
 * strings. That is not stylistic: every value rendered here comes out of a PDF
 * somebody else produced or a CSV somebody else typed, and string-built markup
 * turns an odd payslip into script execution. Escaping by hand works right up
 * until one call site forgets.
 */

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
export function byId(id) {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Elemento #${id} non trovato`);
  return /** @type {T} */ (element);
}

/**
 * Create an element.
 *
 * `props` sets properties directly (`className`, `textContent`, `disabled`, …);
 * keys prefixed `data-` or `aria-`, plus `role`, become attributes. Children may
 * be nodes, strings, numbers, or nullish to skip.
 *
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @param {Array<Node | string | number | null | undefined>} [children]
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, children = []) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role') {
      element.setAttribute(key, String(value));
    } else {
      Reflect.set(element, key, value);
    }
  }

  for (const child of children) {
    if (child === null || child === undefined) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return element;
}

/**
 * Replace an element's children.
 * @param {HTMLElement} parent
 * @param {Array<Node | null | undefined>} children
 */
export function replaceChildren(parent, children) {
  parent.replaceChildren(...children.filter((child) => child !== null && child !== undefined));
}

/**
 * @param {HTMLElement} element
 * @param {boolean} visible
 */
export function setVisible(element, visible) {
  element.classList.toggle('hidden', !visible);
}

/**
 * Show a message, with a tone.
 * @param {HTMLElement} element
 * @param {string} message
 * @param {'plain' | 'ok' | 'error'} [tone]
 */
export function setStatus(element, message, tone = 'plain') {
  element.textContent = message;
  element.classList.toggle('ok', tone === 'ok');
  element.classList.toggle('error', tone === 'error');
}

/**
 * A single full-width row saying there is nothing to show.
 * @param {number} columns
 * @param {string} message
 * @returns {HTMLElement}
 */
export function emptyRow(columns, message) {
  return h('tr', { className: 'empty-row' }, [h('td', { colSpan: columns, textContent: message })]);
}
