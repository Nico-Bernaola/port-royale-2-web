/**
 * Pure texture painters (no DOM, no three.js), shared by the texture worker and the main
 * thread fallback. Every surface is a per-pixel function returning colour and height.
 */
/** canvas size of the texture being painted (set per texture) */
let S = 512;

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise: lattice of `period` cells across the whole texture. */
function tileNoise(seed: number) {
  const rnd = mulberry(seed);
  const N = 256;
  const lat = new Float32Array(N * N);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const at = (x: number, y: number, p: number) => lat[(((y % p) + p) % p) * N + (((x % p) + p) % p)];
  /** u, v in 0..1 over the tile; period = lattice cells per tile (<= 256) */
  const n = (u: number, v: number, p: number) => {
    const x = u * p, y = v * p;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy, p), b = at(ix + 1, iy, p), c = at(ix, iy + 1, p), d = at(ix + 1, iy + 1, p);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  const fbm = (u: number, v: number, p: number, oct = 4) => {
    let s = 0, a = 0.5, t = 0;
    for (let i = 0; i < oct && p <= 256; i++) { s += a * n(u, v, p); t += a; a *= 0.5; p *= 2; }
    return s / t;
  };
  /** anisotropic noise: px cells across, py cells down */
  const n2 = (u: number, v: number, px: number, py: number) => {
    const x = u * px, y = v * py;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const atp = (X: number, Y: number) => lat[(((Y % py) + py) % py) * N + (((X % px) + px) % px)];
    const a = atp(ix, iy), b = atp(ix + 1, iy), c = atp(ix, iy + 1), d = atp(ix + 1, iy + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  return { n, fbm, n2 };
}

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, f: number): RGB => [a[0] * f, a[1] * f, a[2] * f];
const hash2 = (a: number, b: number) => {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** A per-pixel painter: returns colour and height (0..1) at texture coordinate (u, v), v down. */
type PixelFn = (u: number, v: number, x: number, y: number) => [RGB, number];

export interface TexDef {
  size: number; // metres per tile
  px?: number; // canvas size
  paint: (seed: number) => PixelFn;
  rough?: number;
  bump?: number;
  metal?: number;
  alpha?: boolean;
}

// ---- painters ---------------------------------------------------------------------------------

/** Overlapping courses of shingles or slates. */
function courses(rows: number, minW: number, maxW: number, base: RGB[], gap: RGB, moss: number, irregular: number): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    const rnd = mulberry(seed + 1);
    // per row: list of tile boundaries in 0..1
    const rowsB: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const b: number[] = [];
      let x = rnd() * maxW;
      const start = x;
      while (x < start + 1) { b.push(x % 1); x += minW + rnd() * (maxW - minW); }
      b.sort((a, c) => a - c);
      rowsB.push(b);
    }
    const mossC: RGB[] = [hex(0x6f7d34), hex(0x8a8f45), hex(0x55642c)];
    return (u, v) => {
      const r = Math.floor(v * rows);
      const t = v * rows - r; // 0 at top of course (overlapped), 1 at butt edge
      const b = rowsB[r];
      let k = 0;
      while (k < b.length && b[k] <= u) k++;
      const left = k === 0 ? b[b.length - 1] - 1 : b[k - 1];
      const right = k === b.length ? b[0] + 1 : b[k];
      const idx = k === 0 ? b.length - 1 : k - 1;
      const edge = Math.min(u - left, right - u) * S;
      const hsh = hash2(r, idx);
      // butt edge sits a little irregular
      const butt = 1 - irregular * hash2(idx, r + 99);
      let c = mix(base[Math.floor(hsh * base.length)], base[Math.floor(hash2(idx + 7, r) * base.length)], 0.5);
      c = mul(c, 0.82 + hsh * 0.32);
      // grain along the shingle
      c = mul(c, 0.88 + 0.22 * nz.n2(u, v, 160, 6));
      let h = 0.35 + 0.55 * t;
      if (t > butt) { // below the butt: we see the course underneath in shadow
        c = mul(c, 0.45);
        h = 0.2;
      }
      if (edge < 1.6) { c = gap; h = 0.05; }
      // shadow cast by the course above
      if (t < 0.18) c = mul(c, 0.55 + 2.5 * t);
      if (moss > 0) {
        const m = smooth(1 - moss, 1.05 - moss * 0.5, nz.fbm(u, v, 6, 5)) * (0.6 + 0.4 * t);
        if (m > 0) {
          c = mix(c, mul(mossC[Math.floor(nz.n(u, v, 40) * 3) % 3], 0.8 + 0.4 * nz.n(u, v, 120)), m * 0.9);
          h += m * 0.15;
        }
      }
      return [c, h];
    };
  };
}

