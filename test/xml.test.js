// @ts-check
import { assert, test } from './harness.js';
import { el, escapeText, leaf, serialiseXml } from '../src/core/xml.js';

test('serialiseXml writes a declaration and a root', () => {
  assert.equal(serialiseXml(el('Document')), '<?xml version="1.0" encoding="UTF-8"?>\n<Document/>\n');
});

test('serialiseXml nests and indents', () => {
  const xml = serialiseXml(el('A', [el('B', [leaf('C', 'x')])]), { declaration: false });
  assert.equal(xml, '<A>\n  <B>\n    <C>x</C>\n  </B>\n</A>\n');
});

test('serialiseXml writes attributes', () => {
  const xml = serialiseXml(leaf('InstdAmt', '2056.00', { Ccy: 'EUR' }), { declaration: false });
  assert.equal(xml, '<InstdAmt Ccy="EUR">2056.00</InstdAmt>\n');
});

test('serialiseXml can write one line', () => {
  const xml = serialiseXml(el('A', [leaf('B', '1')]), { declaration: false, indent: '' });
  assert.equal(xml, '<A><B>1</B></A>\n');
});

test('el drops nullish children so optional parts can be inline', () => {
  const xml = serialiseXml(el('A', [leaf('B', '1'), null, undefined, leaf('C', '2')]), {
    declaration: false,
  });
  assert.equal(xml, '<A>\n  <B>1</B>\n  <C>2</C>\n</A>\n');
});

test('text content is escaped', () => {
  assert.equal(escapeText('Rossi & Figli <srl>'), 'Rossi &amp; Figli &lt;srl&gt;');
  const xml = serialiseXml(leaf('Nm', 'Rossi & Figli <srl>'), { declaration: false });
  assert.equal(xml, '<Nm>Rossi &amp; Figli &lt;srl&gt;</Nm>\n');
});

test('attribute values are escaped', () => {
  const xml = serialiseXml(leaf('A', 'x', { note: 'a "b" & c' }), { declaration: false });
  assert.equal(xml, '<A note="a &quot;b&quot; &amp; c">x</A>\n');
});

test('an empty text node stays an element', () => {
  assert.equal(serialiseXml(leaf('Nm', ''), { declaration: false }), '<Nm></Nm>\n');
});

test('numbers are written as text', () => {
  assert.equal(serialiseXml(leaf('NbOfTxs', 12), { declaration: false }), '<NbOfTxs>12</NbOfTxs>\n');
});
