// @ts-check
/**
 * A minimal ZIP writer.
 *
 * Only what this app needs: add entries, finish. No reading, no encryption, no
 * ZIP64 — an archive of payslip PDFs stays far below the 4 GiB and 65 535 entry
 * limits, and the writer refuses to produce a file it cannot describe correctly.
 *
 * Deflate comes from the platform via `CompressionStream`, so there is no
 * compression library to ship.
 *
 * Reference: PKWARE APPNOTE.TXT, sections 4.3.7 (local header), 4.3.12 (central
 * directory) and 4.3.16 (end of central directory).
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

/** Version 2.0: the minimum that understands deflate. */
const VERSION = 20;
/** General purpose bit 11: the file name is UTF-8. */
const UTF8_NAME_FLAG = 0x0800;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Fields the format cannot express beyond these. */
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/**
 * A fixed timestamp keeps archives reproducible: the same input produces
 * byte-identical output, which makes the result diffable and testable.
 * 1 January 2000, 00:00, in MS-DOS date format.
 */
const DOS_EPOCH = { time: 0, date: 0x2821 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number} CRC-32 as an unsigned 32-bit integer
 */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>} raw deflate stream, no zlib wrapper
 */
async function deflateRaw(bytes) {
  // Cast: `BlobPart` excludes views over a SharedArrayBuffer, which these never
  // are, and the type system cannot see that.
  const compressed = new Blob([/** @type {BlobPart} */ (bytes)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/**
 * Convert a JS date to the MS-DOS time and date fields.
 * @param {Date} date
 */
function toDosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * @typedef {object} Entry
 * @property {Uint8Array} name encoded file name
 * @property {number} method
 * @property {number} time
 * @property {number} date
 * @property {number} crc
 * @property {number} compressedSize
 * @property {number} size
 * @property {number} offset of its local header
 */

export class ZipWriter {
  /** @type {Entry[]} */
  #entries = [];
  /** @type {BlobPart[]} */
  #parts = [];
  #offset = 0;

  /**
   * Add a file.
   *
   * @param {string} name path inside the archive, `/` separated
   * @param {Uint8Array | string} content
   * @param {object} [options]
   * @param {boolean} [options.compress] false stores the bytes as they are
   * @param {Date} [options.date] defaults to a fixed timestamp, for reproducibility
   * @returns {Promise<void>}
   */
  async file(name, content, options = {}) {
    if (this.#entries.length >= MAX_ENTRIES) {
      throw new Error(`A ZIP archive cannot hold more than ${MAX_ENTRIES} entries`);
    }

    const raw = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    if (raw.length > MAX_SIZE) {
      throw new Error(`${name} is too large for a ZIP archive without ZIP64`);
    }

    const encodedName = new TextEncoder().encode(name);
    const compress = options.compress ?? true;
    const deflated = compress ? await deflateRaw(raw) : null;
    // Storing is smaller for tiny or already-compressed entries, and a ZIP is
    // allowed to mix methods.
    const useDeflate = deflated !== null && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const { time, date } = options.date ? toDosDateTime(options.date) : DOS_EPOCH;
    const crc = crc32(raw);

    const header = new DataView(new ArrayBuffer(LOCAL_HEADER_SIZE));
    header.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    header.setUint16(4, VERSION, true);
    header.setUint16(6, UTF8_NAME_FLAG, true);
    header.setUint16(8, useDeflate ? METHOD_DEFLATE : METHOD_STORE, true);
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, body.length, true);
    header.setUint32(22, raw.length, true);
    header.setUint16(26, encodedName.length, true);
    header.setUint16(28, 0, true); // no extra field

    this.#entries.push({
      name: encodedName,
      method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
      time,
      date,
      crc,
      compressedSize: body.length,
      size: raw.length,
      offset: this.#offset,
    });

    this.#parts.push(new Uint8Array(header.buffer), encodedName, /** @type {BlobPart} */ (body));
    this.#offset += LOCAL_HEADER_SIZE + encodedName.length + body.length;
  }

  /** @returns {number} how many entries have been added */
  get length() {
    return this.#entries.length;
  }

  /**
   * Close the archive.
   * @returns {Blob}
   */
  finish() {
    /** @type {BlobPart[]} */
    const directory = [];
    let directorySize = 0;

    for (const entry of this.#entries) {
      const header = new DataView(new ArrayBuffer(CENTRAL_HEADER_SIZE));
      header.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
      header.setUint16(4, VERSION, true); // version made by
      header.setUint16(6, VERSION, true); // version needed
      header.setUint16(8, UTF8_NAME_FLAG, true);
      header.setUint16(10, entry.method, true);
      header.setUint16(12, entry.time, true);
      header.setUint16(14, entry.date, true);
      header.setUint32(16, entry.crc, true);
      header.setUint32(20, entry.compressedSize, true);
      header.setUint32(24, entry.size, true);
      header.setUint16(28, entry.name.length, true);
      header.setUint16(30, 0, true); // extra field
      header.setUint16(32, 0, true); // comment
      header.setUint16(34, 0, true); // disk number
      header.setUint16(36, 0, true); // internal attributes
      header.setUint32(38, 0, true); // external attributes
      header.setUint32(42, entry.offset, true);

      directory.push(new Uint8Array(header.buffer), /** @type {BlobPart} */ (entry.name));
      directorySize += CENTRAL_HEADER_SIZE + entry.name.length;
    }

    const end = new DataView(new ArrayBuffer(END_OF_CENTRAL_DIRECTORY_SIZE));
    end.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
    end.setUint16(4, 0, true); // this disk
    end.setUint16(6, 0, true); // disk holding the directory
    end.setUint16(8, this.#entries.length, true);
    end.setUint16(10, this.#entries.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, this.#offset, true);
    end.setUint16(20, 0, true); // archive comment

    return new Blob([...this.#parts, ...directory, new Uint8Array(end.buffer)], {
      type: 'application/zip',
    });
  }
}
