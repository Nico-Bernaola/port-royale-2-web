/**
 * Game world: towns at their real-world positions, goods and ship classes. All numbers here
 * are this project's own design (balanced for the WASM economy), not taken from any game.
 */
import type { GameData, GoodDef, Nation, ShipDef, TownDef } from '../core/data.ts';
import { MAP_H, MAP_W, project } from './geo.ts';

// ---- goods ---------------------------------------------------------------------------------

type GoodSpec = [key: string, name: string, price: number, demand: number, prod: number, raw: string | null, rawUse: number];
const GOODS: GoodSpec[] = [
  ['corn', 'Corn', 90, 9, 2.2, null, 0],
  ['sugar', 'Sugar', 110, 8, 2.0, null, 0],
  ['hemp', 'Hemp', 100, 7, 2.0, null, 0],
  ['cotton', 'Cotton', 105, 7, 2.0, null, 0],
  ['wheat', 'Wheat', 75, 20, 2.6, null, 0],
  ['fruit', 'Fruit', 70, 18, 2.6, null, 0],
  ['wood', 'Timber', 80, 14, 2.6, null, 0],
  ['bricks', 'Bricks', 85, 13, 2.4, null, 0],
  ['coffee', 'Coffee', 160, 8, 2.0, 'tools', 0.2],
  ['tobacco', 'Tobacco', 155, 8, 2.0, 'tools', 0.2],
  ['dyes', 'Indigo', 170, 7, 2.0, 'tools', 0.2],
  ['cocoa', 'Cocoa', 150, 8, 2.0, 'tools', 0.2],
  ['meat', 'Meat', 280, 8, 1.0, 'corn', 1],
  ['rum', 'Rum', 310, 8, 1.0, 'sugar', 1],
  ['ropes', 'Rope', 290, 7, 1.0, 'hemp', 1],
  ['textiles', 'Cloth', 300, 8, 1.0, 'cotton', 1],
  ['wine', 'Wine', 480, 8, 0, null, 0],
  ['spices', 'Spices', 520, 7, 0, null, 0],
  ['tools', 'Tools', 450, 1.6, 0, null, 0],
];

export const goods: GoodDef[] = GOODS.map(([key, name, price, demand, prod, raw, rawUse], id) => ({
  id, key, name, basePrice: price, demandPerCitizen: demand, totalDemand: demand, producible: prod > 0,
  workers: 30, production: prod, consumption: rawUse, rawMaterial: raw, buildCost: 10000,
}));
const G = Object.fromEntries(goods.map((g) => [g.key, g.id])) as Record<string, number>;

// ---- ships ---------------------------------------------------------------------------------

type ShipSpec = [key: string, name: string, cargo: number, vmin: number, vmax: number, guns: number, crew: number, hull: number, agility: number, price: number, upkeep: number, draught: number, buildDays: number];
const SHIPS: ShipSpec[] = [
  ['pinnace', 'Pinnace', 70, 6, 11, 8, 30, 30, 100, 9000, 20, 0, 12],
  ['sloop', 'Sloop', 80, 6, 12, 14, 40, 32, 100, 17000, 30, 0, 14],
  ['brig', 'Brig', 110, 5, 11, 16, 50, 45, 95, 26000, 45, 0, 18],
  ['barque', 'Barque', 120, 5, 12, 20, 60, 45, 90, 33000, 55, 0, 18],
  ['raider', 'Raider Barque', 110, 5, 13, 24, 80, 45, 92, 36000, 60, 0, 20],
  ['fluyt', 'Fluyt', 200, 4, 10, 16, 70, 60, 80, 40000, 40, 1, 22],
  ['merchantman', 'East Indiaman', 260, 4, 10, 12, 90, 85, 70, 52000, 50, 1, 26],
  ['corvette', 'Corvette', 140, 5, 13, 24, 90, 70, 85, 62000, 90, 0, 24],
  ['frigate', 'Frigate', 170, 5, 12, 32, 120, 85, 80, 85000, 110, 1, 30],
  ['galleon', 'Galleon', 220, 4, 10, 40, 150, 110, 70, 120000, 140, 2, 34],
  ['manofwar', 'Man-of-War', 180, 4, 12, 56, 220, 140, 60, 190000, 220, 2, 42],
];

