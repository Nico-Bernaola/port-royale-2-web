// Simulation state, stored as fixed-capacity structure-of-arrays so the host can read it
// zero-copy and snapshot it for save games. Everything is allocated once at start-up
// (the module is built with the "stub" runtime, which never frees memory).

export const MAX_TOWNS: i32 = 64;
export const MAX_GOODS: i32 = 20;
export const MAX_SHIP_TYPES: i32 = 20;
export const MAX_CONVOYS: i32 = 192;
export const MAX_SHIPS: i32 = 768;
export const MAX_WP: i32 = 96; // waypoints per convoy path

// Convoy owners
export const OWNER_PLAYER: i32 = 0;
export const OWNER_TRADER: i32 = 1;
export const OWNER_PIRATE: i32 = 2;

// Convoy states
export const CV_FREE: i32 = 0; // slot unused
export const CV_DOCKED: i32 = 1;
export const CV_SAILING: i32 = 2;
export const CV_HALTED: i32 = 3; // engaged in an encounter, waiting for the host

// Events reported to the host
export const EV_ARRIVED: i32 = 1; // a = convoy, b = town
export const EV_ENCOUNTER: i32 = 2; // a = player convoy, b = pirate convoy
export const EV_NPC_RAIDED: i32 = 3; // a = victim convoy, b = pirate convoy
export const EV_DAY: i32 = 4; // a = day number
export const EV_BATTLE_HIT: i32 = 10; // a = battle ship, b = ammo
export const EV_BATTLE_SPLASH: i32 = 11; // a = x, b = y
export const EV_BATTLE_FIRE: i32 = 12; // a = battle ship, b = guns fired
export const EV_BATTLE_SUNK: i32 = 13; // a = battle ship
export const EV_BATTLE_BOARDED: i32 = 14; // a = attacker, b = captured
export const EV_BATTLE_END: i32 = 15; // a = winner side (0 player, 1 enemy, 2 escaped)
export const EV_PATH_FAILED: i32 = 20; // a = convoy

// ---- world --------------------------------------------------------------------------------
export const world = new StaticArray<f64>(16);
// world[0] = time in days, [1] = wind direction (rad, direction the wind blows towards),
// [2] = wind strength 0..1, [3] = player gold, [4] = last processed day, [5] = rng state,
// [6] = map width px, [7] = map height px

// ---- goods (static parameters) ------------------------------------------------------------
export const goodBasePrice = new StaticArray<f64>(MAX_GOODS);
export const goodDemand = new StaticArray<f64>(MAX_GOODS); // kg per inhabitant
export const goodProd = new StaticArray<f64>(MAX_GOODS); // barrels per business per day
export const goodRawUse = new StaticArray<f64>(MAX_GOODS); // raw barrels per business per day
export const goodRaw = new StaticArray<i32>(MAX_GOODS); // raw material good or -1
export let numGoods: i32 = 0;
export function setNumGoods(n: i32): void {
  numGoods = n;
}

// ---- ship types ---------------------------------------------------------------------------
export const typeCargo = new StaticArray<f64>(MAX_SHIP_TYPES);
export const typeVmin = new StaticArray<f64>(MAX_SHIP_TYPES);
export const typeVmax = new StaticArray<f64>(MAX_SHIP_TYPES);
export const typeGuns = new StaticArray<f64>(MAX_SHIP_TYPES);
export const typeCrew = new StaticArray<f64>(MAX_SHIP_TYPES);
export const typeHull = new StaticArray<f64>(MAX_SHIP_TYPES); // structure points
export const typeAgility = new StaticArray<f64>(MAX_SHIP_TYPES); // percent
export const typePrice = new StaticArray<f64>(MAX_SHIP_TYPES);
export const typeUpkeep = new StaticArray<f64>(MAX_SHIP_TYPES);
export const typeDraught = new StaticArray<f64>(MAX_SHIP_TYPES);

