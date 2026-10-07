/** Port screen: 3D harbour town, building interaction and the port dialogs. */
import { settings } from '../settings.ts';
import { audio } from '../audio.ts';
import { flagUrl } from '../assets.ts';
import { CvState } from '../core/core.ts';
import type { App } from '../main.ts';
import { type Building, TownView } from '../render/townView.ts';
import { fmt, h, toast, uiRoot } from '../ui/dom.ts';
import { type PortContext, openMarket, openTavern, openTownHall } from '../ui/market.ts';
import { openHarbour, openShipyard } from '../ui/shipyard.ts';
import { openWarehouse } from '../ui/warehouse.ts';
import type { Session } from './session.ts';

const BUILDING_HELP: Record<string, string> = {
  market: 'Buy and sell goods',
  warehouse: 'Store goods in town',
  shipyard: 'Buy, build and repair ships',
  tavern: 'Hire sailors, hear rumours',
  harbour: 'Manage your convoys',
  townhall: 'Town supply and demand',
  governor: 'Town supply and demand',
  church: 'Pray for fair winds',
};

export class TownScreen {
  private app: App;
  private session: Session;
  readonly town: number;
  private view: TownView;
  private ready = false;
  private root: HTMLElement;
  private tip: HTMLElement;
  private tags: { b: Building; el: HTMLElement }[] = [];
  private goldEl: HTMLElement;
  private dateEl: HTMLElement;
  private hover: Building | null = null;
  private drag: { x: number; y: number; moved: boolean; button: number } | null = null;
  private ctx: PortContext;
  private listeners: [EventTarget, string, EventListener][] = [];
  private keys = new Set<string>();

