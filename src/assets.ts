/** URLs and loaders for the assets produced by `npm run extract` (public/game/). */
import * as THREE from 'three';

export const BASE = import.meta.env.BASE_URL;

export function asset(path: string): string {
  return `${BASE}game/${path}`;
}

export async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(asset(path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function fetchBytes(path: string): Promise<Uint8Array> {
  const r = await fetch(asset(path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** True when the extracted assets are present. */
export async function assetsPresent(): Promise<boolean> {
  try {
    const r = await fetch(asset('manifest.json'), { cache: 'no-store' });
    if (!r.ok) return false;
    const m = await r.json();
    return typeof m.version === 'number';
  } catch {
    return false;
  }
}

/** Register fonts and CSS image variables (so CSS stays base-path independent). */
export async function registerStyleAssets(): Promise<void> {
  const root = document.documentElement.style;
  root.setProperty('--img-parchment', `url('${asset('ui/parchment-globe.webp')}')`);
  root.setProperty('--img-wood', `url('${asset('ui/wood.webp')}')`);
  root.setProperty('--img-title', `url('${asset('ui/title-map.webp')}')`);
  root.setProperty('--img-loading', `url('${asset('ui/loading-ship.webp')}')`);
  const fonts: [string, string, string][] = [
    ['Tiepolo', 'fonts/tiepolo-bold.ttf', 'bold'],
    ['Tiepolo', 'fonts/tiepolo-black.ttf', '900'],
    ['ElGreco', 'fonts/elgreco.ttf', 'normal'],
  ];
  await Promise.all(
    fonts.map(async ([family, path, weight]) => {
      try {
        const f = new FontFace(family, `url('${asset(path)}')`, { weight });
        await f.load();
        document.fonts.add(f);
      } catch {
        /* fall back to the CSS font stack */
      }
    }),
  );
}

const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();

export function texture(path: string, opts: { repeat?: boolean; nearest?: boolean } = {}): Promise<THREE.Texture> {
  const key = `${path}|${opts.repeat ? 1 : 0}|${opts.nearest ? 1 : 0}`;
  let p = cache.get(key);
  if (!p) {
    p = loader.loadAsync(asset(path)).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (opts.nearest) t.magFilter = THREE.NearestFilter;
      t.anisotropy = 4;
      return t;
    });
    cache.set(key, p);
  }
  return p;
}

export function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${path}`));
    img.src = asset(path);
  });
}

export function flagUrl(nation: string): string {
  return asset(`ui/flag-${nation.toLowerCase()}.webp`);
}

export function shipSheetUrl(typeId: number): string {
  return asset(`ships/${String(typeId).padStart(2, '0')}.webp`);
}
