/** CPU access to the coastline distance field, mirroring the terrain shader's height function. */
import { worldUrl } from '../assets.ts';

function hash(x: number, y: number): number {
  let px = (x * 123.34) % 1, py = (y * 456.21) % 1;
  if (px < 0) px += 1;
  if (py < 0) py += 1;
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  const v = (px * py) % 1;
  return v < 0 ? v + 1 : v;
}

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

export function fbm3(x: number, y: number): number {
  let v = 0, a = 0.5;
  for (let i = 0; i < 3; i++) {
    v += a * vnoise(x, y);
    x = x * 2.07 + 5.3;
    y = y * 2.07 + 1.7;
    a *= 0.5;
  }
  return v;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class TerrainSampler {
  readonly image: HTMLImageElement;
  private data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
  readonly mapW: number;
  readonly mapH: number;

  private constructor(img: HTMLImageElement, mapW: number, mapH: number) {
    this.image = img;
    this.w = img.width;
    this.h = img.height;
    this.mapW = mapW;
    this.mapH = mapH;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    this.data = g.getImageData(0, 0, img.width, img.height).data;
  }

  static async load(): Promise<TerrainSampler> {
    const meta = (await (await fetch(worldUrl('world.json'))).json()) as { width: number; height: number };
    const img = new Image();
    img.src = worldUrl('terrain.webp');
    await img.decode();
    return new TerrainSampler(img, meta.width, meta.height);
  }

  /** Signed distance to the coast in map px (positive on land), bilinear. */
  sd(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.w - 1.001, (x / this.mapW) * this.w - 0.5));
    const fy = Math.max(0, Math.min(this.h - 1.001, (y / this.mapH) * this.h - 0.5));
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const at = (X: number, Y: number) => this.data[(Y * this.w + X) * 4];
    const v = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
    return (v - 128) * 2;
  }

  /** Terrain height used by the sea-map shader. */
  height(x: number, y: number): number {
    const sd = this.sd(x, y);
    const land = smooth(0, 6, sd);
    return land * (smooth(0, 120, sd) * 70 + fbm3(x * 0.004, y * 0.004) * 55 * smooth(10, 90, sd));
  }
}
