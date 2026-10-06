/**
 * Typed host-side wrapper around the WASM simulation core (wasm/assembly/index.ts).
 * Works in the browser and in Node (tests).
 */

export interface CoreExports {
  memory: WebAssembly.Memory;
  setup(goods: number, towns: number, seed: number, mapW: number, mapH: number): void;
  setGood(g: number, basePrice: number, demand: number, prod: number, rawUse: number, raw: number): void;
  setShipType(t: number, cargo: number, vmin: number, vmax: number, guns: number, crew: number, hull: number, agility: number, price: number, upkeep: number, draught: number): void;
  setTown(t: number, x: number, y: number, pop: number, nation: number, rank: number): void;
  setTownProduces(t: number, g: number): void;
  setHideout(i: number, x: number, y: number): void;
  setPopulationTargets(traders: number, pirates: number): void;
  navInit(w: number, h: number, mapWidthPx: number): void;
  navPtr(): number;
  initWorld(): void;
  warmUp(days: number): void;
  tick(dtDays: number): void;
  limits(i: number): number;
  ptr(id: number): number;
  // events
  eventCount(): number;
  eventType(i: number): number;
  eventA(i: number): number;
  eventB(i: number): number;
  eventsClear(): void;
  // world
  gold(): number;
  setGold(v: number): void;
  time(): number;
  windDir(): number;
  windStrength(): number;
  rngState(): number;
  setRngState(s: number): void;
  // economy
  buyPrice(t: number, g: number): number;
  sellPrice(t: number, g: number): number;
  quoteBuy(t: number, g: number, n: number): number;
  quoteSell(t: number, g: number, n: number): number;
  dailyDemand(t: number, g: number): number;
  // navigation
  findPath(sx: number, sy: number, tx: number, ty: number): number;
  pathLength(): number;
  isWater(x: number, y: number): number;
  snapToWater(x: number, y: number): number;
  coastDistance(x: number, y: number): number;
  // fleet
  createShip(type: number, owner: number, town: number): number;
  removeShip(s: number): void;
  createConvoy(owner: number, nation: number, x: number, y: number, town: number): number;
  disbandConvoy(c: number): void;
  destroyConvoy(c: number): void;
  addShipToConvoy(s: number, c: number): void;
  shipCount(c: number): number;
  capacity(c: number): number;
  cargoTotal(c: number): number;
  freeSpace(c: number): number;
  buy(c: number, g: number, n: number): number;
  sell(c: number, g: number, n: number): number;
  sailTo(c: number, x: number, y: number, town: number): number;
  sailToTown(c: number, t: number): number;
  stopConvoy(c: number): void;
  convoySpeed(c: number, heading: number): number;
  routeRemaining(c: number): number;
  windFactor(heading: number): number;
  convoyStrength(c: number): number;
  convoyUpkeep(c: number): number;
  autoResolve(player: number, pirate: number): number;
  releaseEncounter(player: number, pirate: number): void;
  spawnTrader(): number;
  spawnPirate(): number;
  // battle
  battleBegin(): void;
  battleAddShip(ship: number, side: number, x: number, y: number, heading: number): number;
  battleStep(dt: number): void;
  battleFire(i: number, side: number): number;
  battleBoard(i: number): number;
  battleSetTarget(i: number, x: number, y: number): void;
  battleSetSail(i: number, v: number): void;
  battleSetAmmo(i: number, a: number): void;
  battleSetAuto(i: number, manual: number, autoFire: number): void;
  battleFlee(): void;
  battleApply(playerConvoy: number, enemyConvoy: number): number;
  battleActive(i: number): number;
  battleShipCount(): number;
  battleResult(): number;
  battleClock(): number;
}

export const Owner = { Player: 0, Trader: 1, Pirate: 2 } as const;
export type Owner = (typeof Owner)[keyof typeof Owner];
export const CvState = { Free: 0, Docked: 1, Sailing: 2, Halted: 3 } as const;
export const Ev = {
  Arrived: 1, Encounter: 2, NpcRaided: 3, Day: 4,
  BattleHit: 10, BattleSplash: 11, BattleFire: 12, BattleSunk: 13, BattleBoarded: 14, BattleEnd: 15,
  PathFailed: 20,
} as const;
export type Ev = (typeof Ev)[keyof typeof Ev];
export const Ammo = { Round: 0, Grape: 1, Chain: 2 } as const;
export const BattleFlag = { Sunk: 1, Captured: 2, Escaped: 4, Fleeing: 8 } as const;

