/** Asset helpers. Everything is either generated at build time (public/world) or procedurally. */

export const BASE = import.meta.env.BASE_URL;

export function worldUrl(path: string): string {
  return `${BASE}world/${path}`;
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Draw a nation's flag (0-3 Spain/England/France/Holland, 4 pirates) on a canvas. */
export function drawFlag(kind: string, w = 64, h = 40): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.scale(w / 64, h / 40);
  switch (kind) {
    case 'spain':
      g.fillStyle = '#c60b1e'; g.fillRect(0, 0, 64, 40);
      g.fillStyle = '#ffc400'; g.fillRect(0, 10, 64, 20);
      break;
    case 'england':
      g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 40);
      g.fillStyle = '#cf142b'; g.fillRect(27, 0, 10, 40); g.fillRect(0, 15, 64, 10);
      break;
    case 'france':
      g.fillStyle = '#1f3c8f'; g.fillRect(0, 0, 64, 40);
      g.fillStyle = '#f2c64b';
      for (const [x, y] of [[16, 12], [40, 12], [28, 28]]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
      break;
    case 'holland':
      g.fillStyle = '#ae1c28'; g.fillRect(0, 0, 64, 14);
      g.fillStyle = '#fff'; g.fillRect(0, 14, 64, 13);
      g.fillStyle = '#21468b'; g.fillRect(0, 27, 64, 13);
      break;
    default:
      g.fillStyle = '#111'; g.fillRect(0, 0, 64, 40);
      g.fillStyle = '#eee'; g.beginPath(); g.arc(32, 16, 8, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#eee'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(18, 26); g.lineTo(46, 36); g.moveTo(46, 26); g.lineTo(18, 36); g.stroke();
  }
  return c;
}

const flagCache = new Map<string, string>();
export function flagUrl(nation: string): string {
  const k = nation.toLowerCase();
  let u = flagCache.get(k);
  if (!u) {
    u = drawFlag(k).toDataURL();
    flagCache.set(k, u);
  }
  return u;
}

/** Procedural paper and wood textures for the UI (SVG turbulence, no image files). */
export function registerStyleAssets(): void {
  const paper = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.32  0 0 0 0 0.16  0 0 0 0.22 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  )}")`;
  const grain = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='120'><filter id='w'><feTurbulence type='fractalNoise' baseFrequency='0.008 0.25' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0 0.02  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(#w)'/></svg>`,
  )}")`;
  const root = document.documentElement.style;
  root.setProperty('--img-paper', paper);
  root.setProperty('--img-grain', grain);
  root.setProperty('--img-overview', `url('${worldUrl('overview.png')}')`);
}