/** Rows of planks with seams (horizontal) — used for decks, siding and doors. */
function planks(rows: number, minL: number, maxL: number, base: RGB, vary: number, gapDark: number, vertical = false): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    const rnd = mulberry(seed + 3);
    const rowsB: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const b: number[] = [];
      let x = rnd();
      const st = x;
      while (x < st + 1) { b.push(x % 1); x += minL + rnd() * (maxL - minL); }
      b.sort((a, c) => a - c);
      rowsB.push(b);
    }
    return (u0, v0) => {
      const u = vertical ? v0 : u0, v = vertical ? u0 : v0;
      const r = Math.floor(v * rows);
      const t = v * rows - r;
      const b = rowsB[r];
      let k = 0;
      while (k < b.length && b[k] <= u) k++;
      const left = k === 0 ? b[b.length - 1] - 1 : b[k - 1];
      const right = k === b.length ? b[0] + 1 : b[k];
      const idx = k === 0 ? b.length - 1 : k - 1;
      const hsh = hash2(r, idx);
      let c = mul(base, 1 - vary / 2 + hsh * vary);
      const gr = vertical ? nz.n2(v0, u0, 8, 220) : nz.n2(u0, v0, 8, 220);
      c = mul(c, 0.78 + 0.34 * gr);
      const knot = nz.n(u, v, 24);
      if (knot > 0.82) c = mul(c, 1 - (knot - 0.82) * 2.5);
      let h = 0.6 + 0.2 * gr;
      const ex = Math.min(u - left, right - u) * S;
      const ey = Math.min(t, 1 - t) * (S / rows);
      if (ey < 1.8 || ex < 1.4) { c = mul(c, gapDark); h = 0.05; }
      // nails near the board ends
      const nx = Math.min(u - left, right - u) * S;
      if (nx > 4 && nx < 9 && Math.abs(t - 0.3) * (S / rows) < 1.6) { c = mul(c, 0.4); h = 0.4; }
      if (nx > 4 && nx < 9 && Math.abs(t - 0.7) * (S / rows) < 1.6) { c = mul(c, 0.4); h = 0.4; }
      return [c, h];
    };
  };
}

function clapboard(rows: number, paint: RGB, wood: RGB): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const r = Math.floor(v * rows);
      const t = v * rows - r;
      const gr = nz.n2(u, v, 6, 240);
      const peel = nz.fbm(u, v, 8, 5) + 0.25 * nz.n2(u, v, 40, rows * 2);
      let c = mul(paint, 0.85 + 0.2 * hash2(r, 3) + 0.1 * gr);
      if (peel > 0.6) c = mul(wood, 0.75 + 0.35 * gr);
      else if (peel > 0.55) c = mix(c, mul(wood, 0.9), (peel - 0.55) * 20);
      // lap shadow at the top of each board
      const sh = 0.55 + 0.45 * smooth(0, 0.25, t);
      c = mul(c, sh);
      let h = 0.25 + 0.7 * t;
      if (t > 0.97) { c = mul(c, 0.5); h = 0; }
      return [c, h];
    };
  };
}

function boardBatten(boards: number, base: RGB): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const b = Math.floor(u * boards);
      const t = u * boards - b;
      const gr = nz.n2(u, v, 260, 6);
      let c = mul(base, 0.8 + 0.3 * hash2(b, 11));
      c = mul(c, 0.75 + 0.4 * gr);
      const stain = nz.fbm(u, v, 5);
      c = mix(c, mul(c, 0.7), smooth(0.55, 0.75, stain));
      let h = 0.5 + 0.2 * gr;
      const bt = Math.abs(t - 0.5) * 2; // 1 at the seam
      if (bt > 0.85) { // batten over the seam
        c = mul(c, bt > 0.97 ? 0.75 : 1.08);
        h = 1;
      }
      if (bt > 0.84 && bt < 0.86) { c = mul(c, 0.45); h = 0.3; }
      return [c, h];
    };
  };
}

