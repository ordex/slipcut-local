// @ts-check
import { assert, test } from './harness.js';
import { crc32, ZipWriter } from '../src/zip.js';

/**
 * Read the fields back out of a finished archive, so the tests check the bytes
 * rather than trusting the writer that produced them.
 * @param {Uint8Array} bytes
 */
function parseArchive(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  // End of central directory is the last 22 bytes when there is no comment.
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory signature');
  const count = view.getUint16(end + 8, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  assert.equal(directoryOffset + directorySize, end, 'directory ends where the trailer starts');

  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50, 'central header signature');
    const nameLength = view.getUint16(cursor + 28, true);
    const entry = {
      flags: view.getUint16(cursor + 8, true),
      method: view.getUint16(cursor + 10, true),
      crc: view.getUint32(cursor + 16, true),
      compressedSize: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
      localOffset: view.getUint32(cursor + 42, true),
      name: decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)),
    };
    entries.push(entry);

    // The local header must agree with the directory.
    assert.equal(view.getUint32(entry.localOffset, true), 0x04034b50, 'local header signature');
    assert.equal(view.getUint32(entry.localOffset + 14, true), entry.crc, 'crc matches');
    assert.equal(view.getUint32(entry.localOffset + 18, true), entry.compressedSize, 'compressed size matches');
    assert.equal(view.getUint32(entry.localOffset + 22, true), entry.size, 'size matches');

    cursor += 46 + nameLength;
  }

  return { count, entries };
}

/**
 * @param {Blob} blob
 * @returns {Promise<Uint8Array>}
 */
async function toBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Decompress a stored or deflated entry back to text.
 * @param {Uint8Array} archive
 * @param {{ localOffset: number, method: number, compressedSize: number, name: string }} entry
 * @returns {Promise<string>}
 */
async function readEntry(archive, entry) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const body = archive.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(body);
  const stream = new Blob([/** @type {BlobPart} */ (body)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

test('crc32 matches known values', () => {
  const encoder = new TextEncoder();
  assert.equal(crc32(encoder.encode('')), 0);
  assert.equal(crc32(encoder.encode('a')), 0xe8b7be43);
  assert.equal(crc32(encoder.encode('123456789')), 0xcbf43926);
});

test('an empty archive is still a valid archive', async () => {
  const zip = new ZipWriter();
  assert.equal(zip.length, 0);
  const bytes = await toBytes(zip.finish());
  assert.equal(bytes.length, 22, 'just the trailer');
  const { count } = parseArchive(bytes);
  assert.equal(count, 0);
});

test('entries round-trip through the archive', async () => {
  const zip = new ZipWriter();
  // Long enough that deflate wins.
  const payload = 'NETTO 2.056,00\n'.repeat(50);
  await zip.file('FRMFRC91P22D086S/202606/page_1.pdf', payload);
  await zip.file('note.txt', 'ciao');
  assert.equal(zip.length, 2);

  const bytes = await toBytes(zip.finish());
  const { count, entries } = parseArchive(bytes);
  assert.equal(count, 2);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['FRMFRC91P22D086S/202606/page_1.pdf', 'note.txt'],
  );
  assert.equal(await readEntry(bytes, entries[0]), payload);
  assert.equal(await readEntry(bytes, entries[1]), 'ciao');
});

test('a compressible entry is deflated', async () => {
  const zip = new ZipWriter();
  const payload = 'x'.repeat(1000);
  await zip.file('big.txt', payload);
  const bytes = await toBytes(zip.finish());
  const { entries } = parseArchive(bytes);
  assert.equal(entries[0].method, 8, 'deflate');
  assert.equal(entries[0].size, 1000);
  assert.ok(entries[0].compressedSize < 100, `compressed to ${entries[0].compressedSize}`);
  assert.equal(await readEntry(bytes, entries[0]), payload);
});

test('an entry deflate would grow is stored instead', async () => {
  const zip = new ZipWriter();
  await zip.file('tiny.json', '{}');
  const bytes = await toBytes(zip.finish());
  const { entries } = parseArchive(bytes);
  assert.equal(entries[0].method, 0, 'stored');
  assert.equal(entries[0].compressedSize, entries[0].size);
  assert.equal(await readEntry(bytes, entries[0]), '{}');
});

test('compression can be turned off', async () => {
  const zip = new ZipWriter();
  await zip.file('big.txt', 'x'.repeat(1000), { compress: false });
  const { entries } = parseArchive(await toBytes(zip.finish()));
  assert.equal(entries[0].method, 0);
  assert.equal(entries[0].compressedSize, 1000);
});

test('binary content survives unchanged', async () => {
  const zip = new ZipWriter();
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff, 0x80]);
  await zip.file('a.pdf', pdf);
  const bytes = await toBytes(zip.finish());
  const { entries } = parseArchive(bytes);
  assert.equal(entries[0].crc, crc32(pdf));
  assert.equal(entries[0].size, pdf.length);
});

test('names are flagged and encoded as UTF-8', async () => {
  const zip = new ZipWriter();
  await zip.file('cedolini/più/città.txt', 'ok');
  const bytes = await toBytes(zip.finish());
  const { entries } = parseArchive(bytes);
  assert.equal(entries[0].name, 'cedolini/più/città.txt');
  assert.equal(entries[0].flags & 0x0800, 0x0800, 'UTF-8 name flag set');
});

test('output is reproducible by default', async () => {
  const build = async () => {
    const zip = new ZipWriter();
    await zip.file('a.txt', 'contenuto');
    return toBytes(zip.finish());
  };
  assert.deepEqual([...(await build())], [...(await build())]);
});

test('an explicit date is recorded', async () => {
  const zip = new ZipWriter();
  await zip.file('a.txt', 'x', { date: new Date(2026, 5, 30, 12, 30, 0) });
  const bytes = await toBytes(zip.finish());
  const view = new DataView(bytes.buffer);
  const { entries } = parseArchive(bytes);
  const dosDate = view.getUint16(entries[0].localOffset + 12, true);
  assert.equal(dosDate >> 9, 2026 - 1980, 'year');
  assert.equal((dosDate >> 5) & 0x0f, 6, 'month');
  assert.equal(dosDate & 0x1f, 30, 'day');
});
