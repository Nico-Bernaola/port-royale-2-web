/**
 * Town buildings, modelled after the British colonial concept sheets: weathered timber cottages
 * on stilts, a half-timbered tavern and warehouse, a limestone Anglican church, the governor's
 * house with its portico and cupola, and a shipyard on a stone quay. Other nations reuse the
 * same models with their own materials (palettes). Local frame: +z is the front, y up, metres.
 */
import * as THREE from 'three';
import { Kit } from './kit.ts';

export interface Palette {
  nation: string;
  /** cottage roofs */
  roof: string;
  /** tavern, warehouse, workshop, church roofs */
  roofMain: string;
  roofTavern: string;
  /** governor's house and town hall */
  roofGrand: string;
  /** cottage wall materials, one per cottage design */
  walls: [string, string, string];
  stucco: string;
  stone: string;
  trim: string;
  shutters: string[];
}

export const PALETTES: Record<string, Palette> = {
  England: {
    nation: 'England', roof: 'shingle', roofMain: 'slate', roofTavern: 'slateMoss', roofGrand: 'terracotta',
    walls: ['planks', 'boards', 'clapboard'], stucco: 'stucco', stone: 'limestone', trim: 'white',
    shutters: ['#56663f', '#6a4c33', '#45596a', '#5d5a3c'],
  },
  Spain: {
    nation: 'Spain', roof: 'terracotta', roofMain: 'terracotta', roofTavern: 'terracotta|c99a80', roofGrand: 'terracotta',
    walls: ['plaster|f3e6c8', 'plaster|ead2a8', 'plaster'], stucco: 'plaster|f4ead6', stone: 'limestone|efe2c4', trim: 'white',
    shutters: ['#2f5a74', '#6a3a2a', '#3f6a44', '#8a5a2a'],
  },
  France: {
    nation: 'France', roof: 'slate', roofMain: 'slate', roofTavern: 'slateMoss', roofGrand: 'slate',
    walls: ['plaster|efe5cf', 'planks', 'plaster|e2d6bc'], stucco: 'plaster|efe6d2', stone: 'limestone', trim: 'white',
    shutters: ['#3f5f86', '#5a6a46', '#7a3a32', '#4a5560'],
  },
  Holland: {
    nation: 'Holland', roof: 'terracotta|9a7a6a', roofMain: 'slate', roofTavern: 'slate', roofGrand: 'terracotta|a07060',
    walls: ['brick', 'brick|c8a090', 'plaster|ebe3d3'], stucco: 'plaster|ece4d4', stone: 'brick|d8b0a0', trim: 'white',
    shutters: ['#2f5a3a', '#7a2f2a', '#2f4a6a', '#e0d8c8'],
  },
};

export interface Blueprint {
  group: THREE.Group;
  /** footprint half-extents (x, z) for placement */
  half: [number, number];
  /** flag attachment points (top of the pole), local */
  flags: THREE.Vector3[];
  /** where a ship under construction sits (shipyard only) */
  slip?: THREE.Vector3;
}

// ---- props ------------------------------------------------------------------------------------

function barrel(k: Kit, x: number, y: number, z: number, s = 1): void {
  k.lathe('wood', [[0, 0], [0.27 * s, 0], [0.32 * s, 0.22 * s], [0.34 * s, 0.42 * s], [0.32 * s, 0.62 * s], [0.27 * s, 0.84 * s], [0, 0.84 * s]], x, y, z, 10);
  for (const hy of [0.12, 0.72]) k.cyl('iron', 0.3 * s + 0.012, 0.05, x, y + hy * s, z, 10);
}

function barrelLying(k: Kit, x: number, y: number, z: number, ry: number): void {
  k.push(x, y + 0.33, z, ry);
  k.add('wood', new THREE.LatheGeometry([[0, -0.42], [0.27, -0.42], [0.33, -0.2], [0.34, 0], [0.33, 0.2], [0.27, 0.42], [0, 0.42]].map(([a, b]) => new THREE.Vector2(a, b)), 10), 0, 0, 0, 0, 0, Math.PI / 2);
  k.pop();
}

function crate(k: Kit, x: number, y: number, z: number, s: number, ry = 0): void {
  k.box('wood', s, s, s, x, y + s / 2, z, ry);
  k.push(x, y, z, ry);
  for (const sz of [-1, 1]) {
    k.box('timber', s + 0.02, 0.08, 0.04, 0, s * 0.12, sz * (s / 2 + 0.01));
    k.box('timber', s + 0.02, 0.08, 0.04, 0, s * 0.88, sz * (s / 2 + 0.01));
  }
  k.pop();
}

function sack(k: Kit, x: number, y: number, z: number, ry = 0): void {
  k.push(x, y, z, ry);
  k.sphere('sack', 0.35, 0, 0.22, 0, 0.62, 1);
  k.pop();
}

function wheel(k: Kit, x: number, z: number, ry: number, lean = 0.25): void {
  k.push(x, 0, z, ry);
  const g = new THREE.TorusGeometry(0.55, 0.06, 6, 16);
  k.add('wood', g, 0, 0.58, 0, -lean, 0, 0);
  for (let i = 0; i < 6; i++) k.add('wood', new THREE.BoxGeometry(0.05, 1.05, 0.05), 0, 0.58, 0, -lean, 0, (i / 6) * Math.PI);
  k.add('timber', new THREE.CylinderGeometry(0.1, 0.1, 0.18, 8), 0, 0.58, 0, Math.PI / 2 - lean, 0, 0);
  k.pop();
}

function logPile(k: Kit, x: number, z: number, len: number, rows: number, ry: number, r = 0.16, key = 'wood'): void {
  k.push(x, 0, z, ry);
  for (let row = 0; row < rows; row++) {
    const n = rows - row + 1;
    for (let i = 0; i < n; i++) k.log(key, r, len, 0, r + row * r * 1.7, (i - (n - 1) / 2) * r * 2.02);
  }
  k.pop();
}

function plankStack(k: Kit, x: number, z: number, ry: number, layers = 6): void {
  k.push(x, 0, z, ry);
  for (let l = 0; l < layers; l++) {
    k.block('timber', 0.15, 0.1, 1.6, l % 2 ? -1.6 : 1.6, l * 0.3, 0);
    for (let i = 0; i < 5; i++) k.block('wood', 4.2, 0.07, 0.26, 0, l * 0.3 + 0.1, (i - 2) * 0.3);
  }
  k.pop();
}

function cannon(k: Kit, x: number, z: number, ry: number): void {
  k.push(x, 0, z, ry);
  k.block('timber', 0.7, 0.35, 1.3, 0, 0.12, 0);
  for (const s of [-1, 1]) for (const wz of [-0.45, 0.45]) k.add('timber', new THREE.CylinderGeometry(0.18, 0.18, 0.1, 10), s * 0.4, 0.18, wz, 0, 0, Math.PI / 2);
  k.add('black', new THREE.CylinderGeometry(0.13, 0.2, 2.0, 10), 0, 0.65, 0.3, Math.PI / 2 - 0.06, 0, 0);
  k.pop();
}