/** Pointer ids, matching ptr() in wasm/assembly/index.ts. */
const P = {
  world: 0, townX: 1, townY: 2, townPop: 3, townNation: 4, townRank: 5, townSatisfaction: 6, townStock: 7,
  townBusinesses: 8, townProduced: 9, townConsumed: 10, cvState: 11, cvOwner: 12, cvNation: 13, cvX: 14, cvY: 15,
  cvHeading: 16, cvSpeed: 17, cvTown: 18, cvDest: 19, cvPathLen: 20, cvPathIdx: 21, cvPath: 22, cvCargo: 23,
  cvAiState: 24, cvAiTimer: 25, cvAiTarget: 26, cvHome: 27, cvGold: 28, shActive: 29, shType: 30, shConvoy: 31,
  shTown: 32, shOwner: 33, shHull: 34, shSails: 35, shCrew: 36, shCannons: 37, bsShip: 38, bsSide: 39, bsType: 40,
  bsFlags: 41, bsX: 42, bsY: 43, bsHeading: 44, bsSpeed: 45, bsSail: 46, bsHull: 47, bsHullMax: 48, bsSails: 49,
  bsCrew: 50, bsCannons: 51, bsReloadL: 52, bsReloadR: 53, bsAmmo: 54, bsLength: 55, ballX: 56, ballY: 57,
  ballLife: 58, ballAmmo: 59, pathX: 60, pathY: 61,
} as const;

export interface CoreEvent {
  type: number;
  a: number;
  b: number;
}

