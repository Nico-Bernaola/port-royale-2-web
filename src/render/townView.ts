/**
 * Port view: the town's real heightmap rendered as an isometric landscape (the original
 * engine's tile ratio, 34x21 px per tile) with the original building sprites laid out around
 * the harbour. The exact original building placement (SurfaceObjects.dat) is not decoded yet,
 * so the layout is generated from the coastline, the town's nation, rank and production.
 */
import * as THREE from 'three';
import { fetchJson, loadImage, texture } from '../assets.ts';
import type { GoodDef, TownDef } from '../core/data.ts';

const TW = 34; // tile width in px
const TH = 21; // tile height in px
const GRID = 256; // tiles per side (heightmap is 513 px: 2 tiles per pixel)
const SEA_LEVEL = 0.55;

export type BuildingKind = 'market' | 'shipyard' | 'tavern' | 'harbour' | 'townhall' | 'church' | 'governor' | 'warehouse' | 'decor' | 'house' | 'farm' | 'lighthouse';

export interface Building {
  kind: BuildingKind;
  sprite: string;
  gx: number;
  gy: number;
  mesh?: THREE.Mesh;
  rect?: { x0: number; y0: number; x1: number; y1: number };
  label: string;
}

interface SpriteMeta {
  w: number;
  h: number;
  ax: number;
  ay: number;
}

const NATION_DE: Record<string, string> = { Spain: 'spanien', England: 'england', France: 'frankreich', Holland: 'holland' };
/** Production building sprite per good key. */
const FARM_SPRITE: Record<string, string> = {
  Weizen: 'getreidefarm_stufe03', 'Früchte': 'fruechte_stufe03', Holz: 'holzfaeller', Lehmziegel: 'lehmziegel',
  Mais: 'maisfarm_stufe03', Zucker: 'zuckerrohr_stufe03', Baumwolle: 'baumwolle_stufe03', Hanf: 'hanffarm_stufe03',
  Fleisch: 'fleisch', Kleidung: 'kleidung', Seile: 'seilerei', Rum: 'rumbrennerei', Kaffee: 'kaffeefarm_stufe03',
  Kakao: 'kakaofarm_stufe03', Farbstoffe: 'farbstoffe_stufe03', Tabak: 'tabakfarm_stufe03',
};

/** Deterministic PRNG so a town always looks the same. */
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

export function isoX(gx: number, gy: number): number {
  return (gx - gy) * (TW / 2);
}
export function isoY(gx: number, gy: number): number {
  return (gx + gy) * (TH / 2);
}