function ashlar(rows: number, minW: number, maxW: number, base: RGB, mortar: RGB, vary: number, rough: number): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    const rnd = mulberry(seed + 5);
    const rowsB: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const b: number[] = [];
      let x = rnd();
      const st = x;
      while (x < st + 1) { b.push(x % 1); x += minW + rnd() * (maxW - minW); }
      b.sort((a, c) => a - c);
      rowsB.push(b);
    }
    return (u, v) => {
      const r = Math.floor(v * rows);
      const t = v * rows - r;
      const b = rowsB[r];
      let k = 0;
      while (k < b.length && b[k] <= u) k++;
      const left = k === 0 ? b[b.length - 1] - 1 : b[k - 1];
      const right = k === b.length ? b[0] + 1 : b[k];
      const idx = k === 0 ? b.length - 1 : k - 1;
      const hsh = hash2(r * 31, idx);
      const n = nz.fbm(u, v, 32, 4);
      let c = mul(base, 1 - vary / 2 + hsh * vary);
      c = mul(c, 0.85 + 0.3 * n);
      const ex = Math.min(u - left, right - u) * S;
      const ey = Math.min(t, 1 - t) * (S / rows);
      const e = Math.min(ex, ey) + (nz.n(u, v, 90) - 0.5) * rough * 6;
      let h = 0.7 + 0.25 * n;
      if (e < 2.5) { c = mul(mortar, 0.9 + 0.2 * n); h = 0.1; }
      else if (e < 5) { h = 0.4 + (e - 2.5) * 0.12; c = mul(c, 0.92); }
      // weathering: dark streaks and spots
      const dirt = nz.fbm(u + 0.3, v, 4, 4);
      c = mix(c, mul(c, 0.72), smooth(0.58, 0.8, dirt));
      return [c, h];
    };
  };
}

function stucco(base: RGB, mold: number): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    const moldC = hex(0x6d7356);
    return (u, v) => {
      const n = nz.fbm(u, v, 16, 5);
      let c = mul(base, 0.92 + 0.12 * n);
      const streak = nz.n2(u, v, 40, 2) * nz.fbm(u, v, 3, 3);
      const m = smooth(0.32, 0.6, streak) * mold;
      c = mix(c, moldC, m * 0.55);
      const blot = smooth(0.6, 0.8, nz.fbm(u + 0.5, v, 6, 4)) * mold;
      c = mix(c, mul(moldC, 0.8), blot * 0.5);
      // patches where the plaster fell off
      const crack = nz.fbm(u, v + 0.3, 8, 4);
      let h = 0.6 + 0.2 * n;
      if (crack > 0.7 && mold > 0) { c = mix(c, hex(0x9a8a74), 0.7); h = 0.3; }
      return [c, h];
    };
  };
}

function barrelTiles(cols: number, rows: number, base: RGB): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const cI = Math.floor(u * cols), rI = Math.floor(v * rows);
      const t = u * cols - cI, s = v * rows - rI;
      const cap = cI % 2 === 0; // alternating caps and channels
      const prof = Math.sin(Math.PI * t);
      let c = mul(base, 0.8 + 0.35 * hash2(cI, rI));
      c = mul(c, cap ? 0.62 + 0.45 * prof : 0.5 + 0.3 * prof);
      c = mul(c, 0.9 + 0.15 * nz.fbm(u, v, 24, 3));
      if (s < 0.15) c = mul(c, 0.6 + s * 2.6);
      const dirt = smooth(0.55, 0.8, nz.fbm(u, v, 5, 4));
      c = mix(c, hex(0x6a5a40), dirt * 0.35);
      const h = cap ? 0.5 + 0.5 * prof : 0.2 + 0.2 * prof;
      return [c, h * (0.75 + 0.25 * s)];
    };
  };
}

function cobbles(cell: number, base: RGB[], soil: RGB): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    const n = Math.round(1 / cell);
    return (u, v) => {
      // voronoi on a jittered grid with wrap
      const gx = u * n, gy = v * n;
      const ix = Math.floor(gx), iy = Math.floor(gy);
      let d1 = 9, d2 = 9, id = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox, cy = iy + oy;
        const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
        const px = cx + 0.2 + 0.6 * hash2(wx, wy), py = cy + 0.2 + 0.6 * hash2(wy + 17, wx);
        const d = Math.hypot(gx - px, gy - py);
        if (d < d1) { d2 = d1; d1 = d; id = wx * 131 + wy; } else if (d < d2) d2 = d;
      }
      const e = d2 - d1;
      const nn = nz.fbm(u, v, 40, 3);
      let c = mul(base[id % base.length], 0.8 + 0.3 * hash2(id, 5) + 0.15 * nn);
      let h = 0.4 + 0.6 * smooth(0, 0.35, e);
      if (e < 0.08) { c = mul(soil, 0.8 + 0.3 * nn); h = 0.05; }
      else c = mul(c, 0.75 + 0.25 * smooth(0, 0.3, e));
      return [c, h];
    };
  };
}

