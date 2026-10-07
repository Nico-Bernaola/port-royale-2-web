/**
 * Geometry kit for buildings: primitives with texture coordinates in metres, collected per
 * material and merged, so a whole building is a handful of draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { material } from './textures.ts';

const V = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), SC = new THREE.Vector3();

/** Planar texture coordinates from each vertex's dominant normal axis (part-local space). */
function planarUV(g: THREE.BufferGeometry): void {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i) * -Math.sign(n.getX(i)); v = p.getY(i); }
    else { u = p.getX(i) * Math.sign(n.getZ(i)); v = p.getY(i); }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Triangles with explicit per-face uv frames (u along `ua`, v along `va`). */
function facesGeometry(tris: { p: THREE.Vector3[]; ua: THREE.Vector3; va: THREE.Vector3 }[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  for (const t of tris) for (const p of t.p) { pos.push(p.x, p.y, p.z); uv.push(p.dot(t.ua), p.dot(t.va)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export class Kit {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  private get m(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  /** Enter a local frame (translated, then rotated about y). */
  push(x = 0, y = 0, z = 0, ry = 0, s = 1): this {
    const l = new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(0, ry, 0)), SC.set(s, s, s));
    this.stack.push(this.m.clone().multiply(l));
    return this;
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /** Add a geometry at a local transform. uv: 'planar' recomputes metric coordinates. */
  add(key: string, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, uv: 'planar' | 'keep' = 'planar'): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (uv === 'planar') planarUV(g);
    const l = new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, 'YXZ')), SC.set(1, 1, 1));
    g.applyMatrix4(this.m.clone().multiply(l));
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
    return this;
  }

  /** Box centred at (x, y, z). */
  box(key: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): this {
    return this.add(key, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  }

  /** Box standing on y (bottom at y). */
  block(key: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): this {
    return this.box(key, w, h, d, x, y + h / 2, z, ry);
  }

  /** Vertical cylinder standing on y. */
  cyl(key: string, r: number, h: number, x: number, y: number, z: number, seg = 8, rTop = r): this {
    return this.add(key, new THREE.CylinderGeometry(rTop, r, h, seg), x, y + h / 2, z);
  }

  /** Cylinder lying along local x (axis) or z, centred. */
  log(key: string, r: number, len: number, x: number, y: number, z: number, ry = 0, seg = 7): this {
    return this.add(key, new THREE.CylinderGeometry(r, r, len, seg), x, y, z, 0, ry, Math.PI / 2);
  }

  sphere(key: string, r: number, x: number, y: number, z: number, sy = 1, detail = 1): this {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(1, sy, 1);
    return this.add(key, g, x, y, z);
  }

  lathe(key: string, profile: [number, number][], x: number, y: number, z: number, seg = 12): this {
    return this.add(key, new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), x, y, z);
  }

  /**
   * Gable roof: ridge along local x at y + rise, eaves at z = ±depth/2 (plus overhang).
   * Built as two slabs with a ridge board.
   */
  gable(key: string, len: number, depth: number, rise: number, x: number, y: number, z: number, opts: { eave?: number; over?: number; thick?: number; ry?: number; ridge?: string } = {}): this {
    const eave = opts.eave ?? 0.45, over = opts.over ?? 0.35, th = opts.thick ?? 0.16;
    const half = depth / 2;
    const a = Math.atan2(rise, half);
    const sl = Math.hypot(rise, half) + eave;
    this.push(x, y, z, opts.ry ?? 0);
    for (const s of [1, -1]) {
      const cz = s * (Math.cos(a) * (sl / 2) + (Math.sin(a) * th) / 2);
      const cy = rise - Math.sin(a) * (sl / 2) + (Math.cos(a) * th) / 2;
      this.add(key, new THREE.BoxGeometry(len + over * 2, th, sl), 0, cy, cz, s * a, 0, 0);
    }
    this.add(opts.ridge ?? key, new THREE.BoxGeometry(len + over * 2 + 0.05, 0.22, 0.32), 0, rise + th + 0.02, 0, Math.PI / 4, 0, 0);
    this.pop();
    return this;
  }

  /** Triangular gable-end wall in the plane x = const (facing ±x), base at y. */
  gableEnd(key: string, depth: number, rise: number, x: number, y: number, z = 0, thick = 0.25): this {
    const sh = new THREE.Shape();
    sh.moveTo(-depth / 2, 0);
    sh.lineTo(depth / 2, 0);
    sh.lineTo(0, rise);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
    g.translate(0, 0, -thick / 2);
    return this.add(key, g, x, y, z, 0, Math.PI / 2, 0);
  }

  /** Hip roof over a w (x) by d (z) rectangle with eaves at y; ridge along the longer side. */
  hip(key: string, w: number, d: number, rise: number, x: number, y: number, z: number, eave = 0.5, ry = 0): this {
    const swap = d > w;
    const W = (swap ? d : w) / 2 + eave, D = (swap ? w : d) / 2 + eave;
    const drop = (eave * rise) / ((swap ? w : d) / 2);
    const r = Math.max(0, W - D);
    const P = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz);
    const y0 = -drop, y1 = rise;
    const a = P(-W, y0, D), b = P(W, y0, D), c = P(W, y0, -D), dd = P(-W, y0, -D);
    const r1 = P(-r, y1, 0), r2 = P(r, y1, 0);
    const X = P(1, 0, 0), Z = P(0, 0, 1);
    const up = (ua: THREE.Vector3, n: THREE.Vector3) => new THREE.Vector3().crossVectors(n, ua).normalize();
    const tris: { p: THREE.Vector3[]; ua: THREE.Vector3; va: THREE.Vector3 }[] = [];
    const slopeF = P(0, D, rise + drop).normalize(), slopeB = P(0, D, -(rise + drop)).normalize();
    const slopeR = P(rise + drop, D, 0).normalize(), slopeL = P(-(rise + drop), D, 0).normalize();
    tris.push({ p: [a, b, r2], ua: X, va: up(X, slopeF) }, { p: [a, r2, r1], ua: X, va: up(X, slopeF) });
    tris.push({ p: [c, dd, r1], ua: X.clone().negate(), va: up(X.clone().negate(), slopeB) }, { p: [c, r1, r2], ua: X.clone().negate(), va: up(X.clone().negate(), slopeB) });
    tris.push({ p: [b, c, r2], ua: Z.clone().negate(), va: up(Z.clone().negate(), slopeR) });
    tris.push({ p: [dd, a, r1], ua: Z, va: up(Z, slopeL) });
    const g = facesGeometry(tris);
    // underside so the eaves are not see-through from below
    const under = new THREE.PlaneGeometry(W * 2, D * 2);
    under.rotateX(Math.PI / 2);
    under.translate(0, y0 + 0.02, 0);
    this.push(x, y, z, ry + (swap ? Math.PI / 2 : 0));
    this.add(key, g, 0, 0, 0, 0, 0, 0, 'keep');
    this.add('timber', under);
    this.pop();
    return this;
  }

  /**
   * Window on a wall facing +z at (x, y) (y = sill height), set into the wall surface at z.
   * frame/glass are material keys; shutters optional.
   */
  window(x: number, y: number, z: number, w: number, h: number, opts: { frame?: string; glass?: string; shutter?: string; arch?: boolean; sill?: string } = {}): this {
    const frame = opts.frame ?? 'white', glass = opts.glass ?? 'glass';
    this.box(frame, w + 0.22, h + 0.22, 0.12, x, y + h / 2, z + 0.02);
    if (opts.arch) {
      this.add(frame, new THREE.CylinderGeometry(w / 2 + 0.11, w / 2 + 0.11, 0.12, 14, 1, false, -Math.PI / 2, Math.PI), x, y + h, z + 0.02, -Math.PI / 2, 0, 0);
      this.add(glass, new THREE.CylinderGeometry(w / 2, w / 2, 0.06, 14, 1, false, -Math.PI / 2, Math.PI), x, y + h, z + 0.07, -Math.PI / 2, 0, 0);
    }
    this.box(glass, w, h, 0.06, x, y + h / 2, z + 0.07);
    this.box(opts.sill ?? frame, w + 0.4, 0.1, 0.22, x, y - 0.05, z + 0.08);
    if (opts.shutter) {
      for (const s of [-1, 1]) this.box(opts.shutter, w / 2 + 0.05, h + 0.05, 0.06, x + s * (w * 0.75 + 0.15), y + h / 2, z + 0.12, s * 0.12);
    }
    return this;
  }

  /** Plank door on a wall facing +z, bottom at y. */
  door(x: number, y: number, z: number, w: number, h: number, frame = 'timber', leaf = 'door', arch = false): this {
    this.box(frame, w + 0.3, h + 0.15, 0.14, x, y + h / 2 + 0.07, z + 0.02);
    if (arch) this.add(frame, new THREE.CylinderGeometry(w / 2 + 0.15, w / 2 + 0.15, 0.14, 14, 1, false, -Math.PI / 2, Math.PI), x, y + h, z + 0.02, -Math.PI / 2, 0, 0);
    this.box(leaf, w, h, 0.08, x, y + h / 2, z + 0.08);
    if (arch) this.add(leaf, new THREE.CylinderGeometry(w / 2, w / 2, 0.08, 14, 1, false, -Math.PI / 2, Math.PI), x, y + h, z + 0.08, -Math.PI / 2, 0, 0);
    this.box('iron', 0.06, 0.06, 0.06, x + w * 0.35, y + h * 0.5, z + 0.14);
    return this;
  }

  /** Steps rising towards -z from z (front edge) to the floor height. */
  steps(key: string, x: number, z: number, w: number, height: number, n: number, run = 0.3, ry = 0): this {
    this.push(x, 0, z, ry);
    for (let i = 0; i < n; i++) {
      const h = (height * (i + 1)) / n;
      this.block(key, w, h, run, 0, 0, -i * run - run / 2);
    }
    this.pop();
    return this;
  }

  /** Railing along local x from x0 to x1 at z, posts every ~1.2 m. */
  railing(key: string, x0: number, x1: number, y: number, z: number, h = 0.95, ry = 0): this {
    this.push(0, 0, 0, ry);
    const n = Math.max(1, Math.round(Math.abs(x1 - x0) / 1.2));
    for (let i = 0; i <= n; i++) this.block(key, 0.1, h, 0.1, x0 + ((x1 - x0) * i) / n, y, z);
    this.box(key, Math.abs(x1 - x0) + 0.1, 0.08, 0.12, (x0 + x1) / 2, y + h, z);
    this.box(key, Math.abs(x1 - x0), 0.05, 0.05, (x0 + x1) / 2, y + h * 0.45, z);
    this.pop();
    return this;
  }

  /** Merged geometry per material key. */
  geometries(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [k, list] of this.parts) {
      const g = mergeGeometries(list, false);
      if (g) out.set(k, g);
      for (const p of list) p.dispose();
    }
    this.parts.clear();
    return out;
  }

  /** Build a group of meshes, one per material. */
  build(shadows = true): THREE.Group {
    const grp = new THREE.Group();
    for (const [k, g] of this.geometries()) {
      const m = new THREE.Mesh(g, material(k));
      m.castShadow = shadows;
      m.receiveShadow = true;
      grp.add(m);
    }
    return grp;
  }
}
