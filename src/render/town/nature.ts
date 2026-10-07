/** Instanced vegetation for the towns: coconut palms, broadleaf trees, bushes and grass tufts. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { frondTexture, material, mulberry, tuftTexture } from './textures.ts';

/** Tube along points with per-point radius; uv in metres (u around, v along). */
function taperedTube(pts: THREE.Vector3[], radii: number[], radial = 7): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) along += pts[i].distanceTo(pts[i - 1]);
    const t = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    const n = new THREE.Vector3(1, 0, 0).cross(t).normalize();
    if (n.lengthSq() < 0.01) n.set(0, 0, 1);
    const b = t.clone().cross(n).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const d = n.clone().multiplyScalar(Math.cos(a)).add(b.clone().multiplyScalar(Math.sin(a)));
      const p = pts[i].clone().addScaledVector(d, radii[i]);
      pos.push(p.x, p.y, p.z);
      uv.push((j / radial) * radii[i] * Math.PI * 2, along);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** One palm frond: a drooping strip, folded into a shallow V along the rib. */
function frond(base: THREE.Vector3, yaw: number, elev: number, len: number, width: number, droop: number): THREE.BufferGeometry {
  const N = 9;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const side = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const d = len * s;
    const p = base.clone().addScaledVector(dir, d * Math.cos(elev)).add(new THREE.Vector3(0, d * Math.sin(elev) - droop * d * d, 0));
    const w = width * Math.sin(Math.PI * Math.min(1, s * 1.05 + 0.08)) * 0.5;
    for (let j = 0; j < 3; j++) {
      const o = (j - 1) * w;
      const q = p.clone().addScaledVector(side, o).add(new THREE.Vector3(0, -Math.abs(o) * 0.35, 0));
      pos.push(q.x, q.y, q.z);
      uv.push(j / 2, 1 - s);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) {
    const a = i * 3 + j, b = a + 3;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

interface Proto {
  parts: { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean }[];
  mats: THREE.Matrix4[];
}

let frondMatC: THREE.MeshStandardMaterial | null = null;
let tuftMatC: THREE.MeshStandardMaterial | null = null;

/** Double-sided foliage keeps its normal on the back face too, so cards are never lit from below. */
function noFlip(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );');
  };
  return m;
}
function frondMaterial(): THREE.MeshStandardMaterial {
  return (frondMatC ??= noFlip(new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 })));
}
function tuftMaterial(): THREE.MeshStandardMaterial {
  return (tuftMatC ??= noFlip(new THREE.MeshStandardMaterial({ map: tuftTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xd8e0b8 })));
}

function palmProto(seed: number): Proto {
  const rnd = mulberry(seed);
  const h = 8 + rnd() * 3;
  const lean = 1 + rnd() * 2;
  const pts: THREE.Vector3[] = [], radii: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector3(lean * t * t, h * t, 0));
    radii.push(0.24 - 0.09 * t + (i === 0 ? 0.08 : 0));
  }
  const top = pts[pts.length - 1];
  const fronds: THREE.BufferGeometry[] = [];
  const n = 12 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const young = i % 4 === 0;
    fronds.push(frond(top, yaw, young ? 0.9 : 0.35 + rnd() * 0.25, 4.2 + rnd() * 1.2, 1.5, young ? 0.03 : 0.07 + rnd() * 0.04));
  }
  const nuts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const g = new THREE.IcosahedronGeometry(0.16, 1);
    g.translate(top.x + Math.cos(a) * 0.25, top.y - 0.35, Math.sin(a) * 0.25);
    g.deleteAttribute('uv');
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    nuts.push(g);
  }
  return {
    parts: [
      { geo: taperedTube(pts, radii), mat: material('bark'), shadow: true },
      { geo: mergeGeometries(fronds)!, mat: frondMaterial(), shadow: true },
      { geo: mergeGeometries(nuts)!, mat: material('#5a4a2a'), shadow: false },
    ],
    mats: [],
  };
}

