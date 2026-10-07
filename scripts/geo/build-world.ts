/**
 * Builds the game's geography from Natural Earth (public domain) coastlines:
 *   public/world/terrain.webp  R = signed distance to the coast, G = antialiased land mask
 *   public/world/nav.bin       navigation grid (u16 w, u16 h, MSB-first bits, 1 = blocked)
 *
 *   node scripts/geo/build-world.ts
 *
 * Downloads ne_10m_land and ne_10m_minor_islands into .cache/ on first run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { GEO, MAP_H, MAP_W, project } from '../../src/data/geo.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, 'public/world');
const SOURCES = ['ne_10m_land', 'ne_10m_minor_islands'];

async function source(name: string): Promise<GeoJSON> {
  const p = join(CACHE, `${name}.geojson`);
  if (!existsSync(p)) {
    mkdirSync(CACHE, { recursive: true });
    const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/${name}.geojson`;
    console.log(`downloading ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  }
  return JSON.parse(readFileSync(p, 'utf8')) as GeoJSON;
}

interface GeoJSON {
  features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[];
}

/** Even-odd scanline fill of one polygon (outer ring + holes) into `mask` at scale `ss` (OR). */
function fillPolygon(mask: Uint8Array, w: number, h: number, rings: number[][][], ss: number): void {
  const edges: [number, number, number, number][] = [];
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = project(ring[i][0], ring[i][1]).map((v) => v * ss);
      const [x1, y1] = project(ring[i + 1][0], ring[i + 1][1]).map((v) => v * ss);
      if (y0 === y1) continue;
      edges.push([x0, y0, x1, y1]);
      minY = Math.min(minY, y0, y1);
      maxY = Math.max(maxY, y0, y1);
    }
  }
  if (maxY < 0 || minY >= h) return;
  const xs: number[] = [];
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(h - 1, Math.ceil(maxY)); y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if ((sy >= y0 && sy < y1) || (sy >= y1 && sy < y0)) xs.push(x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5));
      const b = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) mask[y * w + x] = 1; // spans already pair up even-odd, holes included
    }
  }
}

function inBox(rings: number[][][]): boolean {
  for (const [lon, lat] of rings[0]) {
    if (lon > GEO.lonMin - 1 && lon < GEO.lonMax + 1 && lat > GEO.latMin - 1 && lat < GEO.latMax + 1) return true;
  }
  return false;
}

/** Two-pass chamfer distance (3-4 weights) to the nearest cell where `target(i)` is true. */
function chamfer(w: number, h: number, target: (i: number) => boolean): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = target(i) ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

const t0 = Date.now();
mkdirSync(OUT, { recursive: true });
// full-resolution land mask (1 px = 1 map px)
const W = MAP_W, H = MAP_H;
const land = new Uint8Array(W * H);
for (const name of SOURCES) {
  const gj = await source(name);
  let n = 0;
  for (const f of gj.features) {
    const g = f.geometry;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][];
    for (const rings of polys) {
      if (!inBox(rings)) continue;
      fillPolygon(land, W, H, rings, 1);
      n++;
    }
  }
  console.log(`${name}: ${n} polygons`);
}

// terrain texture at half resolution: signed distance + antialiased mask
const tw = Math.ceil(W / 2), th = Math.ceil(H / 2);
const aa = new Uint8Array(tw * th);
for (let y = 0; y < th; y++) {
  for (let x = 0; x < tw; x++) {
    let s = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const X = Math.min(W - 1, x * 2 + dx), Y = Math.min(H - 1, y * 2 + dy);
      s += land[Y * W + X];
    }
    aa[y * tw + x] = s;
  }
}
const toLand = chamfer(tw, th, (i) => aa[i] >= 2);
const toSea = chamfer(tw, th, (i) => aa[i] < 2);
const rgba = Buffer.alloc(tw * th * 4);
for (let i = 0; i < tw * th; i++) {
  // positive on land, negative at sea, in half-res pixels (= 2 map px), clamped to +-127
  const sd = aa[i] >= 2 ? toSea[i] : -toLand[i];
  rgba[i * 4] = Math.max(0, Math.min(255, Math.round(128 + sd)));
  rgba[i * 4 + 1] = Math.round((aa[i] / 4) * 255);
  rgba[i * 4 + 2] = 0;
  rgba[i * 4 + 3] = 255;
}
await sharp(rgba, { raw: { width: tw, height: th, channels: 4 } }).webp({ lossless: true, effort: 6 }).toFile(join(OUT, 'terrain.webp'));

// navigation grid: a cell is blocked if any of its pixels is land
const c = GEO.navCell;
const nw = Math.ceil(W / c), nh = Math.ceil(H / c);
const bits = Buffer.alloc(4 + Math.ceil((nw * nh) / 8));
bits.writeUInt16LE(nw, 0);
bits.writeUInt16LE(nh, 2);
for (let y = 0; y < nh; y++) {
  for (let x = 0; x < nw; x++) {
    let blocked = 0;
    for (let dy = 0; dy < c && !blocked; dy++) for (let dx = 0; dx < c; dx++) {
      const X = x * c + dx, Y = y * c + dy;
      if (X < W && Y < H && land[Y * W + X]) { blocked = 1; break; }
    }
    const i = y * nw + x;
    if (blocked) bits[4 + (i >> 3)] |= 0x80 >> (i & 7);
  }
}
writeFileSync(join(OUT, 'nav.bin'), bits);

// small overview for the minimap
const ow = 512, oh = Math.round((H / W) * 512);
const ov = Buffer.alloc(ow * oh * 4);
for (let y = 0; y < oh; y++) {
  for (let x = 0; x < ow; x++) {
    const X = Math.floor((x / ow) * W), Y = Math.floor((y / oh) * H);
    const l = land[Y * W + X];
    const o = (y * ow + x) * 4;
    ov[o] = l ? 104 : 22; ov[o + 1] = l ? 128 : 78; ov[o + 2] = l ? 74 : 124; ov[o + 3] = 255;
  }
}
await sharp(ov, { raw: { width: ow, height: oh, channels: 4 } }).png().toFile(join(OUT, 'overview.png'));
writeFileSync(join(OUT, 'world.json'), JSON.stringify({ width: W, height: H, terrain: [tw, th], nav: [nw, nh], navCell: c }));
console.log(`world ${W}x${H}, terrain ${tw}x${th}, nav ${nw}x${nh} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
