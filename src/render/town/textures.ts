/**
 * Materials for the town buildings. Surface textures are painted by pure functions
 * (paint.ts) in a background worker that starts when the game boots, so entering a town
 * does not stall; the main thread paints anything the worker has not delivered yet.
 * Texture coordinates are in metres, a texture's `size` is how many metres one tile covers.
 */
import * as THREE from 'three';
import { drawFlag } from '../../assets.ts';
import { DEFS, mulberry, type Painted, paintRGBA, paintRoad } from './paint.ts';


const PLAIN: Record<string, { color: number; rough?: number; metal?: number; emissive?: number }> = {
  dark: { color: 0x1a1612 },
  black: { color: 0x141414, rough: 0.5 },
  white: { color: 0xf0ece2 },
  gold: { color: 0xc9a14a, rough: 0.4, metal: 0.7 },
  forge: { color: 0xff7a22, emissive: 0xff5a10 },
  water: { color: 0x2d6a78, rough: 0.2 },
  grave: { color: 0x9a978c },
};


const painted = new Map<string, Painted>();
let resolution = 512;
let workers: Worker[] = [];
let ready: Promise<void> = Promise.resolve();

/** Start painting every surface texture in the background, split over several workers. */
export function startTexturePainting(res: number): Promise<void> {
  if (workers.length && res === resolution) return ready;
  for (const w of workers) w.terminate();
  workers = [];
  resolution = res;
  painted.clear();
  texCache.clear();
  matCache.clear();
  road = null;
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const jobs: string[][] = Array.from({ length: n }, () => []);
  jobs[0].push('__road');
  Object.keys(DEFS).forEach((k, i) => jobs[(i + 1) % n].push(k));
  try {
    const done = jobs.map((keys) => {
      const w = new Worker(new URL('./textureWorker.ts', import.meta.url), { type: 'module' });
      workers.push(w);
      return new Promise<void>((resolve) => {
        w.onmessage = (e: MessageEvent<Painted | { done: true }>) => {
          if ('done' in e.data) { resolve(); w.terminate(); return; }
          painted.set(e.data.key, e.data);
        };
        w.onerror = () => resolve(); // anything missing is painted on the main thread
        w.postMessage({ keys, res });
      });
    });
    ready = Promise.all(done).then(() => undefined);
  } catch {
    ready = Promise.resolve();
  }
  return ready;
}

/** Resolves when the background painter has finished (or failed). */
export function texturesReady(): Promise<void> {
  return ready;
}

function dataTexture(p: Painted, srgb: boolean, data: Uint8ClampedArray, wrapS: THREE.Wrapping): THREE.DataTexture {
  const t = new THREE.DataTexture(data, p.w, p.h, THREE.RGBAFormat);
  t.wrapS = wrapS;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const texCache = new Map<string, { map: THREE.DataTexture; bump: THREE.DataTexture }>();

function paintTexture(key: string): { map: THREE.DataTexture; bump: THREE.DataTexture } {
  let t = texCache.get(key);
  if (t) return t;
  const def = DEFS[key];
  const p = painted.get(key) ?? paintRGBA(key, def.px ?? resolution);
  t = { map: dataTexture(p, true, p.color, THREE.RepeatWrapping), bump: dataTexture(p, false, p.height, THREE.RepeatWrapping) };
  t.map.repeat.set(1 / def.size, 1 / def.size);
  t.bump.repeat.set(1 / def.size, 1 / def.size);
  texCache.set(key, t);
  return t;
}

const matCache = new Map<string, THREE.Material>();

/**
 * Material by key: a texture name ("slate"), optionally tinted ("stucco|e8c890"), or a plain
 * colour name ("dark"), or a hex colour ("#5b4128").
 */
export function material(key: string): THREE.Material {
  let m = matCache.get(key);
  if (m) return m;
  const [name, tint] = key.split('|');
  if (DEFS[name]) {
    const def = DEFS[name];
    const t = paintTexture(name);
    m = new THREE.MeshStandardMaterial({
      map: t.map,
      bumpMap: t.bump,
      bumpScale: def.bump ?? 1,
      roughness: def.rough ?? 0.92,
      metalness: def.metal ?? 0,
      color: tint ? new THREE.Color(`#${tint}`) : 0xffffff,
    });
  } else if (PLAIN[name]) {
    const p = PLAIN[name];
    m = new THREE.MeshStandardMaterial({ color: p.color, roughness: p.rough ?? 0.9, metalness: p.metal ?? 0, emissive: p.emissive ?? 0, emissiveIntensity: p.emissive ? 2 : 0 });
  } else {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(name), roughness: 0.9 });
  }
  matCache.set(key, m);
  return m;
}

