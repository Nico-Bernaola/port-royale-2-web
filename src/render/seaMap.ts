/**
 * The sea map: the original painted Caribbean (20x15 tiles), an animated sea underneath it
 * (sea colour map + the game's water animation frames), convoys drawn with the 16-heading
 * ship sprite sheets, routes, clouds, and HTML town labels.
 *
 * World units are map pixels with y pointing down; three.js coordinates are (x, -y).
 */
import * as THREE from 'three';
import { asset, fetchJson, flagUrl, texture } from '../assets.ts';
import { CvState, Owner } from '../core/core.ts';
import type { Session } from '../game/session.ts';
import { h, labelRoot } from '../ui/dom.ts';

const SPRITE_CELL = 100; // px per heading cell in the ship sheets
const SHIP_SIZE = 100; // sheets are drawn 1:1 on the map, like the original

/** Sprite frame for a heading (radians, 0 = east, clockwise on screen). See README. */
export function headingFrame(heading: number): number {
  const step = Math.PI / 8;
  let i = Math.round(heading / step) + 2;
  i = ((i % 16) + 16) % 16;
  return i;
}

export function frameUv(frame: number): [number, number, number, number] {
  const col = frame % 4;
  const row = Math.floor(frame / 4);
  const s = SPRITE_CELL / 512;
  // texture v runs bottom-up
  return [col * s, 1 - (row + 1) * s, (col + 1) * s, 1 - row * s];
}

interface ShipSprite {
  mesh: THREE.Mesh;
  geo: THREE.PlaneGeometry;
  type: number;
  frame: number;
}

export interface MapPick {
  kind: 'convoy' | 'town' | 'sea';
  id: number;
  x: number;
  y: number;
}

