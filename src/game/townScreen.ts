/** Port screen: isometric town view, building interaction and the port dialogs. */
import { audio } from '../audio.ts';
import { flagUrl } from '../assets.ts';
import { CvState } from '../core/core.ts';
import type { App } from '../main.ts';
import { type Building, TownView } from '../render/townView.ts';
import { fmt, h, toast, uiRoot } from '../ui/dom.ts';
import { type PortContext, openMarket, openTavern, openTownHall } from '../ui/market.ts';
import { openHarbour, openShipyard } from '../ui/shipyard.ts';
import type { Session } from './session.ts';

export class TownScreen {
  private app: App;
  private session: Session;
  readonly town: number;
  private view: TownView;
  private ready = false;
  private root: HTMLElement;
  private tip: HTMLElement;
  private goldEl: HTMLElement;
  private dateEl: HTMLElement;
  private hover: Building | null = null;
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private ctx: PortContext;
  private listeners: [EventTarget, string, EventListener][] = [];

  constructor(app: App, session: Session, town: number) {
    this.app = app;
    this.session = session;
    this.town = town;
    const def = session.data.towns[town];
    this.view = new TownView(app.renderer, def, session.data.goods);
    // a convoy docked here becomes the active one
    if (!app.dockedIn(session.selected, town)) {
      const c = this.convoysHere()[0];
      if (c !== undefined) session.selected = c;
    }
    this.ctx = {
      session,
      town,
      convoys: () => this.convoysHere(),
      active: () => (app.dockedIn(session.selected, town) ? session.selected : this.convoysHere()[0] ?? -1),
      setActive: (c) => { session.selected = c; },
      changed: () => { this.refresh(); void this.updateShips(); },
    };
    this.goldEl = h('b');
    this.dateEl = h('b');
    this.tip = h('div', { class: 'building-tip wood', style: 'display:none' });
    const btn = (label: string, fn: () => void) => h('button', { class: 'btn', onclick: () => { audio.sfx('click', 0.6); fn(); } }, label);
    this.root = h('div', { style: 'position:absolute;inset:0;pointer-events:none' },
      h('div', { class: 'topbar wood', style: 'pointer-events:auto' },
        h('div', { class: 'stat' }, h('b', null, session.playerName)),
        h('div', { class: 'stat' }, '📅', this.dateEl),
        h('div', { class: 'stat' }, '💰', this.goldEl),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => { session.save(); toast('Game saved.'); } }, 'Save')),
      h('div', { class: 'town-title wood' }, h('img', { src: flagUrl(def.nation), alt: '' }), def.name,
        h('span', { style: 'font-size:15px;opacity:.85' }, ` · ${fmt(session.core.s.townPop[town])} inhabitants`)),
      h('div', { class: 'town-bar wood', style: 'pointer-events:auto' },
        btn('Market', () => openMarket(this.ctx)),
        btn('Shipyard', () => openShipyard(this.ctx)),
        btn('Tavern', () => openTavern(this.ctx)),
        btn('Harbour', () => openHarbour(this.ctx)),
        btn('Town hall', () => openTownHall(this.ctx)),
        h('button', { class: 'btn', style: 'margin-left:16px', onclick: () => this.leave() }, '⚓ To the sea map')),
      this.tip,
      h('div', { class: 'loading', id: 'town-loading', style: 'pointer-events:auto' }, h('div', { class: 'msg' }, `Entering ${def.name}...`)),
    );
    uiRoot().append(this.root);
    this.refresh();
    void this.view.load().then(async () => {
      this.ready = true;
      document.getElementById('town-loading')?.remove();
      await this.updateShips();
      this.bindInput();
    }).catch((e) => {
      console.error(e);
      document.getElementById('town-loading')?.remove();
      toast(`The town view could not be drawn: ${(e as Error).message}`);
      this.bindInput();
    });
  }

  private convoysHere(): number[] {
    const core = this.session.core;
    return this.session.playerConvoys().filter((c) => core.s.cvState[c] === CvState.Docked && core.s.cvTown[c] === this.town);
  }

  private async updateShips(): Promise<void> {
    const types: number[] = [];
    for (const c of this.convoysHere()) for (const sh of this.session.core.shipsOf(c)) types.push(this.session.core.s.shType[sh]);
    await this.view.setShips(types);
  }

  private refresh(): void {
    this.goldEl.textContent = fmt(this.session.core.x.gold());
    this.dateEl.textContent = this.session.dateString();
  }

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn]);
  }

  private bindInput(): void {
    const canvas = this.app.renderer.domElement;
    this.on(canvas, 'pointerdown', ((e: PointerEvent) => {
      this.drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy, moved: false };
    }) as EventListener);
    this.on(window, 'pointermove', ((e: PointerEvent) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) this.drag.moved = true;
        if (this.drag.moved) {
          this.view.cx = this.drag.cx - dx / this.view.zoom;
          this.view.cy = this.drag.cy - dy / this.view.zoom;
        }
      }
      if (e.target !== canvas || !this.ready) {
        this.setHover(null, 0, 0);
        return;
      }
      this.setHover(this.view.pickBuilding(e.clientX, e.clientY), e.clientX, e.clientY);
    }) as EventListener);
    this.on(window, 'pointerup', ((e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || e.target !== canvas) return;
      const b = this.view.pickBuilding(e.clientX, e.clientY);
      if (b) this.openBuilding(b);
    }) as EventListener);
    this.on(canvas, 'wheel', ((e: WheelEvent) => {
      e.preventDefault();
      this.view.zoom *= Math.exp(-e.deltaY * 0.0012);
    }) as EventListener, { passive: false });
  }

  private setHover(b: Building | null, x: number, y: number): void {
    if (b !== this.hover) {
      this.hover = b;
      this.view.highlight(b);
      this.app.renderer.domElement.style.cursor = b ? 'pointer' : '';
    }
    if (b) {
      this.tip.style.display = '';
      this.tip.textContent = b.label;
      this.tip.style.left = `${x}px`;
      this.tip.style.top = `${y}px`;
    } else this.tip.style.display = 'none';
  }

  private openBuilding(b: Building): void {
    audio.sfx('click', 0.6);
    switch (b.kind) {
      case 'market':
      case 'warehouse':
        openMarket(this.ctx);
        break;
      case 'shipyard':
        openShipyard(this.ctx);
        break;
      case 'tavern':
        openTavern(this.ctx);
        break;
      case 'harbour':
        openHarbour(this.ctx);
        break;
      case 'townhall':
      case 'governor':
        openTownHall(this.ctx);
        break;
      case 'church':
        toast('The padre blesses your voyages.');
        break;
      default:
        if (b.label) toast(b.label);
    }
  }

  private leave(): void {
    const c = this.ctx.active();
    if (c >= 0) this.session.selected = c;
    this.app.showSea();
    if (c >= 0) this.app.sea?.centerOn(this.session.core.s.cvX[c], this.session.core.s.cvY[c]);
  }

  render(dt: number): void {
    this.refresh();
    if (this.ready) this.view.render(dt);
    else {
      this.app.renderer.setClearColor(0x000000);
      this.app.renderer.clear();
    }
  }

  dispose(): void {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners = [];
    this.app.renderer.domElement.style.cursor = '';
    this.view.dispose();
    this.root.remove();
  }
}