export interface ShipClass extends ShipDef {
  buildDays: number;
}

export const ships: ShipClass[] = SHIPS.map(([key, name, cargo, vmin, vmax, guns, crew, hull, agility, price, upkeep, draught, buildDays], id) => ({
  id, key, folder: key, name, agility, crew, hull, cargo, draught, vmin, vmax, upkeep, guns, price, buildDays,
}));
export const S = Object.fromEntries(ships.map((s) => [s.key, s.id])) as Record<string, number>;

/** Materials a shipyard needs to build a ship (barrels), scaled by hull size. */
export function buildMaterials(s: ShipDef): { good: number; amount: number }[] {
  const k = s.hull / 10;
  return [
    { good: G.wood, amount: Math.round(k * 6) },
    { good: G.ropes, amount: Math.round(k * 1.5) },
    { good: G.textiles, amount: Math.round(k * 1.5) },
  ];
}

// ---- towns ---------------------------------------------------------------------------------

type TownSpec = [name: string, lat: number, lon: number, nation: Nation, rank?: 'governor' | 'viceroy'];
const TOWNS: TownSpec[] = [
  // Spain
  ['Havana', 23.14, -82.36, 'Spain', 'viceroy'],
  ['Santo Domingo', 18.47, -69.89, 'Spain', 'viceroy'],
  ['Cartagena', 10.42, -75.54, 'Spain', 'viceroy'],
  ['Veracruz', 19.2, -96.13, 'Spain', 'viceroy'],
  ['San Juan', 18.47, -66.11, 'Spain', 'governor'],
  ['Santiago', 20.02, -75.83, 'Spain', 'governor'],
  ['Campeche', 19.85, -90.53, 'Spain', 'governor'],
  ['Maracaibo', 10.65, -71.62, 'Spain', 'governor'],
  ['Portobelo', 9.55, -79.65, 'Spain', 'governor'],
  ['St. Augustine', 29.89, -81.31, 'Spain', 'governor'],
  ['Caracas', 10.6, -66.93, 'Spain'],
  ['Santa Marta', 11.24, -74.21, 'Spain'],
  ['Coro', 11.42, -69.67, 'Spain'],
  ['Margarita', 11.0, -63.86, 'Spain'],
  ['Cumana', 10.47, -64.18, 'Spain'],
  ['Trinidad', 21.75, -79.99, 'Spain'],
  ['Gibara', 21.11, -76.13, 'Spain'],
  ['Tampico', 22.25, -97.85, 'Spain'],
  ['Sisal', 21.17, -90.03, 'Spain'],
  ['Cancun', 21.16, -86.83, 'Spain'],
  ['Nombre de Dios', 9.59, -79.47, 'Spain'],
  ['Pensacola', 30.4, -87.21, 'Spain'],
  ['Villahermosa', 18.55, -92.64, 'Spain'],
  ['Corpus Christi', 27.78, -97.38, 'Spain'],
  ['Isabela', 19.89, -71.08, 'Spain'],
  // England
  ['Port Royal', 17.94, -76.84, 'England', 'viceroy'],
  ['Bridgetown', 13.1, -59.62, 'England', 'governor'],
  ['Charles Town', 32.78, -79.93, 'England', 'governor'],
  ['Nassau', 25.06, -77.35, 'England', 'governor'],
  ['St. John\'s', 17.12, -61.85, 'England'],
  ['Basseterre', 17.3, -62.72, 'England'],
  ['Providence', 13.35, -81.37, 'England'],
  ['Belize', 17.5, -88.19, 'England'],
  ['George Town', 19.29, -81.38, 'England'],
  ['Freeport', 26.53, -78.7, 'England'],
  ['Eleuthera', 25.25, -76.3, 'England'],
  ['Andros', 24.7, -77.78, 'England'],
  ['Cat Island', 24.4, -75.52, 'England'],
  ['Roatan', 16.32, -86.53, 'England'],
  // France
  ['Tortuga', 20.04, -72.78, 'France', 'viceroy'],
  ['Fort Royal', 14.6, -61.07, 'France', 'governor'],
  ['Port-au-Prince', 18.54, -72.34, 'France', 'governor'],
  ['New Orleans', 29.95, -90.07, 'France', 'governor'],
  ['Basse-Terre', 16.0, -61.73, 'France'],
  ['Castries', 14.01, -61.0, 'France'],
  ['Biloxi', 30.4, -88.89, 'France'],
  ['St. George\'s', 12.05, -61.75, 'France'],
  ['Fort Caroline', 30.38, -81.5, 'France'],
  ['Charlesfort', 32.35, -80.68, 'France'],
  // Holland
  ['Willemstad', 12.11, -68.93, 'Holland', 'viceroy'],
  ['Philipsburg', 18.03, -63.05, 'Holland', 'governor'],
  ['Georgetown', 6.81, -58.16, 'Holland', 'governor'],
  ['Oranjestad', 12.52, -70.03, 'Holland'],
  ['Port of Spain', 10.66, -61.52, 'Holland'],
  ['Puerto Cabello', 10.47, -68.01, 'Holland'],
  ['Charlotte Amalie', 18.34, -64.93, 'Holland'],
  ['Grand Turk', 21.47, -71.14, 'Holland'],
  ['Key West', 24.55, -81.8, 'Holland'],
  ['Tampa', 27.95, -82.46, 'Holland'],
  ['Port St. Joe', 29.81, -85.3, 'Holland'],
];

