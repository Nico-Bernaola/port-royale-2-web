// Port Royale 2 simulation core (AssemblyScript -> WebAssembly).
//
// The host (TypeScript) loads static game data through the set* functions, then calls tick()
// every frame. All state lives in fixed arrays exposed through ptr*() so the host can read it
// without copying and serialise it for save games.

import {
  MAX_TOWNS, MAX_GOODS, MAX_CONVOYS, MAX_SHIPS, MAX_WP, MAX_EVENTS, CV_FREE, EV_DAY, OWNER_PLAYER,
  world, numTowns, setNumGoods, setNumTowns, goodBasePrice, goodDemand, goodProd, goodRawUse, goodRaw,
  typeCargo, typeVmin, typeVmax, typeGuns, typeCrew, typeHull, typeAgility, typePrice, typeUpkeep, typeDraught,
  townX, townY, townPop, townNation, townRank, townSatisfaction, townStock, townBusinesses, townProduced, townConsumed,
  cvState, cvOwner, cvNation, cvX, cvY, cvHeading, cvSpeed, cvTown, cvDest, cvPathLen, cvPathIdx, cvPath, cvCargo,
  cvAiState, cvAiTimer, cvAiTarget, cvHome, cvGold,
  shActive, shType, shConvoy, shTown, shOwner, shHull, shSails, shCrew, shCannons,
  evType, evA, evB, evCount, clearEvents, pushEvent, seedRng, rngGet, rand,
} from './state';
import { economyDay, initTownEconomy, buyPrice, sellPrice, quoteBuy, quoteSell, dailyDemand } from './economy';
import { navInit, navPtr, findPath, pathLen, pathX, pathY, isWater, snapToWater, coastDistance } from './nav';
import {
  createShip, removeShip, createConvoy, disbandConvoy, destroyConvoy, addShipToConvoy, shipCount, capacity,
  cargoTotal, freeSpace, buy, sell, sailTo, sailToTown, stopConvoy, moveConvoys, convoySpeed, routeRemaining,
  windFactor, convoyStrength,
} from './fleet';
import { updateAi, maintainPopulation, setHideout, setPopulationTargets, autoResolve, releaseEncounter, spawnTrader, spawnPirate } from './ai';
import {
  battleBegin, battleAddShip, battleStep, battleFire, battleBoard, battleSetTarget, battleSetSail, battleSetAmmo,
  battleSetAuto, battleFlee, battleApply, battleActive, bsCount, battleOver, battleTime,
  bsShip, bsSide, bsType, bsFlags, bsX, bsY, bsHeading, bsSpeed, bsSail, bsHull, bsHullMax, bsSails, bsCrew,
  bsCannons, bsReloadL, bsReloadR, bsAmmo, bsLength, ballX, ballY, ballLife, ballAmmo, MAX_BS, MAX_BALLS,
} from './battle';

// re-export the command API
export {
  buyPrice, sellPrice, quoteBuy, quoteSell, dailyDemand,
  findPath, isWater, snapToWater, coastDistance,
  createShip, removeShip, createConvoy, disbandConvoy, destroyConvoy, addShipToConvoy, shipCount, capacity,
  cargoTotal, freeSpace, buy, sell, sailTo, sailToTown, stopConvoy, convoySpeed, routeRemaining, windFactor,
  convoyStrength, setHideout, setPopulationTargets, autoResolve, releaseEncounter, spawnTrader, spawnPirate,
  battleBegin, battleAddShip, battleStep, battleFire, battleBoard, battleSetTarget, battleSetSail, battleSetAmmo,
  battleSetAuto, battleFlee, battleApply, battleActive, initTownEconomy,
};

// ---- static data setup ----------------------------------------------------------------------

export function setup(goods: i32, towns: i32, seed: u32, mapW: f64, mapH: f64): void {
  setNumGoods(goods);
  setNumTowns(towns);
  seedRng(seed);
  unchecked((world[0] = 0));
  unchecked((world[1] = 0.6)); // trade winds blow roughly east->west; refined by weather
  unchecked((world[2] = 0.7));
  unchecked((world[3] = 0));
  unchecked((world[4] = 0));
  unchecked((world[6] = mapW));
  unchecked((world[7] = mapH));
  for (let c = 0; c < MAX_CONVOYS; c++) unchecked((cvState[c] = CV_FREE));
  for (let s = 0; s < MAX_SHIPS; s++) unchecked((shActive[s] = 0));
}