// ---- towns --------------------------------------------------------------------------------
export let numTowns: i32 = 0;
export function setNumTowns(n: i32): void {
  numTowns = n;
}
export const townX = new StaticArray<f64>(MAX_TOWNS); // dock position (map px)
export const townY = new StaticArray<f64>(MAX_TOWNS);
export const townPop = new StaticArray<f64>(MAX_TOWNS);
export const townNation = new StaticArray<i32>(MAX_TOWNS);
export const townRank = new StaticArray<i32>(MAX_TOWNS); // 0 colony, 1 governor, 2 viceroy
export const townSatisfaction = new StaticArray<f64>(MAX_TOWNS);
export const townStock = new StaticArray<f64>(MAX_TOWNS * MAX_GOODS);
export const townBusinesses = new StaticArray<f64>(MAX_TOWNS * MAX_GOODS);
export const townProduced = new StaticArray<f64>(MAX_TOWNS * MAX_GOODS); // last day production
export const townConsumed = new StaticArray<f64>(MAX_TOWNS * MAX_GOODS); // last day consumption

// ---- convoys ------------------------------------------------------------------------------
export const cvState = new StaticArray<i32>(MAX_CONVOYS);
export const cvOwner = new StaticArray<i32>(MAX_CONVOYS);
export const cvNation = new StaticArray<i32>(MAX_CONVOYS);
export const cvX = new StaticArray<f64>(MAX_CONVOYS);
export const cvY = new StaticArray<f64>(MAX_CONVOYS);
export const cvHeading = new StaticArray<f64>(MAX_CONVOYS); // radians, 0 = east, clockwise (screen)
export const cvSpeed = new StaticArray<f64>(MAX_CONVOYS); // knots
export const cvTown = new StaticArray<i32>(MAX_CONVOYS); // docked town or -1
export const cvDest = new StaticArray<i32>(MAX_CONVOYS); // destination town or -1
export const cvPathLen = new StaticArray<i32>(MAX_CONVOYS);
export const cvPathIdx = new StaticArray<i32>(MAX_CONVOYS);
export const cvPath = new StaticArray<f64>(MAX_CONVOYS * MAX_WP * 2);
export const cvCargo = new StaticArray<f64>(MAX_CONVOYS * MAX_GOODS);
export const cvAiState = new StaticArray<i32>(MAX_CONVOYS);
export const cvAiTimer = new StaticArray<f64>(MAX_CONVOYS);
export const cvAiTarget = new StaticArray<i32>(MAX_CONVOYS);
export const cvHome = new StaticArray<f64>(MAX_CONVOYS * 2); // pirate lair / home point
export const cvGold = new StaticArray<f64>(MAX_CONVOYS); // NPC trading capital

// ---- ships --------------------------------------------------------------------------------
export const shActive = new StaticArray<i32>(MAX_SHIPS);
export const shType = new StaticArray<i32>(MAX_SHIPS);
export const shConvoy = new StaticArray<i32>(MAX_SHIPS); // owning convoy or -1 (laid up in harbour)
export const shTown = new StaticArray<i32>(MAX_SHIPS); // harbour when shConvoy == -1
export const shOwner = new StaticArray<i32>(MAX_SHIPS);
export const shHull = new StaticArray<f64>(MAX_SHIPS); // condition 0..100 %
export const shSails = new StaticArray<f64>(MAX_SHIPS); // condition 0..100 %
export const shCrew = new StaticArray<f64>(MAX_SHIPS);
export const shCannons = new StaticArray<f64>(MAX_SHIPS);

// ---- events -------------------------------------------------------------------------------
export const MAX_EVENTS: i32 = 256;
export const evType = new StaticArray<i32>(MAX_EVENTS);
export const evA = new StaticArray<f64>(MAX_EVENTS);
export const evB = new StaticArray<f64>(MAX_EVENTS);
export let evCount: i32 = 0;
export function clearEvents(): void {
  evCount = 0;
}
export function pushEvent(t: i32, a: f64, b: f64): void {
  if (evCount >= MAX_EVENTS) return;
  unchecked((evType[evCount] = t));
  unchecked((evA[evCount] = a));
  unchecked((evB[evCount] = b));
  evCount++;
}

// ---- random numbers (xorshift32, state kept in world[5] so saves are deterministic) ---------
let rngState: u32 = 0x9e3779b9;
export function seedRng(seed: u32): void {
  rngState = seed == 0 ? 0x9e3779b9 : seed;
}
export function rngGet(): u32 {
  return rngState;
}
export function rand(): f64 {
  let x = rngState;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rngState = x;
  return <f64>x / 4294967296.0;
}
export function randInt(n: i32): i32 {
  return <i32>(rand() * <f64>n);
}