/** Royal palm: tall, straight, pale smooth trunk with a green crownshaft and an arching crown. */
function royalPalmProto(seed: number): Proto {
  const rnd = mulberry(seed);
  const h = 12 + rnd() * 3;
  const pts: THREE.Vector3[] = [], radii: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector3(0.15 * Math.sin(t * 2), h * t, 0));
    // swollen base and a gentle bulge mid-trunk
    radii.push(0.26 + 0.12 * Math.max(0, 1 - t * 6) + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.4)) - 0.06 * t);
  }
  const top = pts[pts.length - 1].clone();
  const shaft = new THREE.CylinderGeometry(0.2, 0.26, 2.2, 10);
  shaft.translate(top.x, top.y + 1.1, 0);
  const crown = top.clone().add(new THREE.Vector3(0, 2.1, 0));
  const fronds: THREE.BufferGeometry[] = [];
  const n = 13 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rnd() * 0.3;
    const up = i % 3 === 0;
    fronds.push(frond(crown, yaw, up ? 1.05 : 0.45 + rnd() * 0.35, 4.4 + rnd() * 1.0, 1.4, up ? 0.04 : 0.08 + rnd() * 0.04));
  }
  const sh = shaft.toNonIndexed();
  sh.deleteAttribute('uv');
  sh.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(sh.attributes.position.count * 2), 2));
  return {
    parts: [
      { geo: taperedTube(pts, radii, 9), mat: material('royalTrunk'), shadow: true },
      { geo: sh, mat: material('#5f7434'), shadow: true },
      { geo: mergeGeometries(fronds)!, mat: frondMaterial(), shadow: true },
    ],
    mats: [],
  };
}

/** Low fern: short fronds radiating from the ground. */
function fernProto(seed: number): Proto {
  const rnd = mulberry(seed);
  const fronds: THREE.BufferGeometry[] = [];
  const n = 7 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) fronds.push(frond(new THREE.Vector3(0, 0.05, 0), (i / n) * Math.PI * 2 + rnd() * 0.5, 0.75 + rnd() * 0.3, 1.0 + rnd() * 0.5, 0.55, 0.32));
  const g = mergeGeometries(fronds)!;
  upNormals(g);
  return { parts: [{ geo: g, mat: frondMaterial(), shadow: false }], mats: [] };
}

/** Low plants are lit like the ground they grow from (both faces of a card would otherwise differ). */
function upNormals(g: THREE.BufferGeometry): void {
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
}

/** A few weathered stones. */
function rockProto(seed: number): Proto {
  const rnd = mulberry(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const r = 0.18 + rnd() * 0.3;
    const g = blob(r, seed + i * 5, 0);
    g.scale(1 + rnd() * 0.4, 0.6, 1);
    g.translate((rnd() - 0.5) * 1.0, r * 0.25, (rnd() - 0.5) * 1.0);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  return { parts: [{ geo: mergeGeometries(parts)!, mat: material('rubble|c8c0b0'), shadow: true }], mats: [] };
}

/** A lush clump of tall grass: several crossed cards. */
function clumpProto(seed: number): Proto {
  const rnd = mulberry(seed);
  const cards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const w = 1.1 + rnd() * 0.6, h = 0.7 + rnd() * 0.5;
    const a = new THREE.PlaneGeometry(w, h);
    a.translate(0, h / 2, 0);
    a.deleteAttribute('normal');
    a.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    a.rotateY(rnd() * Math.PI);
    a.translate((rnd() - 0.5) * 1.2, 0, (rnd() - 0.5) * 1.2);
    cards.push(a);
  }
  return { parts: [{ geo: mergeGeometries(cards)!, mat: tuftMaterial(), shadow: false }], mats: [] };
}

function blob(r: number, seed: number, detail = 2): THREE.BufferGeometry {
  const rnd = mulberry(seed);
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const k = 1 + 0.18 * Math.sin(n.x * 5 + ph[0]) * Math.sin(n.y * 4 + ph[1]) + 0.1 * Math.sin(n.z * 7 + ph[2]);
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // spherical uv in metres
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = Math.atan2(p.getZ(i), p.getX(i)) * r;
    uv[i * 2 + 1] = p.getY(i);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Mango tree: short forked trunk under a dense, rounded dome of dark foliage. */
function treeProto(seed: number): Proto {
  const rnd = mulberry(seed);
  const h = 3 + rnd() * 1.5;
  const pts = [0, 0.3, 0.6, 1].map((t) => new THREE.Vector3((rnd() - 0.5) * 0.4 * t, h * t, (rnd() - 0.5) * 0.4 * t));
  const limbs = [taperedTube(pts, [0.4, 0.32, 0.26, 0.2])];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd();
    limbs.push(taperedTube([pts[3].clone(), pts[3].clone().add(new THREE.Vector3(Math.cos(a) * 1.6, 1.4, Math.sin(a) * 1.6))], [0.18, 0.1], 6));
  }
  const trunk = mergeGeometries(limbs)!;
  const crowns: THREE.BufferGeometry[] = [];
  const n = 8 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = i === 0 ? 3.2 : 1.7 + rnd() * 1.1;
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6, d = i === 0 ? 0 : 2.2 + rnd() * 0.8;
    const g = blob(r, seed + i * 13, 1);
    g.scale(1, 0.85, 1);
    g.translate(Math.cos(a) * d, h + 2.2 + (i === 0 ? 0.6 : rnd() * 1.6 - 0.6), Math.sin(a) * d);
    crowns.push(g.index ? g.toNonIndexed() : g);
  }
  return { parts: [{ geo: trunk, mat: material('bark|8a7a6a'), shadow: true }, { geo: mergeGeometries(crowns)!, mat: material('foliage'), shadow: true }], mats: [] };
}