// ---- special textures -------------------------------------------------------------------------

/** Palm frond: a rib with leaflets, on a transparent background. */
export function frondTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d')!;
  const rnd = mulberry(77);
  const greens = ['#3f4f1c', '#55652a', '#6b7a35', '#7d8a42', '#4a5a22', '#8f9a4a'];
  for (let i = 0; i < 110; i++) {
    const t = i / 110;
    const y = 10 + t * 485;
    const len = 60 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) * (0.75 + rnd() * 0.35);
    for (const side of [-1, 1]) {
      g.fillStyle = greens[Math.floor(rnd() * greens.length)];
      g.beginPath();
      g.moveTo(64, y);
      g.quadraticCurveTo(64 + side * len * 0.5, y + 4, 64 + side * len, y + 26 + len * 0.35);
      g.quadraticCurveTo(64 + side * len * 0.5, y + 7, 64, y + 3.2);
      g.fill();
    }
  }
  g.strokeStyle = '#7a6a3a';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(64, 0);
  g.lineTo(64, 500);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Grass and fern tufts: blades on a transparent background. */
export function tuftTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rnd = mulberry(91);
  const greens = ['#424c27', '#55602c', '#646f32', '#7a8438', '#888e38', '#4f5f2a', '#9aa048'];
  for (let i = 0; i < 170; i++) {
    const x = 16 + rnd() * 224;
    const h = 70 + rnd() * 175;
    const lean = (rnd() - 0.5) * 140;
    g.fillStyle = greens[Math.floor(rnd() * greens.length)];
    g.beginPath();
    g.moveTo(x - 3, 256);
    g.quadraticCurveTo(x + lean * 0.3, 256 - h * 0.6, x + lean, 256 - h);
    g.quadraticCurveTo(x + lean * 0.3 + 3, 256 - h * 0.5, x + 3, 256);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


let road: { map: THREE.DataTexture; bump: THREE.DataTexture } | null = null;

/** Worn dirt road texture: u across the road (alpha at the edges), v along it. */
export function roadTexture(): { map: THREE.DataTexture; bump: THREE.DataTexture } {
  if (road) return road;
  const p = painted.get('__road') ?? paintRoad();
  road = { map: dataTexture(p, true, p.color, THREE.ClampToEdgeWrapping), bump: dataTexture(p, false, p.height, THREE.ClampToEdgeWrapping) };
  return road;
}

/** Fine greyscale noise used to add close-up detail to the ground. */
export function detailTexture(): THREE.Texture {
  const t = paintTexture('detail').map;
  t.colorSpace = THREE.NoColorSpace;
  t.repeat.set(1, 1);
  return t;
}

/** Flags flown over buildings; the English colonies fly the 1606 Union Flag. */
export function buildingFlag(nation: string): THREE.CanvasTexture {
  let c: HTMLCanvasElement;
  if (nation === 'England') {
    c = document.createElement('canvas');
    c.width = 192;
    c.height = 120;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1b2f6b';
    g.fillRect(0, 0, 192, 120);
    g.strokeStyle = '#fff';
    g.lineWidth = 22;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(192, 120); g.moveTo(192, 0); g.lineTo(0, 120); g.stroke();
    g.fillStyle = '#fff';
    g.fillRect(78, 0, 36, 120); g.fillRect(0, 42, 192, 36);
    g.fillStyle = '#c8102e';
    g.fillRect(86, 0, 20, 120); g.fillRect(0, 50, 192, 20);
  } else {
    c = drawFlag(nation.toLowerCase(), 192, 120);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const hexTint = (h: number) => h.toString(16).padStart(6, '0');
export { mulberry };