function woodGrain(base: RGB, rings: number): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const g = nz.n2(u, v, 6, 200);
      const c = mul(base, 0.7 + 0.45 * g + 0.1 * nz.fbm(u, v, 8));
      const crack = nz.n2(u, v, 3, 60);
      return [crack > 0.85 ? mul(c, 0.5) : c, 0.5 + 0.4 * g - (crack > 0.85 ? 0.3 : 0) + rings * 0];
    };
  };
}

function bark(): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const ring = (v * 14 + nz.n(u, v, 8) * 0.4) % 1;
      const n = nz.fbm(u, v, 16, 4);
      let c = mix(hex(0x7d6a52), hex(0x5a4a3a), n);
      let h = 0.6 + 0.3 * n;
      if (ring < 0.12) { c = mul(c, 0.6); h = 0.2; }
      else if (ring > 0.8) { c = mix(c, hex(0x9a8a70), 0.4); h = 0.9; }
      return [c, h];
    };
  };
}

function noiseTex(a: RGB, b: RGB, p: number, contrast = 1): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const n = nz.fbm(u, v, p, 5);
      const t = Math.max(0, Math.min(1, (n - 0.5) * contrast + 0.5));
      return [mix(a, b, t), n];
    };
  };
}

/** Square setts laid on the diagonal, with moss in the joints (town-centre paving). */
function setts(rows: number, per: number, base: RGB[], joint: RGB, moss: RGB): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const a = (u + v) * rows, b = (v - u) * per;
      const r = Math.floor(a);
      const t = a - r;
      const rm = ((r % (rows * 2)) + rows * 2) % (rows * 2);
      const sb = b + hash2(rm, 7);
      const i = Math.floor(sb);
      const f = sb - i;
      const im = ((i % (per * 2)) + per * 2) % (per * 2);
      const id = hash2(rm, im);
      // rounded-square distance in sett units
      const px = Math.abs(t - 0.5), py = Math.abs(f - 0.5);
      const cr = 0.18, hw = 0.5 - 0.07 - id * 0.03;
      const qx = Math.max(0, px - hw + cr), qy = Math.max(0, py - hw + cr);
      const d = Math.hypot(qx, qy) - cr + (nz.n(u, v, 120) - 0.5) * 0.08;
      const n = nz.fbm(u, v, 48, 3);
      if (d > 0) {
        const m = smooth(0.35, 0.65, nz.fbm(u + 0.2, v, 10, 3));
        return [mix(mul(joint, 0.8 + 0.4 * n), moss, m), 0.05];
      }
      let c = mix(base[Math.floor(id * base.length)], base[Math.floor(hash2(im, rm + 3) * base.length)], 0.4);
      c = mul(c, 0.82 + 0.3 * n);
      const dome = 1 - (px * px + py * py) * 2.2;
      c = mul(c, 0.82 + 0.28 * dome);
      // a little moss creeping onto the stone edges
      const edgeMoss = smooth(-0.06, 0, d) * smooth(0.45, 0.7, nz.fbm(u, v + 0.4, 12, 3));
      c = mix(c, moss, edgeMoss * 0.6);
      return [c, 0.35 + 0.6 * dome];
    };
  };
}

function foliage(): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    const pal: RGB[] = [hex(0x3c4e24), hex(0x4f5f30), hex(0x2c3a1a), hex(0x627238), hex(0x556a2a)];
    return (u, v) => {
      const gx = u * 24, gy = v * 24;
      const ix = Math.floor(gx), iy = Math.floor(gy);
      let best = 9, id = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox, cy = iy + oy;
        const wx = ((cx % 24) + 24) % 24, wy = ((cy % 24) + 24) % 24;
        const d = Math.hypot(gx - cx - hash2(wx, wy), (gy - cy - hash2(wy, wx + 3)) * 1.6);
        if (d < best) { best = d; id = wx * 31 + wy; }
      }
      let c = mul(pal[id % 5], 0.75 + 0.5 * hash2(id, 9));
      c = mul(c, 1.1 - best * 0.6);
      const big = nz.fbm(u, v, 4, 3);
      c = mul(c, 0.75 + 0.5 * big);
      return [c, 1 - best];
    };
  };
}

