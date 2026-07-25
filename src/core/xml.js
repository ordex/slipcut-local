// @ts-check
/**
 * A minimal XML writer.
 *
 * The browser could build XML through `document.implementation` and
 * `XMLSerializer`, but then the generator would only be testable inside a page,
 * and bank files are exactly the thing worth testing everywhere. Building the
 * document as a plain tree keeps it a pure function of its input.
 */

/**
 * @typedef {object} XmlElement
 * @property {string} name
 * @property {Record<string, string>} [attributes]
 * @property {string} [text] leaf content; mutually exclusive with children
 * @property {XmlElement[]} [children]
 */

/**
 * An element with children.
 * @param {string} name
 * @param {Array<XmlElement | null | undefined>} [children] nullish entries are dropped, so
 *   optional parts can be written inline
 * @param {Record<string, string>} [attributes]
 * @returns {XmlElement}
 */
export function el(name, children = [], attributes = {}) {
  return {
    name,
    attributes,
    children: /** @type {XmlElement[]} */ (children.filter(Boolean)),
  };
}

/**
 * An element containing text.
 * @param {string} name
 * @param {string | number} text
 * @param {Record<string, string>} [attributes]
 * @returns {XmlElement}
 */
export function leaf(name, text, attributes = {}) {
  return { name, attributes, text: String(text) };
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

/**
 * @param {XmlElement} element
 * @param {string} indent
 * @param {number} depth
 * @returns {string[]}
 */
function renderLines(element, indent, depth) {
  const pad = indent.repeat(depth);
  const attributes = Object.entries(element.attributes ?? {})
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');

  if (element.text !== undefined) {
    return [`${pad}<${element.name}${attributes}>${escapeText(element.text)}</${element.name}>`];
  }

  const children = element.children ?? [];
  if (children.length === 0) return [`${pad}<${element.name}${attributes}/>`];

  return [
    `${pad}<${element.name}${attributes}>`,
    ...children.flatMap((child) => renderLines(child, indent, depth + 1)),
    `${pad}</${element.name}>`,
  ];
}

/**
 * Serialise a document.
 *
 * @param {XmlElement} root
 * @param {object} [options]
 * @param {string} [options.indent] two spaces by default; pass '' for one line
 * @param {boolean} [options.declaration] include the XML declaration
 * @returns {string}
 */
export function serialiseXml(root, options = {}) {
  const indent = options.indent ?? '  ';
  const declaration = options.declaration ?? true;
  const body = renderLines(root, indent, 0).join(indent === '' ? '' : '\n');
  return declaration ? `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n` : `${body}\n`;
}
