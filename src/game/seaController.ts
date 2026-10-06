/** Sea-map interaction: input, HUD, convoy list/details and minimap. */
import { audio } from '../audio.ts';
import { CvState, Owner } from '../core/core.ts';
import type { App } from '../main.ts';
import { SeaMapView } from '../render/seaMap.ts';
import { fmt, h, modal, toast, uiRoot } from '../ui/dom.ts';
import type { Session } from './session.ts';

export class SeaController {
  private app: App;
  private session: Session;
  private view: SeaMapView;
  private root: HTMLElement | null = null;
  private hud: Record<string, HTMLElement> = {};
  private convoyListEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private minimap!: HTMLCanvasElement;
  private overview = new Image();
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean; button: number } | null = null;
  private keys = new Set<string>();
  private panelTimer = 0;
  private listSig = '';

  constructor(app: App, session: Session, view: SeaMapView) {
    this.app = app;
    this.session = session;
    this.view = view;
    this.overview.src = SeaMapView.overviewUrl();
    const canvas = app.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    view.onTownClick = (t, button) => this.onTown(t, button);
  }

  private get active(): boolean {
    return this.app.screen === 'sea' && !document.querySelector('.overlay');
  }

  // ---- UI ---------------------------------------------------------------------------------

  attachUi(): void {
    const s = this.session;
    const speedBtn = (v: number, label: string) =>
      h('button', { class: 'btn small', 'data-speed': v, onclick: () => this.setSpeed(v) }, label);
    this.hud.name = h('b', null, s.playerName);
    this.hud.date = h('b');
    this.hud.gold = h('b');
    this.hud.wind = h('div', { class: 'wind', title: 'Wind direction' });
    this.hud.speed = h('div', { class: 'speed' }, speedBtn(0, '❚❚'), speedBtn(1, '▶'), speedBtn(2, '▶▶'), speedBtn(4, '▶▶▶'));
    const top = h(
      'div',
      { class: 'topbar wood' },
      h('div', { class: 'stat' }, this.hud.name),
      h('div', { class: 'stat' }, '📅', this.hud.date),
      h('div', { class: 'stat' }, '💰', this.hud.gold),
      h('div', { class: 'stat' }, 'Wind', this.hud.wind),
      this.hud.speed,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => this.save() }, 'Save'),
      h('button', { class: 'btn small', onclick: () => this.menu() }, 'Menu'),
    );
    this.convoyListEl = h('div', { class: 'convoy-list parchment plain' });
    this.panelEl = h('div', { class: 'side-panel parchment plain' });
    this.minimap = h('canvas', { width: 256, height: 202 }) as HTMLCanvasElement;
    const mini = h('div', { class: 'minimap' }, this.minimap);
    mini.addEventListener('pointerdown', (e) => {
      const r = this.minimap.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.view.mapW;
      const y = ((e.clientY - r.top) / r.height) * this.view.mapH;
      if (e.button === 2 && this.session.isPlayerConvoy(this.session.selected)) this.sail(x, y, -1);
      else this.view.centerOn(x, y);
    });
    mini.addEventListener('contextmenu', (e) => e.preventDefault());
    const hint = h(
      'div',
      { class: 'help-hint wood' },
      'Left-click: select convoy · Right-click: sail there · Drag: scroll · Wheel: zoom · Click a town where your convoy lies to enter it',
    );
    this.root = h('div', { style: 'position:absolute;inset:0;pointer-events:none' }, top, this.convoyListEl, this.panelEl, mini, hint);
    for (const el of [top, this.convoyListEl, this.panelEl, mini]) el.style.pointerEvents = 'auto';
    uiRoot().append(this.root);
    this.listSig = '';
    this.setSpeed(this.session.paused ? 0 : this.session.speed);
    this.refreshPanel();
    setTimeout(() => hint.remove(), 12000);
  }

  detachUi(): void {
    this.root?.remove();
    this.root = null;
  }

  private setSpeed(v: number): void {
    if (v === 0) this.session.paused = true;
    else {
      this.session.paused = false;
      this.session.speed = v;
    }
    for (const b of this.hud.speed?.querySelectorAll('button') ?? []) {
      const bv = Number((b as HTMLElement).dataset.speed);
      b.classList.toggle('active', this.session.paused ? bv === 0 : bv === this.session.speed);
    }
  }

  private save(): void {
    try {
      this.session.save();
      audio.sfx('click');
      toast('Game saved.');
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    }
  }

  private menu(): void {
    const m = modal(
      'Menu',
      h(
        'div',
        { class: 'col', style: 'width:260px' },
        h('button', { class: 'btn', onclick: () => { this.save(); m.close(); } }, 'Save game'),
        h('button', { class: 'btn', onclick: () => { audio.setMuted(!audio.muted); m.close(); } }, audio.muted ? 'Sound on' : 'Sound off'),
        h('button', { class: 'btn', onclick: () => { m.close(); this.app.showMainMenu(); } }, 'Quit to main menu'),
      ),
      { plain: true },
    );
  }

  private refreshHud(): void {
    if (!this.root) return;
    const s = this.session;
    this.hud.date.textContent = s.dateString();
    const g = s.core.x.gold();
    this.hud.gold.textContent = fmt(g);
    this.hud.gold.style.color = g < 0 ? '#ff8a7a' : '';
    const deg = (s.core.x.windDir() * 180) / Math.PI + 90;
    this.hud.wind.style.setProperty('--wind', `${deg}deg`);
  }

  private refreshConvoyList(): void {
    const s = this.session;
    const core = s.core;
    const convoys = s.playerConvoys();
    const sig = convoys.map((c) => `${c}:${core.s.cvState[c]}:${core.s.cvTown[c]}:${c === s.selected}`).join(',');
    if (sig === this.listSig) return;
    this.listSig = sig;
    this.convoyListEl.replaceChildren(
      h('h3', { style: 'font-size:20px;margin:0 0 4px' }, 'Your convoys'),
      ...convoys.map((c) => {
        const st = core.s.cvState[c];
        const where = st === CvState.Docked ? this.app.data.towns[core.s.cvTown[c]].name : st === CvState.Halted ? 'in combat' : 'at sea';
        return h(
          'div',
          {
            class: `item ${c === s.selected ? 'sel' : ''}`,
            onclick: () => {
              s.selected = c;
              this.view.centerOn(core.s.cvX[c], core.s.cvY[c]);
              this.refreshPanel();
            },
          },
          h('span', null, s.convoyName(c)),
          h('span', { class: 'muted' }, where),
        );
      }),
      convoys.length === 0 ? h('div', { class: 'muted' }, 'No convoys. Buy a ship at a shipyard.') : '',
    );
  }

  refreshPanel(): void {
    if (!this.root) return;
    const s = this.session;
    const core = s.core;
    const c = s.selected;
    if (!s.isPlayerConvoy(c)) {
      this.panelEl.style.display = 'none';
      return;
    }
    this.panelEl.style.display = '';
    const st = core.s.cvState[c];
    const ships = core.shipsOf(c);
    const cap = core.x.capacity(c);
    const load = core.x.cargoTotal(c);
    const town = st === CvState.Docked ? core.s.cvTown[c] : -1;
    const dest = core.s.cvDest[c];
    let status: string;
    if (town >= 0) status = `In port: ${this.app.data.towns[town].name}`;
    else if (st === CvState.Halted) status = 'Engaged with pirates!';
    else if (core.s.cvPathIdx[c] < core.s.cvPathLen[c]) {
      const knots = core.s.cvSpeed[c];
      const days = core.x.routeRemaining(c) / Math.max(1, knots * 30);
      status = `${dest >= 0 ? `Sailing to ${this.app.data.towns[dest].name}` : 'Under way'} · ${knots.toFixed(1)} kn · ${days < 1 ? '<1' : days.toFixed(0)} day${days >= 1.5 ? 's' : ''}`;
    } else status = 'Anchored at sea';
    const cargoRows = this.app.data.goods
      .map((g) => [g, core.cargo(c, g.id)] as const)
      .filter(([, n]) => n > 0)
      .map(([g, n]) => h('div', { class: 'ship-line' }, h('span', null, g.name), h('span', null, fmt(n))));
    this.panelEl.replaceChildren(
      h('h3', null, s.convoyName(c)),
      h('div', { class: 'muted', style: 'margin-bottom:6px' }, status),
      ...ships.map((sh) => {
        const t = this.app.data.ships[core.s.shType[sh]];
        const hull = core.s.shHull[sh];
        return h(
          'div',
          { class: 'ship-line' },
          h('span', null, s.shipName(sh), h('span', { class: 'muted' }, ` (${t.name})`)),
          h('span', { class: 'bar-mini', title: `Hull ${Math.round(hull)}%` }, h('i', { style: `width:${hull}%;background:${hull > 50 ? '#3d6b2a' : hull > 25 ? '#b8862a' : '#9b2a1a'}` })),
        );
      }),
      h('div', { style: 'margin-top:8px' }, h('b', null, 'Cargo '), h('span', { class: 'muted' }, `${fmt(load)} / ${fmt(cap)} barrels`)),
      ...cargoRows,
      h(
        'div',
        { class: 'actions' },
        town >= 0 ? h('button', { class: 'btn small', onclick: () => this.app.enterTown(town) }, 'Enter port') : null,
        st === CvState.Sailing ? h('button', { class: 'btn small', onclick: () => { core.x.stopConvoy(c); this.refreshPanel(); } }, 'Drop anchor') : null,
        h('button', { class: 'btn small', onclick: () => this.rename(c) }, 'Rename'),
      ),
    );
  }

  private rename(c: number): void {
    const input = h('input', { value: this.session.convoyName(c), maxlength: 24, style: 'width:100%;font-size:16px;padding:4px' }) as HTMLInputElement;
    const m = modal('Rename convoy', input, {
      plain: true,
      footer: [h('button', { class: 'btn', onclick: () => { this.session.convoyNames.set(c, input.value.trim() || this.session.convoyName(c)); m.close(); this.listSig = ''; this.refreshPanel(); } }, 'OK')],
    });
    setTimeout(() => input.select(), 10);
  }

  private drawMinimap(): void {
    const ctx = this.minimap?.getContext('2d');
    if (!ctx) return;
    const W = this.minimap.width, H = this.minimap.height;
    const sx = W / this.view.mapW, sy = H / this.view.mapH;
    ctx.fillStyle = '#0b2e4d';
    ctx.fillRect(0, 0, W, H);
    if (this.overview.complete && this.overview.naturalWidth) {
      // the overview covers the full 20x15 tile grid (5120 x 3840 px)
      ctx.drawImage(this.overview, 0, 0, (5120 * W) / this.view.mapW, H);
    }
    const core = this.session.core;
    const s = core.s;
    for (let c = 0; c < core.MAX_CONVOYS; c++) {
      if (s.cvState[c] === CvState.Free) continue;
      const own = s.cvOwner[c];
      ctx.fillStyle = own === Owner.Player ? '#0f66dd' : own === Owner.Pirate ? '#000' : '#e3e3e3';
      const size = own === Owner.Player ? 4 : 2;
      if (own !== Owner.Player && s.cvState[c] === CvState.Docked) continue;
      ctx.fillRect(s.cvX[c] * sx - size / 2, s.cvY[c] * sy - size / 2, size, size);
    }
    // view rectangle
    const [x0, y0] = this.view.screenToMap(0, 0);
    const c = this.app.renderer.domElement;
    const [x1, y1] = this.view.screenToMap(c.clientWidth, c.clientHeight);
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy);
  }

  update(dt: number): void {
    // keyboard scrolling
    const k = 700 / this.view.zoom * dt;
    if (this.active) {
      if (this.keys.has('arrowleft') || this.keys.has('a')) this.view.cx -= k;
      if (this.keys.has('arrowright') || this.keys.has('d')) this.view.cx += k;
      if (this.keys.has('arrowup') || this.keys.has('w')) this.view.cy -= k;
      if (this.keys.has('arrowdown') || this.keys.has('s')) this.view.cy += k;
    }
    this.refreshHud();
    this.refreshConvoyList();
    this.panelTimer -= dt;
    if (this.panelTimer <= 0) {
      this.panelTimer = 0.5;
      this.refreshPanel();
      this.drawMinimap();
    }
  }

  // ---- input ------------------------------------------------------------------------------

  private onDown(e: PointerEvent): void {
    if (this.app.screen !== 'sea') return;
    this.drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy, moved: false, button: e.button };
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag || this.app.screen !== 'sea') return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) this.drag.moved = true;
    if (this.drag.moved && this.drag.button !== 2) {
      this.view.cx = this.drag.cx - dx / this.view.zoom;
      this.view.cy = this.drag.cy - dy / this.view.zoom;
      this.view.clampCamera();
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved || this.app.screen !== 'sea') return;
    if ((e.target as HTMLElement) !== this.app.renderer.domElement) return;
    const pick = this.view.pick(e.clientX, e.clientY);
    const s = this.session;
    if (e.button === 0) {
      if (pick.kind === 'convoy') {
        const owner = s.core.s.cvOwner[pick.id];
        if (owner === Owner.Player) {
          s.selected = pick.id;
          audio.sfx('click', 0.6);
          this.refreshPanel();
        } else {
          const kind = owner === Owner.Pirate ? 'Pirates' : 'Merchant convoy';
          const n = s.core.shipsOf(pick.id).length;
          toast(`${kind}: ${n} ship${n > 1 ? 's' : ''}`);
        }
      } else if (pick.kind === 'town') this.onTown(pick.id, 0);
    } else if (e.button === 2) {
      if (pick.kind === 'town') this.onTown(pick.id, 2);
      else this.sail(pick.x, pick.y, -1);
    }
  }

  private onWheel(e: WheelEvent): void {
    if (this.app.screen !== 'sea') return;
    e.preventDefault();
    this.view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const key = e.key.toLowerCase();
    if (down) this.keys.add(key);
    else this.keys.delete(key);
    if (!down || !this.active || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (key === ' ') {
      this.setSpeed(this.session.paused ? this.session.speed : 0);
      e.preventDefault();
    } else if (key === '1') this.setSpeed(1);
    else if (key === '2') this.setSpeed(2);
    else if (key === '3') this.setSpeed(4);
    else if (key === '+' || key === '=') this.view.zoom *= 1.2;
    else if (key === '-') this.view.zoom /= 1.2;
  }

  private onTown(t: number, button: number): void {
    const s = this.session;
    const c = s.selected;
    if (this.app.dockedIn(c, t)) {
      this.app.enterTown(t);
      return;
    }
    // left-click on a town where one of our convoys lies: visit it with that convoy
    const there = s.playerConvoys().find((cv) => this.app.dockedIn(cv, t));
    if (button === 0 && there !== undefined) {
      s.selected = there;
      this.app.enterTown(t);
      return;
    }
    if (s.isPlayerConvoy(c)) {
      const town = this.app.data.towns[t];
      this.sail(s.core.s.townX[t], s.core.s.townY[t], t);
      toast(`${s.convoyName(c)} sets course for ${town.name}.`);
    } else {
      toast(this.app.data.towns[t].name);
    }
  }

  private sail(x: number, y: number, town: number): void {
    const s = this.session;
    const c = s.selected;
    if (!s.isPlayerConvoy(c)) return;
    const st = s.core.s.cvState[c];
    if (st === CvState.Halted) return;
    if (s.core.x.sailTo(c, x, y, town)) {
      audio.sfx('click', 0.7);
      this.refreshPanel();
    }
  }
}