export class TownView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
  private renderer: THREE.WebGLRenderer;
  private town: TownDef;
  private goods: GoodDef[];
  private heights = new Float32Array(GRID * GRID); // per tile, 0..1
  private terrainMat!: THREE.ShaderMaterial;
  private sprites: Record<string, SpriteMeta> = {};
  private occupied = new Uint8Array(GRID * GRID);
  buildings: Building[] = [];
  private ships: THREE.Mesh[] = [];
  private time = 0;
  cx = 0;
  cy = 0;
  zoom = 1;
  harbourWater: [number, number] = [0, 0];

  constructor(renderer: THREE.WebGLRenderer, town: TownDef, goods: GoodDef[]) {
    this.renderer = renderer;
    this.town = town;
    this.goods = goods;
    this.scene.background = new THREE.Color(0x0d3a5c);
  }

  height(gx: number, gy: number): number {
    const x = Math.max(0, Math.min(GRID - 1, Math.round(gx)));
    const y = Math.max(0, Math.min(GRID - 1, Math.round(gy)));
    return this.heights[y * GRID + x];
  }

  isLand(gx: number, gy: number, margin = 0.04): boolean {
    return this.height(gx, gy) > SEA_LEVEL + margin;
  }

  async load(): Promise<void> {
    const key = this.town.hasTownView ? this.town.key : 'PortRoyale';
    const [img, sprites] = await Promise.all([loadImage(`town/height/${key}.png`), fetchJson<Record<string, SpriteMeta>>('town/sprites.json')]);
    this.sprites = sprites;
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const side = img.width;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const hx = Math.min(side - 1, Math.floor((x * (side - 1)) / (GRID - 1)));
        const hy = Math.min(side - 1, Math.floor((y * (side - 1)) / (GRID - 1)));
        this.heights[y * GRID + x] = px[(hy * side + hx) * 4] / 255;
      }
    }
    const hm = new THREE.DataTexture(new Uint8Array(px.buffer.slice(0)), side, side, THREE.RGBAFormat);
    hm.magFilter = THREE.LinearFilter;
    hm.minFilter = THREE.LinearFilter;
    hm.needsUpdate = true;

    const [sand, grass, grassDry, rock, cobble, water] = await Promise.all([
      texture('town/ground-sand.webp', { repeat: true }),
      texture('town/ground-grass.webp', { repeat: true }),
      texture('town/ground-grass-dry.webp', { repeat: true }),
      texture('town/ground-rock.webp', { repeat: true }),
      texture('town/ground-cobble.webp', { repeat: true }),
      texture('map/water-atlas.webp'),
    ]);
    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        uH: { value: hm },
        uSand: { value: sand },
        uGrass: { value: grass },
        uDry: { value: grassDry },
        uRock: { value: rock },
        uCobble: { value: cobble },
        uWater: { value: water },
        uTime: { value: 0 },
        uSea: { value: SEA_LEVEL },
        uTown: { value: new THREE.Vector3(0, 0, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D uH, uSand, uGrass, uDry, uRock, uCobble, uWater;
        uniform float uTime, uSea;
        uniform vec3 uTown; // grid x, y, radius of paved area
        float H(vec2 uv) { return texture2D(uH, uv).r; }
        void main() {
          vec2 g = vUv * 256.0;          // tile coordinates
          vec2 t = g / 6.0;              // ground textures repeat every 6 tiles
          float h = H(vUv);
          float e = 1.0 / 513.0;
          float dx = H(vUv + vec2(e, 0.0)) - H(vUv - vec2(e, 0.0));
          float dy = H(vUv + vec2(0.0, e)) - H(vUv - vec2(0.0, e));
          // light from the top-left of the screen (grid -x, -y)
          float shade = clamp(1.0 + (-dx - dy) * 7.0, 0.55, 1.35);
          float slope = length(vec2(dx, dy)) * 40.0;
          vec3 sand = texture2D(uSand, t).rgb;
          vec3 grass = mix(texture2D(uGrass, t * 0.9).rgb, texture2D(uDry, t * 1.1).rgb,
                           smoothstep(0.35, 0.75, sin(g.x * 0.05) * sin(g.y * 0.043) * 0.5 + 0.5));
          vec3 rock = texture2D(uRock, t).rgb;
          float land = smoothstep(uSea, uSea + 0.06, h);
          vec3 col = mix(sand, grass, smoothstep(uSea + 0.06, uSea + 0.16, h));
          col = mix(col, rock, smoothstep(0.5, 1.2, slope) * 0.8);
          float paved = 1.0 - smoothstep(uTown.z * 0.7, uTown.z, distance(g, uTown.xy));
          col = mix(col, texture2D(uCobble, t * 1.4).rgb, paved * 0.55 * land);
          col *= shade;
          // water: depth tint + animated waves + surf line
          float depth = clamp((uSea - h) / uSea, 0.0, 1.0);
          vec3 sea = mix(vec3(0.20, 0.55, 0.62), vec3(0.04, 0.20, 0.36), smoothstep(0.0, 0.5, depth));
          vec2 wuv = fract(g / 10.0 + vec2(uTime * 0.01, 0.0));
          float frame = mod(floor(uTime * 8.0), 27.0);
          vec2 cell = vec2(mod(frame, 8.0), floor(frame / 8.0));
          vec4 w = texture2D(uWater, vec2((cell.x + wuv.x) / 8.0, 1.0 - (cell.y + wuv.y) / 4.0));
          sea *= 1.1 - w.a * 1.6;
          float surf = smoothstep(uSea - 0.05, uSea, h) * (1.0 - land);
          sea = mix(sea, vec3(0.85, 0.95, 0.95), surf * (0.55 + 0.45 * sin(uTime * 2.0 + g.x * 0.3 + g.y * 0.2)));
          gl_FragColor = vec4(mix(sea, col, land), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const step = 2;
    const n = GRID / step + 1;
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const gx = i * step, gy = j * step;
        const k = j * n + i;
        pos[k * 3] = isoX(gx, gy);
        pos[k * 3 + 1] = -isoY(gx, gy);
        pos[k * 3 + 2] = 0;
        uv[k * 2] = gx / GRID;
        uv[k * 2 + 1] = gy / GRID;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const terrain = new THREE.Mesh(geo, this.terrainMat);
    terrain.renderOrder = -1e6;
    this.scene.add(terrain);

    this.layout();
    await this.buildSprites();
  }

  // ---- layout -------------------------------------------------------------------------------

  private free(gx: number, gy: number, r: number): boolean {
    for (let y = Math.floor(gy - r); y <= Math.ceil(gy + r); y++) {
      for (let x = Math.floor(gx - r); x <= Math.ceil(gx + r); x++) {
        if (x < 2 || y < 2 || x >= GRID - 2 || y >= GRID - 2) return false;
        if (this.occupied[y * GRID + x]) return false;
        if (!this.isLand(x, y)) return false;
      }
    }
    return true;
  }

  private occupy(gx: number, gy: number, r: number): void {
    for (let y = Math.floor(gy - r); y <= Math.ceil(gy + r); y++) {
      for (let x = Math.floor(gx - r); x <= Math.ceil(gx + r); x++) {
        if (x >= 0 && y >= 0 && x < GRID && y < GRID) this.occupied[y * GRID + x] = 1;
      }
    }
  }

  private footprint(sprite: string): number {
    const m = this.sprites[sprite];
    return m ? Math.max(1, (m.w / TW) * 0.42) : 2;
  }

  /** Try to place a sprite near (gx, gy), searching outward. */
  private place(kind: BuildingKind, sprite: string, gx: number, gy: number, label: string, maxR = 40, rnd?: () => number): Building | null {
    if (!this.sprites[sprite]) return null;
    const r = this.footprint(sprite);
    for (let d = 0; d <= maxR; d += 1) {
      const tries = d === 0 ? 1 : Math.max(8, d * 4);
      const off = rnd ? rnd() * Math.PI * 2 : 0;
      for (let k = 0; k < tries; k++) {
        const a = off + (k / tries) * Math.PI * 2;
        const x = Math.round(gx + Math.cos(a) * d);
        const y = Math.round(gy + Math.sin(a) * d);
        if (this.free(x, y, r)) {
          this.occupy(x, y, r + 0.6);
          const b: Building = { kind, sprite, gx: x, gy: y, label };
          this.buildings.push(b);
          return b;
        }
      }
    }
    return null;
  }

  private layout(): void {
    const rnd = mulberry(this.town.id * 7919 + 17);
    // distance to water for every land tile (BFS)
    const dist = new Int16Array(GRID * GRID).fill(-1);
    const q: number[] = [];
    for (let i = 0; i < GRID * GRID; i++) {
      if (!this.isLand(i % GRID, Math.floor(i / GRID), 0)) {
        dist[i] = 0;
        q.push(i);
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % GRID, y = (i / GRID) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const j = ny * GRID + nx;
        if (dist[j] < 0) {
          dist[j] = dist[i] + 1;
          q.push(j);
        }
      }
    }
    // harbour: coastal land tile closest to the map centre with open water in front
    let hx = GRID / 2, hy = GRID / 2, best = 1e9;
    for (let y = 8; y < GRID - 8; y++) {
      for (let x = 8; x < GRID - 8; x++) {
        if (dist[y * GRID + x] !== 3) continue;
        const d = (x - GRID / 2) ** 2 + (y - GRID / 2) ** 2;
        if (d < best) {
          best = d;
          hx = x;
          hy = y;
        }
      }
    }
    // inland direction: towards increasing distance from water
    let ix = 0, iy = 0;
    for (let y = -6; y <= 6; y++) {
      for (let x = -6; x <= 6; x++) {
        const xx = hx + x, yy = hy + y;
        if (xx < 0 || yy < 0 || xx >= GRID || yy >= GRID) continue;
        const d = dist[yy * GRID + xx];
        ix += x * d;
        iy += y * d;
      }
    }
    const il = Math.hypot(ix, iy) || 1;
    ix /= il;
    iy /= il;
    // water spot in front of the harbour for docked ships
    this.harbourWater = [hx - ix * 9, hy - iy * 9];
    const nat = NATION_DE[this.town.nation];
    const at = (k: number) => [hx + ix * k, hy + iy * k] as const;

    // the dock faces the water: pick the iso variant whose orientation matches
    const dockFacing = Math.abs(ix) > Math.abs(iy) ? (ix > 0 ? 'hafendock_sw' : 'hafendock_so') : iy > 0 ? 'hafendock_so' : 'hafendock_sw';
    this.place('harbour', dockFacing, hx, hy, 'Harbour', 6);
    const [mx, my] = at(12);
    this.terrainCentre = [mx, my];
    this.place('market', 'markt07', mx, my, 'Market', 6);
    for (let i = 0; i < 4; i++) this.place('market', `marktstand_${i}`, mx + (rnd() - 0.5) * 8, my + (rnd() - 0.5) * 8, 'Market', 6, rnd);
    this.place('townhall', `stadtverwaltung_${nat}`, mx + iy * 10 + ix * 4, my - ix * 10 + iy * 4, 'Town hall', 14, rnd);
    this.place('church', `kirche_${nat}`, mx - iy * 12 + ix * 8, my + ix * 12 + iy * 8, 'Church', 16, rnd);
    this.place('tavern', 'kneipe', hx + iy * 8 + ix * 5, hy - ix * 8 + iy * 5, 'Tavern', 12, rnd);
    this.place('warehouse', 'lagerhaus', hx - iy * 7 + ix * 4, hy + ix * 7 + iy * 4, 'Warehouse', 12, rnd);
    // shipyard on the shore a little along the coast
    let yard: Building | null = null;
    for (let d = 12; d < 60 && !yard; d += 3) {
      for (const sgn of [1, -1]) {
        const x = hx + iy * d * sgn, y = hy - ix * d * sgn;
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= GRID || yi >= GRID) continue;
        const dw = dist[yi * GRID + xi];
        if (dw >= 2 && dw <= 6) {
          yard = this.place('shipyard', 'werft_gr_sw', x, y, 'Shipyard', 3);
          if (yard) break;
        }
      }
    }
    if (!yard) this.place('shipyard', 'werft_gr_sw', hx + iy * 14, hy - ix * 14, 'Shipyard', 30, rnd);
    if (this.town.rank !== 'colony') this.place('governor', `gouverneur_${nat}`, mx + ix * 16, my + iy * 16, "Governor's palace", 18, rnd);
    this.place('decor', 'spital', mx + ix * 22 - iy * 6, my + iy * 22 + ix * 6, 'Hospital', 18, rnd);
    this.place('decor', 'schule', mx + ix * 20 + iy * 10, my + iy * 20 - ix * 10, 'School', 18, rnd);
    // houses around the centre
    const houses = Math.min(46, Math.round(14 + this.town.id % 7 + (this.town.rank === 'viceroy' ? 24 : this.town.rank === 'governor' ? 14 : 4)));
    for (let i = 0; i < houses; i++) {
      const lvl = 1 + Math.min(4, Math.floor(rnd() * (this.town.rank === 'colony' ? 3 : 5)));
      const variant = rnd() < 0.7 ? 'a' : 'b';
      let sprite = `wohnhaus_stufe0${lvl}_${nat}_${variant}`;
      if (!this.sprites[sprite]) sprite = `wohnhaus_stufe0${lvl}_${nat}_a`;
      const a = rnd() * Math.PI * 2;
      const r = 10 + rnd() * 22;
      this.place('house', sprite, mx + Math.cos(a) * r + ix * 6, my + Math.sin(a) * r + iy * 6, 'Residence', 10, rnd);
    }
    // production outside the town
    for (const g of this.town.produces) {
      const good = this.goods[g];
      const sprite = FARM_SPRITE[good.key];
      if (!sprite) continue;
      for (let k = 0; k < 2; k++) {
        const a = rnd() * Math.PI * 2;
        const r = 36 + rnd() * 30;
        this.place('farm', sprite, mx + Math.cos(a) * r + ix * 20, my + Math.sin(a) * r + iy * 20, `${good.name} production`, 20, rnd);
      }
    }
    // lighthouse on a far point of the coast
    for (let tries = 0; tries < 200; tries++) {
      const x = Math.floor(rnd() * GRID), y = Math.floor(rnd() * GRID);
      const d = dist[y * GRID + x];
      if (d === 3 && Math.hypot(x - hx, y - hy) > 35 && Math.hypot(x - hx, y - hy) < 80) {
        if (this.place('lighthouse', 'leuchtturm', x, y, 'Lighthouse', 2)) break;
      }
    }
    // vegetation and clutter
    const flora = ['fruechte_bananenpalme_a', 'fruechte_bananenpalme_b', 'bananenpalme_busch01', 'bananenpalme_busch02', 'busch01', 'busch03', 'busch05', 'busch07', 'busch09', 'busch11', 'fruechte_orangenbaum_a', 'fels01', 'fels03', 'kaktus01'];
    for (let i = 0; i < 900; i++) {
      const x = 4 + rnd() * (GRID - 8), y = 4 + rnd() * (GRID - 8);
      const dw = dist[Math.floor(y) * GRID + Math.floor(x)];
      if (dw < 2) continue;
      if (Math.hypot(x - mx, y - my) < 16) continue;
      const s = flora[Math.floor(rnd() * flora.length)];
      const r = this.footprint(s);
      if (this.free(x, y, r)) {
        this.occupy(x, y, r);
        this.buildings.push({ kind: 'decor', sprite: s, gx: x, gy: y, label: '' });
      }
    }
    for (const s of ['faesser01_1x1', 'kisten02_1x1', 'ballen01_1x1', 'holzstapel01_1x1', 'wagen01_1x2']) {
      this.place('decor', s, hx + ix * 4 + (rnd() - 0.5) * 10, hy + iy * 4 + (rnd() - 0.5) * 10, '', 8, rnd);
    }
    this.terrainMat.uniforms.uTown.value.set(mx, my, 20);
  }

  terrainCentre: [number, number] = [GRID / 2, GRID / 2];

  private async buildSprites(): Promise<void> {
    const mats = new Map<string, THREE.MeshBasicMaterial>();
    await Promise.all(
      [...new Set(this.buildings.map((b) => b.sprite))].map(async (s) => {
        const t = await texture(`town/${s}.webp`);
        mats.set(s, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
      }),
    );
    for (const b of this.buildings) {
      const m = this.sprites[b.sprite];
      const mat = mats.get(b.sprite);
      if (!m || !mat) continue;
      const sx = isoX(b.gx, b.gy), sy = isoY(b.gx, b.gy);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m.w, m.h), mat);
      const x0 = sx - m.ax, y0 = sy - m.ay;
      mesh.position.set(x0 + m.w / 2, -(y0 + m.h / 2), 0);
      mesh.renderOrder = sy;
      b.mesh = mesh;
      b.rect = { x0: x0 + m.w * 0.12, y0: y0 + m.h * 0.12, x1: x0 + m.w * 0.88, y1: y0 + m.h };
      this.scene.add(mesh);
    }
    const [mx, my] = this.terrainCentre;
    this.cx = isoX(mx, my);
    this.cy = isoY(mx, my) - 60;
  }

  /** Show docked ships (sea-map sprites) in front of the harbour. */
  async setShips(types: number[]): Promise<void> {
    for (const m of this.ships) this.scene.remove(m);
    this.ships = [];
    const [wx, wy] = this.harbourWater;
    let i = 0;
    for (const type of types.slice(0, 6)) {
      const t = await texture(`ships/${String(type).padStart(2, '0')}.webp`);
      const geo = new THREE.PlaneGeometry(150, 150);
      // frame 4: bow towards the lower right, a nice "moored" view
      const s = 100 / 512, col = 0, row = 1;
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      uv.setXY(0, col * s, 1 - row * s);
      uv.setXY(1, (col + 1) * s, 1 - row * s);
      uv.setXY(2, col * s, 1 - (row + 1) * s);
      uv.setXY(3, (col + 1) * s, 1 - (row + 1) * s);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false }));
      const gx = wx + (i % 3) * 5 - 5, gy = wy + Math.floor(i / 3) * 6;
      m.position.set(isoX(gx, gy), -isoY(gx, gy) + 30, 0);
      m.renderOrder = isoY(gx, gy);
      this.scene.add(m);
      this.ships.push(m);
      i++;
    }
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const c = this.renderer.domElement;
    return [this.cx + (sx - c.clientWidth / 2) / this.zoom, this.cy + (sy - c.clientHeight / 2) / this.zoom];
  }

  worldToScreen(x: number, y: number): [number, number] {
    const c = this.renderer.domElement;
    return [(x - this.cx) * this.zoom + c.clientWidth / 2, (y - this.cy) * this.zoom + c.clientHeight / 2];
  }

  pickBuilding(sx: number, sy: number): Building | null {
    const [x, y] = this.screenToWorld(sx, sy);
    let best: Building | null = null;
    for (const b of this.buildings) {
      if (!b.rect || !b.label) continue;
      const r = b.rect;
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) {
        if (!best || (b.mesh!.renderOrder > best.mesh!.renderOrder)) best = b;
      }
    }
    return best;
  }

  highlight(b: Building | null): void {
    for (const x of this.buildings) {
      if (!x.mesh) continue;
      (x.mesh.material as THREE.MeshBasicMaterial).color.setScalar(1);
    }
    if (b?.mesh) {
      // tint just this mesh: give it its own material instance
      const m = (b.mesh.material as THREE.MeshBasicMaterial).clone();
      m.color.setRGB(1.25, 1.2, 1.05);
      b.mesh.material = m;
    }
  }

  clampCamera(): void {
    const c = this.renderer.domElement;
    this.zoom = Math.max(0.45, Math.min(1.6, this.zoom));
    const hw = c.clientWidth / this.zoom / 2;
    const hh = c.clientHeight / this.zoom / 2;
    const minX = isoX(0, GRID) + hw, maxX = isoX(GRID, 0) - hw;
    const minY = hh, maxY = isoY(GRID, GRID) - hh;
    this.cx = Math.max(minX, Math.min(maxX, this.cx));
    this.cy = Math.max(minY, Math.min(maxY, this.cy));
  }

  render(dt: number): void {
    this.time += dt;
    if (this.terrainMat) this.terrainMat.uniforms.uTime.value = this.time;
    this.clampCamera();
    const c = this.renderer.domElement;
    const hw = c.clientWidth / this.zoom / 2;
    const hh = c.clientHeight / this.zoom / 2;
    this.camera.left = this.cx - hw;
    this.camera.right = this.cx + hw;
    this.camera.top = -this.cy + hh;
    this.camera.bottom = -this.cy - hh;
    this.camera.updateProjectionMatrix();
    for (const [i, s] of this.ships.entries()) s.position.y += Math.sin(this.time * 1.3 + i) * 0.05;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

