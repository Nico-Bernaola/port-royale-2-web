/**
 * Port view: a 3D harbour town. The coastline faces the direction of the real sea at the town
 * (from the world's distance field). A pier and the shipyard reach into the water, a stone quay
 * lines the waterfront, warehouses and the tavern stand behind it, then the market square,
 * church, town hall and governor's house, with cottages along a street grid. Every building
 * is placed by checking its whole footprint against the actual shoreline, so nothing ends up
 * in the sea. Units are metres.
 */
import * as THREE from 'three';
import type { TownDef } from '../core/data.ts';
import { NOISE, SUN_DIR } from './glsl.ts';
import { makeShip } from './ships3d.ts';
import type { TerrainSampler } from './terrain.ts';
import { type Blueprint, church, cottagePrototype, hullFrame, mansion, market, PALETTES, type Palette, pier, shipyard, tavern, warehouse } from './town/buildings.ts';
import { Kit } from './town/kit.ts';
import { Vegetation } from './town/nature.ts';
import { buildingFlag, detailTexture, material, mulberry } from './town/textures.ts';

export type BuildingKind = 'market' | 'shipyard' | 'tavern' | 'harbour' | 'townhall' | 'church' | 'governor' | 'warehouse' | 'decor';

export interface Building {
  kind: BuildingKind;
  label: string;
  group: THREE.Group;
}

const SIZE = 900; // half-size of the town area in metres
const GROUND_PX = 2048;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
const fbm = (x: number, y: number) => vnoise(x, y) * 0.5 + vnoise(x * 2.1 + 5, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 9, y * 4.3 + 1) * 0.2;

interface Footprint { x: number; z: number; hx: number; hz: number; rot: number; pad: number }