export class Core {
  readonly x: CoreExports;
  readonly MAX_TOWNS: number;
  readonly MAX_GOODS: number;
  readonly MAX_CONVOYS: number;
  readonly MAX_SHIPS: number;
  readonly MAX_WP: number;
  readonly MAX_BS: number;
  readonly MAX_BALLS: number;
  private buffer: ArrayBuffer | null = null;
  private v!: ReturnType<Core['makeViews']>;

  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as unknown as CoreExports;
    this.MAX_TOWNS = this.x.limits(0);
    this.MAX_GOODS = this.x.limits(1);
    this.MAX_CONVOYS = this.x.limits(2);
    this.MAX_SHIPS = this.x.limits(3);
    this.MAX_WP = this.x.limits(4);
    this.MAX_BS = this.x.limits(6);
    this.MAX_BALLS = this.x.limits(7);
  }

  static async load(source: BufferSource | Response | Promise<Response>): Promise<Core> {
    const imports = {
      env: {
        abort(_msg: number, _file: number, line: number, col: number) {
          throw new Error(`wasm abort at ${line}:${col}`);
        },
      },
    };
    let instance: WebAssembly.Instance;
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      instance = (await WebAssembly.instantiate(source, imports)).instance;
    } else {
      const res = await source;
      try {
        instance = (await WebAssembly.instantiateStreaming(res.clone(), imports)).instance;
      } catch {
        instance = (await WebAssembly.instantiate(await res.arrayBuffer(), imports)).instance;
      }
    }
    return new Core(instance);
  }

  private makeViews() {
    const b = this.x.memory.buffer;
    const f = (id: number, n: number) => new Float64Array(b, this.x.ptr(id), n);
    const i = (id: number, n: number) => new Int32Array(b, this.x.ptr(id), n);
    const T = this.MAX_TOWNS, G = this.MAX_GOODS, C = this.MAX_CONVOYS, S = this.MAX_SHIPS, B = this.MAX_BS, BB = this.MAX_BALLS;
    return {
      world: f(P.world, 16),
      townX: f(P.townX, T), townY: f(P.townY, T), townPop: f(P.townPop, T), townNation: i(P.townNation, T),
      townRank: i(P.townRank, T), townSatisfaction: f(P.townSatisfaction, T), townStock: f(P.townStock, T * G),
      townBusinesses: f(P.townBusinesses, T * G), townProduced: f(P.townProduced, T * G), townConsumed: f(P.townConsumed, T * G),
      cvState: i(P.cvState, C), cvOwner: i(P.cvOwner, C), cvNation: i(P.cvNation, C), cvX: f(P.cvX, C), cvY: f(P.cvY, C),
      cvHeading: f(P.cvHeading, C), cvSpeed: f(P.cvSpeed, C), cvTown: i(P.cvTown, C), cvDest: i(P.cvDest, C),
      cvPathLen: i(P.cvPathLen, C), cvPathIdx: i(P.cvPathIdx, C), cvPath: f(P.cvPath, C * this.MAX_WP * 2),
      cvCargo: f(P.cvCargo, C * G), cvAiState: i(P.cvAiState, C), cvAiTimer: f(P.cvAiTimer, C), cvAiTarget: i(P.cvAiTarget, C),
      cvHome: f(P.cvHome, C * 2), cvGold: f(P.cvGold, C),
      shActive: i(P.shActive, S), shType: i(P.shType, S), shConvoy: i(P.shConvoy, S), shTown: i(P.shTown, S),
      shOwner: i(P.shOwner, S), shHull: f(P.shHull, S), shSails: f(P.shSails, S), shCrew: f(P.shCrew, S), shCannons: f(P.shCannons, S),
      bsShip: i(P.bsShip, B), bsSide: i(P.bsSide, B), bsType: i(P.bsType, B), bsFlags: i(P.bsFlags, B),
      bsX: f(P.bsX, B), bsY: f(P.bsY, B), bsHeading: f(P.bsHeading, B), bsSpeed: f(P.bsSpeed, B), bsSail: f(P.bsSail, B),
      bsHull: f(P.bsHull, B), bsHullMax: f(P.bsHullMax, B), bsSails: f(P.bsSails, B), bsCrew: f(P.bsCrew, B),
      bsCannons: f(P.bsCannons, B), bsReloadL: f(P.bsReloadL, B), bsReloadR: f(P.bsReloadR, B), bsAmmo: i(P.bsAmmo, B),
      bsLength: f(P.bsLength, B), ballX: f(P.ballX, BB), ballY: f(P.ballY, BB), ballLife: f(P.ballLife, BB), ballAmmo: i(P.ballAmmo, BB),
      pathX: f(P.pathX, 96), pathY: f(P.pathY, 96),
    };
  }

  /** Typed views over WASM memory (re-created if the memory grew). */
  get s() {
    if (this.buffer !== this.x.memory.buffer) {
      this.buffer = this.x.memory.buffer;
      this.v = this.makeViews();
    }
    return this.v;
  }

  /** Copy the unpacked nav grid into WASM memory and build the clearance field. */
  loadNav(packed: Uint8Array, mapWidthPx: number): void {
    const w = packed[0] | (packed[1] << 8);
    const h = packed[2] | (packed[3] << 8);
    const grid = new Uint8Array(this.x.memory.buffer, this.x.navPtr(), w * h);
    for (let i = 0; i < w * h; i++) {
      const byte = packed[4 + (i >> 3)];
      grid[i] = (byte >> (7 - (i & 7))) & 1; // MSB first, 1 = land
    }
    this.x.navInit(w, h, mapWidthPx);
  }

  drainEvents(): CoreEvent[] {
    const n = this.x.eventCount();
    const out: CoreEvent[] = [];
    for (let i = 0; i < n; i++) out.push({ type: this.x.eventType(i), a: this.x.eventA(i), b: this.x.eventB(i) });
    this.x.eventsClear();
    return out;
  }

  /** Ships belonging to convoy c. */
  shipsOf(c: number): number[] {
    const s = this.s;
    const out: number[] = [];
    for (let i = 0; i < this.MAX_SHIPS; i++) if (s.shActive[i] && s.shConvoy[i] === c) out.push(i);
    return out;
  }

  /** Ships laid up in town t (not assigned to a convoy) owned by `owner`. */
  harbourShips(t: number, owner: number = Owner.Player): number[] {
    const s = this.s;
    const out: number[] = [];
    for (let i = 0; i < this.MAX_SHIPS; i++) if (s.shActive[i] && s.shConvoy[i] < 0 && s.shTown[i] === t && s.shOwner[i] === owner) out.push(i);
    return out;
  }

  convoys(owner?: number): number[] {
    const s = this.s;
    const out: number[] = [];
    for (let c = 0; c < this.MAX_CONVOYS; c++) if (s.cvState[c] !== CvState.Free && (owner === undefined || s.cvOwner[c] === owner)) out.push(c);
    return out;
  }

  stock(t: number, g: number): number {
    return this.s.townStock[t * this.MAX_GOODS + g];
  }

  cargo(c: number, g: number): number {
    return this.s.cvCargo[c * this.MAX_GOODS + g];
  }

  path(c: number): [number, number][] {
    const s = this.s;
    const out: [number, number][] = [];
    for (let i = s.cvPathIdx[c]; i < s.cvPathLen[c]; i++) {
      const k = (c * this.MAX_WP + i) * 2;
      out.push([s.cvPath[k], s.cvPath[k + 1]]);
    }
    return out;
  }

  /** Raw copies of every state array, for save games. */
  snapshot(): Record<string, number[]> {
    const s = this.s as Record<string, Float64Array | Int32Array>;
    const out: Record<string, number[]> = {};
    for (const k of Object.keys(s)) if (!k.startsWith('bs') && !k.startsWith('ball') && !k.startsWith('path')) out[k] = Array.from(s[k]);
    out.rng = [this.x.rngState()];
    return out;
  }

  restore(snap: Record<string, number[]>): void {
    const s = this.s as Record<string, Float64Array | Int32Array>;
    for (const k of Object.keys(snap)) if (s[k]) s[k].set(snap[k].slice(0, s[k].length));
    if (snap.rng) this.x.setRngState(snap.rng[0] >>> 0);
  }
}
