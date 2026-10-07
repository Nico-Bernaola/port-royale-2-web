/** Shapes of the static game data (see src/data/world.ts). */

export interface GoodDef {
  id: number;
  key: string;
  name: string;
  basePrice: number;
  demandPerCitizen: number;
  totalDemand: number;
  producible: boolean;
  workers: number;
  production: number;
  consumption: number;
  rawMaterial: string | null;
  buildCost: number;
}

export type Nation = 'Spain' | 'England' | 'France' | 'Holland';
export const NATIONS: Nation[] = ['Spain', 'England', 'France', 'Holland'];

export interface TownDef {
  id: number;
  key: string;
  name: string;
  nation: Nation;
  rank: 'colony' | 'governor' | 'viceroy';
  x: number;
  y: number;
  dock: [number, number];
  label: [number, number, string];
  seaSide: number;
  produces: number[];
  hasTownView: boolean;
}

export interface ShipDef {
  id: number;
  key: string;
  folder: string;
  name: string;
  agility: number;
  crew: number;
  hull: number;
  cargo: number;
  draught: number;
  vmin: number;
  vmax: number;
  upkeep: number;
  guns: number;
  price: number;
}

export interface GameData {
  map: { width: number; height: number; tile: number; cols: number; rows: number };
  barrelKg: number;
  goods: GoodDef[];
  towns: TownDef[];
  ships: ShipDef[];
  pirateHideouts: [number, number, number][];
  battle: Record<string, Record<string, number>>;
}
