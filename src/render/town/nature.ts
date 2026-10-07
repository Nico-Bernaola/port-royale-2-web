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

let frondMat: THREE.MeshStandardMaterial | null = null;
let tuftMat: THREE.MeshStandardMaterial | null = null;

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
  const n = 9 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const young = i % 4 === 0;
    fronds.push(frond(top, yaw, young ? 0.9 : 0.35 + rnd() * 0.25, 4.2 + rnd() * 1.2, 1.5, young ? 0.03 : 0.07 + rnd() * 0.04));
  }
  frondMat ??= new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
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
      { geo: mergeGeometries(fronds)!, mat: frondMat, shadow: true },
      { geo: mergeGeometries(nuts)!, mat: material('#5a4a2a'), shadow: false },
    ],
    mats: [],
  };
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

function treeProto(seed: number): Proto {
  const rnd = mulberry(seed);
  const h = 4 + rnd() * 2;
  const pts = [0, 0.3, 0.6, 1].map((t) => new THREE.Vector3((rnd() - 0.5) * 0.4 * t, h * t, (rnd() - 0.5) * 0.4 * t));
  const trunk = taperedTube(pts, [0.35, 0.28, 0.22, 0.16]);
  const crowns: THREE.BufferGeometry[] = [];
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = 2.2 + rnd() * 1.6;
    const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : 1.6 + rnd() * 1.2;
    const g = blob(r, seed + i * 13, 1);
    g.scale(1, 0.8, 1);
    g.translate(Math.cos(a) * d, h + (i === 0 ? 1 : rnd() * 1.8 - 0.4), Math.sin(a) * d);
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
  tuftMat ??= new THREE.MeshStandardMaterial({ map: tuftTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xc8d8a0 });
  return { parts: [{ geo: mergeGeometries([a, b, c])!, mat: tuftMat, shadow: false }], mats: [] };
}

export class Vegetation {
  private palms = [palmProto(1), palmProto(2), palmProto(3)];
  private trees = [treeProto(11), treeProto(12)];
  private bushes = [bushProto(21), bushProto(22), bushProto(23)];
  private tufts = tuftProto();
  private rnd = mulberry(99);

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
    for (const p of [...this.palms, ...this.trees, ...this.bushes, this.tufts]) {
      if (!p.mats.length) continue;
      for (const part of p.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, p.mats.length);
        p.mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = part.shadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        g.add(im);
      }
    }
    return g;
  }
}
