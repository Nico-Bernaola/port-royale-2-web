/**
 * A running campaign: the WASM core plus host-side state the core does not need to know
 * (names, selection, game speed), save/load, and event fan-out to the views.
 */
import { Core, CvState, Ev, Owner, type CoreEvent } from '../core/core.ts';
import type { GameData } from '../core/data.ts';
import { configureCore, newGame } from '../core/world.ts';

export const SAVE_KEY = 'caribbean-trader.save.v2';
export const START_YEAR = 1600;

export interface ShipOrder {
  town: number;
  type: number;
  name: string;
  startDay: number;
  readyDay: number;
}

/** A rented warehouse: goods stored in a town, outside any convoy. */
export interface Warehouse {
  town: number;
  goods: number[];
}

export const WAREHOUSE_CAPACITY = 400;
export const WAREHOUSE_RENT = 25; // gold per day

export interface SaveMeta {
  playerName: string;
  playerNation?: number;
  shipNames: [number, string][];
  convoyNames: [number, string][];
  orders?: ShipOrder[];
  warehouses?: Warehouse[];
  savedAt: string;
}

/** Messages for the host UI that do not come from the core. */
export type SessionNote = { kind: 'shipReady'; order: ShipOrder; ship: number };

type Listener = (e: CoreEvent) => void;

export class Session {
  readonly core: Core;
  readonly data: GameData;
  playerName = 'Captain';
  /** flag the player sails under: 0 Spain, 1 England, 2 France, 3 Holland */
  playerNation = 1;
  orders: ShipOrder[] = [];
  warehouses: Warehouse[] = [];
  notes = new Set<(n: SessionNote) => void>();
  shipNames = new Map<number, string>();
  convoyNames = new Map<number, string>();
  selected = -1;
  /** game days per real second at speed 1 */
  readonly daysPerSecond = 1 / 8;
  speed = 1;
  paused = false;
  /** blocks time while a modal flow (battle, dialog) is open */
  holds = 0;
  private listeners = new Set<Listener>();
  private nameCounter = 1;

  constructor(core: Core, data: GameData) {
    this.core = core;
    this.data = data;
  }

  static async create(core: Core, data: GameData, nav: Uint8Array, seed: number): Promise<Session> {
    configureCore(core, data, nav, seed);
    return new Session(core, data);
  }

  startNew(playerName: string, startTown: number, gold: number, ships: number[]): void {
    this.playerName = playerName;
    this.playerNation = ['Spain', 'England', 'France', 'Holland'].indexOf(this.data.towns[startTown].nation);
    const names = ['Santa Maria', 'Fortuna', 'Esperanza', 'Golden Hind', 'Sea Hawk', 'Mercury', 'Dolphin', 'Swallow'];
    const setup = newGame(this.core, this.data, {
      startTown,
      gold,
      ships: ships.map((type, i) => ({ type, name: names[i % names.length] })),
    });
    this.shipNames = setup.shipNames;
    this.convoyNames.set(setup.convoy, 'Convoy 1');
    this.selected = setup.convoy;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Advance simulation by real seconds; dispatches core events. */
  update(realSeconds: number): void {
    if (!this.paused && this.holds === 0 && this.speed > 0) {
      this.core.x.tick(Math.min(0.5, realSeconds * this.daysPerSecond * this.speed));
    }
    this.dispatch();
  }

  dispatch(): void {
    const events = this.core.drainEvents();
    for (const e of events) {
      if (e.type === Ev.Day) this.onDay();
      for (const l of this.listeners) l(e);
    }
  }

  /** Daily running costs (upkeep, warehouse rent) and shipyard deliveries. */
  private onDay(): void {
    let cost = this.warehouses.length * WAREHOUSE_RENT;
    const today = this.core.x.time();
    for (const o of [...this.orders]) {
      if (today < o.readyDay) continue;
      this.orders.splice(this.orders.indexOf(o), 1);
      const ship = this.core.x.createShip(o.type, Owner.Player, o.town);
      if (ship < 0) continue;
      const def = this.data.ships[o.type];
      this.core.s.shCrew[ship] = Math.ceil(def.crew * 0.5);
      this.core.s.shCannons[ship] = 0;
      this.shipNames.set(ship, o.name);
      for (const n of this.notes) n({ kind: 'shipReady', order: o, ship });
    }
    for (const c of this.playerConvoys()) cost += this.core.x.convoyUpkeep(c);
    for (let t = 0; t < this.data.towns.length; t++) {
      for (const s of this.core.harbourShips(t)) cost += this.data.ships[this.core.s.shType[s]].upkeep * 0.5;
    }
    this.core.x.setGold(this.core.x.gold() - cost);
  }

  playerConvoys(): number[] {
    return this.core.convoys(Owner.Player);
  }

  isPlayerConvoy(c: number): boolean {
    return c >= 0 && this.core.s.cvState[c] !== CvState.Free && this.core.s.cvOwner[c] === Owner.Player;
  }

  shipName(s: number): string {
    return this.shipNames.get(s) ?? this.data.ships[this.core.s.shType[s]]?.name ?? `Ship ${s}`;
  }

  convoyName(c: number): string {
    let n = this.convoyNames.get(c);
    if (!n) {
      n = `Convoy ${++this.nameCounter}`;
      this.convoyNames.set(c, n);
    }
    return n;
  }

  /** Flagship type for sprites. */
  flagshipType(c: number): number {
    const ships = this.core.shipsOf(c);
    let best = -1;
    let bestPrice = -1;
    for (const s of ships) {
      const t = this.core.s.shType[s];
      if (this.data.ships[t].price > bestPrice) {
        bestPrice = this.data.ships[t].price;
        best = t;
      }
    }
    return best;
  }

  warehouse(town: number): Warehouse | undefined {
    return this.warehouses.find((w) => w.town === town);
  }

  dateString(day = Math.floor(this.core.x.time())): string {
    const d = new Date(Date.UTC(START_YEAR, 0, 1 + day));
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // ---- save / load ------------------------------------------------------------------------

  save(): void {
    const meta: SaveMeta = {
      playerName: this.playerName,
      playerNation: this.playerNation,
      shipNames: [...this.shipNames],
      convoyNames: [...this.convoyNames],
      orders: this.orders,
      warehouses: this.warehouses,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify({ meta, state: this.core.snapshot() }));
  }

  static hasSave(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  load(): boolean {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const { meta, state } = JSON.parse(raw) as { meta: SaveMeta; state: Record<string, number[]> };
    this.core.restore(state);
    this.playerName = meta.playerName;
    this.playerNation = meta.playerNation ?? 1;
    this.orders = meta.orders ?? [];
    this.warehouses = meta.warehouses ?? [];
    this.shipNames = new Map(meta.shipNames);
    this.convoyNames = new Map(meta.convoyNames);
    this.nameCounter = this.convoyNames.size;
    this.selected = this.playerConvoys()[0] ?? -1;
    this.core.drainEvents();
    return true;
  }
}
