/**
 * Ascaron AIM image container ("AIMRES2.00").
 *
 *   0x00 "AIMRES2.00" (16 bytes, NUL padded), u32 version-ish
 *   0x14 container tag:
 *     "MIPMCONT" u32 levelCount, u32 flag, then one slice per mip level (we keep level 0)
 *     "TILEDIM " u32 8, u32 sliceCount, u32 hasPalette,
 *                [u32 paletteBytes, u32 0, palette (BGRA)], then sliceCount slices
 *
 * Slice headers (all little-endian u32 after the 8-byte tag):
 *   IMSLDXT1/3/5, IMSL1555/565/4444   w, h, payloadLen, payload
 *   IMSLD32, IMSLD8                   layout(0 planar / 2 interleaved), alphaKind, w, h, payloadLen, payload
 *   IMJPG24, IMJPG32                  quality, w, h, jpegLen, jpeg [IMJPG32: alphaLen, alpha payload]
 *   TGARES, BMPRES                    w, h, fileLen, file
 *   IMDXT1/3/5                        w, h, dataLen, raw DXT data
 *   IMTC32, IMHC*                     bytesPerPixel, pitch, 0, dataLen, raw pixels
 * A "payload" is a list of (u32 length, compressed blob) pairs (see aimcomp.ts).
 */
import sharp from 'sharp';
import { decompressPayload } from './aimcomp.ts';
import { type Rgba, blankImage, blit, decode16, decodeD32, decodeD8, decodeDxt, decodeTga } from './pixels.ts';

export interface AimFile {
  container: 'MIPMCONT' | 'TILEDIM';
  slices: Rgba[];
}