function panes(paneW: number, paneH: number, frame: RGB, glass: RGB, leaded: boolean): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      let fu: number, fv: number;
      if (leaded) {
        // diamond lattice
        const a = (u + v) / paneW, b = (u - v) / paneW;
        fu = Math.abs((a % 1 + 1) % 1 - 0.5);
        fv = Math.abs((b % 1 + 1) % 1 - 0.5);
      } else {
        fu = Math.abs(((u / paneW) % 1 + 1) % 1 - 0.5);
        fv = Math.abs(((v / paneH) % 1 + 1) % 1 - 0.5);
      }
      const line = leaded ? 0.46 : 0.43;
      if (fu > line || fv > line) return [mul(frame, 0.9 + 0.1 * nz.n(u, v, 50)), 1];
      // reflections: a diagonal sheen plus a little noise
      const sheen = smooth(0.6, 1, Math.sin((u * 1.3 - v) * 6.0) * 0.5 + 0.5);
      const c = mix(glass, hex(0xb8cad4), sheen * 0.35 + nz.fbm(u, v, 8) * 0.15);
      return [c, 0.2];
    };
  };
}

function stripes(a: RGB, b: RGB, n: number): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const c = Math.floor(u * n) % 2 === 0 ? a : b;
      return [mul(c, 0.82 + 0.25 * nz.fbm(u, v, 16, 4)), 0.5];
    };
  };
}

function iron(): (seed: number) => PixelFn {
  return (seed) => {
    const nz = tileNoise(seed);
    return (u, v) => {
      const n = nz.fbm(u, v, 16, 4);
      const rust = smooth(0.6, 0.8, nz.fbm(u, v, 6, 3));
      return [mix(mul(hex(0x2e2f31), 0.8 + 0.4 * n), hex(0x6a3e24), rust * 0.6), n];
    };
  };
}

// ---- registry ---------------------------------------------------------------------------------

