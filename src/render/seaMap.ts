/**
 * The sea map, rendered in 3D: terrain and sea in one shader driven by the coastline's signed
 * distance field (public/world/terrain.webp), procedural low-poly ships and towns, a tilted
 * perspective camera, and HTML town labels.
 *
 * Map coordinates are pixels (x right, y down). World space: x = map x, z = map y, y = up.
 */
import * as THREE from 'three';
import { CvState, Owner } from '../core/core.ts';
import type { Session } from '../game/session.ts';
import { flagUrl, worldUrl } from '../assets.ts';
import { h, labelRoot } from '../ui/dom.ts';
import { NOISE, SUN_DIR } from './glsl.ts';
import { makeShip, shipLength } from './ships3d.ts';
import { TerrainSampler } from './terrain.ts';

const PITCH = (52 * Math.PI) / 180;
const FOV = 38;

export interface MapPick {
  kind: 'convoy' | 'town' | 'sea';
  id: number;
  x: number;
  y: number;
}

interface ShipObj {
  group: THREE.Group;
  key: string;
  nation: number;
}

export class SeaMapView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 30000);
  private session: Session;
  private renderer: THREE.WebGLRenderer;
  private terrainMat!: THREE.ShaderMaterial;
  terrain!: TerrainSampler;
  private ships = new Map<number, ShipObj>();
  private routeLine: THREE.Line;
  private selRing: THREE.Mesh;
  private targetMarker: THREE.Mesh;
  private labels: HTMLElement[] = [];
  private time = 0;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** camera target on the map and distance from it */
  cx = 2600;
  cy = 1900;
  dist = 1400;
  readonly mapW: number;
  readonly mapH: number;
  visible = false;
  onTownClick: ((town: number, button: number) => void) | null = null;

  constructor(renderer: THREE.WebGLRenderer, session: Session) {
    this.renderer = renderer;
    this.session = session;
    this.mapW = session.data.map.width;
    this.mapH = session.data.map.height;
    this.scene.background = new THREE.Color(0x8fb8d0);
    this.scene.fog = new THREE.Fog(0x9fc3d6, 4000, 16000);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]).multiplyScalar(1000);
    this.scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 1.1));

    const routeGeo = new THREE.BufferGeometry();
    routeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 100), 3));
    this.routeLine = new THREE.Line(routeGeo, new THREE.LineDashedMaterial({ color: 0xfff3c4, dashSize: 14, gapSize: 9, transparent: true, opacity: 0.95, fog: false }));
    this.routeLine.frustumCulled = false;
    this.scene.add(this.routeLine);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, fog: false });
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), ringMat);
    this.selRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.selRing);
    this.targetMarker = new THREE.Mesh(new THREE.RingGeometry(6, 9, 24), ringMat);
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.scene.add(this.targetMarker);
  }

  async load(onProgress: (k: number) => void): Promise<void> {
    this.terrain = await TerrainSampler.load();
    onProgress(0.5);
    const tex = new THREE.Texture(this.terrain.image);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        uT: { value: tex },
        uMap: { value: new THREE.Vector2(this.mapW, this.mapH) },
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(...SUN_DIR).normalize() },
        uCam: { value: new THREE.Vector3() },
        fogColor: { value: new THREE.Color(0x9fc3d6) },
        fogNear: { value: 4000 },
        fogFar: { value: 16000 },
      },
      vertexShader: /* glsl */ `
        uniform sampler2D uT;
        uniform vec2 uMap;
        varying vec3 vPos;
        varying float vSd;
        ${NOISE}
        float sdAt(vec2 p) { return (texture2D(uT, vec2(p.x / uMap.x, 1.0 - p.y / uMap.y)).r * 255.0 - 128.0) * 2.0; }
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          float sd = sdAt(w.xz);
          vSd = sd;
          float land = smoothstep(0.0, 6.0, sd);
          // relief: rises inland, ridged by noise
          float hgt = land * (smoothstep(0.0, 120.0, sd) * 70.0 + fbm3(w.xz * 0.004) * 55.0 * smoothstep(10.0, 90.0, sd));
          w.y = hgt;
          vPos = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uT;
        uniform vec2 uMap;
        uniform float uTime;
        uniform vec3 uSun, uCam, fogColor;
        uniform float fogNear, fogFar;
        varying vec3 vPos;
        varying float vSd;
        ${NOISE}
        float sdAt(vec2 p) { return (texture2D(uT, vec2(p.x / uMap.x, 1.0 - p.y / uMap.y)).r * 255.0 - 128.0) * 2.0; }
        void main() {
          float sd = sdAt(vPos.xz);
          vec3 col;
          vec3 V = normalize(uCam - vPos);
          if (sd < 0.0) {
            float depth = -sd;
            vec3 shallow = vec3(0.30, 0.78, 0.76);
            vec3 mid = vec3(0.08, 0.47, 0.62);
            vec3 deep = vec3(0.03, 0.20, 0.42);
            col = mix(shallow, mid, smoothstep(0.0, 28.0, depth));
            col = mix(col, deep, smoothstep(28.0, 220.0, depth));
            // animated wave normal from two scrolling noise layers
            vec2 p = vPos.xz * 0.045;
            float e = 0.35;
            float n0 = fbm3(p + uTime * vec2(0.20, 0.12)) + 0.5 * fbm3(p * 2.3 - uTime * vec2(0.15, 0.25));
            float nx = fbm3(p + vec2(e, 0.0) + uTime * vec2(0.20, 0.12)) + 0.5 * fbm3((p + vec2(e, 0.0)) * 2.3 - uTime * vec2(0.15, 0.25));
            float nz = fbm3(p + vec2(0.0, e) + uTime * vec2(0.20, 0.12)) + 0.5 * fbm3((p + vec2(0.0, e)) * 2.3 - uTime * vec2(0.15, 0.25));
            vec3 N = normalize(vec3((n0 - nx) * 2.2, 1.0, (n0 - nz) * 2.2));
            float diff = clamp(dot(N, uSun), 0.0, 1.0);
            vec3 H = normalize(uSun + V);
            float spec = pow(clamp(dot(N, H), 0.0, 1.0), 90.0) * 1.4;
            float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
            col = col * (0.72 + 0.35 * diff) + vec3(1.0, 0.96, 0.85) * spec + vec3(0.55, 0.72, 0.85) * fres * 0.25;
            // surf: bands rolling towards the beach, broken up by noise
            float surf = smoothstep(14.0, 0.0, depth) * smoothstep(0.55, 0.85, sin(depth * 0.9 - uTime * 2.2) * 0.5 + 0.5 + vnoise(vPos.xz * 0.08) * 0.35);
            col = mix(col, vec3(0.95, 0.98, 1.0), surf * 0.75 + smoothstep(2.5, 0.0, depth) * 0.6);
          } else {
            // faceted low-poly land shading from screen-space derivatives
            vec3 N = normalize(cross(dFdx(vPos), dFdy(vPos)));
            if (N.y < 0.0) N = -N;
            float n = fbm(vPos.xz * 0.012);
            float n2 = vnoise(vPos.xz * 0.06);
            vec3 sand = vec3(0.93, 0.84, 0.62);
            vec3 grass = mix(vec3(0.42, 0.62, 0.26), vec3(0.62, 0.70, 0.33), n2);
            vec3 jungle = vec3(0.16, 0.42, 0.18);
            vec3 rock = vec3(0.55, 0.50, 0.44);
            col = mix(sand, grass, smoothstep(3.0, 9.0, sd));
            col = mix(col, jungle, smoothstep(0.45, 0.65, n) * smoothstep(8.0, 20.0, sd));
            float slope = 1.0 - N.y;
            col = mix(col, rock, smoothstep(0.35, 0.6, slope) * smoothstep(20.0, 60.0, sd));
            col = mix(col, vec3(0.92, 0.92, 0.9), smoothstep(105.0, 125.0, vPos.y));
            float diff = clamp(dot(N, uSun), 0.0, 1.0);
            col *= 0.55 + 0.6 * diff;
          }
          float f = smoothstep(fogNear, fogFar, length(uCam - vPos));
          col = mix(col, fogColor, f);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    // one big terrain patch; the mesh is denser than the half-res distance field
    const geo = new THREE.PlaneGeometry(this.mapW, this.mapH, 560, 410);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.position.set(this.mapW / 2, 0, this.mapH / 2);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.addTowns();
    this.buildLabels();
    onProgress(1);
  }

  /** Small clusters of houses, a church and the nation's flag at every town. */
  private addTowns(): void {
    const roof = [0xb5523b, 0xa8452f, 0x8e3b2a, 0xc0703f];
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xefe6d2, flatShading: true });
    const roofMats = roof.map((c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true }));
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cone = new THREE.ConeGeometry(0.8, 1, 4);
    cone.rotateY(Math.PI / 4);
    for (const t of this.session.data.towns) {
      const g = new THREE.Group();
      const rnd = mulberry(t.id + 1);
      const n = t.rank === 'viceroy' ? 16 : t.rank === 'governor' ? 11 : 7;
      let placed = 0;
      for (let k = 0; k < n * 4 && placed < n; k++) {
        const a = rnd() * Math.PI * 2, r = 4 + rnd() * (8 + n);
        const x = t.x + Math.cos(a) * r, z = t.y + Math.sin(a) * r;
        if (this.terrain.sd(x, z) < 3) continue;
        const s = 3 + rnd() * 2.5;
        const y = this.terrain.height(x, z);
        const wall = new THREE.Mesh(box, wallMat);
        wall.scale.set(s, s * 0.8, s * (0.8 + rnd() * 0.5));
        wall.position.set(x, y + s * 0.4, z);
        wall.rotation.y = rnd() * Math.PI;
        const rf = new THREE.Mesh(cone, roofMats[Math.floor(rnd() * roofMats.length)]);
        rf.scale.set(s * 0.95, s * 0.6, s * 0.95);
        rf.position.set(x, y + s * 0.8 + s * 0.3, z);
        rf.rotation.y = wall.rotation.y;
        g.add(wall, rf);
        placed++;
      }
      // church tower
      const ty = this.terrain.height(t.x, t.y);
      const tower = new THREE.Mesh(box, wallMat);
      tower.scale.set(3.4, 10, 3.4);
      tower.position.set(t.x, ty + 5, t.y);
      const spire = new THREE.Mesh(cone, roofMats[0]);
      spire.scale.set(3.5, 5, 3.5);
      spire.position.set(t.x, ty + 12.5, t.y);
      g.add(tower, spire);
      this.scene.add(g);
    }
  }

  private buildLabels(): void {
    const root = labelRoot();
    for (const t of this.session.data.towns) {
      const el = h('div', { class: `town-label ${t.rank !== 'colony' ? 'capital' : ''}`, 'data-town': t.id },
        h('img', { src: flagUrl(t.nation), alt: '' }), t.name);
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onTownClick?.(t.id, (e as PointerEvent).button);
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      root.append(el);
      this.labels.push(el);
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    for (const l of this.labels) l.style.display = v ? '' : 'none';
  }

  // ---- camera -----------------------------------------------------------------------------

  private size(): { w: number; h: number } {
    const c = this.renderer.domElement;
    return { w: c.clientWidth || 1, h: c.clientHeight || 1 };
  }

  /** Approximate screen pixels per map pixel at the camera target (used for scroll speed). */
  get zoom(): number {
    const { h: hh } = this.size();
    return hh / (2 * this.dist * Math.tan((FOV * Math.PI) / 360));
  }
  set zoom(z: number) {
    const { h: hh } = this.size();
    this.dist = hh / (2 * Math.max(0.01, z) * Math.tan((FOV * Math.PI) / 360));
  }

  clampCamera(): void {
    this.dist = Math.max(260, Math.min(5200, this.dist));
    this.cx = Math.max(0, Math.min(this.mapW, this.cx));
    this.cy = Math.max(0, Math.min(this.mapH, this.cy));
  }

  private updateCamera(): void {
    this.clampCamera();
    const { w, h: hh } = this.size();
    this.camera.aspect = w / hh;
    this.camera.position.set(this.cx, Math.sin(PITCH) * this.dist, this.cy + Math.cos(PITCH) * this.dist);
    this.camera.lookAt(this.cx, 0, this.cy);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  screenToMap(sx: number, sy: number): [number, number] {
    this.updateCamera();
    const { w, h: hh } = this.size();
    this.raycaster.setFromCamera(new THREE.Vector2((sx / w) * 2 - 1, -(sy / hh) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, p)) return [this.cx, this.cy];
    return [p.x, p.z];
  }

  mapToScreen(x: number, y: number, height = 0): [number, number, boolean] {
    const { w, h: hh } = this.size();
    const v = new THREE.Vector3(x, height, y).project(this.camera);
    return [(v.x + 1) * 0.5 * w, (1 - v.y) * 0.5 * hh, v.z < 1];
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const [mx, my] = this.screenToMap(sx, sy);
    this.dist /= factor;
    this.clampCamera();
    const [mx2, my2] = this.screenToMap(sx, sy);
    this.cx += mx - mx2;
    this.cy += my - my2;
    this.clampCamera();
  }

  private dragAnchor: [number, number] | null = null;
  dragStart(sx: number, sy: number): void {
    this.dragAnchor = this.screenToMap(sx, sy);
  }
  dragTo(sx: number, sy: number): void {
    if (!this.dragAnchor) return;
    const [mx, my] = this.screenToMap(sx, sy);
    this.cx += this.dragAnchor[0] - mx;
    this.cy += this.dragAnchor[1] - my;
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
    let bd = 34 * 34;
    for (let c = 0; c < core.MAX_CONVOYS; c++) {
      const st = s.cvState[c];
      if (st === CvState.Free || st === CvState.Docked) continue;
      const [px, py] = this.mapToScreen(s.cvX[c], s.cvY[c], 6);
      const d = ((px - sx) ** 2 + (py - sy) ** 2) * (s.cvOwner[c] === Owner.Player ? 0.5 : 1);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best >= 0) return { kind: 'convoy', id: best, x, y };
    for (const t of this.session.data.towns) {
      const [px, py] = this.mapToScreen(t.x, t.y);
      if ((px - sx) ** 2 + (py - sy) ** 2 < 26 * 26) return { kind: 'town', id: t.id, x, y };
    }
    return { kind: 'sea', id: -1, x, y };
  }

  // ---- per-frame ----------------------------------------------------------------------------

  private shipScale(): number {
    // ships are drawn far larger than life so they stay readable at map scale
    return Math.max(0.9, Math.min(3.2, this.dist / 900));
  }

  private syncShips(): void {
    const core = this.session.core;
    const s = core.s;
    const seen = new Set<number>();
    const scale = this.shipScale();
    for (let c = 0; c < core.MAX_CONVOYS; c++) {
      const st = s.cvState[c];
      if (st === CvState.Free || st === CvState.Docked) continue;
      const type = this.session.flagshipType(c);
      if (type < 0) continue;
      seen.add(c);
      const key = this.session.data.ships[type].key;
      const nation = s.cvOwner[c] === Owner.Pirate ? 4 : s.cvNation[c];
      let obj = this.ships.get(c);
      if (!obj || obj.key !== key || obj.nation !== nation) {
        if (obj) this.scene.remove(obj.group);
        obj = { group: makeShip(key, nation), key, nation };
        this.scene.add(obj.group);
        this.ships.set(c, obj);
      }
      const g = obj.group;
      const moving = s.cvSpeed[c] > 0.1;
      g.scale.setScalar(scale);
      g.position.set(s.cvX[c], Math.sin(this.time * 1.7 + c) * 0.6 * scale, s.cvY[c]);
      g.rotation.set(Math.sin(this.time * 1.3 + c * 2) * 0.05 * (moving ? 1 : 0.5), -s.cvHeading[c], Math.sin(this.time * 0.9 + c) * 0.03);
    }
    for (const [c, obj] of this.ships) {
      if (!seen.has(c)) {
        this.scene.remove(obj.group);
        this.ships.delete(c);
      }
    }
  }

  private syncSelection(): void {
    const core = this.session.core;
    const s = core.s;
    const c = this.session.selected;
    const show = this.session.isPlayerConvoy(c) && s.cvState[c] !== CvState.Docked;
    this.selRing.visible = show;
    this.routeLine.visible = false;
    this.targetMarker.visible = false;
    if (!show) return;
    const type = this.session.flagshipType(c);
    const r = (type >= 0 ? shipLength(this.session.data.ships[type].key) : 30) * 0.75 * this.shipScale();
    this.selRing.scale.setScalar(r);
    this.selRing.position.set(s.cvX[c], 1.2, s.cvY[c]);
    const path = core.path(c);
    if (s.cvState[c] === CvState.Sailing && path.length) {
      const pos = this.routeLine.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, s.cvX[c], 2, s.cvY[c]);
      path.slice(0, 99).forEach(([x, y], i) => pos.setXYZ(i + 1, x, 2, y));
      this.routeLine.geometry.setDrawRange(0, Math.min(100, path.length + 1));
      pos.needsUpdate = true;
      this.routeLine.computeLineDistances();
      this.routeLine.visible = true;
      const [tx, ty] = path[path.length - 1];
      this.targetMarker.position.set(tx, 2, ty);
      this.targetMarker.scale.setScalar(this.shipScale());
      this.targetMarker.visible = true;
    }
  }

  private syncLabels(): void {
    const { w, h: hh } = this.size();
    const showMinor = this.dist < 2600;
    const core = this.session.core;
    const docked = new Set<number>();
    for (const c of this.session.playerConvoys()) if (core.s.cvState[c] === CvState.Docked) docked.add(core.s.cvTown[c]);
    for (const t of this.session.data.towns) {
      const el = this.labels[t.id];
      const [sx, sy, front] = this.mapToScreen(t.x, t.y, this.terrain.height(t.x, t.y) + 22);
      const visible = front && sx > -100 && sy > -40 && sx < w + 100 && sy < hh + 40 && (showMinor || t.rank !== 'colony');
      el.classList.toggle('hidden', !visible);
      if (visible) {
        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
        el.classList.toggle('docked', docked.has(t.id));
      }
    }
  }

  render(dt: number): void {
    this.time += dt;
    this.updateCamera();
    if (this.terrainMat) {
      this.terrainMat.uniforms.uTime.value = this.time;
      this.terrainMat.uniforms.uCam.value.copy(this.camera.position);
    }
    this.syncShips();
    this.syncSelection();
    if (this.terrain) this.syncLabels();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const l of this.labels) l.remove();
    this.labels = [];
  }

  static overviewUrl(): string {
    return worldUrl('overview.png');
  }
}

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
