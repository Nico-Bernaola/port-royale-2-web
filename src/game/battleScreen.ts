/**
 * Sea battle: the WASM core simulates ships and cannonballs; this screen renders them with
 * WebGL (ship sprites by heading, cannonballs, splashes, smoke) and maps player input to
 * the core's battle commands.
 */
import * as THREE from 'three';
import { audio } from '../audio.ts';
import { texture } from '../assets.ts';
import { Ammo, BattleFlag, Ev } from '../core/core.ts';
import type { App } from '../main.ts';
import { frameUv, headingFrame } from '../render/seaMap.ts';
import { h, uiRoot } from '../ui/dom.ts';
import type { Session } from './session.ts';

const ARENA_W = 1800;
const ARENA_H = 1300;

interface ShipGfx {
  mesh: THREE.Mesh;
  geo: THREE.PlaneGeometry;
  frame: number;
  ring: THREE.Mesh;
  sink: number;
}

interface Fx {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  grow: number;
}

export class BattleScreen {
  private app: App;
  private session: Session;
  private player: number;
  private pirate: number;
  private done: () => void;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  private waterMat!: THREE.ShaderMaterial;
  private ships: ShipGfx[] = [];
  private balls: THREE.InstancedMesh;
  private fx: Fx[] = [];
  private fxGeo = new THREE.CircleGeometry(1, 20);
  private ringGeo = new THREE.RingGeometry(0.8, 1, 24);
  private targetMarker: THREE.Mesh;
  private time = 0;
  private speed = 1;
  private flagship = 0;
  private finished = false;
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