export const DEFS: Record<string, TexDef> = {
  shingle: { size: 2.2, paint: courses(14, 0.035, 0.085, [hex(0x8a8170), hex(0x766e5f), hex(0x9a8f7a), hex(0x6b6456)], hex(0x2a2620), 0.42, 0.25), bump: 2.2 },
  shingleClean: { size: 2.2, paint: courses(14, 0.035, 0.085, [hex(0x8c7356), hex(0x7a644b), hex(0x9a8062)], hex(0x2a2620), 0.12, 0.2), bump: 2.2 },
  slate: { size: 2.4, paint: courses(18, 0.05, 0.075, [hex(0x50575c), hex(0x5c6266), hex(0x464c52), hex(0x575d63)], hex(0x1d2023), 0.08, 0.06), bump: 1.8, rough: 0.75 },
  slateMoss: { size: 2.4, paint: courses(16, 0.045, 0.08, [hex(0x4c5452), hex(0x58605b), hex(0x434a48)], hex(0x1d2023), 0.5, 0.15), bump: 2 },
  terracotta: { size: 2.2, paint: barrelTiles(12, 10, hex(0xb65a32)), bump: 2.5, rough: 0.8 },
  planks: { size: 2.4, paint: planks(12, 0.3, 0.7, hex(0x8f7d64), 0.3, 0.35), bump: 1.4 },
  deck: { size: 2.4, paint: planks(14, 0.25, 0.6, hex(0x86705a), 0.35, 0.3), bump: 1.4 },
  boards: { size: 2.4, paint: boardBatten(9, hex(0x8a7e6c)), bump: 1.6 },
  clapboard: { size: 2.4, paint: clapboard(15, hex(0x6f8ea6), hex(0x8f877a)), bump: 1.6 },
  door: { size: 1.2, paint: planks(6, 0.9, 1.0, hex(0x5e4630), 0.25, 0.4, true), bump: 1.4 },
  timber: { size: 1.5, paint: woodGrain(hex(0x4e3c2b), 0), bump: 1 },
  wood: { size: 1.5, paint: woodGrain(hex(0x8a6c4a), 0), bump: 1 },
  stucco: { size: 4, paint: stucco(hex(0xe9e2cf), 1), bump: 0.8 },
  plaster: { size: 4, paint: stucco(hex(0xf2eee6), 0.15), bump: 0.5 },
  limestone: { size: 3, paint: ashlar(10, 0.14, 0.3, hex(0xd8cdb4), hex(0xa79e8a), 0.22, 0.6), bump: 1.6 },
  rubble: { size: 2, paint: ashlar(9, 0.08, 0.2, hex(0xb3a890), hex(0x857c6a), 0.35, 1.6), bump: 2.2 },
  quay: { size: 4, paint: ashlar(6, 0.15, 0.3, hex(0x9b998a), hex(0x6a6a5e), 0.25, 1.2), bump: 2 },
  brick: { size: 1.2, paint: ashlar(16, 0.18, 0.2, hex(0x9a4f38), hex(0xb7ab96), 0.3, 0.4), bump: 1.4 },
  cobble: { size: 3, paint: setts(14, 18, [hex(0x8d856c), hex(0xa9a48e), hex(0x7a7460), hex(0x9a927a), hex(0xb0a88e)], hex(0x4e4a32), hex(0x66752f)), bump: 2.6, rough: 0.7 },
  roundCobble: { size: 3, paint: cobbles(0.06, [hex(0x9c9384), hex(0x8a8274), hex(0xa79b82), hex(0x7d776c)], hex(0x6a5a44)), bump: 2.4 },
  dirt: { size: 6, paint: noiseTex(hex(0xa8916a), hex(0x8a7352), 12, 1.6), bump: 1 },
  iron: { size: 1, paint: iron(), bump: 0.4, rough: 0.6, metal: 0.4 },
  glass: { size: 1, paint: panes(0.24, 0.3, hex(0xece8de), hex(0x33424c), false), rough: 0.25, bump: 0.6 },
  glassDark: { size: 1, paint: panes(0.24, 0.3, hex(0x4a3a2a), hex(0x2c3a42), false), rough: 0.25, bump: 0.6 },
  leaded: { size: 1, paint: panes(0.22, 0.22, hex(0x3a3a38), hex(0x5c7480), true), rough: 0.3, bump: 0.6 },
  bark: { size: 1.2, paint: bark(), bump: 2 },
  royalTrunk: { size: 1.5, paint: noiseTex(hex(0xc9c5b9), hex(0x8a857a), 24, 1.3), bump: 0.8 },
  foliage: { size: 3, paint: foliage(), bump: 2, rough: 0.85 },
  hedge: { size: 1.5, paint: foliage(), bump: 2.5, rough: 0.9 },
  canvasRed: { size: 2, paint: stripes(hex(0xb8432f), hex(0xe9dfc8), 8), bump: 0.3 },
  canvasBlue: { size: 2, paint: stripes(hex(0x2f5f8a), hex(0xe9dfc8), 8), bump: 0.3 },
  canvasGreen: { size: 2, paint: stripes(hex(0x3f7a44), hex(0xe9dfc8), 8), bump: 0.3 },
  canvasOchre: { size: 2, paint: stripes(hex(0xc8962e), hex(0xe9dfc8), 8), bump: 0.3 },
  sack: { size: 1, paint: noiseTex(hex(0xc9b48a), hex(0xa8916a), 48, 1.2), bump: 1.4 },
  rope: { size: 0.5, paint: noiseTex(hex(0xb49a6a), hex(0x7a6440), 64, 2), bump: 2 },
  sail: { size: 3, paint: noiseTex(hex(0xefe6d2), hex(0xd8ccb0), 16, 1), bump: 0.4 },
  detail: { size: 1, paint: noiseTex([90, 90, 90], [165, 165, 165], 32, 1.4) },
};

export interface Painted {
  key: string;
  w: number;
  h: number;
  color: Uint8ClampedArray;
  height: Uint8ClampedArray;
}

function seedOf(key: string): number {
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
  return seed;
}

