/**
 * Sea battle: the WASM core simulates ships and cannonballs; this screen renders them in 3D
 * (procedural ships, wave-shaded water, smoke and splashes) and maps player input to the
 * core's battle commands. Arena units: x = east, z = south, y = up.
 */
import * as THREE from 'three';
import { audio } from '../audio.ts';
import { Ammo, BattleFlag, Ev } from '../core/core.ts';
import type { App } from '../main.ts';
import { NOISE, SUN_DIR } from '../render/glsl.ts';
import { makeShip } from '../render/ships3d.ts';
import { h, uiRoot } from '../ui/dom.ts';
import type { Session } from './session.ts';

const ARENA_W = 1800;
const ARENA_H = 1300;

interface ShipGfx {
  group: THREE.Group;
  ring: THREE.Mesh;
  sink: number;
  heel: number;
}

interface Fx {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  grow: number;
  rise: number;
  opacity: number;
}

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class BattleScreen {
  private app: App;
  private session: Session;
  private player: number;
  private pirate: number;
  private done: () => void;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 5, 12000);
  private waterMat!: THREE.ShaderMaterial;
  private ships: ShipGfx[] = [];
  private balls: THREE.InstancedMesh;
  private fx: Fx[] = [];
  private puff = puffTexture();
  private targetMarker: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private time = 0;
  private speed = 1;
  private flagship = 0;
  private finished = false;
  private autoFire = true;
  private root: HTMLElement;
  private hudLeft!: HTMLElement;
  private hudRight!: HTMLElement;
  private reloadL!: HTMLElement;
  private reloadR!: HTMLElement;
  private controls!: HTMLElement;
  private listeners: [EventTarget, string, EventListener][] = [];
  private splashCooldown = 0;
  private hudTimer = 0;

  constructor(app: App, session: Session, player: number, pirate: number, done: () => void) {
    this.app = app;
    this.session = session;
    this.player = player;
    this.pirate = pirate;
    this.done = done;
    const core = session.core;
    core.x.battleBegin();
    const mine = core.shipsOf(player);
    const theirs = core.shipsOf(pirate);
    mine.forEach((s, i) => core.x.battleAddShip(s, 0, 380, ARENA_H / 2 + (i - (mine.length - 1) / 2) * 150, 0));
    theirs.forEach((s, i) => core.x.battleAddShip(s, 1, ARENA_W - 380, ARENA_H / 2 + (i - (theirs.length - 1) / 2) * 160 + 60, Math.PI));
    // the flagship is AI-assisted until the player gives an order; escorts always follow the AI
    core.x.battleSetAuto(0, 0, 1);
    core.drainEvents();

    this.scene.background = new THREE.Color(0x9cc4dc);
    this.scene.fog = new THREE.Fog(0x9cc4dc, 1800, 6000);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]).multiplyScalar(1000);
    this.scene.add(sun, new THREE.HemisphereLight(0xd6eaff, 0x2a4a5a, 1.1));
    this.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(2.6, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }), core.MAX_BALLS);
    this.balls.frustumCulled = false;
    this.scene.add(this.balls);
    this.targetMarker = new THREE.Mesh(new THREE.RingGeometry(10, 14, 32), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.targetMarker.visible = false;
    this.scene.add(this.targetMarker);

    this.root = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    uiRoot().append(this.root);
    this.build();
  }

  private build(): void {
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(...SUN_DIR).normalize() }, uCam: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `
        varying vec3 vP;
        uniform float uTime;
        uniform vec3 uSun, uCam;
        ${NOISE}
        float waves(vec2 p) { return fbm3(p + uTime * vec2(0.25, 0.15)) + 0.5 * fbm3(p * 2.4 - uTime * vec2(0.2, 0.3)); }
        void main() {
          vec2 p = vP.xz * 0.02;
          float e = 0.25;
          float n0 = waves(p), nx = waves(p + vec2(e, 0.0)), nz = waves(p + vec2(0.0, e));
          vec3 N = normalize(vec3((n0 - nx) * 2.4, 1.0, (n0 - nz) * 2.4));
          vec3 V = normalize(uCam - vP);
          vec3 H = normalize(uSun + V);
          float spec = pow(max(dot(N, H), 0.0), 110.0) * 1.5;
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 col = mix(vec3(0.05, 0.30, 0.48), vec3(0.08, 0.42, 0.56), n0);
          col = col * (0.75 + 0.35 * max(dot(N, uSun), 0.0)) + spec + vec3(0.5, 0.7, 0.85) * fres * 0.35;
          col = mix(col, vec3(0.92, 0.97, 1.0), smoothstep(0.80, 0.95, n0) * 0.35);
          float fogF = smoothstep(1800.0, 6000.0, length(uCam - vP));
          col = mix(col, vec3(0.61, 0.77, 0.86), fogF);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W * 6, ARENA_H * 6), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(ARENA_W / 2, 0, ARENA_H / 2);
    this.scene.add(water);

    const core = this.session.core;
    const n = core.x.battleShipCount();
    for (let i = 0; i < n; i++) {
      const key = this.session.data.ships[core.s.bsType[i]].key;
      const side = core.s.bsSide[i];
      const group = makeShip(key, side === 0 ? this.session.playerNation : 4);
      // battle hull length -> model length
      group.scale.setScalar((core.s.bsLength[i] * 1.5) / (group.userData.length as number));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: side === 0 ? 0x4fa3ff : 0xff5040, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(core.s.bsLength[i] * 0.9);
      this.scene.add(ring, group);
      this.ships.push({ group, ring, sink: 0, heel: 0 });
    }
    this.buildUi();
    this.bindInput();
  }

  // ---- UI -----------------------------------------------------------------------------------

  private buildUi(): void {
    const core = this.session.core;
    this.hudLeft = h('div', { class: 'battle-ships parchment', style: 'pointer-events:auto' });
    this.hudRight = h('div', { class: 'battle-ships enemy parchment', style: 'pointer-events:auto' });
    this.reloadL = h('i');
    this.reloadR = h('i');
    const btn = (label: string, title: string, fn: () => void, id?: string) =>
      h('button', { class: 'btn small', title, onclick: fn, 'data-id': id }, label);
    this.controls = h('div', { class: 'battle-hud wood', style: 'pointer-events:auto' },
      h('div', { class: 'group' }, 'Sails',
        ...[0.25, 0.5, 0.75, 1].map((v) => btn(`${v * 100}%`, 'Sail area', () => { core.x.battleSetSail(this.flagship, v); this.syncButtons(); }, `sail${v}`))),
      h('div', { class: 'group' }, 'Shot',
        btn('Round', 'Round shot: damages the hull (1)', () => this.setAmmo(Ammo.Round), 'ammo0'),
        btn('Grape', 'Grapeshot: kills crew (2)', () => this.setAmmo(Ammo.Grape), 'ammo1'),
        btn('Chain', 'Chain shot: shreds sails (3)', () => this.setAmmo(Ammo.Chain), 'ammo2')),
      h('div', { class: 'group' },
        btn('◀ Fire (Q)', 'Fire the port broadside', () => this.fire(-1)), h('div', { class: 'reload' }, this.reloadL),
        h('div', { class: 'reload' }, this.reloadR), btn('Fire (E) ▶', 'Fire the starboard broadside', () => this.fire(1))),
      h('div', { class: 'group' },
        btn('Auto-fire', 'Fire automatically when an enemy is abeam', () => {
          const cur = (this.autoFire = !this.autoFire);
          core.x.battleSetAuto(this.flagship, 1, cur ? 1 : 0);
          this.syncButtons();
        }, 'auto'),
        btn('Board (B)', 'Grapple and board the nearest enemy', () => this.board()),
        btn('Speed', 'Battle speed', () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1; this.syncButtons(); }, 'speed'),
        btn('Flee', 'Break off the fight', () => this.flee())),
    );
    this.root.append(this.hudLeft, this.hudRight, this.controls,
      h('div', { class: 'help-hint wood', style: 'bottom:auto;top:12px;left:50%;transform:translateX(-50%)' }, 'Click the sea to steer your flagship · Q/E fire broadsides · 1/2/3 ammunition · B board'));
    this.syncButtons();
    this.refreshHud();
  }

  private syncButtons(): void {
    const core = this.session.core;
    const sail = core.s.bsSail[this.flagship];
    const ammo = core.s.bsAmmo[this.flagship];
    for (const b of this.controls.querySelectorAll('button')) {
      const id = (b as HTMLElement).dataset.id;
      if (!id) continue;
      if (id.startsWith('sail')) b.classList.toggle('active', Math.abs(Number(id.slice(4)) - sail) < 0.01);
      if (id.startsWith('ammo')) b.classList.toggle('active', Number(id.slice(4)) === ammo);
      if (id === 'auto') b.classList.toggle('active', this.autoFire);
      if (id === 'speed') b.textContent = `Speed ${this.speed}x`;
    }
  }

  private setAmmo(a: number): void {
    this.session.core.x.battleSetAmmo(this.flagship, a);
    this.syncButtons();
  }

  private fire(side: number): void {
    if (!this.session.core.x.battleFire(this.flagship, side)) audio.sfx('negative', 0.3);
  }

  private board(): void {
    const core = this.session.core;
    if (!core.x.battleBoard(this.flagship) && core.x.battleActive(this.flagship)) audio.sfx('negative', 0.4);
  }

  private flee(): void {
    this.session.core.x.battleFlee();
  }

  private refreshHud(): void {
    const core = this.session.core;
    const s = core.s;
    const n = core.x.battleShipCount();
    const line = (i: number) => {
      const t = this.session.data.ships[s.bsType[i]];
      const dead = (s.bsFlags[i] & (BattleFlag.Sunk | BattleFlag.Captured | BattleFlag.Escaped)) !== 0;
      const hull = s.bsHull[i] / s.bsHullMax[i];
      const status = s.bsFlags[i] & BattleFlag.Sunk ? ' — sunk' : s.bsFlags[i] & BattleFlag.Captured ? ' — captured' : s.bsFlags[i] & BattleFlag.Escaped ? ' — escaped' : s.bsFlags[i] & BattleFlag.Fleeing ? ' — fleeing' : '';
      const name = s.bsSide[i] === 0 ? this.session.shipName(s.bsShip[i]) : `Pirate ${t.name}`;
      return h('div', { class: `s ${dead ? 'dead' : ''}` },
        h('div', null, i === this.flagship ? '⚑ ' : '', h('b', null, name), h('span', { class: 'muted' }, status)),
        h('div', { class: 'muted', style: 'font-size:12px' }, `Crew ${Math.round(s.bsCrew[i])} · Guns ${s.bsCannons[i]} · Sails ${Math.round(s.bsSails[i])}%`),
        h('div', { class: 'hp' }, h('i', { style: `width:${Math.max(0, hull * 100)}%;background:${hull > 0.5 ? '#3d6b2a' : hull > 0.25 ? '#b8862a' : '#9b2a1a'}` })));
    };
    const mine: HTMLElement[] = [], theirs: HTMLElement[] = [];
    for (let i = 0; i < n; i++) (s.bsSide[i] === 0 ? mine : theirs).push(line(i));
    this.hudLeft.replaceChildren(h('h3', { style: 'font-size:15px' }, 'Your ships'), ...mine);
    this.hudRight.replaceChildren(h('h3', { style: 'font-size:15px' }, 'Pirates'), ...theirs);
  }

  // ---- input ----------------------------------------------------------------------------------

  private on(t: EventTarget, type: string, fn: EventListener): void {
    t.addEventListener(type, fn);
    this.listeners.push([t, type, fn]);
  }

  private bindInput(): void {
    const canvas = this.app.renderer.domElement;
    this.on(canvas, 'pointerdown', ((e: PointerEvent) => {
      if (this.finished) return;
      const [x, y] = this.screenToArena(e.clientX, e.clientY);
      this.session.core.x.battleSetTarget(this.flagship, x, y); // also switches to manual steering
      this.targetMarker.position.set(x, 1.5, y);
      this.targetMarker.visible = true;
    }) as EventListener);
    this.on(window, 'keydown', ((e: KeyboardEvent) => {
      if (this.finished) return;
      const k = e.key.toLowerCase();
      if (k === 'q') this.fire(-1);
      else if (k === 'e') this.fire(1);
      else if (k === 'b') this.board();
      else if (k === '1') this.setAmmo(Ammo.Round);
      else if (k === '2') this.setAmmo(Ammo.Grape);
      else if (k === '3') this.setAmmo(Ammo.Chain);
    }) as EventListener);
  }

  /** camera target (arena units) and distance, eased towards the action */
  private cam = { x: ARENA_W / 2, y: ARENA_H / 2, dist: 0 };

  private updateCamera(dt: number): void {
    const core = this.session.core;
    const s = core.s;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const n = core.x.battleShipCount();
    for (let i = 0; i < n; i++) {
      if (s.bsFlags[i] & (BattleFlag.Sunk | BattleFlag.Escaped)) continue;
      x0 = Math.min(x0, s.bsX[i]); x1 = Math.max(x1, s.bsX[i]);
      y0 = Math.min(y0, s.bsY[i]); y1 = Math.max(y1, s.bsY[i]);
    }
    if (x0 > x1) { x0 = 0; x1 = ARENA_W; y0 = 0; y1 = ARENA_H; }
    const extent = Math.max(500, x1 - x0, (y1 - y0) * 1.4) + 350;
    const target = Math.min(2600, extent * 0.95);
    const k = this.cam.dist === 0 ? 1 : Math.min(1, dt * 1.2);
    this.cam.dist += (target - this.cam.dist) * k;
    this.cam.x += ((x0 + x1) / 2 - this.cam.x) * k;
    this.cam.y += ((y0 + y1) / 2 - this.cam.y) * k;
    const c = this.app.renderer.domElement;
    this.camera.aspect = (c.clientWidth || 1) / (c.clientHeight || 1);
    const pitch = 0.95;
    this.camera.position.set(this.cam.x, Math.sin(pitch) * this.cam.dist, this.cam.y + 60 + Math.cos(pitch) * this.cam.dist);
    this.camera.lookAt(this.cam.x, 0, this.cam.y + 60);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private screenToArena(sx: number, sy: number): [number, number] {
    const c = this.app.renderer.domElement;
    this.raycaster.setFromCamera(new THREE.Vector2((sx / c.clientWidth) * 2 - 1, -(sy / c.clientHeight) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, p) ? [p.x, p.z] : [this.cam.x, this.cam.y];
  }

  // ---- effects ------------------------------------------------------------------------------

  private smoke(x: number, y: number, z: number, color: number, size: number, life: number, opacity: number): void {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, color, transparent: true, opacity, depthWrite: false }));
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    this.scene.add(sp);
    this.fx.push({ sprite: sp, life, max: life, grow: size * 1.2, rise: 6, opacity });
  }

  private splash(x: number, z: number): void {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    sp.position.set(x, 2, z);
    sp.scale.set(6, 14, 1);
    sp.center.set(0.5, 0);
    this.scene.add(sp);
    this.fx.push({ sprite: sp, life: 0.7, max: 0.7, grow: 8, rise: 0, opacity: 0.9 });
  }

  private onEvents(): void {
    const core = this.session.core;
    const s = core.s;
    for (const e of core.drainEvents()) {
      switch (e.type) {
        case Ev.BattleFire: {
          const i = e.a;
          const pan = (s.bsX[i] / ARENA_W) * 2 - 1;
          audio.sfx(e.b > 12 ? 'cannon-20' : e.b > 5 ? 'cannon-10' : 'cannon-3', 0.8, pan);
          for (let k = 0; k < Math.min(6, e.b); k++) {
            const along = (k / 5 - 0.5) * s.bsLength[i] * 0.7;
            const hdg = s.bsHeading[i];
            this.smoke(s.bsX[i] + Math.cos(hdg) * along, 8, s.bsY[i] + Math.sin(hdg) * along, 0xe8e8e8, 10, 2.2, 0.75);
          }
          break;
        }
        case Ev.BattleHit: {
          const i = e.a;
          audio.sfx(Math.random() < 0.5 ? 'hit-1' : 'hit-2', 0.5, (s.bsX[i] / ARENA_W) * 2 - 1);
          this.smoke(s.bsX[i] + (Math.random() - 0.5) * 20, 10, s.bsY[i] + (Math.random() - 0.5) * 14, 0x6a5a48, 8, 1.4, 0.8);
          break;
        }
        case Ev.BattleSplash:
          this.splash(e.a, e.b);
          if (this.splashCooldown <= 0) {
            audio.sfx(Math.random() < 0.5 ? 'splash-1' : 'splash-2', 0.25, (e.a / ARENA_W) * 2 - 1);
            this.splashCooldown = 0.15;
          }
          break;
        case Ev.BattleSunk:
          audio.sfx('sink', 0.9);
          break;
        case Ev.BattleBoarded:
          audio.sfx('board', 0.9);
          break;
        case Ev.BattleEnd:
          this.finish(e.a);
          break;
      }
    }
  }

  private finish(result: number): void {
    if (this.finished) return;
    this.finished = true;
    const core = this.session.core;
    const captured = core.x.battleApply(this.player, this.pirate);
    for (const sh of core.shipsOf(this.player)) {
      if (!this.session.shipNames.has(sh)) this.session.shipNames.set(sh, `Prize ${this.session.data.ships[core.s.shType[sh]].name}`);
    }
    const title = result === 0 ? 'Victory!' : result === 1 ? 'Defeat' : 'Escaped';
    const text = result === 0
      ? `The pirates are beaten.${captured ? ` You captured ${captured} ship${captured > 1 ? 's' : ''}.` : ''} Their cargo is yours.`
      : result === 1 ? 'Your convoy was overwhelmed. The pirates take what they can carry.' : 'You broke away from the fight.';
    audio.sfx(result === 0 ? 'victory' : result === 1 ? 'defeat' : 'message');
    this.root.append(h('div', { class: 'battle-banner parchment', style: 'pointer-events:auto' }, h('h1', null, title), h('p', null, text),
      h('button', { class: 'btn primary', onclick: () => this.done() }, 'Continue')));
    this.refreshHud();
  }

  // ---- frame --------------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    this.splashCooldown -= dt;
    const core = this.session.core;
    if (!this.finished && this.ships.length) {
      const sim = dt * this.speed;
      const steps = Math.ceil(sim / (1 / 60));
      for (let i = 0; i < steps; i++) core.x.battleStep(sim / steps);
      // hand control to the next ship if the flagship is out
      if (!core.x.battleActive(this.flagship)) {
        const n = core.x.battleShipCount();
        for (let i = 0; i < n; i++) {
          if (core.s.bsSide[i] === 0 && core.x.battleActive(i)) {
            this.flagship = i;
            core.x.battleSetAuto(i, 1, this.autoFire ? 1 : 0);
            break;
          }
        }
      }
    }
    this.onEvents();
    this.draw(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && this.hudLeft) {
      this.hudTimer = 0.25;
      this.refreshHud();
    }
    if (this.reloadL) {
      this.reloadL.style.width = `${100 - Math.min(100, (core.s.bsReloadL[this.flagship] / 16) * 100)}%`;
      this.reloadR.style.width = `${100 - Math.min(100, (core.s.bsReloadR[this.flagship] / 16) * 100)}%`;
    }
  }

  private draw(dt: number): void {
    const core = this.session.core;
    const s = core.s;
    this.updateCamera(dt);
    if (this.waterMat) {
      this.waterMat.uniforms.uTime.value = this.time;
      this.waterMat.uniforms.uCam.value.copy(this.camera.position);
    }
    const wind = core.x.windDir();
    this.ships.forEach((g, i) => {
      const flags = s.bsFlags[i];
      const sunk = (flags & BattleFlag.Sunk) !== 0;
      // heel away from the wind when sailing across it
      let rel = wind - s.bsHeading[i];
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      const targetHeel = Math.sin(rel) * 0.08 * Math.min(1, s.bsSpeed[i] / 40);
      g.heel += (targetHeel - g.heel) * Math.min(1, dt * 2);
      if (sunk) {
        g.sink = Math.min(1, g.sink + dt * 0.18);
        if (Math.random() < dt * 5 && g.sink < 0.8) this.smoke(s.bsX[i] + (Math.random() - 0.5) * 30, 10, s.bsY[i], 0x333333, 14, 2.5, 0.6);
      }
      const bob = Math.sin(this.time * 1.5 + i) * 1.2;
      g.group.position.set(s.bsX[i], bob - g.sink * 40, s.bsY[i]);
      g.group.rotation.set(g.heel + g.sink * 0.5, -s.bsHeading[i], Math.sin(this.time * 1.1 + i * 2) * 0.03 - g.sink * 0.35, 'YXZ');
      g.group.visible = g.sink < 1 && !(flags & BattleFlag.Escaped);
      g.ring.position.set(s.bsX[i], 0.8, s.bsY[i]);
      g.ring.visible = (flags & (BattleFlag.Sunk | BattleFlag.Escaped | BattleFlag.Captured)) === 0;
      (g.ring.material as THREE.MeshBasicMaterial).opacity = i === this.flagship ? 0.95 : 0.45;
    });

    // cannonballs, flying in a shallow arc
    const m = new THREE.Matrix4();
    let n = 0;
    for (let b = 0; b < core.MAX_BALLS; b++) {
      const life = s.ballLife[b];
      if (life <= 0) continue;
      m.makeTranslation(s.ballX[b], 6 + Math.min(18, life * 14), s.ballY[b]);
      this.balls.setMatrixAt(n++, m);
    }
    this.balls.count = n;
    this.balls.instanceMatrix.needsUpdate = true;

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      const k = 1 - f.life / f.max;
      f.sprite.scale.x += f.grow * dt;
      f.sprite.scale.y += f.grow * dt * (f.rise ? 1 : 0.4);
      f.sprite.position.y += f.rise * dt;
      f.sprite.material.opacity = Math.max(0, (1 - k) * f.opacity);
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.fx.splice(i, 1);
      }
    }
    if (this.finished) this.targetMarker.visible = false;
    this.app.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.root.remove();
    for (const f of this.fx) f.sprite.material.dispose();
  }
}
