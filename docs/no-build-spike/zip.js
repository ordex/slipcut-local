// Minimal ZIP writer — replaces jszip with ~90 lines and zero dependencies.
// Deflate comes from the platform: CompressionStream('deflate-raw').
//
// Only what SlipCut Local needs: write entries, finish. No reading, no
// encryption, no zip64 (a payslip archive is far below the 4 GB limit).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// DOS date/time. Fixed by default so archives are reproducible; pass a Date to
// use the wall clock instead.
function dosDateTime(date) {
  if (!date) return { time: 0, date: 0x2821 }; // 1 Jan 2000
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

export class ZipWriter {
  #entries = [];
  #parts = [];
  #offset = 0;

  /** @param {string} name @param {Uint8Array|string} content */
  async file(name, content, { compress = true, date = null } = {}) {
    const raw = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const nameBytes = new TextEncoder().encode(name);
    const stored = compress ? await deflateRaw(raw) : raw;
    // Never let compression make an entry bigger than storing it.
    const useDeflate = compress && stored.length < raw.length;
    const body = useDeflate ? stored : raw;
    const { time, date: dosDate } = dosDateTime(date);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // UTF-8 filename
    header.setUint16(8, useDeflate ? 8 : 0, true);
    header.setUint16(10, time, true);
    header.setUint16(12, dosDate, true);
    header.setUint32(14, crc32(raw), true);
    header.setUint32(18, body.length, true);
    header.setUint32(22, raw.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true); // no extra field

    this.#entries.push({
      nameBytes,
      method: useDeflate ? 8 : 0,
      time,
      dosDate,
      crc: crc32(raw),
      compressedSize: body.length,
      size: raw.length,
      offset: this.#offset,
    });

    this.#parts.push(new Uint8Array(header.buffer), nameBytes, body);
    this.#offset += 30 + nameBytes.length + body.length;
  }

  /** @returns {Blob} the finished archive */
  finish() {
    const central = [];
    let centralSize = 0;

    for (const e of this.#entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true); // version made by
      h.setUint16(6, 20, true); // version needed
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, e.method, true);
      h.setUint16(12, e.time, true);
      h.setUint16(14, e.dosDate, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.compressedSize, true);
      h.setUint32(24, e.size, true);
      h.setUint16(28, e.nameBytes.length, true);
      h.setUint16(30, 0, true); // extra
      h.setUint16(32, 0, true); // comment
      h.setUint16(34, 0, true); // disk
      h.setUint16(36, 0, true); // internal attrs
      h.setUint32(38, 0, true); // external attrs
      h.setUint32(42, e.offset, true);
      central.push(new Uint8Array(h.buffer), e.nameBytes);
      centralSize += 46 + e.nameBytes.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true); // this disk
    end.setUint16(6, 0, true); // disk with central directory
    end.setUint16(8, this.#entries.length, true);
    end.setUint16(10, this.#entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, this.#offset, true);
    end.setUint16(20, 0, true); // comment length

    return new Blob([...this.#parts, ...central, new Uint8Array(end.buffer)], {
      type: 'application/zip',
    });
  }
}