export function setGood(g: i32, basePrice: f64, demand: f64, prod: f64, rawUse: f64, raw: i32): void {
  unchecked((goodBasePrice[g] = basePrice));
  unchecked((goodDemand[g] = demand));
  unchecked((goodProd[g] = prod));
  unchecked((goodRawUse[g] = rawUse));
  unchecked((goodRaw[g] = raw));
}

export function setShipType(t: i32, cargo: f64, vmin: f64, vmax: f64, guns: f64, crew: f64, hull: f64, agility: f64, price: f64, upkeep: f64, draught: f64): void {
  unchecked((typeCargo[t] = cargo));
  unchecked((typeVmin[t] = vmin));
  unchecked((typeVmax[t] = vmax));
  unchecked((typeGuns[t] = guns));
  unchecked((typeCrew[t] = crew));
  unchecked((typeHull[t] = hull));
  unchecked((typeAgility[t] = agility));
  unchecked((typePrice[t] = price));
  unchecked((typeUpkeep[t] = upkeep));
  unchecked((typeDraught[t] = draught));
}

export function setTown(t: i32, x: f64, y: f64, pop: f64, nation: i32, rank: i32): void {
  // dock position snapped to navigable water
  if (snapToWater(x, y)) {
    unchecked((townX[t] = pathX[0]));
    unchecked((townY[t] = pathY[0]));
  } else {
    unchecked((townX[t] = x));
    unchecked((townY[t] = y));
  }
  unchecked((townPop[t] = pop));
  unchecked((townNation[t] = nation));
  unchecked((townRank[t] = rank));
  for (let g = 0; g < MAX_GOODS; g++) unchecked((townBusinesses[t * MAX_GOODS + g] = 0));
}

/** Mark good g as produced in town t (businesses are sized by initTownEconomy). */
export function setTownProduces(t: i32, g: i32): void {
  unchecked((townBusinesses[t * MAX_GOODS + g] = 1));
}

export { navInit, navPtr };

// ---- main loop ------------------------------------------------------------------------------

/** Weather: the wind veers slowly around the prevailing easterly trade wind. */
function updateWind(dt: f64): void {
  const base = Math.PI; // blowing towards the west
  const cur = unchecked(world[1]);
  const drift = (rand() - 0.5) * 0.6 * dt + (base - cur) * 0.05 * dt;
  unchecked((world[1] = cur + drift));
  const s = unchecked(world[2]) + (rand() - 0.5) * 0.4 * dt;
  unchecked((world[2] = Math.max(0.2, Math.min(1.0, s))));
}

/**
 * Advance the world by dt game days. Economy and AI population updates happen once per day;
 * movement and AI decisions every call. Events are queued for the host (see ev*()).
 */
export function tick(dt: f64): void {
  // sub-step long frames so fast ships do not skip encounter checks
  let remaining = dt;
  while (remaining > 0) {
    const h = Math.min(remaining, 0.02);
    remaining -= h;
    unchecked((world[0] += h));
    updateWind(h);
    moveConvoys(h);
    updateAi(h);
    const day = Math.floor(unchecked(world[0]));
    if (day > unchecked(world[4])) {
      economyDay();
      maintainPopulation();
      pushEvent(EV_DAY, day, 0);
    }
  }
}

export function initWorld(): void {
  for (let t = 0; t < numTowns; t++) initTownEconomy(t);
  maintainPopulation();
  // let the computer traders spread out before the player arrives
  for (let i = 0; i < 30; i++) {
    moveConvoys(0.1);
    updateAi(0.1);
  }
}

/** Day-by-day warm-up so stocks and prices settle before the game starts. */
export function warmUp(days: i32): void {
  for (let d = 0; d < days; d++) {
    economyDay();
    for (let k = 0; k < 10; k++) {
      moveConvoys(0.1);
      updateAi(0.1);
    }
  }
}

// ---- events ---------------------------------------------------------------------------------
export function eventCount(): i32 { return evCount; }
export function eventType(i: i32): i32 { return unchecked(evType[i]); }
export function eventA(i: i32): f64 { return unchecked(evA[i]); }
export function eventB(i: i32): f64 { return unchecked(evB[i]); }
export function eventsClear(): void { clearEvents(); }

