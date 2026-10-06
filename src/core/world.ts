/** Builds the simulation from extracted game data and sets up a new campaign. */
import { Core, Owner } from './core.ts';
import { type GameData, NATIONS } from './data.ts';

export const NATION_PIRATE = 4;

/** Starting populations by town rank (the original's exact values are not in the data files). */
function startPopulation(rank: string, id: number): number {
  const jitter = ((id * 2654435761) >>> 0) / 4294967296;
  if (rank === 'viceroy') return 4200 + jitter * 1200;
  if (rank === 'governor') return 2800 + jitter * 1000;
  return 1100 + jitter * 1400;
}

export function configureCore(core: Core, data: GameData, nav: Uint8Array, seed: number): void {
  const x = core.x;
  x.setup(data.goods.length, data.towns.length, seed >>> 0, data.map.width, data.map.height);
  core.loadNav(nav, data.map.width);
  const goodIndex = new Map(data.goods.map((g) => [g.key, g.id]));
  for (const g of data.goods) {
    const raw = g.rawMaterial ? goodIndex.get(g.rawMaterial) ?? -1 : -1;
    x.setGood(g.id, g.basePrice, g.demandPerCitizen, g.production, g.consumption, raw);
  }
  for (const s of data.ships) {
    x.setShipType(s.id, s.cargo, s.vmin, s.vmax, s.guns, s.crew, s.hull, s.agility, s.price, s.upkeep, s.draught);
  }
  for (const t of data.towns) {
    const rank = t.rank === 'viceroy' ? 2 : t.rank === 'governor' ? 1 : 0;
    x.setTown(t.id, t.dock[0], t.dock[1], startPopulation(t.rank, t.id), NATIONS.indexOf(t.nation), rank);
    for (const g of t.produces) x.setTownProduces(t.id, g);
  }
  data.pirateHideouts.forEach(([hx, hy], i) => {
    // hideout coordinates are the icon's top-left corner; the lair is just offshore
    x.setHideout(i, hx + 16, hy + 16);
  });
  x.setPopulationTargets(56, 12);
}

export interface NewGameOptions {
  startTown: number;
  gold: number;
  ships: { type: number; name: string }[];
}

export interface PlayerSetup {
  convoy: number;
  shipNames: Map<number, string>;
}

/** Start a campaign: warm the economy up, then give the player a convoy in the start town. */
export function newGame(core: Core, data: GameData, opts: NewGameOptions): PlayerSetup {
  const x = core.x;
  x.initWorld();
  x.warmUp(20);
  x.setGold(opts.gold);
  const t = data.towns[opts.startTown];
  const s = core.s;
  const convoy = x.createConvoy(Owner.Player, NATIONS.indexOf(t.nation), s.townX[t.id], s.townY[t.id], t.id);
  const shipNames = new Map<number, string>();
  for (const sh of opts.ships) {
    const id = x.createShip(sh.type, Owner.Player, t.id);
    const def = data.ships[sh.type];
    // a fresh crew and a modest battery
    core.s.shCrew[id] = Math.ceil(def.crew * 0.6);
    core.s.shCannons[id] = Math.floor(def.guns * 0.5);
    x.addShipToConvoy(id, convoy);
    shipNames.set(id, sh.name);
  }
  core.drainEvents();
  return { convoy, shipNames };
}