export class SeaMapView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  private session: Session;
  private renderer: THREE.WebGLRenderer;
  private seaMat!: THREE.ShaderMaterial;
  private shipMats = new Map<number, THREE.MeshBasicMaterial>();
  /** largest opaque extent of each sheet's sprites (px), from the extractor */
  private extents: Record<string, number> = {};
  private sprites = new Map<number, ShipSprite>();
  private routeLine: THREE.Line;
  private selRing: THREE.Mesh;
  private targetMarker: THREE.Mesh;
  private clouds: THREE.Mesh[] = [];
  private labels: HTMLElement[] = [];
  private time = 0;
  /** camera centre (map px) and zoom (screen px per map px) */
  cx = 2600;
  cy = 1900;
  zoom = 0.6;
  readonly mapW: number;
  readonly mapH: number;
  visible = false;

  constructor(renderer: THREE.WebGLRenderer, session: Session) {
    this.renderer = renderer;
    this.session = session;
    this.mapW = session.data.map.width;
    this.mapH = session.data.map.height;
    this.scene.background = new THREE.Color(0x0a2a47);

    const routeGeo = new THREE.BufferGeometry();
    routeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 100), 3));
    this.routeLine = new THREE.Line(
      routeGeo,
      new THREE.LineDashedMaterial({ color: 0xffe9a8, dashSize: 10, gapSize: 7, transparent: true, opacity: 0.9 }),
    );
    this.routeLine.renderOrder = 20;
    this.scene.add(this.routeLine);

    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(30, 34, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.85 }),
    );
    this.selRing.renderOrder = 21;
    this.selRing.visible = false;
    this.scene.add(this.selRing);

    this.targetMarker = new THREE.Mesh(
      new THREE.RingGeometry(6, 9, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }),
    );
    this.targetMarker.renderOrder = 21;
    this.targetMarker.visible = false;
    this.scene.add(this.targetMarker);
  }

  async load(onProgress: (k: number) => void): Promise<void> {
    const [shading, water, tiles] = await Promise.all([
      texture('map/sea-shading.webp'),
      texture('map/water-atlas.webp'),
      fetchJson<string[]>('map/tiles.json'),
    ]);
    const atlas = await fetchJson<{ frames: number; cols: number; size: number }>('map/water-atlas.json');
    this.extents = await fetchJson<Record<string, number>>('ships/extents.json').catch(() => ({}));
    water.wrapS = water.wrapT = THREE.ClampToEdgeWrapping;
    water.minFilter = THREE.LinearFilter;
    water.generateMipmaps = false;
    this.seaMat = new THREE.ShaderMaterial({
      uniforms: {
        uShading: { value: shading },
        uWater: { value: water },
        uFrame: { value: 0 },
        uFrames: { value: atlas.frames },
        uCols: { value: atlas.cols },
        uRows: { value: Math.ceil(atlas.frames / atlas.cols) },
        uMap: { value: new THREE.Vector2(this.mapW, this.mapH) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec2 vWorld;
        uniform vec2 uMap;
        void main() {
          vUv = uv;
          vWorld = vec2(uv.x, 1.0 - uv.y) * uMap;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec2 vWorld;
        uniform sampler2D uShading;
        uniform sampler2D uWater;
        uniform float uFrame, uFrames, uCols, uRows, uTime;
        vec4 waterAt(vec2 p, float frame) {
          vec2 cell = vec2(mod(frame, uCols), floor(frame / uCols));
          vec2 f = fract(p / 128.0) * (126.0 / 128.0) + 1.0 / 128.0;
          vec2 uv = (cell + f) / vec2(uCols, uRows);
          uv.y = 1.0 - uv.y;
          return texture2D(uWater, uv);
        }
        void main() {
          vec3 sea = texture2D(uShading, vUv).rgb;
          float f0 = floor(uFrame);
          float k = uFrame - f0;
          vec4 a = waterAt(vWorld, f0);
          vec4 b = waterAt(vWorld, mod(f0 + 1.0, uFrames));
          vec4 w = mix(a, b, k);
          vec4 w2 = waterAt(vWorld * 0.37 + vec2(uTime * 3.0, uTime * 1.7), mod(f0 + 9.0, uFrames));
          float wave = w.a * 2.2 + w2.a * 0.9;
          vec3 col = sea * (1.12 - wave * 0.55);
          // sparkle on wave crests
          col += vec3(0.10, 0.13, 0.15) * smoothstep(0.08, 0.02, w.a) * (0.5 + 0.5 * sin(uTime * 2.0 + vWorld.x * 0.05));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(this.mapW, this.mapH), this.seaMat);
    sea.position.set(this.mapW / 2, -this.mapH / 2, 0);
    sea.renderOrder = 0;
    this.scene.add(sea);

    // land tiles
    const geo = new THREE.PlaneGeometry(256, 256);
    let done = 0;
    await Promise.all(
      tiles.map(async (key) => {
        const [x, y] = key.split('_').map(Number);
        const tex = await texture(`map/tiles/${key}.webp`);
        tex.anisotropy = 8;
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        m.position.set(x * 256 + 128, -(y * 256 + 128), 1);
        m.renderOrder = 1;
        this.scene.add(m);
        onProgress(++done / tiles.length);
      }),
    );

    // drifting clouds
    const cloudTex = await Promise.all(['map/wolke01.webp', 'map/wolke03.webp', 'map/wolke05.webp'].map((p) => texture(p)));
    for (let i = 0; i < 9; i++) {
      const t = cloudTex[i % cloudTex.length];
      const img = t.image as HTMLImageElement;
      const s = 2.2 + Math.random() * 1.6;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(img.width * s, img.height * s),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      m.position.set(Math.random() * this.mapW, -Math.random() * this.mapH, 30);
      m.renderOrder = 30;
      this.clouds.push(m);
      this.scene.add(m);
    }

    this.buildLabels();
  }

  private shipMaterial(type: number): THREE.MeshBasicMaterial {
    let m = this.shipMats.get(type);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, alphaTest: 0.02 });
      const mat = m;
      void texture(`ships/${String(type).padStart(2, '0')}.webp`).then((t) => {
        mat.map = t;
        mat.needsUpdate = true;
      });
      this.shipMats.set(type, m);
    }
    return m;
  }

  private buildLabels(): void {
    const root = labelRoot();
    for (const t of this.session.data.towns) {
      const el = h(
        'div',
        { class: `town-label ${t.rank !== 'colony' ? 'capital' : ''}`, 'data-town': t.id },
        h('img', { src: flagUrl(t.nation), alt: '' }),
        t.name,
      );
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onTownClick?.(t.id, (e as PointerEvent).button);
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      root.append(el);
      this.labels.push(el);
    }
  }

  onTownClick: ((town: number, button: number) => void) | null = null;

  setVisible(v: boolean): void {
    this.visible = v;
    for (const l of this.labels) l.style.display = v ? '' : 'none';
  }

  // ---- camera -----------------------------------------------------------------------------

  private viewport(): { w: number; h: number } {
    const c = this.renderer.domElement;
    return { w: c.clientWidth, h: c.clientHeight };
  }

  clampCamera(): void {
    const { w, h: hh } = this.viewport();
    const minZoom = Math.max(w / this.mapW, hh / this.mapH) * 0.98;
    this.zoom = Math.max(minZoom, Math.min(2.5, this.zoom));
    const hw = w / this.zoom / 2;
    const hh2 = hh / this.zoom / 2;
    this.cx = Math.max(hw, Math.min(this.mapW - hw, this.cx));
    this.cy = Math.max(hh2, Math.min(this.mapH - hh2, this.cy));
  }

  screenToMap(sx: number, sy: number): [number, number] {
    const { w, h: hh } = this.viewport();
    return [this.cx + (sx - w / 2) / this.zoom, this.cy + (sy - hh / 2) / this.zoom];
  }

  mapToScreen(x: number, y: number): [number, number] {
    const { w, h: hh } = this.viewport();
    return [(x - this.cx) * this.zoom + w / 2, (y - this.cy) * this.zoom + hh / 2];
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const [mx, my] = this.screenToMap(sx, sy);
    this.zoom *= factor;
    this.clampCamera();
    const [mx2, my2] = this.screenToMap(sx, sy);
    this.cx += mx - mx2;
    this.cy += my - my2;
    this.clampCamera();
  }

  centerOn(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    this.clampCamera();
  }

  // ---- picking ------------------------------------------------------------------------------

  pick(sx: number, sy: number): MapPick {
    const [x, y] = this.screenToMap(sx, sy);
    const core = this.session.core;
    const s = core.s;
    let best = -1;
    let bd = (36 / Math.min(1, this.zoom)) ** 2;
    for (let c = 0; c < core.MAX_CONVOYS; c++) {
      const st = s.cvState[c];
      if (st === CvState.Free || st === CvState.Docked) continue;
      const d = (s.cvX[c] - x) ** 2 + (s.cvY[c] - y) ** 2;
      // prefer the player's own convoys
      const bias = s.cvOwner[c] === Owner.Player ? 0.5 : 1;
      if (d * bias < bd) {
        bd = d * bias;
        best = c;
      }
    }
    if (best >= 0) return { kind: 'convoy', id: best, x, y };
    for (const t of this.session.data.towns) {
      if ((t.x - x) ** 2 + (t.y - y) ** 2 < (24 / Math.min(1, this.zoom)) ** 2) return { kind: 'town', id: t.id, x, y };
    }
    return { kind: 'sea', id: -1, x, y };
  }

  // ---- per-frame --------------------------------------------------------------------------

  private syncShips(): void {
    const core = this.session.core;
    const s = core.s;
    const seen = new Set<number>();
    for (let c = 0; c < core.MAX_CONVOYS; c++) {
      const st = s.cvState[c];
      if (st === CvState.Free || st === CvState.Docked) continue;
      const type = this.session.flagshipType(c);
      if (type < 0) continue;
      seen.add(c);
      let sp = this.sprites.get(c);
      if (!sp || sp.type !== type) {
        if (sp) this.scene.remove(sp.mesh);
        const geo = new THREE.PlaneGeometry(SHIP_SIZE, SHIP_SIZE);
        const mesh = new THREE.Mesh(geo, this.shipMaterial(type));
        mesh.renderOrder = 10;
        this.scene.add(mesh);
        sp = { mesh, geo, type, frame: -1 };
        this.sprites.set(c, sp);
      }
      const frame = headingFrame(s.cvHeading[c]);
      if (frame !== sp.frame) {
        sp.frame = frame;
        const [u0, v0, u1, v1] = frameUv(frame);
        const uv = sp.geo.attributes.uv as THREE.BufferAttribute;
        // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right
        uv.setXY(0, u0, v1);
        uv.setXY(1, u1, v1);
        uv.setXY(2, u0, v0);
        uv.setXY(3, u1, v0);
        uv.needsUpdate = true;
      }
      // gentle bobbing; small hulls are drawn a little larger, and everything stays readable
      // when zoomed out
      const ext = this.extents[String(type)] ?? 70;
      const scale = Math.max(1, 62 / ext) * Math.max(1, 0.55 / this.zoom);
      sp.mesh.scale.setScalar(scale);
      const bob = Math.sin(this.time * 1.6 + c) * 1.2;
      sp.mesh.position.set(s.cvX[c], -s.cvY[c] + 14 * scale + bob, 10 + (s.cvY[c] / this.mapH));
    }
    for (const [c, sp] of this.sprites) {
      if (!seen.has(c)) {
        this.scene.remove(sp.mesh);
        sp.geo.dispose();
        this.sprites.delete(c);
      }
    }
  }

  private syncSelection(): void {
    const core = this.session.core;
    const s = core.s;
    const c = this.session.selected;
    const show = this.session.isPlayerConvoy(c);
    this.selRing.visible = show && s.cvState[c] !== CvState.Docked;
    this.routeLine.visible = false;
    this.targetMarker.visible = false;
    if (!show) return;
    const scale = Math.max(1, 0.55 / this.zoom);
    this.selRing.scale.setScalar(scale);
    this.selRing.position.set(s.cvX[c], -s.cvY[c], 9);
    const path = core.path(c);
    if (s.cvState[c] === CvState.Sailing && path.length) {
      const pos = this.routeLine.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, s.cvX[c], -s.cvY[c], 8);
      path.slice(0, 99).forEach(([x, y], i) => pos.setXYZ(i + 1, x, -y, 8));
      this.routeLine.geometry.setDrawRange(0, Math.min(100, path.length + 1));
      pos.needsUpdate = true;
      this.routeLine.computeLineDistances();
      this.routeLine.visible = true;
      const [tx, ty] = path[path.length - 1];
      this.targetMarker.position.set(tx, -ty, 8);
      this.targetMarker.visible = true;
    }
  }

  private syncLabels(): void {
    const { w, h: hh } = this.viewport();
    const showMinor = this.zoom > 0.42;
    const docked = new Map<number, number>();
    const core = this.session.core;
    for (const c of this.session.playerConvoys()) if (core.s.cvState[c] === CvState.Docked) docked.set(core.s.cvTown[c], c);
    for (const t of this.session.data.towns) {
      const el = this.labels[t.id];
      const [sx, sy] = this.mapToScreen(t.x, t.y);
      const visible = sx > -100 && sy > -40 && sx < w + 100 && sy < hh + 40 && (showMinor || t.rank !== 'colony');
      el.classList.toggle('hidden', !visible);
      if (visible) {
        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
        el.style.color = docked.has(t.id) ? '#9fe6ff' : '';
      }
    }
  }

  render(dt: number): void {
    this.time += dt;
    const { w, h: hh } = this.viewport();
    this.clampCamera();
    const hw = w / this.zoom / 2;
    const hh2 = hh / this.zoom / 2;
    this.camera.left = this.cx - hw;
    this.camera.right = this.cx + hw;
    this.camera.top = -this.cy + hh2;
    this.camera.bottom = -this.cy - hh2;
    this.camera.updateProjectionMatrix();
    if (this.seaMat) {
      this.seaMat.uniforms.uTime.value = this.time;
      this.seaMat.uniforms.uFrame.value = (this.time * 9) % this.seaMat.uniforms.uFrames.value;
    }
    // clouds drift with the wind
    const wind = this.session.core.x.windDir();
    for (const [i, cl] of this.clouds.entries()) {
      cl.position.x += Math.cos(wind) * dt * (8 + i);
      cl.position.y -= Math.sin(wind) * dt * (8 + i);
      if (cl.position.x < -600) cl.position.x = this.mapW + 600;
      if (cl.position.x > this.mapW + 600) cl.position.x = -600;
      if (cl.position.y > 600) cl.position.y = -this.mapH - 600;
      if (cl.position.y < -this.mapH - 600) cl.position.y = 600;
      (cl.material as THREE.MeshBasicMaterial).opacity = Math.min(0.35, 0.18 / this.zoom);
    }
    this.syncShips();
    this.syncSelection();
    this.syncLabels();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const l of this.labels) l.remove();
    this.labels = [];
  }

  /** URL of the overview image for the minimap. */
  static overviewUrl(): string {
    return asset('map/overview.webp');
  }
}