function coil(k: Kit, x: number, y: number, z: number): void {
  k.add('rope', new THREE.TorusGeometry(0.32, 0.09, 6, 14), x, y + 0.09, z, Math.PI / 2, 0, 0);
  k.add('rope', new THREE.TorusGeometry(0.28, 0.08, 6, 14), x, y + 0.24, z, Math.PI / 2, 0, 0);
}

function shotPile(k: Kit, x: number, z: number): void {
  const r = 0.11;
  for (let l = 0; l < 3; l++) {
    const n = 4 - l;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) k.sphere('black', r, x + (i - (n - 1) / 2) * r * 2, r + l * r * 1.5, z + (j - (n - 1) / 2) * r * 2, 1, 0);
  }
}

function rowboat(k: Kit, x: number, z: number, ry: number): void {
  k.push(x, 0, z, ry);
  const hull = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hull.scale(2.4, 0.75, 0.9);
  k.add('wood', hull, 0, 0.45, 0);
  k.add('timber', new THREE.TorusGeometry(1, 0.06, 4, 20).scale(2.4, 0.9, 1), 0, 0.45, 0, Math.PI / 2, 0, 0);
  k.box('timber', 3.8, 0.05, 1.2, 0, 0.12, 0);
  for (const bx of [-0.8, 0.5]) k.box('wood', 0.25, 0.05, 1.5, bx, 0.35, 0);
  k.pop();
}

function grave(k: Kit, x: number, z: number, ry: number): void {
  k.push(x, 0, z, ry);
  k.block('grave', 0.6, 0.75, 0.14, 0, 0, 0);
  k.add('grave', new THREE.CylinderGeometry(0.3, 0.3, 0.14, 10, 1, false, -Math.PI / 2, Math.PI), 0, 0.75, 0, -Math.PI / 2, 0, 0);
  k.pop();
}

function flagPole(k: Kit, x: number, y: number, z: number, h: number, key = 'white'): THREE.Vector3 {
  k.cyl(key, 0.08, h, x, y, z, 6, 0.05);
  k.sphere('gold', 0.12, x, y + h + 0.08, z, 1, 0);
  return new THREE.Vector3(x, y + h - 0.1, z);
}

/** Half-timbering on a wall facing +z: sill, head, posts per bay and corner braces. */
function timbering(k: Kit, x0: number, x1: number, y0: number, y1: number, z: number, bays: number, openBays: number[] = [], key = 'timber'): void {
  const t = 0.2, d = 0.12, zc = z + 0.03;
  const w = x1 - x0, h = y1 - y0;
  k.box(key, w + 0.1, t, d, (x0 + x1) / 2, y0 + t / 2, zc);
  k.box(key, w + 0.1, t, d, (x0 + x1) / 2, y1 - t / 2, zc);
  const bw = w / bays;
  for (let i = 0; i <= bays; i++) k.box(key, t, h, d, x0 + bw * i, (y0 + y1) / 2, zc);
  for (let i = 0; i < bays; i++) {
    if (openBays.includes(i)) continue;
    const cx = x0 + bw * (i + 0.5);
    if (i === 0 || i === bays - 1) {
      const len = Math.hypot(bw, h);
      const a = Math.atan2(h, bw) * (i === 0 ? 1 : -1);
      k.add(key, new THREE.BoxGeometry(len, t * 0.8, d), cx, (y0 + y1) / 2, zc, 0, 0, a);
    } else {
      k.box(key, bw, t * 0.8, d, cx, y0 + h * 0.5, zc);
    }
  }
}

function dormer(k: Kit, x: number, y: number, zFront: number, w: number, h: number, depth: number, wall: string, roof: string, frame = 'timber'): void {
  k.box(wall, w, h, depth, x, y + h / 2, zFront - depth / 2);
  k.push(x, y + h, zFront - depth / 2, Math.PI / 2);
  k.gable(roof, depth + 0.2, w, w * 0.55, 0, 0, 0, { eave: 0.22, over: 0.18, thick: 0.1 });
  k.gableEnd(wall, w, w * 0.55, -depth / 2 + 0.1, 0, 0, 0.2);
  k.pop();
  k.window(x, y + 0.3, zFront, Math.min(0.75, w - 0.6), Math.min(0.9, h - 0.5), { frame, glass: 'glassDark', sill: frame });
}

function chimney(k: Kit, x: number, z: number, y0: number, top: number, w: number, d: number, key = 'brick'): void {
  k.block(key, w, top - y0, d, x, y0, z);
  k.block(key, w + 0.14, 0.18, d + 0.14, x, top - 0.3, z);
  k.cyl('#8a5a40', 0.12, 0.35, x - w * 0.2, top, z, 8);
  k.cyl('#8a5a40', 0.12, 0.3, x + w * 0.2, top, z, 8);
}

// ---- cottages ---------------------------------------------------------------------------------