function bushProto(seed: number): Proto {
  const rnd = mulberry(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.6 + rnd() * 0.6;
    const g = blob(r, seed + i * 7, 1);
    g.scale(1, 0.75, 1);
    g.translate((rnd() - 0.5) * 1.4, r * 0.55, (rnd() - 0.5) * 1.4);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  return { parts: [{ geo: mergeGeometries(parts)!, mat: material('hedge'), shadow: true }], mats: [] };
}

function tuftProto(): Proto {
  const a = new THREE.PlaneGeometry(0.9, 0.6);
  a.translate(0, 0.3, 0);
  a.deleteAttribute('normal');
  a.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const b = a.clone().rotateY(Math.PI / 2);
  const c = a.clone().rotateY(Math.PI / 4);
  return { parts: [{ geo: mergeGeometries([a, b, c])!, mat: tuftMaterial(), shadow: false }], mats: [] };
}

export class Vegetation {
  private palms = [palmProto(1), palmProto(2), palmProto(3)];
  private trees = [treeProto(11), treeProto(12)];
  private bushes = [bushProto(21), bushProto(22), bushProto(23)];
  private royals = [royalPalmProto(5), royalPalmProto(6)];
  private tufts = tuftProto();
  private clumps = [clumpProto(31), clumpProto(32), clumpProto(33)];
  private ferns = [fernProto(41), fernProto(42)];
  private rocks = [rockProto(51), rockProto(52), rockProto(53)];
  private rnd = mulberry(99);

  private pick<T>(a: T[]): T {
    return a[Math.floor(this.rnd() * a.length)];
  }
  royal(x: number, y: number, z: number): void {
    this.put(this.pick(this.royals), x, y - 0.2, z, 0.85 + this.rnd() * 0.3);
  }
  clump(x: number, y: number, z: number): void {
    this.put(this.pick(this.clumps), x, y - 0.05, z, 1.0 + this.rnd() * 0.8);
  }
  fern(x: number, y: number, z: number): void {
    this.put(this.pick(this.ferns), x, y, z, 0.9 + this.rnd() * 0.7);
  }
  rock(x: number, y: number, z: number): void {
    this.put(this.pick(this.rocks), x, y, z, 0.6 + this.rnd() * 0.9);
  }

  private put(p: Proto, x: number, y: number, z: number, s: number): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI * 2), new THREE.Vector3(s, s, s));
    p.mats.push(m);
  }

  palm(x: number, y: number, z: number): void {
    this.put(this.palms[Math.floor(this.rnd() * 3)], x, y - 0.2, z, 0.85 + this.rnd() * 0.35);
  }
  tree(x: number, y: number, z: number): void {
    this.put(this.trees[Math.floor(this.rnd() * 2)], x, y - 0.2, z, 0.8 + this.rnd() * 0.5);
  }
  bush(x: number, y: number, z: number): void {
    this.put(this.bushes[Math.floor(this.rnd() * 3)], x, y - 0.1, z, 0.7 + this.rnd() * 0.7);
  }
  tuft(x: number, y: number, z: number): void {
    this.put(this.tufts, x, y - 0.05, z, 0.6 + this.rnd() * 0.8);
  }

  /** Create the instanced meshes. */
  build(): THREE.Group {
    const g = new THREE.Group();
    for (const p of [...this.palms, ...this.royals, ...this.trees, ...this.bushes, this.tufts, ...this.clumps, ...this.ferns, ...this.rocks]) {
      if (!p.mats.length) continue;
      for (const part of p.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, p.mats.length);
        p.mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = part.shadow;
        // shadows on thin cards come out as black smudges, so low plants skip them
        im.receiveShadow = part.shadow;
        im.computeBoundingSphere();
        g.add(im);
      }
    }
    return g;
  }
}
