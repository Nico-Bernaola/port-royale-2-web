/**
 * Ascaron AIM slice decompressor, ported from AIM20.dll (routine at 0x1008491c).
 *
 * Blob layout (starts with a 0x01 marker byte):
 *   i32 outSize
 *   u32 flags     bit31 = stored raw; bit30 (with bit31) = every byte XOR 0x35
 *   u32 params    8 nibbles: incremental bit widths of the 8 LZ distance classes
 *   ...           bitstream, little-endian u32 words consumed LSB first
 *                 (equivalent to reading bytes in order, LSB first)
 *
 * Token: 1 flag bit. 0 = literal byte (8 bits). 1 = match:
 *   3 bits class c, width[c] bits v, distance = base[c] + v, copy from out[pos - distance - 1];
 *   length = 2 + fields of width 2, 3, 4, ... summed while each field is all ones.
 */

class BitReader {
  private bit: number;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array, byteOffset: number) {
    this.data = data;
    this.bit = byteOffset * 8;
  }

  read(k: number): number {
    let v = 0;
    let got = 0;
    while (got < k) {
      const idx = this.bit >>> 3;
      const byte = idx < this.data.length ? this.data[idx] : 0;
      const off = this.bit & 7;
      const take = Math.min(8 - off, k - got);
      v |= ((byte >>> off) & ((1 << take) - 1)) << got;
      got += take;
      this.bit += take;
    }
    return v >>> 0;
  }
}

/** Decompress one blob starting at `offset` (which must hold the 0x01 marker). */
export function decompressBlob(src: Uint8Array, offset: number): Uint8Array {
  if (src[offset] !== 1) throw new Error(`bad AIM blob marker ${src[offset]} at ${offset}`);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const size = Math.abs(dv.getInt32(offset + 1, true));
  const flags = dv.getUint32(offset + 5, true);
  let params = dv.getUint32(offset + 9, true);
  const p = offset + 13;
  if (flags & 0x80000000) {
    const raw = src.slice(p, p + size);
    if (flags & 0x40000000) for (let i = 0; i < raw.length; i++) raw[i] ^= 0x35;
    return raw;
  }
  const widths: number[] = [];
  const bases: number[] = [];
  let cum = 0;
  let base = 0;
  for (let i = 0; i < 8; i++) {
    cum += params & 15;
    params >>>= 4;
    if (i) base += 2 ** widths[i - 1];
    widths.push(cum);
    bases.push(base);
  }
  const out = new Uint8Array(size);
  const br = new BitReader(src, p);
  let pos = 0;
  while (pos < size) {
    if (br.read(1) === 0) {
      out[pos++] = br.read(8);
    } else {
      const c = br.read(3);
      const dist = bases[c] + br.read(widths[c]);
      let length = 2;
      let w = 2;
      for (;;) {
        const t = br.read(w);
        length += t;
        if (t !== (1 << w) - 1) break;
        w++;
      }
      let s = pos - dist - 1;
      const end = Math.min(size, pos + length);
      while (pos < end) out[pos++] = out[s++];
    }
  }
  return out;
}

/**
 * A slice payload is a sequence of (u32 length, blob) pairs whose outputs concatenate.
 */
export function decompressPayload(src: Uint8Array, offset: number, length: number): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const parts: Uint8Array[] = [];
  let q = offset;
  const end = offset + length;
  while (q + 4 <= end) {
    const len = dv.getUint32(q, true);
    parts.push(decompressBlob(src, q + 4));
    q += 4 + len;
  }
  const total = parts.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}