export class TownView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 7000);
  private renderer: THREE.WebGLRenderer;
  private town: TownDef;
  private rnd: () => number;
  private pal: Palette;
  /** unit vector pointing out to sea */
  private nx = 0;
  private nz = 1;
  private seed: number;
  private waterMat!: THREE.ShaderMaterial;
  private sun!: THREE.DirectionalLight;
  private time = 0;
  buildings: Building[] = [];
  private shipGroup = new THREE.Group();
  private construction = new THREE.Group();
  private slip = new THREE.Vector3();
  private flags: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private footprints: Footprint[] = [];
  private streets: [number, number, number, number][] = [];
  private fields: Footprint[] = [];
  private prevToneMapping: THREE.ToneMapping = THREE.NoToneMapping;
  private prevExposure = 1;
  /** camera target and distance */
  cx = 0;
  cy = 0;
  dist = 260;
  yaw = 0;
  /** world position of berths for docked ships */
  private berths: [number, number, number][] = [];

  constructor(renderer: THREE.WebGLRenderer, town: TownDef, terrain: TerrainSampler) {
    this.renderer = renderer;
    this.town = town;
    this.rnd = mulberry(town.id * 7919 + 13);
    this.pal = PALETTES[town.nation] ?? PALETTES.England;
    this.seed = town.id * 0.37;
    // sea direction: down the distance-field gradient at the town
    const e = 3;
    let gx = terrain.sd(town.x - e, town.y) - terrain.sd(town.x + e, town.y);
    let gz = terrain.sd(town.x, town.y - e) - terrain.sd(town.x, town.y + e);
    const l = Math.hypot(gx, gz);
    if (l < 1e-3) { gx = 0; gz = 1; } else { gx /= l; gz /= l; }
    this.nx = gx;
    this.nz = gz;
    this.scene.fog = new THREE.Fog(0xbcd6e4, 700, 2600);
  }

  /** Signed distance to the coast in metres (positive on land) in town space. */
  private coast(x: number, z: number): number {
    const along = -x * this.nz + z * this.nx;
    const off = x * this.nx + z * this.nz; // positive = out to sea
    const s = this.seed;
    // the waterfront in front of the town is kept fairly straight; the coast wanders further out
    const calm = 0.25 + 0.75 * smooth(160, 420, Math.abs(along));
    const wobble = (Math.sin(along * 0.008 + s) * 70 + Math.sin(along * 0.021 + s * 3) * 28 + Math.sin(along * 0.05 + s * 7) * 8) * calm;
    const q = along / 220;
    const bay = -60 * Math.exp(-q * q * q * q);
    return -(off - wobble - bay);
  }

  height(x: number, z: number): number {
    const d = this.coast(x, z);
    if (d <= 0) return Math.max(-14, d * 0.06) - 0.4;
    const hill = Math.max(0, (d - 170) / 420);
    return Math.min(1, d / 12) * 2.2 + hill * hill * 60 * (0.6 + 0.4 * Math.sin(x * 0.01 + z * 0.013));
  }

  /** Town space from the town's "local frame": u = along the coast, v = inland distance. */
  private frame(u: number, v: number): [number, number] {
    return [u * -this.nz - v * this.nx, u * this.nx - v * this.nz];
  }

  /** Heading that turns a blueprint's +z towards the sea. */
  private get seaward(): number {
    return Math.atan2(this.nx, this.nz);
  }

  async load(): Promise<void> {
    this.prevToneMapping = this.renderer.toneMapping;
    this.prevExposure = this.renderer.toneMappingExposure;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, new THREE.HemisphereLight(0xd6eaff, 0x8a7a52, 1.15));

    this.buildSky();
    // yield so the loading message paints before the heavy work
    await new Promise((r) => setTimeout(r, 30));
    this.layout();
    this.buildTerrain();
    this.buildWater();
    this.scene.add(this.shipGroup, this.construction);
    const [hx, hz] = this.frame(0, this.shoreV(0) + 30);
    this.cx = hx;
    this.cy = hz;
    // look from the sea towards the town
    this.yaw = this.seaward;
  }

  // ---- environment ------------------------------------------------------------------------------

  private buildSky(): void {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD;
        void main(){
          float h = clamp(vD.y, 0.0, 1.0);
          vec3 c = mix(vec3(0.74, 0.84, 0.89), vec3(0.33, 0.58, 0.82), pow(h, 0.55));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 24, 12), mat);
    sky.renderOrder = -1;
    sky.onBeforeRender = () => sky.position.copy(this.camera.position);
    this.scene.add(sky);
  }

  private buildTerrain(): void {
    const geo = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2, 240, 240);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, this.height(p.getX(i), p.getZ(i)));
    geo.computeVertexNormals();
    const detail = detailTexture();
    const mat = new THREE.MeshStandardMaterial({ map: this.paintGround(), roughness: 1 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = { value: detail };
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D uDetail;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= 0.62 + 0.76 * texture2D(uDetail, vMapUv * 900.0).r;
          diffuseColor.rgb *= 0.8 + 0.4 * texture2D(uDetail, vMapUv * 97.0).r;`);
    };
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  /** Paint the ground: sand, grass, dirt around buildings, streets and fields. */
  private paintGround(): THREE.CanvasTexture {
    const N = GROUND_PX;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    const img = g.createImageData(N, N);
    const C = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    const wet = C(0xa8966e), deepSand = C(0x8a8466), sand = C(0xcdb98c), grassA = C(0x7d9a44), grassB = C(0x5b7c31), dry = C(0xa8a25e), forest = C(0x4d6c2c), rock = C(0x8c8470);
    const col = [0, 0, 0];
    const lerp = (a: number[], b: number[], t: number) => { col[0] = a[0] + (b[0] - a[0]) * t; col[1] = a[1] + (b[1] - a[1]) * t; col[2] = a[2] + (b[2] - a[2]) * t; };
    const tmp = [0, 0, 0];
    for (let r = 0; r < N; r++) {
      const z = -SIZE + ((r + 0.5) / N) * SIZE * 2;
      for (let q = 0; q < N; q++) {
        const x = -SIZE + ((q + 0.5) / N) * SIZE * 2;
        const d = this.coast(x, z);
        const n1 = fbm(x * 0.02, z * 0.02), n2 = fbm(x * 0.006 + 40, z * 0.006);
        if (d < 0) {
          lerp(wet, deepSand, smooth(0, 90, -d));
        } else if (d < 26) {
          lerp(sand, grassA, smooth(12 + n1 * 8, 26, d));
        } else {
          lerp(grassA, grassB, n1);
          tmp[0] = col[0]; tmp[1] = col[1]; tmp[2] = col[2];
          if (n2 > 0.55) lerp(tmp, dry, smooth(0.55, 0.75, n2) * 0.8);
          tmp[0] = col[0]; tmp[1] = col[1]; tmp[2] = col[2];
          const h = this.height(x, z);
          if (h > 14) lerp(tmp, forest, smooth(14, 30, h) * 0.8);
          tmp[0] = col[0]; tmp[1] = col[1]; tmp[2] = col[2];
          if (n1 > 0.72) lerp(tmp, rock, (n1 - 0.72) * 2);
        }
        const o = (r * N + q) * 4;
        const f = 0.92 + 0.16 * vnoise(x * 0.4, z * 0.4);
        img.data[o] = col[0] * f; img.data[o + 1] = col[1] * f; img.data[o + 2] = col[2] * f; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const s = N / (SIZE * 2);
    const at = (x: number, z: number): [number, number] => [(x + SIZE) * s, (z + SIZE) * s];
    const place = (fp: Footprint) => {
      const [px, pz] = at(fp.x, fp.z);
      const cs = Math.cos(fp.rot), sn = Math.sin(fp.rot);
      g.setTransform(s * cs, -s * sn, s * sn, s * cs, px, pz);
    };
    // fields beyond the town, ploughed in rows
    const crops = ['#b8a456', '#8faa48', '#a4b85a', '#9a7a48', '#c2b062'];
    for (const f of this.fields) {
      place(f);
      g.fillStyle = crops[Math.floor(hash(Math.round(f.x), Math.round(f.z)) * crops.length)];
      g.globalAlpha = 0.85;
      g.fillRect(-f.hx, -f.hz, f.hx * 2, f.hz * 2);
      g.globalAlpha = 0.25;
      g.fillStyle = '#4a3a20';
      for (let k = -f.hx; k < f.hx; k += 2.4) g.fillRect(k, -f.hz, 0.9, f.hz * 2);
    }
    g.globalAlpha = 1;
    // streets
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = 'blur(1.5px)';
    g.lineCap = 'round';
    for (const [u0, v0, u1, v1] of this.streets) {
      const [x0, z0] = this.frame(u0, v0), [x1, z1] = this.frame(u1, v1);
      const a = at(x0, z0), b = at(x1, z1);
      g.strokeStyle = 'rgba(132, 106, 72, 0.9)';
      g.lineWidth = 5.5 * s;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.strokeStyle = 'rgba(156, 128, 90, 0.6)';
      g.lineWidth = 2.5 * s;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    // trodden earth around every building
    for (const fp of this.footprints) {
      place(fp);
      g.fillStyle = 'rgba(138, 112, 76, 0.7)';
      const r = Math.min(fp.hx, fp.hz) * 0.5;
      g.beginPath();
      g.roundRect(-fp.hx - fp.pad, -fp.hz - fp.pad, (fp.hx + fp.pad) * 2, (fp.hz + fp.pad) * 2, r);
      g.fill();
    }
    g.filter = 'none';
    g.setTransform(1, 0, 0, 1, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  private buildWater(): void {
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uSun: { value: new THREE.Vector3(...SUN_DIR).normalize() }, uCam: { value: new THREE.Vector3() },
        uN: { value: new THREE.Vector2(this.nx, this.nz) }, uSeed: { value: this.seed },
      }]),
      vertexShader: `varying vec3 vP;
        #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vP;
        uniform float uTime, uSeed;
        uniform vec3 uSun, uCam;
        uniform vec2 uN;
        #include <fog_pars_fragment>
        ${NOISE}
        float coastD(vec2 p) {
          float along = -p.x * uN.y + p.y * uN.x;
          float off = p.x * uN.x + p.y * uN.y;
          float calm = 0.25 + 0.75 * smoothstep(160.0, 420.0, abs(along));
          float wob = (sin(along * 0.008 + uSeed) * 70.0 + sin(along * 0.021 + uSeed * 3.0) * 28.0 + sin(along * 0.05 + uSeed * 7.0) * 8.0) * calm;
          float q = along / 220.0;
          float bay = -60.0 * exp(-q * q * q * q);
          return -(off - wob - bay);
        }
        void main() {
          vec2 p = vP.xz * 0.05;
          float e = 0.3;
          vec2 f1 = uTime * vec2(0.3, 0.2);
          float n0 = fbm3(p + f1) + 0.5 * fbm3(p * 2.5 - uTime * 0.3);
          float nx = fbm3(p + vec2(e, 0.0) + f1) + 0.5 * fbm3((p + vec2(e, 0.0)) * 2.5 - uTime * 0.3);
          float nz = fbm3(p + vec2(0.0, e) + f1) + 0.5 * fbm3((p + vec2(0.0, e)) * 2.5 - uTime * 0.3);
          vec3 N = normalize(vec3((n0 - nx) * 1.4, 1.0, (n0 - nz) * 1.4));
          vec3 V = normalize(uCam - vP);
          vec3 H = normalize(uSun + V);
          float spec = pow(max(dot(N, H), 0.0), 320.0) * 1.1;
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          float depth = -coastD(vP.xz);
          float shallow = 1.0 - smoothstep(0.0, 80.0, depth);
          vec3 deep = vec3(0.04, 0.27, 0.40), turq = vec3(0.16, 0.62, 0.62);
          vec3 col = mix(deep, turq, shallow);
          col = mix(col, vec3(0.62, 0.78, 0.86), fres * 0.5);
          col = col * (0.82 + 0.25 * max(dot(N, uSun), 0.0)) + spec;
          // surf where the waves meet the shore
          float wave = 0.5 + 0.5 * sin(uTime * 1.1 - depth * 0.55 + fbm3(vP.xz * 0.02) * 6.0);
          float foam = (1.0 - smoothstep(0.0, 2.5 + 3.0 * wave, depth)) * smoothstep(0.35, 0.65, fbm(vP.xz * 0.15 + uTime * 0.2));
          col = mix(col, vec3(0.95), foam * 0.85);
          float alpha = mix(0.94, 0.5, shallow * shallow) + foam * 0.4;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 6, SIZE * 6, 1, 1), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    water.renderOrder = 1;
    this.scene.add(water);
  }

  // ---- layout -----------------------------------------------------------------------------------

  /** Inland distance v at which the shore is, for coast coordinate u. */
  private shoreV(u: number): number {
    let v = -300;
    for (let k = 0; k < 400; k++) {
      const [x, z] = this.frame(u, v);
      if (this.coast(x, z) > 0) break;
      v += 2;
    }
    // refine
    let lo = v - 2, hi = v;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      const [x, z] = this.frame(u, mid);
      if (this.coast(x, z) > 0) hi = mid; else lo = mid;
    }
    return hi;
  }

  private occupied: [number, number, number][] = [];

  /** Is a circle of radius r at (u, v) on dry land (with a margin) and clear of other things? */
  private free(u: number, v: number, r: number, margin = 3): boolean {
    const [x, z] = this.frame(u, v);
    if (this.coast(x, z) < r + margin) return false;
    return this.occupied.every(([ou, ov, or]) => (ou - u) ** 2 + (ov - v) ** 2 > (or + r) ** 2);
  }

  private reserve(u: number, v: number, r: number): void {
    this.occupied.push([u, v, r]);
  }

  /** Lowest and highest ground under a rotated footprint. */
  private groundRange(x: number, z: number, hx: number, hz: number, rot: number): [number, number] {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    let lo = Infinity, hi = -Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const lx = a * hx, lz = b * hz;
      const h = this.height(x + lx * cs + lz * sn, z - lx * sn + lz * cs);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return [lo, hi];
  }

  private flag(group: THREE.Group, at: THREE.Vector3, size = 1): void {
    const geo = new THREE.PlaneGeometry(1.9 * size, 1.15 * size, 12, 2);
    geo.translate(0.95 * size, -0.575 * size, 0);
    geo.userData.base = Float32Array.from(geo.attributes.position.array as Float32Array);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: buildingFlag(this.pal.nation), side: THREE.DoubleSide, roughness: 0.9 }));
    m.position.copy(at);
    m.castShadow = true;
    // fly downwind: the trade winds blow from the east
    m.rotation.y = -group.rotation.y + Math.PI;
    group.add(m);
    this.flags.push(m);
  }

  /**
   * Place a blueprint facing the sea (plus rot) at coast coordinate u, dv metres inland of the
   * local shoreline. Land buildings move further inland until their footprint is clear.
   */
  private place(kind: BuildingKind, label: string, bp: Blueprint, u: number, dv: number, rot = 0, water = false, grounds = 0): Building {
    const r = Math.hypot(bp.half[0], bp.half[1]) * 0.82 + grounds;
    let v = this.shoreV(u) + dv;
    if (!water) for (let k = 0; k < 80 && !this.free(u, v, r); k++) v += 3;
    this.reserve(u, v, r);
    const [x, z] = this.frame(u, v);
    const g = bp.group;
    const heading = this.seaward + rot;
    g.rotation.y = heading;
    if (water) {
      g.position.set(x, 0, z);
    } else {
      const [lo, hi] = this.groundRange(x, z, bp.half[0] * 0.8, bp.half[1] * 0.8, heading);
      g.position.set(x, hi, z);
      if (hi - lo > 0.08) {
        // a stone plinth under buildings on sloping ground
        const k = new Kit();
        k.block(this.pal.stone === 'limestone' ? 'rubble' : this.pal.stone, bp.half[0] * 1.7, hi - lo + 1, bp.half[1] * 1.7, 0, lo - hi - 1, 0);
        g.add(k.build());
      }
      this.footprints.push({ x, z, hx: bp.half[0], hz: bp.half[1], rot: heading, pad: 2.5 });
    }
    for (const f of bp.flags) this.flag(g, f, kind === 'governor' ? 1.6 : 1);
    g.traverse((o) => { o.userData.building = true; });
    this.scene.add(g);
    const b = { kind, label, group: g };
    if (kind !== 'decor') this.buildings.push(b);
    return b;
  }

  /** Stone quay along the waterfront between u0 and u1. */
  private quay(u0: number, u1: number): void {
    const k = new Kit();
    const step = 4;
    for (let u = u0; u < u1; u += step) {
      const v = this.shoreV(u + step / 2);
      const [x, z] = this.frame(u + step / 2, v + 2);
      k.box('quay', step + 0.15, 5.4, 11, x, -2.2 + 0.3, z, this.seaward);
      const [x2, z2] = this.frame(u + step / 2, v - 3.3);
      k.box('limestone|f2ead8', step + 0.15, 0.3, 0.7, x2, 1.25, z2, this.seaward);
      this.reserve(u + step / 2, v + 2, 7);
    }
    // bollards along the edge
    for (let u = u0 + 6; u < u1; u += 14) {
      const [x, z] = this.frame(u, this.shoreV(u) - 2.5);
      k.cyl('black', 0.2, 0.5, x, 1.4, z, 10, 0.16);
      k.cyl('black', 0.27, 0.08, x, 1.86, z, 10);
    }
    const g = k.build();
    this.scene.add(g);
    this.streets.push([u0, this.shoreV(0) + 7, u1, this.shoreV(0) + 7]);
  }

  private layout(): void {
    const rnd = this.rnd;
    const pal = this.pal;
    const shore = this.shoreV(0);
    const big = this.town.rank === 'viceroy' ? 2 : this.town.rank === 'governor' ? 1 : 0;

    // ---- harbour: pier into the water, berths alongside and beyond it
    const len = 92;
    this.place('harbour', 'Harbour', pier(len), 0, 4, 0, true);
    for (let v = shore + 10; v > shore - len; v -= 6) this.reserve(0, v, 9);
    for (const [du, dv] of [[-14, -46], [14, -50], [-34, -128], [34, -128], [-84, -112], [84, -112]]) {
      const [x, z] = this.frame(du, shore + dv);
      this.berths.push([x, z, this.seaward]);
    }
    this.quay(-120, 118);

    // ---- shipyard on its own stretch of shore, slipway into the sea
    const yardU = 175 + rnd() * 25;
    const yard = shipyard(pal);
    this.place('shipyard', 'Shipyard', yard, yardU, 0, 0, true);
    for (let du = -26; du <= 26; du += 8) this.reserve(yardU + du, this.shoreV(yardU) + 10, 14);
    const [yx, yz] = this.frame(yardU, this.shoreV(yardU) + 12);
    this.footprints.push({ x: yx, z: yz, hx: 28, hz: 10, rot: this.seaward, pad: 4 });
    this.construction.position.copy(yard.group.position);
    this.construction.rotation.copy(yard.group.rotation);
    this.slip.copy(yard.slip!);

    // ---- waterfront: warehouses either side of the pier, the tavern further along
    this.place('warehouse', 'Warehouse', warehouse(pal), -36, 22);
    this.place('warehouse', 'Warehouse', warehouse(pal), 38, 22);
    this.place('tavern', 'Tavern', tavern(pal), -88, 18, 0.05);

    // ---- market square with the town hall, church and governor's house around it
    const mk = this.place('market', 'Market', market(pal, rnd), 0, 72);
    const mv = this.vOf(mk.group);
    this.place('townhall', 'Town hall', mansion(pal, false), 0, mv - this.shoreV(0) + 46, 0, false, 4);
    this.place('church', 'Church', church(pal), -68, mv - this.shoreV(-68) + 22, -Math.PI / 2, false, 5);
    if (this.town.rank !== 'colony') this.place('governor', "Governor's house", mansion(pal, true), 86, mv - this.shoreV(86) + 38, 0, false, 8);

    // ---- cottages along a street grid
    this.cottages(big, mv);

    // ---- fields, trees, bushes and grass
    this.nature(big);
  }

  /** Inland coordinate v of a placed group. */
  private vOf(g: THREE.Object3D): number {
    // inverse of frame(): v = -(x*nx + z*nz)
    return -(g.position.x * this.nx + g.position.z * this.nz);
  }

  private cottages(big: number, mv: number): void {
    const rnd = this.rnd;
    const count = [46, 80, 120][big];
    const protos: { geos: Map<string, THREE.BufferGeometry>; half: [number, number]; mats: THREE.Matrix4[] }[] = [];
    for (let v = 0; v < 3; v++) for (let s = 0; s < 2; s++) protos.push({ ...cottagePrototype(this.pal, v, 1 + v * 17 + s * 101), mats: [] });
    const plinths: THREE.Matrix4[] = [];
    const shore = this.shoreV(0);
    const rowGap = 24, colGap = 18;
    const halfWidth = 120 + count * 1.6;
    let placed = 0;
    const rows: number[] = [];
    for (let rI = 0; rI < 20; rI++) rows.push(shore + 40 + rI * rowGap);
    // walk outwards from the centre so the town grows from the square
    const cells: [number, number][] = [];
    for (const v of rows) for (let u = -halfWidth; u <= halfWidth; u += colGap) cells.push([u, v]);
    cells.sort((a, b) => Math.hypot(a[0], (a[1] - mv) * 1.4) - Math.hypot(b[0], (b[1] - mv) * 1.4));
    const usedRows = new Map<number, [number, number]>();
    for (const [cu, cv] of cells) {
      if (placed >= count) break;
      if (rnd() < 0.12) continue; // the odd empty plot
      const u = cu + (rnd() - 0.5) * 3, v = cv + (rnd() - 0.5) * 2;
      const P = protos[Math.floor(rnd() * protos.length)];
      const r = Math.hypot(P.half[0], P.half[1]) * 0.78;
      if (!this.free(u, v, r, 2)) continue;
      this.reserve(u, v, r);
      const [x, z] = this.frame(u, v);
      // face the street (the sea side), sometimes turned to a side lane
      const turn = rnd() < 0.18 ? (rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : 0;
      const heading = this.seaward + turn + (rnd() - 0.5) * 0.1;
      const [lo, hi] = this.groundRange(x, z, P.half[0] * 0.7, P.half[1] * 0.7, heading);
      const y = Math.max(hi - 0.5, (lo + hi) / 2);
      P.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), new THREE.Vector3(1, 1, 1)));
      if (y - lo > 0.75) plinths.push(new THREE.Matrix4().compose(new THREE.Vector3(x, (y + lo) / 2 - 0.2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), new THREE.Vector3(P.half[0] * 1.5, y - lo + 0.4, P.half[1] * 1.2)));
      this.footprints.push({ x, z, hx: P.half[0] * 0.9, hz: P.half[1] * 0.9, rot: heading, pad: 1.8 });
      const ext = usedRows.get(cv) ?? [u, u];
      usedRows.set(cv, [Math.min(ext[0], u), Math.max(ext[1], u)]);
      placed++;
    }
    // streets in front of each row of houses, and lanes up from the waterfront
    for (const [v, [u0, u1]] of usedRows) this.streets.push([u0 - 8, v - 10, u1 + 8, v - 10]);
    const vmax = Math.max(...[...usedRows.keys()], mv + 60);
    for (const u of [-colGap * 4.5, -colGap * 1.5, colGap * 1.5, colGap * 4.5]) this.streets.push([u, shore + 8, u, vmax]);
    this.streets.push([-30, mv + 30, 30, mv + 30]);
    for (const P of protos) {
      if (!P.mats.length) continue;
      for (const [key, geo] of P.geos) {
        const im = new THREE.InstancedMesh(geo, material(key), P.mats.length);
        P.mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.scene.add(im);
      }
    }
    if (plinths.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material('rubble'), plinths.length);
      plinths.forEach((m, i) => im.setMatrixAt(i, m));
      im.receiveShadow = true;
      this.scene.add(im);
    }
  }

  /** Is a world point clear of buildings (used for vegetation)? */
  private clearOfBuildings(x: number, z: number, margin: number): boolean {
    for (const f of this.footprints) {
      const dx = x - f.x, dz = z - f.z;
      const cs = Math.cos(f.rot), sn = Math.sin(f.rot);
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) < f.hx + margin && Math.abs(lz) < f.hz + margin) return false;
    }
    return true;
  }

  private nature(big: number): void {
    const rnd = this.rnd;
    const shore = this.shoreV(0);
    const veg = new Vegetation();
    const townR = 170 + big * 60;
    // fields on the gentle land behind the town
    for (let k = 0; k < 40 && this.fields.length < 16; k++) {
      const u = (rnd() - 0.5) * 900, v = shore + townR + 80 + rnd() * 300;
      const [x, z] = this.frame(u, v);
      if (this.coast(x, z) < 60 || this.height(x, z) > 30) continue;
      if (!this.free(u, v, 40, 0)) continue;
      this.reserve(u, v, 38);
      this.fields.push({ x, z, hx: 25 + rnd() * 15, hz: 18 + rnd() * 10, rot: this.seaward + (rnd() - 0.5) * 0.6, pad: 0 });
    }
    const onStreet = (u: number, v: number) => this.streets.some(([u0, v0, u1, v1]) => {
      const dx = u1 - u0, dv = v1 - v0;
      const t = Math.max(0, Math.min(1, ((u - u0) * dx + (v - v0) * dv) / (dx * dx + dv * dv || 1)));
      return Math.hypot(u - (u0 + dx * t), v - (v0 + dv * t)) < 4;
    });
    const tryPut = (n: number, fn: (x: number, y: number, z: number, d: number, u: number, v: number) => boolean) => {
      for (let k = 0; k < n; k++) {
        const u = (rnd() - 0.5) * 1700, v = shore - 20 + rnd() * 900;
        const [x, z] = this.frame(u, v);
        const d = this.coast(x, z);
        if (d < 3) continue;
        fn(x, this.height(x, z), z, d, u, v);
      }
    };
    // palms along the beach and scattered through the town, broadleaf trees inland
    tryPut(2600, (x, y, z, d, u, v) => {
      const inTown = Math.abs(u) < townR * 1.4 && v < shore + townR * 1.3;
      const want = d < 70 ? 0.22 : inTown ? 0.06 : 0.035;
      if (rnd() > want) return false;
      if (!this.clearOfBuildings(x, z, 2.5) || onStreet(u, v) || !this.free(u, v, 1.5, 0)) return false;
      if (d < 80 || rnd() < 0.45) veg.palm(x, y, z);
      else veg.tree(x, y, z);
      if (!inTown && rnd() < 0.5) this.reserve(u, v, 3);
      return true;
    });
    // forest on the hills
    tryPut(1800, (x, y, z, _d, u, v) => {
      if (y < 12 || rnd() < 0.4 || !this.free(u, v, 3, 0)) return false;
      if (rnd() < 0.7) veg.tree(x, y, z); else veg.palm(x, y, z);
      return true;
    });
    tryPut(2500, (x, y, z, _d, u, v) => {
      if (rnd() < 0.55 || !this.clearOfBuildings(x, z, 1) || onStreet(u, v)) return false;
      if (!this.free(u, v, 0.8, 0) && rnd() < 0.8) return false;
      veg.bush(x, y, z);
      return true;
    });
    tryPut(6000, (x, y, z, _d, u, v) => {
      if (!this.clearOfBuildings(x, z, 0.3) || onStreet(u, v)) return false;
      if (Math.abs(u) < townR && v < shore + townR && rnd() < 0.5) return false;
      veg.tuft(x, y, z);
      return true;
    });
    this.scene.add(veg.build());
  }

  // ---- ships ------------------------------------------------------------------------------------

  /** Show docked ships at the pier. */
  setShips(ships: { key: string; nation: number }[]): void {
    this.shipGroup.clear();
    ships.slice(0, this.berths.length).forEach((s, i) => {
      const g = makeShip(s.key, s.nation);
      const [x, z, rot] = this.berths[i];
      g.position.set(x, 0, z);
      // moored parallel to the pier, bow to the sea
      g.rotation.y = rot - Math.PI / 2;
      g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.shipGroup.add(g);
    });
  }

  /** Show a hull under construction on the slipway (progress 0..1), or nothing. */
  setConstruction(key: string | null, progress: number): void {
    this.construction.clear();
    if (!key) {
      // an idle yard still has a hull taking shape on the stocks
      const f = hullFrame(30);
      f.position.copy(this.slip).add(new THREE.Vector3(0, 0.2, -4));
      f.rotation.x = 0.11;
      this.construction.add(f);
      return;
    }
    const g = makeShip(key, 0);
    // only the hull while building, masts appear near the end
    g.children.forEach((c, i) => { if (i > 0) c.visible = progress > 0.8; });
    g.scale.setScalar(0.5 + 0.5 * Math.min(1, progress * 1.3));
    g.position.copy(this.slip).add(new THREE.Vector3(0, 2.4, 0));
    g.rotation.set(0, -Math.PI / 2, -0.11, 'YXZ');
    g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.construction.add(g);
  }

  // ---- camera & picking -------------------------------------------------------------------------

  private size() {
    const c = this.renderer.domElement;
    return { w: c.clientWidth || 1, h: c.clientHeight || 1 };
  }

  private updateCamera(): void {
    this.dist = Math.max(28, Math.min(1100, this.dist));
    const lim = SIZE * 0.8;
    this.cx = Math.max(-lim, Math.min(lim, this.cx));
    this.cy = Math.max(-lim, Math.min(lim, this.cy));
    const { w, h } = this.size();
    // lower, more cinematic angle when close; nearly top-down when far
    const pitch = 0.4 + 0.45 * smooth(28, 700, this.dist);
    this.camera.aspect = w / h;
    const ty = Math.max(0, this.height(this.cx, this.cy));
    const sx = Math.sin(this.yaw), sz = Math.cos(this.yaw);
    this.camera.position.set(this.cx + sx * Math.cos(pitch) * this.dist, ty + Math.sin(pitch) * this.dist, this.cy + sz * Math.cos(pitch) * this.dist);
    this.camera.lookAt(this.cx, ty, this.cy);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private updateSun(): void {
    // keep the shadow map focused on what the camera looks at, so close-ups get crisp shadows
    const half = Math.max(50, Math.min(520, this.dist * 0.95));
    const sc = this.sun.shadow.camera;
    if (sc.right !== half) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = 1; sc.far = 2400;
      sc.updateProjectionMatrix();
    }
    const d = 900;
    // snap to shadow texels to avoid shimmering while panning
    const texel = (half * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(this.cx / texel) * texel, tz = Math.round(this.cy / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + SUN_DIR[0] * d, SUN_DIR[1] * d, tz + SUN_DIR[2] * d);
    this.sun.target.updateMatrixWorld();
  }

  private ray(sx: number, sy: number): void {
    this.updateCamera();
    const { w, h } = this.size();
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((sx - r.left) / w) * 2 - 1, -((sy - r.top) / h) * 2 + 1), this.camera);
  }

  groundAt(sx: number, sy: number): [number, number] {
    this.ray(sx, sy);
    const p = new THREE.Vector3();
    this.ground.constant = -Math.max(0, this.height(this.cx, this.cy));
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

  private labelAnchors = new Map<Building, THREE.Vector3>();

  /** Screen position of a building's label anchor. */
  labelPos(b: Building): [number, number, boolean] {
    let a = this.labelAnchors.get(b);
    if (!a) {
      const box = new THREE.Box3().setFromObject(b.group);
      a = new THREE.Vector3((box.min.x + box.max.x) / 2, Math.min(box.max.y, b.group.position.y + 16) + 3, (box.min.z + box.max.z) / 2);
      if (b.kind === 'harbour') a.copy(b.group.position).add(new THREE.Vector3(0, 8, 0));
      this.labelAnchors.set(b, a);
    }
    const p = a.clone().project(this.camera);
    const { w, h } = this.size();
    return [(p.x + 1) * 0.5 * w, (1 - p.y) * 0.5 * h, p.z < 1];
  }

  private highlighted: Building | null = null;
  highlight(b: Building | null): void {
    if (b === this.highlighted) return;
    const set = (bb: Building | null, on: boolean) => {
      bb?.group.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o.material instanceof THREE.ShaderMaterial)) {
          if (on) {
            o.userData.mat = o.material;
            const m = (o.material as THREE.MeshStandardMaterial).clone();
            m.emissive = new THREE.Color(0x3a2610);
            m.emissiveIntensity = 1;
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
    this.updateSun();
    if (this.waterMat) {
      this.waterMat.uniforms.uTime.value = this.time;
      this.waterMat.uniforms.uCam.value.copy(this.camera.position);
    }
    this.shipGroup.children.forEach((s, i) => {
      s.position.y = Math.sin(this.time * 1.2 + i) * 0.25;
      s.rotation.x = Math.sin(this.time * 0.9 + i) * 0.015;
    });
    for (const f of this.flags) {
      const pos = f.geometry.attributes.position as THREE.BufferAttribute;
      const base = f.geometry.userData.base as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        pos.setZ(i, Math.sin(x * 2.6 - this.time * 6 + base[i * 3 + 1]) * 0.14 * x);
      }
      pos.needsUpdate = true;
      f.geometry.computeVertexNormals();
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = this.prevToneMapping;
    this.renderer.toneMappingExposure = this.prevExposure;
    // building materials and textures are shared and cached; geometry is per town
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