    this.scene.background = new THREE.Color(0x0b3354);
    this.balls = new THREE.InstancedMesh(new THREE.CircleGeometry(3.2, 8), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), core.MAX_BALLS);
    this.balls.renderOrder = 50;
    this.balls.frustumCulled = false;
    this.scene.add(this.balls);
    this.targetMarker = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.8 }));
    this.targetMarker.scale.setScalar(14);
    this.targetMarker.renderOrder = 5;
    this.scene.add(this.targetMarker);

    this.root = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    uiRoot().append(this.root);
    void this.build();
  }

  private async build(): Promise<void> {
    const water = await texture('map/water-atlas.webp');
    const shading = await texture('map/sea-shading.webp');
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { uWater: { value: water }, uShade: { value: shading }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        varying vec2 vP;
        uniform sampler2D uWater, uShade;
        uniform float uTime;
        vec4 W(vec2 p, float f) {
          vec2 cell = vec2(mod(f, 8.0), floor(f / 8.0));
          vec2 q = fract(p / 128.0) * (126.0/128.0) + 1.0/128.0;
          return texture2D(uWater, vec2((cell.x + q.x) / 8.0, 1.0 - (cell.y + q.y) / 4.0));
        }
        void main() {
          // open-sea colour from the sea map's shading, brightened for the close-up view
          vec3 sea = texture2D(uShade, vec2(0.62, 0.55)).rgb * 1.25 + vec3(0.02, 0.05, 0.07);
          float f = mod(floor(uTime * 9.0), 27.0);
          vec2 p = vP * 0.55;
          float a = W(p, f).a * 2.6 + W(p * 0.45 + uTime * 6.0, mod(f + 11.0, 27.0)).a * 1.4;
          vec3 col = sea * (1.25 - a * 0.85);
          col += vec3(0.12, 0.16, 0.18) * smoothstep(0.07, 0.015, W(p, f).a);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const water3 = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W * 3, ARENA_H * 3), this.waterMat);
    water3.position.set(ARENA_W / 2, -ARENA_H / 2, -1);
    this.scene.add(water3);
    // arena boundary hint
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(ARENA_W, 0, 0), new THREE.Vector3(ARENA_W, -ARENA_H, 0), new THREE.Vector3(0, -ARENA_H, 0)]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 20, gapSize: 20, transparent: true, opacity: 0.18 }),
    );
    border.computeLineDistances();
    this.scene.add(border);

    const core = this.session.core;
    const n = core.x.battleShipCount();
    for (let i = 0; i < n; i++) {
      const type = core.s.bsType[i];
      const t = await texture(`ships/${String(type).padStart(2, '0')}.webp`);
      const size = core.s.bsLength[i] * 2.6;
      const geo = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 10;
      const side = core.s.bsSide[i];
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: side === 0 ? 0x4fa3ff : 0xff5040, transparent: true, opacity: 0.55, depthTest: false }));
      ring.scale.setScalar(core.s.bsLength[i] * 0.75);
      ring.renderOrder = 9;
      this.scene.add(ring, mesh);
      this.ships.push({ mesh, geo, frame: -1, ring, sink: 0 });
    }
    this.buildUi();
    this.bindInput();
  }

  // ---- UI -----------------------------------------------------------------------------------

  private buildUi(): void {
    const core = this.session.core;
    this.hudLeft = h('div', { class: 'battle-ships parchment plain', style: 'pointer-events:auto' });
    this.hudRight = h('div', { class: 'battle-ships enemy parchment plain', style: 'pointer-events:auto' });
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
          const cur = this.autoFire = !this.autoFire;
          core.x.battleSetAuto(this.flagship, 1, cur ? 1 : 0);
          this.syncButtons();
        }, 'auto'),
        btn('Board (B)', 'Grapple and board the nearest enemy', () => this.board()),
        btn('Speed', 'Battle speed', () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1; this.syncButtons(); }, 'speed'),
        btn('Flee', 'Break off the fight', () => this.flee())),
    );
    this.root.append(this.hudLeft, this.hudRight, this.controls,
      h('div', { class: 'help-hint wood', style: 'bottom:auto;top:12px;left:50%;transform:translateX(-50%)' }, 'Right-click: steer your flagship · Q/E: broadsides · 1/2/3: ammunition · B: board'));
    this.syncButtons();
    this.refreshHud();
  }

  private autoFire = true;

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
    if (!core.x.battleBoard(this.flagship)) {
      // either too far away or the boarding failed; the core reports captures as events
      if (core.x.battleActive(this.flagship)) audio.sfx('negative', 0.4);
    }
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
        h('div', null, i === this.flagship ? '⚑ ' : '', name, h('span', { class: 'muted' }, status)),
        h('div', { class: 'muted', style: 'font-size:12px' }, `Crew ${Math.round(s.bsCrew[i])} · Guns ${s.bsCannons[i]} · Sails ${Math.round(s.bsSails[i])}%`),
        h('div', { class: 'hp' }, h('i', { style: `width:${Math.max(0, hull * 100)}%;background:${hull > 0.5 ? '#3d6b2a' : hull > 0.25 ? '#b8862a' : '#9b2a1a'}` })));
    };
    const mine: HTMLElement[] = [], theirs: HTMLElement[] = [];
    for (let i = 0; i < n; i++) (s.bsSide[i] === 0 ? mine : theirs).push(line(i));
    this.hudLeft.replaceChildren(h('b', null, 'Your ships'), ...mine);
    this.hudRight.replaceChildren(h('b', null, 'Pirates'), ...theirs);
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
      if (e.button === 2 || e.button === 0) {
        this.session.core.x.battleSetTarget(this.flagship, x, y); // also switches to manual steering
        this.targetMarker.position.set(x, -y, 1);
      }
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

  /** camera centre (arena units) and scale (screen px per unit), eased towards the action */
  private cam = { x: ARENA_W / 2, y: ARENA_H / 2, scale: 0 };

  private updateCamera(dt: number): void {
    const core = this.session.core;
    const s = core.s;
    const c = this.app.renderer.domElement;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const n = core.x.battleShipCount();
    for (let i = 0; i < n; i++) {
      if (s.bsFlags[i] & (BattleFlag.Sunk | BattleFlag.Escaped)) continue;
      x0 = Math.min(x0, s.bsX[i]); x1 = Math.max(x1, s.bsX[i]);
      y0 = Math.min(y0, s.bsY[i]); y1 = Math.max(y1, s.bsY[i]);
    }
    if (x0 > x1) { x0 = 0; x1 = ARENA_W; y0 = 0; y1 = ARENA_H; }
    const pad = 260;
    const w = Math.max(900, x1 - x0 + pad * 2), hgt = Math.max(650, y1 - y0 + pad * 2);
    const fit = Math.min(c.clientWidth / w, (c.clientHeight - 140) / hgt);
    const full = Math.min(c.clientWidth / (ARENA_W + 120), (c.clientHeight - 140) / (ARENA_H + 120));
    const target = Math.max(full, Math.min(1.4, fit));
    const k = this.cam.scale === 0 ? 1 : Math.min(1, dt * 1.5);
    this.cam.scale += (target - this.cam.scale) * k;
    this.cam.x += ((x0 + x1) / 2 - this.cam.x) * k;
    this.cam.y += ((y0 + y1) / 2 - this.cam.y) * k;
  }

  private view(): { scale: number; ox: number; oy: number } {
    const c = this.app.renderer.domElement;
    return { scale: this.cam.scale || 0.6, ox: c.clientWidth / 2, oy: c.clientHeight / 2 - 30 };
  }

  private screenToArena(sx: number, sy: number): [number, number] {
    const { scale, ox, oy } = this.view();
    return [this.cam.x + (sx - ox) / scale, this.cam.y + (sy - oy) / scale];
  }

  // ---- effects ------------------------------------------------------------------------------

  private spawnFx(x: number, y: number, color: number, size: number, life: number, grow: number, ring = false, opacity = 0.8): void {
    const m = new THREE.Mesh(ring ? this.ringGeo : this.fxGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    m.position.set(x, -y, 2);
    m.scale.setScalar(size);
    m.renderOrder = ring ? 8 : 60;
    this.scene.add(m);
    this.fx.push({ mesh: m, life, max: life, grow });
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
          // muzzle smoke along the firing side
          for (let k = 0; k < Math.min(6, e.b); k++) {
            const along = (k / 5 - 0.5) * s.bsLength[i] * 0.7;
            const hdg = s.bsHeading[i];
            this.spawnFx(s.bsX[i] + Math.cos(hdg) * along, s.bsY[i] + Math.sin(hdg) * along, 0xd8d8d8, 9, 1.6, 14, false, 0.55);
          }
          break;
        }
        case Ev.BattleHit: {
          const i = e.a;
          audio.sfx(Math.random() < 0.5 ? 'hit-1' : 'hit-2', 0.5, (s.bsX[i] / ARENA_W) * 2 - 1);
          this.spawnFx(s.bsX[i] + (Math.random() - 0.5) * 20, s.bsY[i] + (Math.random() - 0.5) * 14, 0x5a4a3a, 6, 1.2, 10, false, 0.7);
          break;
        }
        case Ev.BattleSplash:
          this.spawnFx(e.a, e.b, 0xffffff, 4, 0.7, 16, true, 0.85);
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
    this.root.append(h('div', { class: 'battle-banner parchment plain', style: 'pointer-events:auto' }, h('h1', null, title), h('p', null, text),
      h('button', { class: 'btn', onclick: () => this.done() }, 'Continue')));
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
    const { scale, ox, oy } = this.view();
    const c = this.app.renderer.domElement;
    const cx = this.cam.x + (c.clientWidth / 2 - ox) / scale;
    const cy = this.cam.y + (c.clientHeight / 2 - oy) / scale;
    const hw = c.clientWidth / scale / 2, hh = c.clientHeight / scale / 2;
    this.camera.left = cx - hw;
    this.camera.right = cx + hw;
    this.camera.top = -cy + hh;
    this.camera.bottom = -cy - hh;
    this.camera.updateProjectionMatrix();
    if (this.waterMat) this.waterMat.uniforms.uTime.value = this.time;

    this.ships.forEach((g, i) => {
      const flags = s.bsFlags[i];
      const frame = headingFrame(s.bsHeading[i]);
      if (frame !== g.frame) {
        g.frame = frame;
        const [u0, v0, u1, v1] = frameUv(frame);
        const uv = g.geo.attributes.uv as THREE.BufferAttribute;
        uv.setXY(0, u0, v1);
        uv.setXY(1, u1, v1);
        uv.setXY(2, u0, v0);
        uv.setXY(3, u1, v0);
        uv.needsUpdate = true;
      }
      const mat = g.mesh.material as THREE.MeshBasicMaterial;
      if (flags & BattleFlag.Sunk) {
        g.sink = Math.min(1, g.sink + dt * 0.25);
        mat.opacity = 1 - g.sink;
        g.mesh.scale.setScalar(1 - g.sink * 0.3);
        g.mesh.rotation.z = g.sink * 0.4;
        if (Math.random() < dt * 6 && g.sink < 0.9) this.spawnFx(s.bsX[i] + (Math.random() - 0.5) * 30, s.bsY[i], 0x333333, 10, 2, 12, false, 0.5);
      } else if (flags & BattleFlag.Captured) {
        mat.color.setRGB(0.7, 0.7, 0.7);
      }
      if (flags & BattleFlag.Escaped) mat.opacity = Math.max(0, mat.opacity - dt);
      const bob = Math.sin(this.time * 1.7 + i) * 1.5;
      g.mesh.position.set(s.bsX[i], -s.bsY[i] + s.bsLength[i] * 0.35 + bob, 0);
      g.mesh.renderOrder = 10 + s.bsY[i] / 100;
      g.ring.position.set(s.bsX[i], -s.bsY[i], 0);
      g.ring.visible = (flags & (BattleFlag.Sunk | BattleFlag.Escaped)) === 0;
      (g.ring.material as THREE.MeshBasicMaterial).opacity = i === this.flagship ? 0.95 : 0.45;
    });

    // cannonballs
    const m = new THREE.Matrix4();
    let n = 0;
    for (let b = 0; b < core.MAX_BALLS; b++) {
      if (s.ballLife[b] <= 0) continue;
      m.makeTranslation(s.ballX[b], -s.ballY[b], 3);
      this.balls.setMatrixAt(n++, m);
    }
    this.balls.count = n;
    this.balls.instanceMatrix.needsUpdate = true;

    // effects
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      const k = 1 - f.life / f.max;
      f.mesh.scale.setScalar(f.mesh.scale.x + f.grow * dt);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - k) * 0.75);
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.fx.splice(i, 1);
      }
    }
    this.targetMarker.visible = !this.finished;
    this.app.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.root.remove();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry !== this.fxGeo && o.geometry !== this.ringGeo && o.geometry.dispose();
    });
  }
}
