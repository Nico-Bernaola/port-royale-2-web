/**
 * Procedural low-poly sailing ships. Local axes: +X = bow, +Y = up, +Z = starboard.
 * A map heading θ (0 = east, clockwise on screen) maps to rotation.y = -θ.
 */
import * as THREE from 'three';
import { drawFlag } from '../assets.ts';
import { ships as shipClasses } from '../data/world.ts';

interface ShipStyle {
  length: number;
  beam: number;
  masts: number[]; // mast heights as a fraction of length
  rig: 'square' | 'foreaft' | 'mixed';
  castle: number; // stern castle height (0 = none)
  forecastle: number;
  hull: number; // hull colour
  stripe: number; // gunport band colour
  sail: number;
  gunDecks: number;
}

const STYLES: Record<string, ShipStyle> = {
  pinnace: { length: 24, beam: 6.5, masts: [0.95, 0.75], rig: 'mixed', castle: 0, forecastle: 0, hull: 0x7a4b25, stripe: 0x3a2412, sail: 0xf2ead7, gunDecks: 1 },
  sloop: { length: 24, beam: 7, masts: [1.15], rig: 'foreaft', castle: 0, forecastle: 0, hull: 0x6f4422, stripe: 0x2a2a2a, sail: 0xf4eedf, gunDecks: 1 },
  brig: { length: 32, beam: 8.5, masts: [1.0, 1.05], rig: 'square', castle: 0, forecastle: 0, hull: 0x5e3a1d, stripe: 0x111111, sail: 0xf1e8d2, gunDecks: 1 },
  barque: { length: 34, beam: 9, masts: [0.95, 1.05, 0.85], rig: 'mixed', castle: 1.5, forecastle: 0, hull: 0x6a4120, stripe: 0x2b1a0c, sail: 0xefe5cc, gunDecks: 1 },
  raider: { length: 34, beam: 8.5, masts: [0.95, 1.05, 0.85], rig: 'square', castle: 1.2, forecastle: 0, hull: 0x2b2420, stripe: 0x8a1c14, sail: 0x3b3632, gunDecks: 1 },
  fluyt: { length: 40, beam: 10.5, masts: [0.85, 0.95, 0.7], rig: 'mixed', castle: 3, forecastle: 1, hull: 0x7b5126, stripe: 0x2f5a2a, sail: 0xf0e4c8, gunDecks: 1 },
  merchantman: { length: 48, beam: 12.5, masts: [0.85, 0.95, 0.72], rig: 'mixed', castle: 3.6, forecastle: 1.4, hull: 0x6b4622, stripe: 0x24334f, sail: 0xeee2c4, gunDecks: 1 },
  corvette: { length: 42, beam: 10, masts: [1.0, 1.08, 0.9], rig: 'square', castle: 1, forecastle: 0, hull: 0x3f2d1c, stripe: 0xd7c08a, sail: 0xf5efe0, gunDecks: 1 },
  frigate: { length: 50, beam: 12, masts: [1.0, 1.1, 0.9], rig: 'square', castle: 1.6, forecastle: 0.8, hull: 0x33261a, stripe: 0xe0c27a, sail: 0xf6f0e2, gunDecks: 1 },
  galleon: { length: 54, beam: 14, masts: [0.85, 0.95, 0.72, 0.6], rig: 'mixed', castle: 6, forecastle: 3, hull: 0x7a3d1c, stripe: 0xc9a14a, sail: 0xeadcbc, gunDecks: 2 },
  manofwar: { length: 62, beam: 15, masts: [1.0, 1.1, 0.88], rig: 'square', castle: 4, forecastle: 1.5, hull: 0x2b2017, stripe: 0xd9b964, sail: 0xf7f1e4, gunDecks: 2 },
};

const NATION_FLAG = ['spain', 'england', 'france', 'holland', 'pirate'] as const;