class Cursor {
  readonly buf: Buffer;
  pos: number;
  constructor(buf: Buffer, pos: number) {
    this.buf = buf;
    this.pos = pos;
  }
  u32(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  tag(): string {
    const t = this.buf.toString('latin1', this.pos, this.pos + 8);
    this.pos += 8;
    return t;
  }
  bytes(n: number): Buffer {
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}

async function decodeJpeg(jpeg: Buffer, w: number, h: number): Promise<Rgba> {
  const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img: Rgba = { width: info.width, height: info.height, data: new Uint8Array(data) };
  if (info.width === w && info.height === h) return img;
  const out = blankImage(w, h);
  blit(out, img, 0, 0);
  return out;
}

async function readSlice(c: Cursor, palette: Uint8Array | null): Promise<Rgba> {
  const tag = c.tag();
  switch (tag) {
    case 'IMSLDXT1':
    case 'IMSLDXT3':
    case 'IMSLDXT5': {
      const w = c.u32(), h = c.u32(), len = c.u32();
      const raw = decompressPayload(c.buf, c.pos, len);
      c.pos += len;
      return decodeDxt(raw, w, h, Number(tag[7]) as 1 | 3 | 5);
    }
    case 'IMSL1555':
    case 'IMSL565 ':
    case 'IMSL4444': {
      const w = c.u32(), h = c.u32(), len = c.u32();
      const raw = decompressPayload(c.buf, c.pos, len);
      c.pos += len;
      return decode16(raw, w, h, tag.slice(4).trim() as '1555' | '565' | '4444');
    }
    case 'IMSLD32 ':
    case 'IMSLD8  ': {
      const layout = c.u32();
      c.u32(); // alpha kind
      const w = c.u32(), h = c.u32(), len = c.u32();
      const raw = decompressPayload(c.buf, c.pos, len);
      c.pos += len;
      if (tag === 'IMSLD8  ') {
        if (!palette) throw new Error('IMSLD8 without palette');
        return decodeD8(raw, w, h, palette);
      }
      return decodeD32(raw, w, h, layout === 0);
    }
    case 'IMJPG24 ':
    case 'IMJPG32 ': {
      c.u32(); // quality
      const w = c.u32(), h = c.u32(), len = c.u32();
      const img = await decodeJpeg(c.bytes(len), w, h);
      if (tag === 'IMJPG32 ') {
        const alen = c.u32();
        const alpha = decompressPayload(c.buf, c.pos, alen);
        c.pos += alen;
        for (let i = 0; i < w * h && i < alpha.length; i++) img.data[i * 4 + 3] = alpha[i];
      }
      return img;
    }
    case 'TGARES  ': {
      c.u32();
      c.u32();
      const len = c.u32();
      return decodeTga(c.bytes(len));
    }
    case 'BMPRES  ': {
      const w = c.u32(), h = c.u32(), len = c.u32();
      const bmp = c.bytes(len);
      const { data, info } = await sharp(bmp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      void w;
      void h;
      return { width: info.width, height: info.height, data: new Uint8Array(data) };
    }
    case 'IMTC32  ':
    case 'IMHC4444':
    case 'IMHC1555':
    case 'IMHC565 ': {
      // raw: bytesPerPixel, pitch (bytes per row), 0, dataLen, pixels
      const bpp = c.u32(), pitch = c.u32();
      c.u32();
      const len = c.u32();
      const raw = new Uint8Array(c.bytes(len));
      const w = pitch / bpp, h = len / pitch;
      if (bpp === 4) return decodeD32(raw, w, h, false);
      return decode16(raw, w, h, tag.slice(4).trim() as '1555' | '565' | '4444');
    }
    case 'IMDXT1  ':
    case 'IMDXT3  ':
    case 'IMDXT5  ': {
      const w = c.u32(), h = c.u32(), len = c.u32();
      const raw = c.bytes(len);
      return decodeDxt(raw, w, h, Number(tag[5]) as 1 | 3 | 5);
    }
    default:
      throw new Error(`unsupported AIM slice ${JSON.stringify(tag)}`);
  }
}

export async function parseAim(buf: Buffer, opts: { maxSlices?: number } = {}): Promise<AimFile> {
  if (buf.toString('latin1', 0, 10) !== 'AIMRES2.00') throw new Error('not an AIM file');
  const c = new Cursor(buf, 20);
  const container = c.tag();
  const slices: Rgba[] = [];
  if (container === 'MIPMCONT') {
    c.u32();
    c.u32();
    slices.push(await readSlice(c, null));
    return { container, slices };
  }
  if (container !== 'TILEDIM ') throw new Error(`unknown AIM container ${container}`);
  c.u32();
  const count = c.u32();
  const hasPalette = c.u32();
  let palette: Uint8Array | null = null;
  if (hasPalette) {
    const palBytes = c.u32();
    c.u32();
    palette = new Uint8Array(c.bytes(palBytes));
  }
  const n = Math.min(count, opts.maxSlices ?? count);
  for (let i = 0; i < n; i++) slices.push(await readSlice(c, palette));
  return { container: 'TILEDIM', slices };
}

/**
 * Assemble TILEDIM slices into one image. Slices are stored column-major (each column
 * top to bottom); `rows` is the number of slices per column. The format does not record
 * it, see guessRows.
 */
export function assemble(slices: Rgba[], rows: number): Rgba {
  const columns = Math.ceil(slices.length / rows);
  const colW: number[] = [];
  const rowH: number[] = [];
  slices.forEach((s, i) => {
    const cx = Math.floor(i / rows), ry = i % rows;
    colW[cx] = Math.max(colW[cx] ?? 0, s.width);
    rowH[ry] = Math.max(rowH[ry] ?? 0, s.height);
  });
  const W = colW.slice(0, columns).reduce((a, b) => a + b, 0);
  const H = rowH.reduce((a, b) => a + b, 0);
  const out = blankImage(W, H);
  let x = 0;
  for (let cx = 0; cx < columns; cx++) {
    let y = 0;
    for (let r = 0; r < rows; r++) {
      const s = slices[cx * rows + r];
      if (s) blit(out, s, x, y);
      y += rowH[r];
    }
    x += colW[cx];
  }
  return out;
}

/**
 * Guess slices per column: a column ends with the first slice shorter than the first one.
 * Uniform grids fall back to a "_<w>x<h>" size in the file name, then to a square layout.
 */
export function guessRows(slices: Rgba[], name = ''): number {
  if (slices.length <= 1) return 1;
  const h0 = slices[0].height;
  for (let i = 1; i < slices.length; i++) if (slices[i].height !== h0) return i + 1;
  const m = /_(\d+)x(\d+)/.exec(name);
  if (m) {
    const rows = Math.ceil(Number(m[2]) / h0);
    if (slices.length % rows === 0) return rows;
  }
  const sq = Math.round(Math.sqrt(slices.length));
  return sq * sq === slices.length ? sq : 1;
}