/** Paint one registered texture at n x n pixels. Rows are stored bottom-up (v = 0 first). */
export function paintRGBA(key: string, n: number): Painted {
  const def = DEFS[key];
  S = n;
  const color = new Uint8ClampedArray(n * n * 4), height = new Uint8ClampedArray(n * n * 4);
  const f = def.paint(seedOf(key));
  for (let y = 0; y < n; y++) {
    const row = (n - 1 - y) * n;
    for (let x = 0; x < n; x++) {
      const [c, h] = f(x / n, y / n, x, y);
      const o = (row + x) * 4;
      color[o] = c[0]; color[o + 1] = c[1]; color[o + 2] = c[2]; color[o + 3] = 255;
      const hv = h * 255;
      height[o] = height[o + 1] = height[o + 2] = hv; height[o + 3] = 255;
    }
  }
  return { key, w: n, h: n, color, height };
}

/** Worn dirt road: wheel ruts, footprints, puddles and pebbles; u across (alpha at the edges), v along. */
export function paintRoad(): Painted {
  const W = 256, H = 1024;
  const color = new Uint8ClampedArray(W * H * 4), height = new Uint8ClampedArray(W * H * 4);
  const nz = tileNoise(4242);
  const rnd = mulberry(4243);
  const light = hex(0xb59668), mid = hex(0x9d805c), dark = hex(0x846a4f), wet = hex(0x7f7c70), pebble = hex(0xc8bca4);
  const puddles: [number, number, number, number][] = [];
  for (let i = 0; i < 3; i++) puddles.push([rnd() < 0.5 ? 0.34 : 0.66, rnd(), 0.05 + rnd() * 0.04, 0.025 + rnd() * 0.02]);
  const prints: [number, number][] = [];
  for (let i = 0; i < 70; i++) prints.push([0.2 + rnd() * 0.6, rnd()]);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    // only the marks near this row matter
    const rowPrints = prints.filter(([, py]) => Math.min(Math.abs(v - py), 1 - Math.abs(v - py)) < 0.007);
    const rowPuddles = puddles.filter(([, py, , ry]) => Math.min(Math.abs(v - py), 1 - Math.abs(v - py)) < ry * 1.4);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const n = nz.fbm(u, v, 8, 5);
      let c = n < 0.5 ? mix(dark, mid, n * 2) : mix(mid, light, (n - 0.5) * 2);
      let h = 0.5 + 0.2 * n;
      for (const base of [0.34, 0.66]) {
        const cx = base + 0.025 * Math.sin(v * Math.PI * 4 + base * 9) + 0.01 * Math.sin(v * Math.PI * 14);
        const d = (u - cx) / 0.035;
        const g = Math.exp(-d * d);
        c = mix(c, mul(dark, 0.78), g * 0.7);
        h -= g * 0.32;
        const ridge = Math.exp(-((Math.abs(d) - 1.6) ** 2) * 2);
        c = mix(c, light, ridge * 0.25);
        h += ridge * 0.12;
        if (Math.abs(Math.abs(d) - 0.55) < 0.07) c = mul(c, 0.85);
      }
      for (const [px, py] of rowPrints) {
        let dy = Math.abs(v - py);
        dy = Math.min(dy, 1 - dy);
        const e = ((u - px) / 0.012) ** 2 + (dy / 0.006) ** 2;
        if (e < 1) { c = mul(c, 0.82); h -= 0.08 * (1 - e); }
      }
      if (nz.n(u, v, 200) > 0.86 && nz.n(u + 0.5, v, 150) > 0.6) { c = mix(c, pebble, 0.7); h += 0.25; }
      for (const [px, py, rx, ry] of rowPuddles) {
        let dy = Math.abs(v - py);
        dy = Math.min(dy, 1 - dy);
        const e = ((u - px) / rx) ** 2 + (dy / ry) ** 2 + (nz.n(u, v, 64) - 0.5) * 0.5;
        if (e < 1) { c = mix(wet, hex(0x9a9e9a), smooth(0.2, 0.9, 1 - e) * 0.4); h = 0.22; }
        else if (e < 1.5) { c = mul(c, 0.8); h -= 0.05; }
      }
      const edge = Math.min(u, 1 - u);
      const a = smooth(0.02, 0.17, edge + (nz.fbm(u, v, 16, 3) - 0.5) * 0.12);
      const o = ((H - 1 - y) * W + x) * 4;
      color[o] = c[0]; color[o + 1] = c[1]; color[o + 2] = c[2]; color[o + 3] = a * 255;
      height[o] = height[o + 1] = height[o + 2] = h * 255; height[o + 3] = 255;
    }
  }
  return { key: '__road', w: W, h: H, color, height };
}