/** Regional production: what grows where (roughly by latitude and coast). */
function regionalGoods(lat: number, lon: number, seed: number): number[] {
  const rnd = (n: number) => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  let pool: string[];
  if (lat > 27) pool = ['wheat', 'wood', 'hemp', 'corn', 'bricks', 'tobacco', 'ropes', 'meat'];
  else if (lat > 21) pool = ['sugar', 'tobacco', 'wood', 'fruit', 'corn', 'meat', 'rum', 'bricks'];
  else if (lon < -84) pool = ['dyes', 'wood', 'corn', 'cocoa', 'fruit', 'meat', 'cotton', 'bricks'];
  else if (lat < 13) pool = ['cocoa', 'coffee', 'cotton', 'fruit', 'meat', 'textiles', 'corn', 'wheat'];
  else pool = ['sugar', 'rum', 'cotton', 'coffee', 'fruit', 'textiles', 'wood', 'bricks'];
  // every town makes one staple so nobody starves completely
  const staples = ['wheat', 'fruit', 'wood', 'bricks'];
  const out = new Set<string>([staples[Math.floor(rnd(0) * staples.length)]]);
  let i = 1;
  while (out.size < 5) out.add(pool[Math.floor(rnd(i++) * pool.length)]);
  return [...out].map((k) => G[k]);
}

export const towns: TownDef[] = TOWNS.map(([name, lat, lon, nation, rank], id) => {
  const [x, y] = project(lon, lat);
  return {
    id,
    key: name.replace(/[^A-Za-z]/g, ''),
    name,
    nation,
    rank: rank ?? 'colony',
    x,
    y,
    dock: [x, y],
    label: [x, y - 12, 'r'],
    seaSide: 0,
    produces: regionalGoods(lat, lon, id + 1),
    hasTownView: true,
  };
});

/** Pirate hideouts: secluded keys and coves (lat, lon). */
const HIDEOUTS: [number, number][] = [
  [26.7, -77.0], [23.6, -75.9], [22.3, -74.3], [21.9, -82.8], [19.0, -81.0], [16.5, -86.0], [12.6, -81.7],
  [18.5, -63.4], [16.6, -61.5], [12.4, -61.4], [11.8, -66.7], [12.3, -71.8], [15.9, -83.3], [24.9, -80.6],
  [29.2, -89.2], [20.3, -86.9], [17.7, -71.6], [19.9, -74.6],
];

export const world: GameData = {
  map: { width: MAP_W, height: MAP_H, tile: 256, cols: Math.ceil(MAP_W / 256), rows: Math.ceil(MAP_H / 256) },
  barrelKg: 0,
  goods,
  towns,
  ships,
  pirateHideouts: HIDEOUTS.map(([lat, lon]) => {
    const [x, y] = project(lon, lat);
    return [x, y, 0] as [number, number, number];
  }),
  battle: {},
};