// ---- misc accessors ---------------------------------------------------------------------------
export function gold(): f64 { return unchecked(world[3]); }
export function setGold(v: f64): void { unchecked((world[3] = v)); }
export function time(): f64 { return unchecked(world[0]); }
export function windDir(): f64 { return unchecked(world[1]); }
export function windStrength(): f64 { return unchecked(world[2]); }
export function rngState(): u32 { return rngGet(); }
export function setRngState(s: u32): void { seedRng(s); }
export function pathLength(): i32 { return pathLen; }
export function battleShipCount(): i32 { return bsCount; }
export function battleResult(): i32 { return battleOver; }
export function battleClock(): f64 { return battleTime; }
export function playerOwner(): i32 { return OWNER_PLAYER; }

/** Player-convoy convenience: total crew and upkeep per day (used by the HUD). */
export function convoyUpkeep(c: i32): f64 {
  let v: f64 = 0;
  for (let s = 0; s < MAX_SHIPS; s++) if (unchecked(shActive[s]) != 0 && unchecked(shConvoy[s]) == c) v += unchecked(typeUpkeep[shType[s]]);
  return v;
}

// ---- memory layout for the host ----------------------------------------------------------------
// Each entry: pointer to the first element. Lengths follow from the MAX_* constants below.
export function limits(i: i32): i32 {
  switch (i) {
    case 0: return MAX_TOWNS;
    case 1: return MAX_GOODS;
    case 2: return MAX_CONVOYS;
    case 3: return MAX_SHIPS;
    case 4: return MAX_WP;
    case 5: return MAX_EVENTS;
    case 6: return MAX_BS;
    case 7: return MAX_BALLS;
    default: return 0;
  }
}

@inline function p<T>(a: T): usize { return changetype<usize>(a); }

export function ptr(id: i32): usize {
  switch (id) {
    case 0: return p(world);
    case 1: return p(townX);
    case 2: return p(townY);
    case 3: return p(townPop);
    case 4: return p(townNation);
    case 5: return p(townRank);
    case 6: return p(townSatisfaction);
    case 7: return p(townStock);
    case 8: return p(townBusinesses);
    case 9: return p(townProduced);
    case 10: return p(townConsumed);
    case 11: return p(cvState);
    case 12: return p(cvOwner);
    case 13: return p(cvNation);
    case 14: return p(cvX);
    case 15: return p(cvY);
    case 16: return p(cvHeading);
    case 17: return p(cvSpeed);
    case 18: return p(cvTown);
    case 19: return p(cvDest);
    case 20: return p(cvPathLen);
    case 21: return p(cvPathIdx);
    case 22: return p(cvPath);
    case 23: return p(cvCargo);
    case 24: return p(cvAiState);
    case 25: return p(cvAiTimer);
    case 26: return p(cvAiTarget);
    case 27: return p(cvHome);
    case 28: return p(cvGold);
    case 29: return p(shActive);
    case 30: return p(shType);
    case 31: return p(shConvoy);
    case 32: return p(shTown);
    case 33: return p(shOwner);
    case 34: return p(shHull);
    case 35: return p(shSails);
    case 36: return p(shCrew);
    case 37: return p(shCannons);
    case 38: return p(bsShip);
    case 39: return p(bsSide);
    case 40: return p(bsType);
    case 41: return p(bsFlags);
    case 42: return p(bsX);
    case 43: return p(bsY);
    case 44: return p(bsHeading);
    case 45: return p(bsSpeed);
    case 46: return p(bsSail);
    case 47: return p(bsHull);
    case 48: return p(bsHullMax);
    case 49: return p(bsSails);
    case 50: return p(bsCrew);
    case 51: return p(bsCannons);
    case 52: return p(bsReloadL);
    case 53: return p(bsReloadR);
    case 54: return p(bsAmmo);
    case 55: return p(bsLength);
    case 56: return p(ballX);
    case 57: return p(ballY);
    case 58: return p(ballLife);
    case 59: return p(ballAmmo);
    case 60: return p(pathX);
    case 61: return p(pathY);
    default: return 0;
  }
}