function flagTexture(kind: string): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(drawFlag(kind));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Lofted hull: cross-sections along the keel, vertex-coloured hull, gunport band and deck. */
function hullGeometry(st: ShipStyle): THREE.BufferGeometry {
  const L = st.length, B = st.beam;
  const N = 12;
  const pos: number[] = [];
  const col: number[] = [];
  const hullC = new THREE.Color(st.hull), stripeC = new THREE.Color(st.stripe), deckC = new THREE.Color(0xb48a55), bottomC = new THREE.Color(0x3a2a1c);
  const section = (t: number) => {
    // t: 0 = stern, 1 = bow
    const x = (t - 0.5) * L;
    const bowTaper = t > 0.7 ? 1 - Math.pow((t - 0.7) / 0.3, 1.6) * 0.95 : 1;
    const sternTaper = t < 0.12 ? 0.78 + (t / 0.12) * 0.22 : 1;
    const half = (B / 2) * bowTaper * sternTaper;
    const sheer = 2.2 + Math.pow(Math.abs(t - 0.45) * 2, 2) * 1.8; // deck rises fore and aft
    const depth = 3.2 * (0.6 + 0.4 * Math.min(bowTaper, 1));
    return { x, half, top: sheer, bottom: -depth };
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < N; i++) {
    const s0 = section(i / N), s1 = section((i + 1) / N);
    for (const side of [1, -1]) {
      const z0 = s0.half * side, z1 = s1.half * side;
      const band = 0.62; // where the gunport stripe sits (fraction of hull height above waterline)
      const mid0 = s0.top * band, mid1 = s1.top * band;
      const w0 = z0 * 0.92, w1 = z1 * 0.92; // slight tumblehome
      const order = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) =>
        side > 0 ? quad(a, b, c, d, color) : quad(a, d, c, b, color);
      // lower hull (to the keel)
      order([s0.x, s0.bottom, 0], [s1.x, s1.bottom, 0], [s1.x, 0, z1], [s0.x, 0, z0], bottomC);
      order([s0.x, 0, z0], [s1.x, 0, z1], [s1.x, mid1, z1], [s0.x, mid0, z0], hullC);
      order([s0.x, mid0, z0], [s1.x, mid1, z1], [s1.x, mid1 + 0.9, z1 * 0.98], [s0.x, mid0 + 0.9, z0 * 0.98], stripeC);
      order([s0.x, mid0 + 0.9, z0 * 0.98], [s1.x, mid1 + 0.9, z1 * 0.98], [s1.x, s1.top, w1], [s0.x, s0.top, w0], hullC);
    }
    // deck
    quad([s0.x, s0.top - 0.15, s0.half * 0.92], [s0.x, s0.top - 0.15, -s0.half * 0.92], [s1.x, s1.top - 0.15, -s1.half * 0.92], [s1.x, s1.top - 0.15, s1.half * 0.92], deckC);
  }
  // transom
  const s = section(0);
  quad([s.x, s.bottom, 0], [s.x, s.top, s.half * 0.92], [s.x, s.top, -s.half * 0.92], [s.x, s.bottom, 0], hullC);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A square sail billowing forward. */
function squareSail(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 4, 3);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const bulge = (1 - (x / (w / 2)) ** 2) * (1 - (y / (h / 2)) ** 2 * 0.6) * w * 0.14;
    // plane lies in XY; rotate so it spans Z (across the ship) and billows towards +X (bow)
    p.setXYZ(i, bulge, y, x);
  }
  g.computeVertexNormals();
  return g;
}