  constructor(app: App, session: Session, town: number) {
    this.app = app;
    this.session = session;
    this.town = town;
    const def = session.data.towns[town];
    this.view = new TownView(app.renderer, def, app.sea!.terrain);
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
      changed: () => { this.refresh(); this.updateShips(); },
    };
    this.goldEl = h('b');
    this.dateEl = h('b');
    this.tip = h('div', { class: 'building-tip wood', style: 'display:none' });
    const btn = (label: string, icon: string, fn: () => void, title: string) =>
      h('button', { class: 'btn town-btn', title, onclick: () => { audio.sfx('click'); fn(); } }, h('span', { class: 'ico' }, icon), label);
    this.root = h('div', { style: 'position:absolute;inset:0;pointer-events:none' },
      h('div', { class: 'tags', id: 'town-tags' }),
      h('div', { class: 'topbar wood', style: 'pointer-events:auto' },
        h('div', { class: 'stat' }, h('b', null, session.playerName)),
        h('div', { class: 'stat' }, '📅 ', this.dateEl),
        h('div', { class: 'stat' }, '💰 ', this.goldEl),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => { session.save(); toast('Game saved.'); } }, 'Save'),
        h('button', { class: 'btn small', title: 'Settings', onclick: () => app.openSettings() }, '⚙')),
      h('div', { class: 'town-title wood' }, h('img', { src: flagUrl(def.nation), alt: '' }), def.name,
        h('span', { class: 'sub' }, ` ${def.rank === 'viceroy' ? 'Seat of the Viceroy' : def.rank === 'governor' ? 'Governor town' : 'Colony'} · ${fmt(session.core.s.townPop[town])} inhabitants`)),
      h('div', { class: 'town-bar wood', style: 'pointer-events:auto' },
        btn('Market', '⚖', () => openMarket(this.ctx), 'Buy and sell goods'),
        btn('Warehouse', '📦', () => openWarehouse(this.ctx), 'Store goods in this town'),
        btn('Shipyard', '⚒', () => openShipyard(this.ctx), 'Buy, commission and repair ships'),
        btn('Harbour', '⚓', () => openHarbour(this.ctx), 'Form and manage convoys'),
        btn('Tavern', '🍺', () => openTavern(this.ctx), 'Hire sailors, hear trade rumours'),
        btn(def.rank === 'colony' ? 'Town hall' : 'Governor', '🏛', () => openTownHall(this.ctx), 'What the town makes and needs'),
        h('button', { class: 'btn town-btn sail', onclick: () => this.leave(), title: 'Back to the sea map' }, h('span', { class: 'ico' }, '⛵'), 'Set sail')),
      h('div', { class: 'help-hint wood', id: 'town-hint', style: 'bottom:auto;top:auto;bottom:96px' }, 'Click a building to visit it · drag to look around · wheel to zoom · Q/E or right-drag to rotate'),
      this.tip,
      h('div', { class: 'loading', id: 'town-loading', style: 'pointer-events:auto' }, h('div', { class: 'msg' }, `Entering ${def.name}...`)),
    );
    uiRoot().append(this.root);
    if (settings.hints) setTimeout(() => document.getElementById('town-hint')?.remove(), 9000);
    else document.getElementById('town-hint')?.remove();
    this.refresh();
    void this.view.load().then(() => {
      this.ready = true;
      document.getElementById('town-loading')?.remove();
      this.updateShips();
      this.buildTags();
      this.bindInput();
    }).catch((e) => {
      console.error(e);
      document.getElementById('town-loading')?.remove();
      toast(`The town view could not be drawn: ${(e as Error).message}`);
    });
  }

  private convoysHere(): number[] {
    const core = this.session.core;
    return this.session.playerConvoys().filter((c) => core.s.cvState[c] === CvState.Docked && core.s.cvTown[c] === this.town);
  }

  private updateShips(): void {
    const core = this.session.core;
    const list: { key: string; nation: number }[] = [];
    for (const c of this.convoysHere()) for (const sh of core.shipsOf(c)) list.push({ key: this.session.data.ships[core.s.shType[sh]].key, nation: this.session.playerNation });
    for (const sh of core.harbourShips(this.town)) list.push({ key: this.session.data.ships[core.s.shType[sh]].key, nation: this.session.playerNation });
    this.view.setShips(list);
    const order = this.session.orders.find((o) => o.town === this.town);
    if (order) {
      const total = order.readyDay - order.startDay;
      const done = (this.session.core.x.time() - order.startDay) / Math.max(1, total);
      this.view.setConstruction(this.session.data.ships[order.type].key, done);
    } else this.view.setConstruction(null, 0);
  }

  private buildTags(): void {
    const box = document.getElementById('town-tags')!;
    for (const b of this.view.buildings) {
      const el = h('div', { class: 'building-tag' }, b.label);
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.openBuilding(b); });
      box.append(el);
      this.tags.push({ b, el });
    }
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
      this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
      this.view.dragStart(e.clientX, e.clientY);
    }) as EventListener);
    this.on(window, 'pointermove', ((e: PointerEvent) => {
      if (this.drag) {
        if (Math.abs(e.clientX - this.drag.x) + Math.abs(e.clientY - this.drag.y) > 5) this.drag.moved = true;
        if (this.drag.moved) {
          if (this.drag.button === 2) {
            this.view.rotateBy((e.movementX || 0) * -0.005);
          } else this.view.dragTo(e.clientX, e.clientY);
        }
      }
      if (e.target !== canvas || !this.ready) {
        this.setHover(null, 0, 0);
        return;
      }
      this.setHover(this.drag?.moved ? null : this.view.pickBuilding(e.clientX, e.clientY), e.clientX, e.clientY);
    }) as EventListener);
    this.on(window, 'pointerup', ((e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || e.target !== canvas || d.button !== 0) return;
      const b = this.view.pickBuilding(e.clientX, e.clientY);
      if (b) this.openBuilding(b);
    }) as EventListener);
    this.on(canvas, 'wheel', ((e: WheelEvent) => {
      e.preventDefault();
      this.view.zoomBy(Math.exp(-e.deltaY * 0.0012));
    }) as EventListener, { passive: false });
    this.on(window, 'keydown', ((e: KeyboardEvent) => { this.keys.add(e.key.toLowerCase()); }) as EventListener);
    this.on(window, 'keyup', ((e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); }) as EventListener);
  }

  private setHover(b: Building | null, x: number, y: number): void {
    if (b !== this.hover) {
      this.hover = b;
      this.view.highlight(b);
      this.app.renderer.domElement.style.cursor = b ? 'pointer' : '';
    }
    if (b) {
      this.tip.style.display = '';
      this.tip.replaceChildren(h('b', null, b.label), h('div', { class: 'muted-light' }, BUILDING_HELP[b.kind] ?? ''));
      this.tip.style.left = `${x}px`;
      this.tip.style.top = `${y}px`;
    } else this.tip.style.display = 'none';
  }

  private openBuilding(b: Building): void {
    audio.sfx('click');
    switch (b.kind) {
      case 'market': openMarket(this.ctx); break;
      case 'warehouse': openWarehouse(this.ctx); break;
      case 'shipyard': openShipyard(this.ctx); break;
      case 'tavern': openTavern(this.ctx); break;
      case 'harbour': openHarbour(this.ctx); break;
      case 'townhall':
      case 'governor': openTownHall(this.ctx); break;
      case 'church': toast('The padre blesses your voyages.'); break;
      default: break;
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
    if (!this.ready) {
      this.app.renderer.setClearColor(0x000000);
      this.app.renderer.clear();
      return;
    }
    if (!document.querySelector('.overlay')) {
      if (this.keys.has('q')) this.view.rotateBy(dt * 0.9);
      if (this.keys.has('e')) this.view.rotateBy(-dt * 0.9);
    }
    this.view.render(dt);
    for (const { b, el } of this.tags) {
      const [x, y, front] = this.view.labelPos(b);
      el.style.display = front ? '' : 'none';
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
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
