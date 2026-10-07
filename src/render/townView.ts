/**
 * Port view: a procedurally built 3D harbour town. The coastline faces the direction of the
 * real sea at the town (from the world's distance field); the pier and shipyard reach into
 * the water, warehouses line the waterfront, the market square, town hall, church and tavern
 * sit behind them, houses and fields fill the land. Units are metres.
 */
import * as THREE from 'three';
import type { TownDef } from '../core/data.ts';
import { NOISE, SUN_DIR } from './glsl.ts';
import { makeShip } from './ships3d.ts';
import type { TerrainSampler } from './terrain.ts';

export type BuildingKind = 'market' | 'shipyard' | 'tavern' | 'harbour' | 'townhall' | 'church' | 'governor' | 'warehouse' | 'decor';

export interface Building {
  kind: BuildingKind;
  label: string;
  group: THREE.Group;
}

const SIZE = 900; // metres per side of the town area

interface Style {
  walls: number[];
  roofs: number[];
  roofPitch: number;
}

const STYLES: Record<string, Style> = {
  Spain: { walls: [0xf2ead8, 0xead7b0, 0xf5f0e4, 0xe3c38f], roofs: [0xb4532f, 0xc0683a, 0xa24a2c], roofPitch: 0.35 },
  England: { walls: [0x9b5a43, 0xd9cdb4, 0x8d4d39, 0xe6dccb], roofs: [0x4a4a4f, 0x5a5048, 0x3e3f45], roofPitch: 0.6 },
  France: { walls: [0xf0e6cf, 0xe8dcc0, 0xf6efe0, 0xd8c7a3], roofs: [0x56606e, 0x4a5563, 0x8a5a3c], roofPitch: 0.55 },
  Holland: { walls: [0xa04a32, 0x8c3f2b, 0xb35d40, 0xe9e0cc], roofs: [0x3b3632, 0x52352a, 0x2f2f33], roofPitch: 0.8 },
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function M(color: number): THREE.MeshStandardMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });
    matCache.set(color, m);
  }
  return m;
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const PRISM = (() => {
  // triangular prism along X: ridge on top, base 1 wide (z) and 1 high
  const g = new THREE.BufferGeometry();
  const v = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // side -z
    -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, 0.5, 0, 0.5, // side +z
    -0.5, 0, -0.5, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0, // gables
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
})();
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CONE = new THREE.ConeGeometry(0.5, 1, 8);

function part(geo: THREE.BufferGeometry, color: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, M(color));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** House: walls plus a gable roof. Local origin at the ground centre, ridge along X. */
function house(w: number, d: number, h: number, wall: number, roof: number, pitch: number): THREE.Group {
  const g = new THREE.Group();
  g.add(part(BOX, wall, w, h, d, 0, h / 2, 0));
  g.add(part(PRISM, roof, w + 0.8, d * pitch, d + 0.8, 0, h, 0));
  // door and windows as dark insets on the long side
  g.add(part(BOX, 0x3b2a1c, 1.1, 2, 0.15, 0, 1, d / 2 + 0.05));
  for (const wx of [-w / 3, w / 3]) if (w > 5) g.add(part(BOX, 0x2f3a46, 0.9, 0.9, 0.15, wx, h * 0.62, d / 2 + 0.05));
  return g;
}

