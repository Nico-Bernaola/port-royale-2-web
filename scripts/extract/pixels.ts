/** Pixel format decoders producing RGBA8 images. */

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, row-major
}

export function blankImage(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function c565(c: number, out: number[], o: number): void {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  out[o] = (r << 3) | (r >> 2);
  out[o + 1] = (g << 2) | (g >> 4);
  out[o + 2] = (b << 3) | (b >> 2);
}

/** Decode the 8-byte colour part of a DXT block into 16 RGBA texels (row-major 4x4). */
function colorBlock(src: Uint8Array, o: number, alwaysFour: boolean, px: Uint8Array): void {
  const col0 = src[o] | (src[o + 1] << 8);
  const col1 = src[o + 2] | (src[o + 3] << 8);
  const pal = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  c565(col0, pal, 0);
  c565(col1, pal, 4);
  if (alwaysFour || col0 > col1) {
    for (let i = 0; i < 3; i++) {
      pal[8 + i] = ((2 * pal[i] + pal[4 + i]) / 3) | 0;
      pal[12 + i] = ((pal[i] + 2 * pal[4 + i]) / 3) | 0;
    }
  } else {
    for (let i = 0; i < 3; i++) {
      pal[8 + i] = ((pal[i] + pal[4 + i]) / 2) | 0;
      pal[12 + i] = 0;
    }
    pal[15] = 0;
  }
  const idx = (src[o + 4] | (src[o + 5] << 8) | (src[o + 6] << 16) | (src[o + 7] << 24)) >>> 0;
  for (let t = 0; t < 16; t++) {
    const s = ((idx >>> (2 * t)) & 3) * 4;
    px[t * 4] = pal[s];
    px[t * 4 + 1] = pal[s + 1];
    px[t * 4 + 2] = pal[s + 2];
    px[t * 4 + 3] = pal[s + 3];
  }
}

function placeBlock(img: Rgba, bx: number, by: number, px: Uint8Array): void {
  for (let y = 0; y < 4; y++) {
    const iy = by * 4 + y;
    if (iy >= img.height) break;
    for (let x = 0; x < 4; x++) {
      const ix = bx * 4 + x;
      if (ix >= img.width) continue;
      const d = (iy * img.width + ix) * 4;
      const s = (y * 4 + x) * 4;
      img.data[d] = px[s];
      img.data[d + 1] = px[s + 1];
      img.data[d + 2] = px[s + 2];
      img.data[d + 3] = px[s + 3];
    }
  }
}

export function decodeDxt(src: Uint8Array, width: number, height: number, kind: 1 | 3 | 5): Rgba {
  const img = blankImage(width, height);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const blockSize = kind === 1 ? 8 : 16;
  const px = new Uint8Array(64);
  let o = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, o += blockSize) {
      if (o + blockSize > src.length) return img;
      if (kind === 1) {
        colorBlock(src, o, false, px);
      } else {
        colorBlock(src, o + 8, true, px);
        if (kind === 3) {
          for (let t = 0; t < 16; t++) {
            const nib = (src[o + (t >> 1)] >> ((t & 1) * 4)) & 15;
            px[t * 4 + 3] = nib * 17;
          }
        } else {
          const a0 = src[o];
          const a1 = src[o + 1];
          const ap = [a0, a1, 0, 0, 0, 0, 0, 0];
          if (a0 > a1) {
            for (let i = 1; i < 7; i++) ap[i + 1] = (((7 - i) * a0 + i * a1) / 7) | 0;
          } else {
            for (let i = 1; i < 5; i++) ap[i + 1] = (((5 - i) * a0 + i * a1) / 5) | 0;
            ap[6] = 0;
            ap[7] = 255;
          }
          // 48 bits of 3-bit indices
          let lo = (src[o + 2] | (src[o + 3] << 8) | (src[o + 4] << 16)) >>> 0;
          let hi = (src[o + 5] | (src[o + 6] << 8) | (src[o + 7] << 16)) >>> 0;
          for (let t = 0; t < 16; t++) {
            let sel: number;
            if (t < 8) {
              sel = lo & 7;
              lo >>>= 3;
            } else {
              sel = hi & 7;
              hi >>>= 3;
            }
            px[t * 4 + 3] = ap[sel];
          }
        }
      }
      placeBlock(img, bx, by, px);
    }
  }
  return img;
}