/** A fore-and-aft (gaff/lateen-like) triangular sail in the ship's centre plane. */
function triSail(len: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const v = [0, 0, 0, -len, 0, 0, 0, h, 0, -len, 0, 0, -len * 0.25, h * 0.95, 0.6, 0, h, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

/**
 * Build a ship model. `nation` 0-3 = Spain/England/France/Holland, 4 = pirates.
 * Returns a Group sized in world units of roughly `style.length` long.
 */
export function makeShip(classKey: string, nation: number): THREE.Group {
  const st = STYLES[classKey] ?? STYLES.brig;
  const group = new THREE.Group();
  let hg = geoCache.get(classKey);
  if (!hg) {
    hg = hullGeometry(st);
    geoCache.set(classKey, hg);
  }
  const hull = new THREE.Mesh(hg, mat('hull', () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })));
  hull.castShadow = true;
  group.add(hull);
  const wood = mat('wood', () => new THREE.MeshStandardMaterial({ color: 0x5a3a1e, flatShading: true, roughness: 0.9 }));
  const L = st.length;
  // castles
  if (st.castle > 0) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(L * 0.2, st.castle, st.beam * 0.8), mat(`castle${st.hull}`, () => new THREE.MeshStandardMaterial({ color: st.hull, flatShading: true })));
    c.position.set(-L * 0.38, 3.6 + st.castle / 2, 0);
    group.add(c);
  }
  if (st.forecastle > 0) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(L * 0.12, st.forecastle, st.beam * 0.55), mat(`castle${st.hull}`, () => new THREE.MeshStandardMaterial({ color: st.hull, flatShading: true })));
    c.position.set(L * 0.32, 3.4 + st.forecastle / 2, 0);
    group.add(c);
  }
  // bowsprit
  const bs = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, L * 0.32, 5), wood);
  bs.rotation.z = -Math.PI / 2 + 0.3;
  bs.position.set(L * 0.58, 4.2, 0);
  group.add(bs);

  const sailMat = mat(`sail${st.sail}`, () => new THREE.MeshStandardMaterial({ color: st.sail, side: THREE.DoubleSide, flatShading: true, roughness: 1 }));
  const n = st.masts.length;
  let tallest = 0;
  st.masts.forEach((frac, i) => {
    const x = n === 1 ? L * 0.05 : (0.3 - (i / (n - 1)) * 0.62) * L;
    const h = frac * L;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, h, 6), wood);
    mast.position.set(x, 2 + h / 2, 0);
    group.add(mast);
    if (h > tallest) tallest = h;
    const isLast = i === n - 1;
    const foreAft = st.rig === 'foreaft' || (st.rig === 'mixed' && isLast && n > 1);
    if (foreAft) {
      const s = new THREE.Mesh(triSail(L * 0.45, h * 0.8), sailMat);
      s.position.set(x, 3.2, 0);
      group.add(s);
      if (st.rig === 'foreaft') {
        const jib = new THREE.Mesh(triSail(L * 0.42, h * 0.7), sailMat);
        jib.rotation.y = Math.PI;
        jib.position.set(x + 1, 3, 0);
        group.add(jib);
      }
    } else {
      const tiers = h > L * 0.9 ? 3 : 2;
      for (let k = 0; k < tiers; k++) {
        const sw = st.beam * (1.9 - k * 0.42);
        const sh = (h * 0.8) / tiers;
        const y = 4 + k * sh * 1.02 + sh / 2;
        const s = new THREE.Mesh(squareSail(sw, sh * 0.95), sailMat);
        s.position.set(x + 0.6, y, 0);
        group.add(s);
        const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, sw * 1.05, 4), wood);
        yard.rotation.x = Math.PI / 2;
        yard.position.set(x + 0.2, y + sh / 2, 0);
        group.add(yard);
      }
    }
  });
  // flag on the tallest mast
  const kind = NATION_FLAG[Math.max(0, Math.min(4, nation))];
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 2.8),
    mat(`flag-${kind}`, () => new THREE.MeshBasicMaterial({ map: flagTexture(kind), side: THREE.DoubleSide })),
  );
  flag.position.set(st.masts.length > 1 ? (0.3 - (1 / (n - 1)) * 0.62) * L - 2.4 : L * 0.05 - 2.4, 2 + tallest + 1.2, 0);
  flag.rotation.y = Math.PI / 2;
  flag.name = 'flag';
  group.add(flag);
  group.userData.length = L;
  return group;
}

export function shipLength(classKey: string): number {
  return (STYLES[classKey] ?? STYLES.brig).length;
}

let thumbRenderer: THREE.WebGLRenderer | null = null;
const thumbs = new Map<number, Promise<string>>();

/** A small three-quarter portrait of a ship class, rendered once and cached as a data URL. */
export function shipThumbnail(type: number): Promise<string> {
  let p = thumbs.get(type);
  if (!p) {
    p = new Promise((resolve) => {
      if (!thumbRenderer) {
        thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        thumbRenderer.setSize(200, 150);
      }
      const key = shipClasses[type]?.key ?? 'brig';
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
      sun.position.set(40, 80, 60);
      scene.add(sun, new THREE.HemisphereLight(0xdfeeff, 0x6b5a40, 1.2));
      const ship = makeShip(key, 1);
      scene.add(ship);
      const L = ship.userData.length as number;
      const cam = new THREE.PerspectiveCamera(30, 200 / 150, 1, 1000);
      cam.position.set(L * 1.2, L * 0.7, L * 1.55);
      cam.lookAt(0, L * 0.35, 0);
      thumbRenderer.render(scene, cam);
      resolve(thumbRenderer.domElement.toDataURL());
    });
    thumbs.set(type, p);
  }
  return p;
}