export class TownView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 6000);
  private renderer: THREE.WebGLRenderer;
  private town: TownDef;
  private rnd: () => number;
  private style: Style;
  /** unit vector pointing out to sea, and along the coast */
  private nx = 0;
  private nz = 1;
  private waterMat!: THREE.ShaderMaterial;
  private time = 0;
  buildings: Building[] = [];
  private shipGroup = new THREE.Group();
  private construction = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** camera target and distance */
  cx = 0;
  cy = 0;
  dist = 420;
  yaw = 0;
  /** world position of berths for docked ships */
  private berths: [number, number, number][] = [];

  constructor(renderer: THREE.WebGLRenderer, town: TownDef, terrain: TerrainSampler) {
    this.renderer = renderer;
    this.town = town;
    this.rnd = mulberry(town.id * 7919 + 13);
    this.style = STYLES[town.nation] ?? STYLES.Spain;
    // sea direction: down the distance-field gradient at the town
    const e = 3;
    let gx = terrain.sd(town.x - e, town.y) - terrain.sd(town.x + e, town.y);
    let gz = terrain.sd(town.x, town.y - e) - terrain.sd(town.x, town.y + e);
    const l = Math.hypot(gx, gz);
    if (l < 1e-3) { gx = 0; gz = 1; } else { gx /= l; gz /= l; }
    this.nx = gx;
    this.nz = gz;
    this.scene.background = new THREE.Color(0x9cc6dd);
    this.scene.fog = new THREE.Fog(0x9cc6dd, 900, 2600);
  }

  /** Signed distance to the coast in metres (positive on land) in town space. */
  private coast(x: number, z: number): number {
    // the shore runs through the origin, perpendicular to the sea direction, with bays
    const along = -x * this.nz + z * this.nx;
    const off = x * this.nx + z * this.nz; // positive = out to sea
    const seed = this.town.id * 0.37;
    const wobble = Math.sin(along * 0.008 + seed) * 70 + Math.sin(along * 0.021 + seed * 3) * 28 + Math.sin(along * 0.05 + seed * 7) * 8;
    // a harbour bay right at the town
    const bay = -60 * Math.exp(-(along * along) / (2 * 140 * 140));
    return -(off - wobble - bay);
  }

  height(x: number, z: number): number {
    const d = this.coast(x, z);
    if (d <= 0) return d * 0.05 - 0.5;
    const hill = Math.max(0, (d - 120) / 400);
    return Math.min(1, d / 12) * 2.2 + hill * hill * 60 * (0.6 + 0.4 * Math.sin(x * 0.01 + z * 0.013));
  }

  /** Town space to the town's "local frame": u = along the coast, v = inland distance. */
  private frame(u: number, v: number): [number, number] {
    // inland = -n; along = (-nz, nx)
    return [u * -this.nz - v * this.nx, u * this.nx - v * this.nz];
  }

  async load(): Promise<void> {
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(SUN_DIR[0] * 600, SUN_DIR[1] * 600, SUN_DIR[2] * 600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -500; sc.right = 500; sc.top = 500; sc.bottom = -500; sc.far = 2000;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target, new THREE.HemisphereLight(0xd8ecff, 0x6b7a4a, 1.0));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.buildTerrain();
    this.buildWater();
    this.layout();
    this.scene.add(this.shipGroup, this.construction);
    const [hx, hz] = this.frame(0, 40);
    this.cx = hx;
    this.cy = hz;
    // look from the sea towards the town
    this.yaw = Math.atan2(this.nx, this.nz);
  }

  private buildTerrain(): void {
    const geo = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2, 220, 220);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const col: number[] = [];
    const sand = new THREE.Color(0xe8d6a6), grass = new THREE.Color(0x7aa04a), dark = new THREE.Color(0x4f7a34), wet = new THREE.Color(0xb9a77a);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = this.height(x, z);
      p.setY(i, y);
      const d = this.coast(x, z);
      const n = Math.sin(x * 0.05) * Math.sin(z * 0.043) * 0.5 + 0.5;
      if (d < 0) c.copy(wet);
      else if (d < 18) c.copy(sand);
      else c.copy(grass).lerp(dark, n * 0.6);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  private buildWater(): void {
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(...SUN_DIR).normalize() }, uCam: { value: new THREE.Vector3() } },
      vertexShader: `varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vP;
        uniform float uTime;
        uniform vec3 uSun, uCam;
        ${NOISE}
        void main() {
          vec2 p = vP.xz * 0.05;
          float e = 0.3;
          float n0 = fbm3(p + uTime * vec2(0.3, 0.2)) + 0.5 * fbm3(p * 2.5 - uTime * 0.3);
          float nx = fbm3(p + vec2(e, 0.0) + uTime * vec2(0.3, 0.2)) + 0.5 * fbm3((p + vec2(e, 0.0)) * 2.5 - uTime * 0.3);
          float nz = fbm3(p + vec2(0.0, e) + uTime * vec2(0.3, 0.2)) + 0.5 * fbm3((p + vec2(0.0, e)) * 2.5 - uTime * 0.3);
          vec3 N = normalize(vec3((n0 - nx) * 1.6, 1.0, (n0 - nz) * 1.6));
          vec3 V = normalize(uCam - vP);
          vec3 H = normalize(uSun + V);
          float spec = pow(max(dot(N, H), 0.0), 120.0) * 1.6;
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 col = mix(vec3(0.10, 0.48, 0.58), vec3(0.45, 0.70, 0.82), fres * 0.6);
          col = col * (0.8 + 0.25 * max(dot(N, uSun), 0.0)) + spec;
          gl_FragColor = vec4(col, 0.86);
          #include <colorspace_fragment>
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 4, SIZE * 4, 1, 1), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    this.scene.add(water);
    // surf line along the shore
    const pts: THREE.Vector3[] = [];
    for (let u = -SIZE; u <= SIZE; u += 6) {
      // walk out from land until we hit the water line
      let v = 0;
      for (let k = 0; k < 80; k++) {
        const [x, z] = this.frame(u, v);
        if (this.coast(x, z) <= 0) break;
        v -= 4;
      }
      for (let k = 0; k < 80; k++) {
        const [x, z] = this.frame(u, v);
        if (this.coast(x, z) > 0) break;
        v += 4;
      }
      const [x, z] = this.frame(u, v);
      pts.push(new THREE.Vector3(x, 0.15, z));
    }
    const surf = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.scene.add(surf);
  }

  /** Find the inland distance v at which the shore is, for coast coordinate u. */
  private shoreV(u: number): number {
    let v = -200;
    for (let k = 0; k < 200; k++) {
      const [x, z] = this.frame(u, v);
      if (this.coast(x, z) > 0) return v;
      v += 3;
    }
    return 0;
  }

  private add(kind: BuildingKind, label: string, g: THREE.Group, u: number, v: number, rot = 0): Building {
    const [x, z] = this.frame(u, v);
    g.position.set(x, this.height(x, z), z);
    // face the sea (local +z points to the sea after this rotation)
    g.rotation.y = Math.atan2(this.nx, this.nz) + rot;
    g.traverse((o) => { o.userData.building = true; });
    this.scene.add(g);
    const b = { kind, label, group: g };
    if (kind !== 'decor') this.buildings.push(b);
    return b;
  }

  private occupied: [number, number, number][] = [];
  private free(u: number, v: number, r: number): boolean {
    const [x, z] = this.frame(u, v);
    if (this.coast(x, z) < r * 0.6 + 6) return false;
    return this.occupied.every(([ou, ov, or]) => (ou - u) ** 2 + (ov - v) ** 2 > (or + r) ** 2);
  }
  private reserve(u: number, v: number, r: number): void {
    this.occupied.push([u, v, r]);
  }

  private layout(): void {
    const st = this.style;
    const rnd = this.rnd;
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const shore = this.shoreV(0);

    // ---- harbour: pier into the water with posts and bollards
    const pier = new THREE.Group();
    const len = 90;
    pier.add(part(BOX, 0x8a6a45, 10, 1, len, 0, 1.6, len / 2));
    for (let k = 0; k <= len; k += 10) for (const sx of [-4.6, 4.6]) pier.add(part(CYL, 0x5b4128, 0.8, 6, 0.8, sx, -1.4, k));
    pier.add(part(BOX, 0x8a6a45, 26, 1, 8, 0, 1.6, len));
    this.add('harbour', 'Harbour', pier, 0, shore + 2);
    this.reserve(0, shore, 14);
    // berths alongside the pier (pointing out to sea), plus moorings off it
    for (const [du, dv] of [[-22, -55], [22, -65], [-22, -100], [22, -105], [55, -135], [-55, -135]]) {
      const [x, z] = this.frame(du, shore + dv);
      this.berths.push([x, z, Math.atan2(this.nx, this.nz)]);
    }

    // ---- warehouses on the waterfront
    for (const du of [-34, 30]) {
      const w = house(26, 14, 9, 0x9a7b55, 0x5a4636, 0.45);
      const b = this.add('warehouse', 'Warehouse', w, du, shore + 16);
      void b;
      this.reserve(du, shore + 16, 16);
    }
    // cargo on the quay
    for (let k = 0; k < 10; k++) {
      const g = new THREE.Group();
      g.add(part(CYL, 0x7a5532, 1.4, 1.8, 1.4, 0, 0.9, 0));
      this.add('decor', '', g, (rnd() - 0.5) * 50, shore + 4 + rnd() * 5);
    }

    // ---- shipyard: slipway running into the water, sheds and a crane
    const yardU = 150 + rnd() * 40;
    const ys = this.shoreV(yardU);
    const yard = new THREE.Group();
    const ramp = part(BOX, 0x9b7b52, 16, 1, 70, 0, 0.2, 18);
    ramp.rotation.x = 0.06;
    yard.add(ramp);
    yard.add(house(22, 14, 8, 0x8e6b48, 0x4b3a2e, 0.5).translateZ(-26).translateX(-20));
    yard.add(house(16, 12, 7, 0x8e6b48, 0x4b3a2e, 0.5).translateZ(-24).translateX(18));
    const crane = new THREE.Group();
    crane.add(part(BOX, 0x5b4128, 1.2, 22, 1.2, 0, 11, 0));
    crane.add(part(BOX, 0x5b4128, 18, 1, 1, 7, 22, 0));
    crane.position.set(12, 0, 6);
    yard.add(crane);
    this.add('shipyard', 'Shipyard', yard, yardU, ys + 4);
    this.reserve(yardU, ys, 34);
    this.construction.position.copy(yard.position);
    this.construction.rotation.copy(yard.rotation);

    // ---- market square, town hall, church, tavern
    const mv = shore + 70;
    const plaza = new THREE.Group();
    plaza.add(part(BOX, 0xc9b48c, 54, 0.4, 44, 0, 0.2, 0));
    const awnings = [0xc0392b, 0x2e86ab, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad];
    for (let k = 0; k < 8; k++) {
      const s = new THREE.Group();
      s.add(part(BOX, 0x8a6a45, 4, 1.2, 3, 0, 0.8, 0));
      s.add(part(PRISM, pick(awnings), 4.6, 1.2, 3.6, 0, 2.6, 0));
      for (const [px, pz] of [[-2, -1.5], [2, -1.5], [-2, 1.5], [2, 1.5]]) s.add(part(BOX, 0x5b4128, 0.25, 2.6, 0.25, px, 1.3, pz));
      s.position.set(-18 + (k % 4) * 12, 0, k < 4 ? -9 : 9);
      plaza.add(s);
    }
    plaza.add(part(CYL, 0xb8b0a0, 4, 1.2, 4, 0, 0.6, 0)); // well
    this.add('market', 'Market', plaza, 0, mv);
    this.reserve(0, mv, 34);

    const hall = new THREE.Group();
    hall.add(house(30, 18, 12, st.walls[2], st.roofs[0], st.roofPitch));
    hall.add(part(BOX, st.walls[2], 6, 22, 6, 0, 11, 0));
    hall.add(part(CONE, st.roofs[0], 7, 6, 7, 0, 25, 0));
    this.add('townhall', 'Town hall', hall, 0, mv + 40, Math.PI);
    this.reserve(0, mv + 40, 20);

    const church = new THREE.Group();
    church.add(house(34, 15, 13, st.walls[0], st.roofs[1], st.roofPitch));
    church.add(part(BOX, st.walls[0], 8, 30, 8, -19, 15, 0));
    church.add(part(CONE, st.roofs[1], 9, 12, 9, -19, 36, 0));
    this.add('church', 'Church', church, -55, mv + 28, Math.PI / 2);
    this.reserve(-55, mv + 28, 22);

    const tavern = new THREE.Group();
    tavern.add(house(18, 13, 8, st.walls[1], st.roofs[2], st.roofPitch));
    tavern.add(part(BOX, 0x5b4128, 0.4, 5, 0.4, 10, 2.5, 7)); // sign post
    tavern.add(part(BOX, 0xc9a14a, 3, 2, 0.3, 11.5, 4.5, 7));
    this.add('tavern', 'Tavern', tavern, 62, shore + 34, 0);
    this.reserve(62, shore + 34, 14);

    if (this.town.rank !== 'colony') {
      const pal = new THREE.Group();
      pal.add(house(40, 24, 14, st.walls[2], st.roofs[0], st.roofPitch * 0.8));
      pal.add(part(BOX, st.walls[2], 10, 18, 10, -18, 9, 0));
      pal.add(part(BOX, st.walls[2], 10, 18, 10, 18, 9, 0));
      for (const px of [-18, 18]) pal.add(part(CONE, st.roofs[0], 10, 6, 10, px, 21, 0));
      this.add('governor', "Governor's palace", pal, 70, mv + 60, Math.PI);
      this.reserve(70, mv + 60, 28);
    }

    // ---- houses along a loose street grid
    const houses = this.town.rank === 'viceroy' ? 120 : this.town.rank === 'governor' ? 80 : 45;
    let placed = 0;
    for (let k = 0; k < houses * 8 && placed < houses; k++) {
      const u = (rnd() - 0.5) * (220 + houses * 2.2);
      const v = shore + 25 + rnd() * (150 + houses * 1.4);
      const w = 8 + rnd() * 7, d = 7 + rnd() * 4, hh = 5 + rnd() * 5;
      const r = Math.max(w, d) * 0.65;
      // snap to a street grid so the town reads as streets
      const su = Math.round(u / 16) * 16, sv = Math.round(v / 14) * 14;
      if (!this.free(su, sv, r)) continue;
      this.reserve(su, sv, r);
      const hs = house(w, d, hh, pick(st.walls), pick(st.roofs), st.roofPitch);
      this.add('decor', '', hs, su, sv, rnd() < 0.5 ? 0 : Math.PI / 2);
      placed++;
    }

    // ---- fields and trees outside the town
    for (let k = 0; k < 14; k++) {
      const u = (rnd() - 0.5) * 700, v = shore + 230 + rnd() * 260;
      const [x, z] = this.frame(u, v);
      if (this.coast(x, z) < 40) continue;
      const field = part(BOX, pick([0xc8b45a, 0x8fae4a, 0xa7c25a, 0xb38a4a]), 60 + rnd() * 40, 0.3, 40 + rnd() * 30, x, this.height(x, z) + 0.3, z, rnd() * Math.PI);
      field.castShadow = false;
      this.scene.add(field);
    }
    for (let k = 0; k < 420; k++) {
      const u = (rnd() - 0.5) * 1500, v = shore + 8 + rnd() * 700;
      if (!this.free(u, v, 3)) continue;
      const [x, z] = this.frame(u, v);
      const y = this.height(x, z);
      const tree = new THREE.Group();
      if (this.coast(x, z) < 60 && rnd() < 0.7) {
        // palm
        tree.add(part(CYL, 0x7a5a3a, 0.7, 9, 0.7, 0, 4.5, 0));
        for (let f = 0; f < 5; f++) {
          const leaf = part(BOX, 0x3f8a3a, 7, 0.3, 1.6, 0, 9, 0, (f / 5) * Math.PI * 2);
          leaf.rotation.z = -0.35;
          leaf.translateX(3);
          tree.add(leaf);
        }
      } else {
        tree.add(part(CYL, 0x6b4a2e, 0.8, 4, 0.8, 0, 2, 0));
        tree.add(part(CONE, rnd() < 0.5 ? 0x3d7a34 : 0x4f8a3a, 7, 10, 7, 0, 8, 0));
      }
      tree.position.set(x, y, z);
      tree.scale.setScalar(0.8 + rnd() * 0.6);
      this.scene.add(tree);
    }
  }

  /** Show docked ships at the pier. */
  setShips(ships: { key: string; nation: number }[]): void {
    this.shipGroup.clear();
    ships.slice(0, this.berths.length).forEach((s, i) => {
      const g = makeShip(s.key, s.nation);
      const [x, z, rot] = this.berths[i];
      g.position.set(x, 0, z);
      // moored parallel to the pier, bow to the sea
      g.rotation.y = rot - Math.PI / 2;
      g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      this.shipGroup.add(g);
    });
  }

  /** Show a hull under construction on the slipway (progress 0..1), or nothing. */
  setConstruction(key: string | null, progress: number): void {
    this.construction.clear();
    if (!key) return;
    const g = makeShip(key, 0);
    // only the hull while building, masts appear near the end
    g.children.forEach((c, i) => { if (i > 0) c.visible = progress > 0.8; });
    g.scale.setScalar(0.5 + 0.5 * Math.min(1, progress * 1.3));
    g.position.set(0, 3, 10);
    g.rotation.y = -Math.PI / 2;
    this.construction.add(g);
  }

  // ---- camera & picking ----------------------------------------------------------------------

  private size() {
    const c = this.renderer.domElement;
    return { w: c.clientWidth || 1, h: c.clientHeight || 1 };
  }

  private updateCamera(): void {
    this.dist = Math.max(120, Math.min(1100, this.dist));
    const lim = SIZE * 0.8;
    this.cx = Math.max(-lim, Math.min(lim, this.cx));
    this.cy = Math.max(-lim, Math.min(lim, this.cy));
    const { w, h } = this.size();
    const pitch = 0.75;
    this.camera.aspect = w / h;
    // camera sits on the sea side, looking inland
    const sx = Math.sin(this.yaw), sz = Math.cos(this.yaw);
    this.camera.position.set(this.cx + sx * Math.cos(pitch) * this.dist, Math.sin(pitch) * this.dist, this.cy + sz * Math.cos(pitch) * this.dist);
    this.camera.lookAt(this.cx, 0, this.cy);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private ray(sx: number, sy: number): void {
    this.updateCamera();
    const { w, h } = this.size();
    this.raycaster.setFromCamera(new THREE.Vector2((sx / w) * 2 - 1, -(sy / h) * 2 + 1), this.camera);
  }

  groundAt(sx: number, sy: number): [number, number] {
    this.ray(sx, sy);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, p) ? [p.x, p.z] : [this.cx, this.cy];
  }

  private anchor: [number, number] | null = null;
  dragStart(sx: number, sy: number): void {
    this.anchor = this.groundAt(sx, sy);
  }
  dragTo(sx: number, sy: number): void {
    if (!this.anchor) return;
    const [x, z] = this.groundAt(sx, sy);
    this.cx += this.anchor[0] - x;
    this.cy += this.anchor[1] - z;
  }
  zoomBy(f: number): void {
    this.dist /= f;
  }
  rotateBy(a: number): void {
    this.yaw += a;
  }

  pickBuilding(sx: number, sy: number): Building | null {
    this.ray(sx, sy);
    const hits = this.raycaster.intersectObjects(this.buildings.map((b) => b.group), true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o) {
      const b = this.buildings.find((x) => x.group === o);
      if (b) return b;
      o = o.parent;
    }
    return null;
  }

  /** Screen position of a building's label anchor. */
  labelPos(b: Building): [number, number, boolean] {
    const box = new THREE.Box3().setFromObject(b.group);
    const p = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 4, (box.min.z + box.max.z) / 2).project(this.camera);
    const { w, h } = this.size();
    return [(p.x + 1) * 0.5 * w, (1 - p.y) * 0.5 * h, p.z < 1];
  }

  private highlighted: Building | null = null;
  highlight(b: Building | null): void {
    if (b === this.highlighted) return;
    const set = (bb: Building | null, on: boolean) => {
      bb?.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (on) {
            o.userData.mat = o.material;
            const m = (o.material as THREE.MeshStandardMaterial).clone();
            m.emissive = new THREE.Color(0x553311);
            o.material = m;
          } else if (o.userData.mat) {
            (o.material as THREE.Material).dispose();
            o.material = o.userData.mat;
          }
        }
      });
    };
    set(this.highlighted, false);
    set(b, true);
    this.highlighted = b;
  }

  render(dt: number): void {
    this.time += dt;
    this.updateCamera();
    if (this.waterMat) {
      this.waterMat.uniforms.uTime.value = this.time;
      this.waterMat.uniforms.uCam.value.copy(this.camera.position);
    }
    this.shipGroup.children.forEach((s, i) => {
      s.position.y = Math.sin(this.time * 1.2 + i) * 0.3;
      s.rotation.x = Math.sin(this.time * 0.9 + i) * 0.02;
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.shadowMap.enabled = false;
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== BOX && o.geometry !== PRISM && o.geometry !== CYL && o.geometry !== CONE) o.geometry.dispose();
    });
  }
}