/** 32-bit BGRA, either interleaved or planar (B plane, G plane, R plane, A plane). */
export function decodeD32(src: Uint8Array, width: number, height: number, planar: boolean): Rgba {
  const img = blankImage(width, height);
  const n = width * height;
  const d = img.data;
  if (planar) {
    for (let i = 0; i < n; i++) {
      d[i * 4] = src[2 * n + i];
      d[i * 4 + 1] = src[n + i];
      d[i * 4 + 2] = src[i];
      d[i * 4 + 3] = src[3 * n + i];
    }
  } else {
    for (let i = 0; i < n; i++) {
      d[i * 4] = src[i * 4 + 2];
      d[i * 4 + 1] = src[i * 4 + 1];
      d[i * 4 + 2] = src[i * 4];
      d[i * 4 + 3] = src[i * 4 + 3];
    }
  }
  return img;
}

/** 8-bit indexed with a BGRA palette. */
export function decodeD8(src: Uint8Array, width: number, height: number, palette: Uint8Array): Rgba {
  const img = blankImage(width, height);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const p = src[i] * 4;
    img.data[i * 4] = palette[p + 2];
    img.data[i * 4 + 1] = palette[p + 1];
    img.data[i * 4 + 2] = palette[p];
    img.data[i * 4 + 3] = palette[p + 3];
  }
  return img;
}

/** 16-bit formats: 1555, 4444, 565 (little endian). */
export function decode16(src: Uint8Array, width: number, height: number, fmt: '1555' | '4444' | '565'): Rgba {
  const img = blankImage(width, height);
  const n = width * height;
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const v = src[i * 2] | (src[i * 2 + 1] << 8);
    let r: number, g: number, b: number, a: number;
    if (fmt === '1555') {
      r = ((v >> 10) & 31) * 255 / 31;
      g = ((v >> 5) & 31) * 255 / 31;
      b = (v & 31) * 255 / 31;
      a = v & 0x8000 ? 255 : 0;
    } else if (fmt === '4444') {
      a = ((v >> 12) & 15) * 17;
      r = ((v >> 8) & 15) * 17;
      g = ((v >> 4) & 15) * 17;
      b = (v & 15) * 17;
    } else {
      r = ((v >> 11) & 31) * 255 / 31;
      g = ((v >> 5) & 63) * 255 / 63;
      b = (v & 31) * 255 / 31;
      a = 255;
    }
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = a;
  }
  return img;
}

/** Uncompressed 32-bit or 24-bit TGA (as embedded in TGARES slices). */
export function decodeTga(src: Uint8Array): Rgba {
  const idLen = src[0];
  const type = src[2];
  const width = src[12] | (src[13] << 8);
  const height = src[14] | (src[15] << 8);
  const bpp = src[16];
  const topDown = (src[17] & 0x20) !== 0;
  if (type !== 2 || (bpp !== 32 && bpp !== 24)) throw new Error(`unsupported TGA type ${type}/${bpp}`);
  const img = blankImage(width, height);
  const bytes = bpp / 8;
  let o = 18 + idLen;
  for (let y = 0; y < height; y++) {
    const row = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++, o += bytes) {
      const d = (row * width + x) * 4;
      img.data[d] = src[o + 2];
      img.data[d + 1] = src[o + 1];
      img.data[d + 2] = src[o];
      img.data[d + 3] = bytes === 4 ? src[o + 3] : 255;
    }
  }
  return img;
}

export function blit(dst: Rgba, src: Rgba, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      dst.data[d] = src.data[s];
      dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = src.data[s + 3];
    }
  }
}