/** Three cottage designs from the sheets; `v` picks the design, `rnd` varies details. */
export function cottage(k: Kit, p: Palette, v: number, rnd: () => number): [number, number] {
  const shutter = p.shutters[Math.floor(rnd() * p.shutters.length)];
  const wall = p.walls[v];
  if (v === 0) {
    // loft & dormer: natural timber, stone chimney outside the gable, porch at the front right
    const W = 8, D = 6, F = 0.7, H = 3.0, R = 3.4;
    for (const x of [-W / 2 + 0.2, 0, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) k.block('timber', 0.26, F, 0.26, x, 0, z);
    k.block('deck', W + 0.1, 0.2, D + 0.1, 0, F - 0.2, 0);
    k.block(wall, W, H, D, 0, F, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.block('timber', 0.2, H, 0.2, sx * W / 2, F, sz * D / 2);
    for (const sx of [-1, 1]) k.gableEnd(wall, D, R, sx * (W / 2 - 0.12), F + H);
    k.gable(p.roof, W, D, R, 0, F + H, 0, { eave: 0.5, over: 0.45 });
    dormer(k, 1.0, F + H + 0.8, 1.45, 1.7, 1.5, 1.6, wall, p.roof);
    k.block(p.stone === 'limestone' ? 'rubble' : p.stone, 1.4, F + H * 0.75, 1.1, -W / 2 - 0.6, 0, -0.6);
    chimney(k, -W / 2 - 0.55, -0.6, F + H * 0.75, F + H + R + 0.9, 0.85, 0.75, p.stone === 'limestone' ? 'rubble' : p.stone);
    k.window(-2.5, F + 0.9, D / 2, 0.9, 1.1, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' });
    k.door(0.3, F, D / 2, 1.0, 2.1);
    k.window(2.5, F + 0.9, D / 2, 0.9, 1.1, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' });
    k.push(W / 2, 0, 0, Math.PI / 2).window(0.6, F + 0.9, 0, 0.9, 1.1, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' }).pop();
    k.push(0, 0, -D / 2, Math.PI).window(1.5, F + 0.9, 0, 0.9, 1.1, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' }).pop();
    // porch
    k.block('deck', 4.6, 0.16, 1.9, 1.3, F - 0.16, D / 2 + 0.95);
    for (const x of [-0.9, 3.5]) k.block('timber', 0.18, F, 0.18, x, 0, D / 2 + 1.8);
    k.steps('deck', 2.6, D / 2 + 1.9 + 0.9, 1.1, F, 3);
    barrel(k, 3.3, F, D / 2 + 0.5, 0.8);
    crate(k, -0.3, F, D / 2 + 0.5, 0.55, 0.3);
    logPile(k, -2.8, D / 2 + 1.0, 1.2, 2, 0, 0.1);
    return [W / 2 + 1.2, D / 2 + 2.8];
  }
  if (v === 1) {
    // humble board-and-batten cottage with a brick chimney through the roof
    const W = 7, D = 5.4, F = 0.6, H = 2.8, R = 2.9;
    for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, 0, D / 2 - 0.2]) k.block('timber', 0.24, F, 0.24, x, 0, z);
    k.block('deck', W + 0.1, 0.2, D + 0.1, 0, F - 0.2, 0);
    k.block(wall, W, H, D, 0, F, 0);
    for (const sx of [-1, 1]) k.gableEnd(wall, D, R, sx * (W / 2 - 0.12), F + H);
    k.gable(p.roof, W, D, R, 0, F + H, 0, { eave: 0.45, over: 0.4 });
    chimney(k, 1.8, -0.9, F + H - 0.5, F + H + R + 0.6, 0.7, 0.7);
    k.window(-1.9, F + 0.9, D / 2, 0.8, 0.95, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' });
    k.door(0.4, F, D / 2, 0.95, 2.0);
    k.window(2.3, F + 0.9, D / 2, 0.8, 0.95, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' });
    k.push(-W / 2, 0, 0, -Math.PI / 2).window(0, F + 0.9, 0, 0.8, 0.95, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' }).pop();
    k.block('deck', 3.6, 0.16, 1.6, 0.8, F - 0.16, D / 2 + 0.8);
    for (const x of [-0.9, 2.5]) {
      k.block('timber', 0.16, F, 0.16, x, 0, D / 2 + 1.5);
      k.block('timber', 0.14, 1.0, 0.14, x, F, D / 2 + 1.5);
    }
    k.steps('deck', 1.4, D / 2 + 1.6 + 0.6, 1.0, F, 2);
    barrel(k, -2.9, 0, D / 2 + 0.7, 0.9);
    k.sphere('black', 0.28, 2.6, F + 0.26, D / 2 + 0.6, 0.8, 1);
    logPile(k, -3.0, -1.0, 1.1, 2, Math.PI / 2, 0.1);
    return [W / 2 + 0.8, D / 2 + 2.2];
  }
  // horizontal clapboard with a deep front gallery under a lean-to roof
  const W = 8, D = 6, F = 0.8, H = 3.0, R = 3.0, G = 2.3;
  for (const x of [-W / 2 + 0.2, 0, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2, D / 2 + G - 0.15]) k.block('timber', 0.24, F, 0.24, x, 0, z);
  k.block('deck', W + 0.1, 0.2, D + G, 0, F - 0.2, G / 2);
  k.block(wall, W, H, D, 0, F, 0);
  for (const sx of [-1, 1]) k.block('white', 0.16, H, 0.16, sx * W / 2, F, D / 2);
  for (const sx of [-1, 1]) k.gableEnd(wall, D, R, sx * (W / 2 - 0.12), F + H);
  k.gable(p.roof, W, D, R, 0, F + H, 0, { eave: 0.35, over: 0.45 });
  // gallery roof
  const drop = 0.75, run = G + 0.4;
  const a = Math.atan2(drop, run);
  k.box(p.roof, W + 0.9, 0.12, Math.hypot(drop, run), 0, F + H - drop / 2 + 0.05, D / 2 + run / 2, 0, a);
  for (const x of [-W / 2 + 0.2, -1.2, 1.2, W / 2 - 0.2]) k.block('timber', 0.18, H - drop, 0.18, x, F, D / 2 + G - 0.15);
  k.box('timber', W, 0.18, 0.2, 0, F + H - drop - 0.05, D / 2 + G - 0.15);
  k.railing('timber', -W / 2 + 0.2, -1.2, F, D / 2 + G - 0.15, 0.85);
  k.railing('timber', 2.4, W / 2 - 0.2, F, D / 2 + G - 0.15, 0.85);
  k.steps('deck', 1.8, D / 2 + G + 0.9, 1.2, F, 3);
  chimney(k, -W / 2 + 0.7, -0.2, F + H + 0.8, F + H + R + 0.5, 0.65, 0.65);
  k.window(-2.4, F + 0.9, D / 2, 0.9, 1.15, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' });
  k.door(0.0, F, D / 2, 1.0, 2.1);
  k.window(2.4, F + 0.9, D / 2, 0.9, 1.15, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' });
  for (const s of [-1, 1]) k.push(s * W / 2, 0, 0, s * Math.PI / 2).window(-0.8, F + 0.9, 0, 0.9, 1.15, { frame: 'timber', glass: 'glassDark', shutter, sill: 'timber' }).pop();
  k.block('wood', 1.6, 0.08, 0.45, -2.6, F + 0.42, D / 2 + 0.5);
  for (const x of [-3.3, -1.9]) k.block('timber', 0.08, 0.42, 0.4, x, F, D / 2 + 0.5);
  barrel(k, -W / 2 - 0.6, 0, D / 2 - 0.5, 0.9);
  return [W / 2 + 0.8, D / 2 + G + 1.2];
}

// ---- tavern -----------------------------------------------------------------------------------

export function tavern(p: Palette): Blueprint {
  const k = new Kit();
  const W = 11, D = 8, P = 0.5, H1 = 3.2, H2 = 2.8, J = 0.35, R = 4.8;
  const st = p.stucco, roof = p.roofTavern;
  k.block(p.stone === 'limestone' ? 'rubble' : p.stone, W + 0.3, P, D + 0.3, 0, 0, 0);
  k.block(st, W, H1, D, 0, P, 0);
  k.block('timber', W + 2 * J + 0.1, 0.3, D + 2 * J + 0.1, 0, P + H1, 0);
  k.block(st, W + 2 * J, H2, D + 2 * J, 0, P + H1 + 0.3, 0);
  const top = P + H1 + 0.3 + H2;
  for (const sx of [-1, 1]) k.gableEnd(st, D + 2 * J, R, sx * (W / 2 + J - 0.12), top);
  k.gable(roof, W + 2 * J, D + 2 * J, R, 0, top, 0, { eave: 0.5, over: 0.4 });
  // timber framing, front and back, both floors
  for (const [z, ry] of [[D / 2, 0], [-D / 2, Math.PI]] as const) {
    k.push(0, 0, z, ry);
    timbering(k, -W / 2, W / 2, P, P + H1, 0, 6, [1, 2, 3, 4]);
    timbering(k, -W / 2 - J, W / 2 + J, P + H1 + 0.3, top, J, 6, [1, 2, 3, 4]);
    k.pop();
  }
  for (const s of [-1, 1]) {
    k.push(s * W / 2, 0, 0, s * Math.PI / 2);
    timbering(k, -D / 2, D / 2, P, P + H1, 0, 4, [1, 2]);
    timbering(k, -D / 2 - J, D / 2 + J, P + H1 + 0.3, top, J, 4, [1, 2]);
    k.window(-1.0, P + 1.1, 0, 0.8, 1.1, { frame: 'timber', glass: 'glassDark', sill: 'timber' });
    k.window(1.0, P + H1 + 1.0, J, 0.8, 1.0, { frame: 'timber', glass: 'glassDark', sill: 'timber' });
    k.pop();
  }
  // windows and door between the posts
  const bw = W / 6;
  for (const i of [1, 4]) k.window(-W / 2 + bw * (i + 0.5), P + 1.0, D / 2, 0.95, 1.2, { frame: 'timber', glass: 'glassDark', sill: 'timber' });
  k.door(-W / 2 + bw * 2.5 + bw * 0.5, P, D / 2, 1.3, 2.3, 'timber', 'door');
  for (const i of [1, 2, 3, 4]) k.window(-W / 2 - J + ((W + 2 * J) / 6) * (i + 0.5), P + H1 + 1.0, D / 2 + J, 0.85, 1.05, { frame: 'timber', glass: 'glassDark', sill: 'timber' });
  for (const i of [1, 4]) k.push(0, 0, 0, Math.PI).window(-W / 2 + bw * (i + 0.5), P + 1.0, D / 2, 0.95, 1.2, { frame: 'timber', glass: 'glassDark', sill: 'timber' }).pop();
  // dormers in the front slope
  for (const x of [-2.6, 2.6]) dormer(k, x, top + 1.0, 2.2, 1.9, 1.7, 2.0, st, roof);
  chimney(k, W / 2 - 1.3, -1.2, top - 1, top + R + 1.3, 1.3, 1.0);
  // stone steps up to the door, and the sign on its bracket
  k.steps('rubble', -W / 2 + bw * 3, D / 2 + 1.4, 2.4, P, 3, 0.45);
  k.box('timber', 0.14, 0.14, 1.6, 2.6, P + H1 - 0.1, D / 2 + 0.8);
  k.box('timber', 0.1, 0.9, 0.1, 2.6, P + H1 - 0.5, D / 2 + 0.1, 0, 0.9);
  for (const x of [2.25, 2.95]) k.box('iron', 0.02, 0.4, 0.02, x, P + H1 - 0.35, D / 2 + 1.35);
  k.box('wood', 1.1, 0.8, 0.07, 2.6, P + H1 - 0.95, D / 2 + 1.35);
  k.box('gold', 0.5, 0.5, 0.09, 2.6, P + H1 - 0.95, D / 2 + 1.35, 0, 0, Math.PI / 4);
  const flags = [flagPole(k, -W / 2 - J + 0.6, top + R * 0.75, 0.6, 3.2, 'timber')];
  // yard clutter
  for (let i = 0; i < 3; i++) barrel(k, -W / 2 - 1.0, 0, -2 + i * 0.75);
  for (let i = 0; i < 2; i++) barrel(k, -W / 2 - 1.0, 0.84, -1.6 + i * 0.75);
  barrelLying(k, -W / 2 - 1.1, 0, 1.4, 0.2);
  crate(k, W / 2 + 0.8, 0, 2.2, 0.8, 0.2);
  crate(k, W / 2 + 0.9, 0.8, 2.3, 0.6, -0.3);
  crate(k, -W / 2 + 0.8, 0, D / 2 + 1.0, 0.7, 0.5);
  wheel(k, 4.6, D / 2 + 0.25, 0.2);
  wheel(k, 3.6, D / 2 + 0.3, -0.1);
  wheel(k, W / 2 + 0.3, -2.0, Math.PI / 2 + 0.1);
  k.cyl('rubble', 0.6, 0.3, 4.8, 0, D / 2 + 3.0, 10);
  k.sphere('forge', 0.25, 4.8, 0.35, D / 2 + 3.0, 0.5, 0);
  return { group: k.build(), half: [W / 2 + 1.8, D / 2 + 3.5], flags };
}

// ---- warehouse --------------------------------------------------------------------------------

export function warehouse(p: Palette): Blueprint {
  const k = new Kit();
  const W = 10, L = 16, H = 5.2, R = 4.0, F = 0.5;
  const st = p.stucco;
  k.block(p.stone === 'limestone' ? 'rubble' : p.stone, W + 0.3, F, L + 0.3, 0, 0, 0);
  k.block(st, W, H, L, 0, F, 0);
  k.gable(p.roofMain, L, W, R, 0, F + H, 0, { ry: Math.PI / 2, eave: 0.55, over: 0.45 });
  for (const s of [-1, 1]) {
    k.push(0, 0, s * (L / 2 - 0.12), Math.PI / 2 - (s < 0 ? Math.PI : 0));
    k.gableEnd(st, W, R, 0, F + H);
    k.pop();
  }
  // framing: long sides
  for (const s of [-1, 1]) {
    k.push(s * W / 2, 0, 0, s * Math.PI / 2);
    timbering(k, -L / 2, L / 2, F, F + H, 0, 8, [2, 5]);
    for (const i of [1, 3, 4, 6]) k.window(-L / 2 + 2 * (i + 0.5), F + 2.8, 0, 0.7, 0.8, { frame: 'timber', glass: 'glassDark', sill: 'timber' });
    k.door(-L / 2 + 2 * 2.5, F, 0, 1.4, 2.4);
    k.pop();
  }
  // gable ends: framing, big double doors front and back, loft door and hoist beam
  for (const [z, ry] of [[L / 2, 0], [-L / 2, Math.PI]] as const) {
    k.push(0, 0, z, ry);
    timbering(k, -W / 2, W / 2, F, F + H, 0, 5, [2]);
    k.box('timber', 0.2, R * 0.8, 0.12, 0, F + H + R * 0.4, -0.05);
    k.box('timber', W * 0.7, 0.2, 0.12, 0, F + H + R * 0.25, -0.05);
    k.door(-0.85, F, 0, 1.6, 3.4, 'timber', 'door');
    k.door(0.85, F, 0, 1.6, 3.4, 'timber', 'door');
    k.door(0, F + H + 0.3, -0.05, 1.2, 1.5, 'timber', 'door');
    k.box('timber', 0.25, 0.25, 1.8, 0, F + H + R * 0.62, 0.7);
    k.cyl('iron', 0.12, 0.2, 0, F + H + R * 0.62 - 0.35, 1.45);
    k.pop();
  }
  // loading dock in front with steps
  k.block('deck', 6.5, F + 0.6, 3.2, 0, 0, L / 2 + 1.6);
  k.steps('deck', 3.9, L / 2 + 3.2, 1.2, F + 0.6, 3, 0.35, Math.PI / 2);
  const flags = [flagPole(k, W / 2 - 0.6, F + 2.4, L / 2 + 0.6, 2.6, 'timber')];
  // goods around the building
  for (let i = 0; i < 4; i++) crate(k, -W / 2 - 1.2, 0, -4 + i * 1.0, 0.9, i * 0.2);
  for (let i = 0; i < 3; i++) crate(k, -W / 2 - 1.2, 0.9, -3.5 + i * 1.0, 0.8, -i * 0.3);
  crate(k, -2.2, F + 0.6, L / 2 + 1.5, 0.8, 0.1);
  crate(k, -2.0, F + 1.4, L / 2 + 1.5, 0.6, 0.5);
  for (let i = 0; i < 5; i++) barrel(k, W / 2 + 1.1, 0, 2 + (i % 3) * 0.75 + (i > 2 ? 0.37 : 0) - 0.4, 1);
  for (let i = 0; i < 2; i++) barrel(k, W / 2 + 1.1, 0.84, 2.0 + i * 0.75, 1);
  for (let i = 0; i < 4; i++) sack(k, 1.8 + i * 0.5, F + 0.6, L / 2 + 2.2, i);
  sack(k, -W / 2 - 1.0, 0, L / 2 - 1, 0.4);
  sack(k, -W / 2 - 1.4, 0, L / 2 - 1.5, 1.2);
  coil(k, W / 2 + 1, 0, -3);
  return { group: k.build(), half: [W / 2 + 2, L / 2 + 3.6], flags };
}

// ---- church -----------------------------------------------------------------------------------

export function church(p: Palette): Blueprint {
  const k = new Kit();
  const W = 9, L = 19, H = 6.4, R = 4.3, P = 0.5;
  const stone = p.stone, light = p.stone.includes('|') ? p.stone : `${p.stone}|f4ede0`;
  k.block(stone, W + 0.4, P, L + 0.4, 0, 0, 0);
  k.block(stone, W, H, L, 0, P, 0);
  k.gable(p.roofMain, L, W, R, 0, P + H, 0, { ry: Math.PI / 2, eave: 0.4, over: 0.3 });
  for (const s of [-1, 1]) {
    k.push(0, 0, s * (L / 2 - 0.1), Math.PI / 2 - (s < 0 ? Math.PI : 0));
    k.gableEnd(stone, W, R, 0, P + H, 0, 0.3);
    k.pop();
  }
  // parapet copings along the gables
  for (const s of [-1, 1]) {
    const a = Math.atan2(R, W / 2);
    for (const sx of [-1, 1]) k.box(light, Math.hypot(R, W / 2) + 0.3, 0.3, 0.5, sx * W / 4, P + H + R / 2 + 0.1, s * (L / 2 + 0.05), 0, 0, -sx * a);
  }
  // corner quoins and buttress-like pilasters
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let y = 0; y < H; y += 0.6) {
    const big = Math.round(y / 0.6) % 2 === 0;
    k.box(light, big ? 0.9 : 0.6, 0.55, 0.12, sx * (W / 2 - (big ? 0.45 : 0.3)), P + y + 0.3, sz * (L / 2 + 0.03));
    k.box(light, 0.12, 0.55, big ? 0.6 : 0.9, sx * (W / 2 + 0.03), P + y + 0.3, sz * (L / 2 - (big ? 0.3 : 0.45)));
  }
  // arched windows along both sides
  for (const s of [-1, 1]) {
    k.push(s * W / 2, 0, 0, s * Math.PI / 2);
    for (let i = 0; i < 5; i++) k.window(-L / 2 + 2.6 + i * 3.45, P + 2.0, 0, 1.1, 2.4, { frame: light, glass: 'leaded', arch: true, sill: light });
    k.pop();
  }
  // west front: arched door, two windows and a round window high up
  k.door(0, P, L / 2, 1.8, 2.6, light, 'door', true);
  for (const x of [-2.8, 2.8]) k.window(x, P + 2.2, L / 2, 0.8, 1.8, { frame: light, glass: 'leaded', arch: true, sill: light });
  k.window(0, P + H + 0.8, L / 2 + 0.15, 0.6, 0.9, { frame: light, glass: 'leaded', arch: true, sill: light });
  k.push(0, 0, 0, Math.PI);
  k.window(0, P + 2.2, L / 2, 1.4, 2.8, { frame: light, glass: 'leaded', arch: true, sill: light });
  k.pop();
  k.steps(light, 0, L / 2 + 0.2 + 3 * 0.4, 4.2, P, 3, 0.4);
  // bell-cote on the west gable
  const bz = L / 2 - 1.4, by = P + H + R - 1.6;
  k.block(stone, 2.6, 2.6, 2.6, 0, by, bz);
  k.block(light, 2.9, 0.25, 2.9, 0, by + 2.6, bz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.block(light, 0.35, 1.9, 0.35, sx * 1.1, by + 2.85, bz + sz * 1.1);
  k.lathe('gold', [[0, 0.9], [0.18, 0.85], [0.3, 0.5], [0.45, 0.05], [0.47, 0], [0, 0]], 0, by + 3.05, bz, 12);
  k.block(light, 2.9, 0.25, 2.9, 0, by + 4.75, bz);
  k.hip(p.roofMain, 2.7, 2.7, 1.7, 0, by + 5.0, bz, 0.25);
  k.block('iron', 0.12, 1.3, 0.12, 0, by + 6.6, bz);
  k.block('iron', 0.7, 0.12, 0.12, 0, by + 7.4, bz);
  const flags = [flagPole(k, -W / 2 - 1.5, 0, L / 2 + 1.0, 8.5)];
  // churchyard
  const rnd = (i: number) => Math.sin(i * 12.9898) * 0.5 + 0.5;
  for (let i = 0; i < 9; i++) grave(k, W / 2 + 2.0 + (i % 3) * 1.6, -L / 2 + 3 + Math.floor(i / 3) * 2.4 + rnd(i) * 0.4, (rnd(i + 3) - 0.5) * 0.3);
  k.block('rubble', 0.5, 0.8, L - 4, W / 2 + 6.2, 0, -1);
  return { group: k.build(), half: [W / 2 + 6.5, L / 2 + 2.6], flags };
}

// ---- governor's house and town hall -----------------------------------------------------------

export function mansion(p: Palette, grand: boolean): Blueprint {
  const k = new Kit();
  const W = grand ? 20 : 15, D = grand ? 12 : 10, P = 0.7, H1 = 4.2, H2 = 4.0, R = grand ? 4.4 : 3.6;
  const stone = p.stone, up = p.stucco === 'stucco' ? 'plaster' : p.stucco, roof = grand ? p.roofGrand : p.roofMain;
  const top = P + H1 + H2;
  k.block(stone, W + 0.4, P, D + 0.4, 0, 0, 0);
  k.block(stone, W, H1, D, 0, P, 0);
  k.block(up, W, H2, D, 0, P + H1, 0);
  k.block(light(stone), W + 0.25, 0.3, D + 0.25, 0, P + H1 - 0.1, 0);
  k.block('white', W + 0.5, 0.4, D + 0.5, 0, top - 0.2, 0);
  // central bay steps forward with a pediment
  const bay = grand ? 6.4 : 5;
  k.block(up, bay, H2, 0.6, 0, P + H1, D / 2 + 0.3);
  k.push(0, 0, D / 2 + 0.55, Math.PI / 2).gableEnd('white', bay + 0.6, 1.8, 0, top + 0.2, 0, 0.3).pop();
  k.gable(roof, 3, bay + 0.6, 1.8, 0, top + 0.2, D / 2 - 0.6, { ry: Math.PI / 2, eave: 0.3, over: 0.2 });
  k.hip(roof, W, D, R, 0, top + 0.2, 0, 0.7);
  // cupola
  k.cyl('white', 1.4, 0.4, 0, top + R - 0.3, 0, 8);
  k.cyl(up, 1.15, 1.7, 0, top + R + 0.1, 0, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.box('dark', 0.45, 0.95, 0.1, Math.sin(a) * 1.12, top + R + 0.95, Math.cos(a) * 1.12, a);
  }
  k.cyl(roof, 1.35, 1.3, 0, top + R + 1.8, 0, 8, 0.08);
  k.sphere('gold', 0.16, 0, top + R + 3.2, 0, 1, 0);
  // windows: a regular grid with white frames, both floors
  const cols = grand ? 9 : 7;
  const sp = (W - 1.6) / (cols - 1);
  for (let c = 0; c < cols; c++) {
    const x = -W / 2 + 0.8 + c * sp;
    const inBay = Math.abs(x) < bay / 2;
    if (!(inBay && Math.abs(x) < 0.5)) k.window(x, P + 1.1, D / 2, 1.0, 1.9, { frame: light(stone), glass: 'glass', sill: light(stone) });
    k.window(x, P + H1 + 1.0, D / 2 + (inBay ? 0.6 : 0), 1.0, 1.9, { frame: 'white', glass: 'glass', sill: 'white' });
    k.push(0, 0, 0, Math.PI);
    k.window(x, P + 1.1, D / 2, 1.0, 1.9, { frame: light(stone), glass: 'glass', sill: light(stone) });
    k.window(x, P + H1 + 1.0, D / 2, 1.0, 1.9, { frame: 'white', glass: 'glass', sill: 'white' });
    k.pop();
  }
  for (const s of [-1, 1]) {
    k.push(s * W / 2, 0, 0, s * Math.PI / 2);
    for (let c = 0; c < (grand ? 5 : 4); c++) {
      const z = -D / 2 + 1.5 + c * ((D - 3) / ((grand ? 5 : 4) - 1));
      k.window(z, P + 1.1, 0, 1.0, 1.9, { frame: light(stone), glass: 'glass', sill: light(stone) });
      k.window(z, P + H1 + 1.0, 0, 1.0, 1.9, { frame: 'white', glass: 'glass', sill: 'white' });
    }
    k.pop();
  }
  // portico: columns carrying the balcony, iron railing, door, double stair
  const pz = D / 2 + 2.6;
  k.door(0, P, D / 2, 1.6, 2.8, 'white', 'door');
  k.door(0, P + H1 + 0.2, D / 2 + 0.6, 1.4, 2.6, 'white', 'glass');
  k.block(light(stone), bay + 0.4, 0.3, 3.0, 0, P + H1 - 0.1, D / 2 + 1.3);
  for (const x of [-bay / 2 + 0.2, -bay / 6, bay / 6, bay / 2 - 0.2]) {
    k.cyl('white', 0.28, H1 - 0.1, x, P, pz - 0.2, 12, 0.24);
    k.block('white', 0.65, 0.2, 0.65, x, P, pz - 0.2);
    k.block('white', 0.6, 0.18, 0.6, x, P + H1 - 0.28, pz - 0.2);
  }
  k.railing('iron', -bay / 2, bay / 2, P + H1 + 0.2, pz - 0.2, 1.0);
  for (const s of [-1, 1]) k.railing('iron', -(pz - 0.2), -(D / 2 + 0.6), P + H1 + 0.2, s * bay / 2, 1.0, Math.PI / 2);
  k.block(light(stone), bay + 0.4, P, 3.0, 0, 0, D / 2 + 1.3);
  k.steps(light(stone), 0, pz + 1.6, 3.4, P, 4, 0.4);
  for (const s of [-1, 1]) k.railing('iron', -(pz + 1.6), -(pz - 0.1), 0.2, s * 1.8, 0.8, Math.PI / 2);
  const flags: THREE.Vector3[] = [];
  if (grand) {
    flags.push(flagPole(k, -3.2, top + R * 0.55, -0.6, 6.5));
    // walled front gardens with hedges and cannons
    for (const s of [-1, 1]) {
      const cx = s * (bay / 2 + 4.2);
      k.block('hedge', 6.5, 0.9, 0.7, cx, 0, D / 2 + 5.4);
      k.block('hedge', 0.7, 0.9, 4.6, cx + s * 3.0, 0, D / 2 + 3.2);
      k.block('hedge', 0.7, 0.9, 4.6, cx - s * 3.0, 0, D / 2 + 3.2);
      k.block('#b8a888', 5.6, 0.04, 4.2, cx, 0, D / 2 + 3.1);
      cannon(k, cx - 1.2, D / 2 + 3.2, 0.1 * s);
      cannon(k, cx + 1.2, D / 2 + 3.2, -0.1 * s);
    }
    // gravel drive
    k.block('#cdbf9f', 4.5, 0.04, 6, 0, 0, pz + 4.6);
  } else {
    // a clock on the cupola instead of a flag, plus a notice board
    k.cyl('white', 0.5, 0.06, 0, top + R + 0.9, 1.2, 16);
    flags.push(flagPole(k, W / 2 - 1, top - 0.1, D / 2 - 0.5, 5));
    k.block('timber', 0.12, 1.8, 0.12, bay / 2 + 1.5, 0, pz + 1.0);
    k.block('wood', 1.4, 0.9, 0.08, bay / 2 + 1.5, 1.0, pz + 1.0);
  }
  return { group: k.build(), half: [W / 2 + (grand ? 1.5 : 1), D / 2 + (grand ? 6.5 : 4.6)], flags };
}

function light(stone: string): string {
  return stone.includes('|') ? stone : `${stone}|f6efe2`;
}

// ---- shipyard ---------------------------------------------------------------------------------

/**
 * Shipyard on a stone quay, origin at sea level on the shoreline: the quay runs from z = -18
 * (inland) to z = +8 (the water), the slipway descends into the sea on the right.
 */
export function shipyard(p: Palette): Blueprint {
  const k = new Kit();
  const Q = 2.6; // quay height above the water
  // quay platform and its wall
  k.block('quay', 30, Q + 4, 26, -6, -4, -5);
  k.block(light('limestone'), 30.2, 0.25, 0.6, -6, Q - 0.05, 8);
  k.block('deck', 26, 0.08, 18, -6, Q, -8);
  // slipway: timber ramp with ways and keel blocks, descending into the water
  const sx = 16, len = 52, drop = Q + 3.5;
  const a = Math.atan2(drop, len);
  const zc = -14 + len / 2;
  k.block('quay', 16, Q + 4, 10, sx, -4, -18);
  k.box('deck', 13, 0.5, len, sx, Q - drop / 2 - 0.2, zc, 0, a);
  for (const s of [-1, 1]) k.box('timber', 0.5, 0.45, len, sx + s * 2.4, Q - drop / 2 + 0.2, zc, 0, a);
  for (let i = 0; i < 9; i++) {
    const z = -12 + i * 3;
    const y = Q - ((z + 14) / len) * drop;
    k.block('timber', 1.4, 0.7, 0.6, sx, y - 0.1, z);
  }
  // cradle shores either side of the hull
  for (let i = 0; i < 5; i++) {
    const z = -8 + i * 5;
    const y = Q - ((z + 14) / len) * drop;
    for (const s of [-1, 1]) k.box('timber', 0.25, 5.5, 0.25, sx + s * 5.5, y + 2.4, z, 0, 0, s * 0.45);
  }
  // scaffold along one side
  for (let i = 0; i < 4; i++) k.block('timber', 0.2, 7, 0.2, sx - 7.2, Q - ((-10 + i * 7 + 14) / len) * drop, -10 + i * 7);
  k.box('deck', 1.2, 0.15, 22, sx - 7.0, Q + 3.0, 0.5);
  // workshop: half-timbered, open on the slipway side, with a forge inside
  const W = 13, D = 9, H = 4.6, R = 4.0, wx = -10, wz = -11;
  k.push(wx, Q, wz);
  k.block(p.stucco, W, H, 0.4, 0, 0, -D / 2 + 0.2);
  k.block(p.stucco, 0.4, H, D, -W / 2 + 0.2, 0, 0);
  k.block(p.stucco, W * 0.45, H, 0.4, -W * 0.275, 0, D / 2 - 0.2);
  for (const z of [-D / 2 + 0.2, 0, D / 2 - 0.2]) k.block('timber', 0.35, H, 0.35, W / 2 - 0.2, 0, z);
  for (const x of [0.5, W / 4]) k.block('timber', 0.3, H, 0.3, x, 0, D / 2 - 0.2);
  k.box('timber', W, 0.35, 0.35, 0, H - 0.2, D / 2 - 0.2);
  k.box('timber', 0.35, 0.35, D, W / 2 - 0.2, H - 0.2, 0);
  for (const s of [-1, 1]) k.gableEnd(p.stucco, D, R, s * (W / 2 - 0.15), H);
  k.gable(p.roofMain, W, D, R, 0, H, 0, { eave: 0.6, over: 0.5 });
  dormer(k, -3, H + 0.9, 1.9, 1.8, 1.5, 1.8, p.stucco, p.roofMain);
  k.push(0, 0, D / 2, 0);
  timbering(k, -W / 2, -0.1, 0, H, 0, 3, [1]);
  k.window(-W / 2 + 3.0, 1.2, 0, 0.9, 1.1, { frame: 'timber', glass: 'glassDark', sill: 'timber' });
  k.pop();
  k.push(-W / 2, 0, 0, -Math.PI / 2);
  timbering(k, -D / 2, D / 2, 0, H, 0, 4, [1, 2]);
  k.door(0, 0, 0, 2.2, 2.8);
  k.pop();
  k.block('brick', 1.8, 1.0, 1.4, -3, 0, -D / 2 + 1.1);
  k.block('forge', 1.2, 0.12, 0.9, -3, 1.0, -D / 2 + 1.1);
  chimney(k, -3, -D / 2 + 0.7, 1.0, H + R + 1.2, 0.9, 0.7);
  k.block('iron', 0.8, 0.5, 0.4, 0, 0, -1.5);
  k.block('iron', 0.3, 0.4, 0.3, 0, 0.5, -1.5);
  const flags = [flagPole(k, W / 2 - 1.5, H + R * 0.6, -0.5, 3.5, 'timber')];
  k.pop();
  // timber yard
  k.push(0, Q, 0);
  logPile(k, -16, 0, 7, 3, 0.1, 0.32);
  logPile(k, -16, 4.5, 6, 2, -0.05, 0.3);
  plankStack(k, -7, -1, Math.PI / 2 + 0.05, 5);
  plankStack(k, -2.5, -2, Math.PI / 2 - 0.1, 3);
  shotPile(k, -0.5, 2.5);
  k.pop();
  for (let i = 0; i < 6; i++) barrel(k, -19 + (i % 3) * 0.75, Q, -6 + Math.floor(i / 3) * 0.75);
  for (let i = 0; i < 3; i++) barrel(k, 2 + i * 0.75, Q, 4);
  coil(k, 4, Q, 1);
  coil(k, -12, Q, 5);
  crate(k, 1.5, Q, -6, 1.0, 0.3);
  crate(k, 1.6, Q + 1, -5.9, 0.7, 0.5);
  // shear-legs crane at the quay edge
  for (const s of [-1, 1]) k.box('timber', 0.35, 13, 0.35, 5 + s * 1.6, Q + 6.2, 5.5, 0, -0.18, s * 0.12);
  k.box('timber', 0.3, 0.3, 4, 5, Q + 12.4, 6.6);
  k.box('rope', 0.05, 8, 0.05, 5, Q + 8.4, 8.2);
  // rowboats moored alongside
  for (const [bx, bz, ry] of [[-14, 10.5, 0.1], [-6, 11, -0.08], [26, 4, Math.PI / 2 + 0.2]] as const) rowboat(k, bx, bz, ry);
  return { group: k.build(), half: [26, 18], flags, slip: new THREE.Vector3(sx, Q - 0.6, 4) };
}

// ---- market -----------------------------------------------------------------------------------

export function market(p: Palette, rnd: () => number): Blueprint {
  const k = new Kit();
  const W = 42, D = 32;
  k.block('cobble', W, 1.6, D, 0, -1.3, 0);
  k.block(light(p.stone), W + 0.4, 0.15, D + 0.4, 0, -0.1, 0);
  const cloths = ['canvasRed', 'canvasBlue', 'canvasGreen', 'canvasOchre'];
  const produce = ['#c0392b', '#e67e22', '#f1c40f', '#7a9a3a', '#8e5a2a', '#d4b483'];
  for (let i = 0; i < 10; i++) {
    const x = -16 + (i % 5) * 8, z = i < 5 ? -8.5 : 8.5;
    k.push(x, 0.3, z, i < 5 ? 0 : Math.PI);
    k.block('wood', 3.6, 0.9, 1.4, 0, 0, 0.4);
    for (const [px, pz] of [[-1.9, -0.6], [1.9, -0.6], [-1.9, 1.5], [1.9, 1.5]]) k.block('timber', 0.12, pz < 0 ? 2.8 : 2.3, 0.12, px, 0, pz);
    k.box(cloths[i % 4], 4.2, 0.05, 2.6, 0, 2.6, 0.45, 0, 0.2);
    for (let j = 0; j < 6; j++) k.sphere(produce[Math.floor(rnd() * produce.length)], 0.18, -1.4 + j * 0.55, 1.05, 0.4 + (rnd() - 0.5) * 0.4, 0.8, 0);
    crate(k, 1.2, 0, -1.3, 0.6, rnd());
    sack(k, -1.0, 0, -1.4, rnd() * 3);
    k.pop();
  }
  // well with a little roof
  k.cyl('rubble', 1.4, 0.9, 0, 0.3, 0, 14);
  k.cyl('water', 1.1, 0.05, 0, 1.1, 0, 14);
  for (const s of [-1, 1]) k.block('timber', 0.18, 2.4, 0.18, s * 1.2, 1.2, 0);
  k.gable(p.roofMain, 0.6, 3.0, 0.9, 0, 3.4, 0, { ry: Math.PI / 2, eave: 0.1, over: 0.1, thick: 0.08 });
  k.log('timber', 0.08, 2.4, 0, 2.9, 0);
  for (let i = 0; i < 6; i++) barrel(k, 17 + (i % 2) * 0.75, 0.3, -2 + Math.floor(i / 2) * 0.75);
  for (let i = 0; i < 4; i++) crate(k, -18, 0.3, -2 + i * 1.0, 0.9, rnd());
  return { group: k.build(), half: [W / 2, D / 2], flags: [] };
}

// ---- harbour ----------------------------------------------------------------------------------

/** Wooden pier, origin at sea level on the shore, running out along +z. */
export function pier(len: number): Blueprint {
  const k = new Kit();
  const Y = 2.2, w = 9;
  k.block('deck', w, 0.35, len, 0, Y - 0.35, len / 2 - 4);
  k.block('deck', 28, 0.35, 9, 0, Y - 0.35, len - 4);
  for (let z = -4; z <= len - 4; z += 4.5) for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) k.cyl('timber', 0.28, Y + 4, x, -4, z, 8);
  for (let x = -13.5; x <= 13.5; x += 4.5) for (const z of [len - 8.2, len + 0.2]) k.cyl('timber', 0.28, Y + 4, x, -4, z, 8);
  for (let z = 4; z < len - 8; z += 9) for (const s of [-1, 1]) {
    k.cyl('black', 0.22, 0.6, s * (w / 2 - 0.4), Y, z, 10, 0.18);
    k.cyl('black', 0.3, 0.1, s * (w / 2 - 0.4), Y + 0.55, z, 10);
  }
  for (const s of [-1, 1]) k.box('timber', 0.25, 0.3, len, s * (w / 2 + 0.05), Y - 0.5, len / 2 - 4);
  for (let i = 0; i < 4; i++) barrel(k, -2.8 + (i % 2) * 0.75, Y, len - 6 + Math.floor(i / 2) * 0.75);
  crate(k, 3, Y, len - 6, 1.0, 0.2);
  crate(k, 3.1, Y + 1, len - 5.9, 0.7, 0.6);
  coil(k, -10, Y, len - 4);
  coil(k, 10, Y, len - 4.5);
  for (const x of [-12, 12]) {
    k.block('timber', 0.2, 3.2, 0.2, x, Y, len - 0.5);
    k.block('iron', 0.45, 0.6, 0.45, x, Y + 3.2, len - 0.5);
  }
  return { group: k.build(), half: [14, len / 2], flags: [] };
}

/** The bare frame of a hull on the stocks (keel, stem, sternpost and ribs), bow towards +z. */
export function hullFrame(len: number): THREE.Group {
  const k = new Kit();
  const beam = len * 0.26;
  k.box('timber', 0.5, 0.6, len, 0, 0.3, 0);
  k.add('timber', new THREE.TorusGeometry(len * 0.12, 0.25, 5, 12, Math.PI / 2).rotateZ(-Math.PI / 2), 0, len * 0.12 + 0.3, len / 2 - len * 0.12, 0, -Math.PI / 2, 0);
  k.box('timber', 0.4, len * 0.2, 0.5, 0, len * 0.1 + 0.3, -len / 2, 0, -0.15);
  const n = Math.round(len / 1.6);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const w = beam * Math.sqrt(Math.sin(Math.PI * Math.min(1, t * 1.05))) * 0.5;
    if (w < 0.4) continue;
    const z = -len / 2 + t * len;
    const rib = new THREE.TorusGeometry(1, 0.08, 4, 14, Math.PI);
    rib.rotateZ(Math.PI);
    rib.scale(w, w * 0.95, 1 / 0.08 * 0.18);
    k.add('timber', rib, 0, w * 0.95 + 0.4, z, 0, 0, 0);
  }
  // a few strakes of planking already on near the keel
  for (const s of [-1, 1]) for (let j = 0; j < 3; j++) k.box('wood', 0.12, 0.35, len * (0.7 - j * 0.12), s * (beam * 0.18 + j * beam * 0.08), 0.75 + j * 0.45, 0, 0, 0, s * (0.9 - j * 0.25));
  return k.build();
}

/** Prototype geometry for instanced cottages. */
export function cottagePrototype(p: Palette, v: number, seed: number): { geos: Map<string, THREE.BufferGeometry>; half: [number, number] } {
  const k = new Kit();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const half = cottage(k, p, v, rnd);
  return { geos: k.geometries(), half };
}
