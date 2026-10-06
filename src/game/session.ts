/**
 * A running campaign: the WASM core plus host-side state the core does not need to know
 * (names, selection, game speed), save/load, and event fan-out to the views.
 */
import { Core, CvState, Ev, Owner, type CoreEvent } from '../core/core.ts';
import type { GameData } from '../core/data.ts';
import { configureCore, newGame } from '../core/world.ts';

export const SAVE_KEY = 'pr2web.save.v1';
export const START_YEAR = 1600;

export interface SaveMeta {
  playerName: string;
  shipNames: [number, string][];
  convoyNames: [number, string][];
  savedAt: string;
}

type Listener = (e: CoreEvent) => void;

export class Session {
  readonly core: Core;
  readonly data: GameData;
  playerName = 'Captain';
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

  /** Daily running costs: ship upkeep. */
  private onDay(): void {
    let cost = 0;
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

  dateString(): string {
    const day = Math.floor(this.core.x.time());
    const d = new Date(Date.UTC(START_YEAR, 0, 1 + day));
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // ---- save / load ------------------------------------------------------------------------

  save(): void {
    const meta: SaveMeta = {
      playerName: this.playerName,
      shipNames: [...this.shipNames],
      convoyNames: [...this.convoyNames],
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
    this.shipNames = new Map(meta.shipNames);
    this.convoyNames = new Map(meta.convoyNames);
    this.nameCounter = this.convoyNames.size;
    this.selected = this.playerConvoys()[0] ?? -1;
    this.core.drainEvents();
    return true;
  }
}
