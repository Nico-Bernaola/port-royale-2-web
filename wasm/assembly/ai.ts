// Computer-controlled convoys: free traders that arbitrage between towns, and pirates that
// patrol around their hideouts and raid convoys.
import {
  MAX_CONVOYS, MAX_GOODS, MAX_SHIPS, CV_DOCKED, CV_SAILING, CV_HALTED, CV_FREE,
  OWNER_PLAYER, OWNER_TRADER, OWNER_PIRATE, EV_ENCOUNTER, EV_NPC_RAIDED,
  numTowns, numGoods, townX, townY, townNation, townStock, cvState, cvOwner, cvX, cvY, cvTown, cvCargo,
  cvAiState, cvAiTimer, cvAiTarget, cvHome, cvGold, cvPathLen, cvPathIdx, cvDest,
  shActive, shConvoy, shHull, shCrew, shCannons, typeGuns, typeCrew,
  pushEvent, rand, randInt,
} from './state';
import {
  createConvoy, createShip, addShipToConvoy, destroyConvoy, sailTo, sailToTown, sell, buy,
  freeSpace, convoyStrength, cargoTotal, shipCount,
} from './fleet';
import { buyPrice, sellPrice } from './economy';
import { isWater } from './nav';

export const MAX_HIDEOUTS: i32 = 32;
export const hideoutX = new StaticArray<f64>(MAX_HIDEOUTS);
export const hideoutY = new StaticArray<f64>(MAX_HIDEOUTS);
export let numHideouts: i32 = 0;
export function setHideout(i: i32, x: f64, y: f64): void {
  unchecked((hideoutX[i] = x));
  unchecked((hideoutY[i] = y));
  if (i >= numHideouts) numHideouts = i + 1;
}

export let targetTraders: i32 = 36;
export let targetPirates: i32 = 10;
export function setPopulationTargets(traders: i32, pirates: i32): void {
  targetTraders = traders;
  targetPirates = pirates;
}

// ship class ids from src/data/world.ts: fluyt, east indiaman, brig, barque, galleon, pinnace, sloop
const TRADER_TYPES: StaticArray<i32> = [5, 6, 2, 3, 9, 0, 1];
// raider barque, sloop, brig, barque, corvette
const PIRATE_TYPES: StaticArray<i32> = [4, 1, 2, 3, 7];

const AI_IDLE: i32 = 0;
const AI_TRADING: i32 = 1;
const AI_WANDER: i32 = 2;
const AI_CHASE: i32 = 3;
const AI_RETURN: i32 = 4;

const ENCOUNTER_RANGE: f64 = 16.0;
const SIGHT_RANGE: f64 = 150.0;

@inline function dist(ax: f64, ay: f64, bx: f64, by: f64): f64 {
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

function count(owner: i32): i32 {
  let n = 0;
  for (let c = 0; c < MAX_CONVOYS; c++) if (unchecked(cvState[c]) != CV_FREE && unchecked(cvOwner[c]) == owner) n++;
  return n;
}

export function spawnTrader(): i32 {
  if (numTowns == 0) return -1;
  const t = randInt(numTowns);
  const c = createConvoy(OWNER_TRADER, unchecked(townNation[t]), unchecked(townX[t]), unchecked(townY[t]), t);
  if (c < 0) return -1;
  const ships = 1 + randInt(3);
  for (let i = 0; i < ships; i++) {
    const s = createShip(unchecked(TRADER_TYPES[randInt(TRADER_TYPES.length)]), OWNER_TRADER, t);
    if (s >= 0) addShipToConvoy(s, c);
  }
  unchecked((cvGold[c] = 8000.0 + rand() * 20000.0));
  unchecked((cvAiState[c] = AI_IDLE));
  unchecked((cvAiTimer[c] = rand() * 1.5));
  return c;
}

export function spawnPirate(): i32 {
  if (numHideouts == 0) return -1;
  const h = randInt(numHideouts);
  const c = createConvoy(OWNER_PIRATE, 4, unchecked(hideoutX[h]), unchecked(hideoutY[h]), -1);
  if (c < 0) return -1;
  const ships = 1 + randInt(2);
  for (let i = 0; i < ships; i++) {
    const type = unchecked(PIRATE_TYPES[randInt(PIRATE_TYPES.length)]);
    const s = createShip(type, OWNER_PIRATE, -1);
    if (s >= 0) {
      addShipToConvoy(s, c);
      unchecked((shCannons[s] = Math.floor(unchecked(typeGuns[type]) * (0.5 + rand() * 0.35))));
      unchecked((shCrew[s] = Math.floor(unchecked(typeCrew[type]) * (0.6 + rand() * 0.3))));
    }
  }
  unchecked((cvHome[c * 2] = unchecked(hideoutX[h])));
  unchecked((cvHome[c * 2 + 1] = unchecked(hideoutY[h])));
  unchecked((cvAiState[c] = AI_WANDER));
  unchecked((cvAiTimer[c] = 0));
  unchecked((cvPathLen[c] = 0));
  unchecked((cvPathIdx[c] = 0));
  return c;
}

/** Keep the number of computer convoys near the targets (called once per game day). */
export function maintainPopulation(): void {
  let traders = count(OWNER_TRADER);
  while (traders < targetTraders && spawnTrader() >= 0) traders++;
  let pirates = count(OWNER_PIRATE);
  if (pirates < targetPirates && spawnPirate() >= 0) pirates++;
}

/** Choose the most profitable cargo from town t to one of a few nearby candidate towns. */
function planTrade(c: i32): void {
  const t = unchecked(cvTown[c]);
  const space = freeSpace(c);
  const gold = unchecked(cvGold[c]);
  let bestGain: f64 = 0;
  let bestTown = -1;
  let bestGood = -1;
  for (let k = 0; k < 10; k++) {
    const d = randInt(numTowns);
    if (d == t) continue;
    const dd = dist(unchecked(townX[t]), unchecked(townY[t]), unchecked(townX[d]), unchecked(townY[d]));
    if (dd > 1800.0) continue;
    for (let g = 0; g < numGoods; g++) {
      const b = buyPrice(t, g);
      const s = sellPrice(d, g);
      if (b >= s * 0.85) continue;
      // expected volume: what is in stock here, fits in the hold and can be paid for
      const vol = Math.min(Math.min(unchecked(townStock[t * MAX_GOODS + g]) - 2.0, space), gold * 0.8 / b);
      if (vol < 5.0) continue;
      // total profit, discounted by travel distance (prices fall as we sell, so damp volume)
      const gain = (s - b) * Math.sqrt(vol) / (1.0 + dd / 900.0);
      if (gain > bestGain) {
        bestGain = gain;
        bestTown = d;
        bestGood = g;
      }
    }
  }
  if (bestGood >= 0) {
    buy(c, bestGood, <i32>(space * 0.9));
    // top up with a second good for the same destination if there is room
    const left = freeSpace(c);
    if (left > 20.0) {
      let g2 = -1;
      let best2: f64 = 0;
      for (let g = 0; g < numGoods; g++) {
        if (g == bestGood) continue;
        const m = sellPrice(bestTown, g) - buyPrice(t, g);
        if (m > best2 && unchecked(townStock[t * MAX_GOODS + g]) > 10.0) {
          best2 = m;
          g2 = g;
        }
      }
      if (g2 >= 0 && best2 > buyPrice(t, g2) * 0.2) buy(c, g2, <i32>left);
    }
    if (sailToTown(c, bestTown)) {
      unchecked((cvAiState[c] = AI_TRADING));
      return;
    }
  }
  // nothing worth doing: move on to a random town to look for better prices
  const d = randInt(numTowns);
  if (d != t && sailToTown(c, d)) unchecked((cvAiState[c] = AI_TRADING));
  else unchecked((cvAiTimer[c] = 0.5));
}

function updateTrader(c: i32, dt: f64): void {
  const st = unchecked(cvState[c]);
  if (st == CV_DOCKED) {
    if (unchecked(cvAiState[c]) == AI_TRADING) {
      // just arrived: sell everything
      for (let g = 0; g < numGoods; g++) {
        const n = <i32>unchecked(cvCargo[c * MAX_GOODS + g]);
        if (n > 0) sell(c, g, n);
      }
      unchecked((cvAiState[c] = AI_IDLE));
      unchecked((cvAiTimer[c] = 0.3 + rand() * 0.9));
      // traders that went broke retire
      if (unchecked(cvGold[c]) < 500.0) destroyConvoy(c);
      return;
    }
    unchecked((cvAiTimer[c] -= dt));
    if (unchecked(cvAiTimer[c]) <= 0) planTrade(c);
  } else if (st == CV_SAILING && unchecked(cvPathIdx[c]) >= unchecked(cvPathLen[c]) && unchecked(cvDest[c]) < 0) {
    // lost its route (e.g. after a raid): head for the nearest town
    let best = -1;
    let bd: f64 = 1e18;
    for (let t = 0; t < numTowns; t++) {
      const d = dist(unchecked(cvX[c]), unchecked(cvY[c]), unchecked(townX[t]), unchecked(townY[t]));
      if (d < bd) { bd = d; best = t; }
    }
    if (best >= 0) {
      sailToTown(c, best);
      unchecked((cvAiState[c] = AI_TRADING));
    }
  }
}

function randomPointNear(x: f64, y: f64, r: f64, c: i32): bool {
  for (let tries = 0; tries < 12; tries++) {
    const a = rand() * Math.PI * 2.0;
    const d = r * (0.3 + 0.7 * rand());
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (isWater(px, py) && sailTo(c, px, py, -1)) return true;
  }
  return false;
}

/** Pirate victim selection: the weakest convoy in sight that is at sea. */
function findPrey(c: i32): i32 {
  const x = unchecked(cvX[c]);
  const y = unchecked(cvY[c]);
  const myStrength = convoyStrength(c);
  let best = -1;
  let bestScore: f64 = 0;
  for (let o = 0; o < MAX_CONVOYS; o++) {
    if (o == c || unchecked(cvState[o]) != CV_SAILING) continue;
    const owner = unchecked(cvOwner[o]);
    if (owner == OWNER_PIRATE) continue;
    const d = dist(x, y, unchecked(cvX[o]), unchecked(cvY[o]));
    if (d > SIGHT_RANGE) continue;
    const loot = cargoTotal(o) + 20.0;
    const risk = convoyStrength(o) / (myStrength + 1.0);
    if (risk > 1.3) continue;
    const score = loot / (1.0 + risk) / (1.0 + d / 50.0) * (owner == OWNER_PLAYER ? 1.4 : 1.0);
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/** Auto-resolve a pirate raid on an NPC convoy. */
function raid(p: i32, v: i32): void {
  const sp = convoyStrength(p);
  const sv = convoyStrength(v);
  const pirateWins = rand() < sp / (sp + sv * 1.1 + 1.0);
  if (pirateWins) {
    // plunder the cargo, sometimes sink the victim
    for (let g = 0; g < numGoods; g++) unchecked((cvCargo[v * MAX_GOODS + g] = 0));
    pushEvent(EV_NPC_RAIDED, <f64>v, <f64>p);
    if (rand() < 0.35) destroyConvoy(v);
    else {
      for (let s = 0; s < MAX_SHIPS; s++) {
        if (unchecked(shActive[s]) != 0 && unchecked(shConvoy[s]) == v) unchecked((shHull[s] = Math.max(15.0, unchecked(shHull[s]) - 30.0)));
      }
      unchecked((cvPathLen[v] = 0));
      unchecked((cvDest[v] = -1));
    }
    unchecked((cvAiState[p] = AI_RETURN));
    unchecked((cvAiTimer[p] = 2.0));
    randomPointNear(unchecked(cvHome[p * 2]), unchecked(cvHome[p * 2 + 1]), 60.0, p);
  } else {
    destroyConvoy(p);
  }
}

function updatePirate(c: i32, dt: f64): void {
  if (unchecked(cvState[c]) != CV_SAILING) return;
  unchecked((cvAiTimer[c] -= dt));
  const state = unchecked(cvAiState[c]);
  const arrived = unchecked(cvPathIdx[c]) >= unchecked(cvPathLen[c]);
  if (state == AI_CHASE) {
    const v = unchecked(cvAiTarget[c]);
    if (v < 0 || unchecked(cvState[v]) != CV_SAILING) {
      unchecked((cvAiState[c] = AI_WANDER));
      return;
    }
    const d = dist(unchecked(cvX[c]), unchecked(cvY[c]), unchecked(cvX[v]), unchecked(cvY[v]));
    if (d < ENCOUNTER_RANGE) {
      if (unchecked(cvOwner[v]) == OWNER_PLAYER) {
        unchecked((cvState[c] = CV_HALTED));
        unchecked((cvState[v] = CV_HALTED));
        pushEvent(EV_ENCOUNTER, <f64>v, <f64>c);
      } else raid(c, v);
      return;
    }
    if (d > SIGHT_RANGE * 1.5 || unchecked(cvAiTimer[c]) < -6.0) {
      unchecked((cvAiState[c] = AI_WANDER));
      return;
    }
    // re-plan the intercept a few times per day
    if (arrived || unchecked(cvAiTimer[c]) <= 0) {
      sailTo(c, unchecked(cvX[v]), unchecked(cvY[v]), -1);
      unchecked((cvAiTimer[c] = 0.12));
    }
    return;
  }
  if (state == AI_RETURN) {
    if (unchecked(cvAiTimer[c]) <= 0) unchecked((cvAiState[c] = AI_WANDER));
    else if (arrived) randomPointNear(unchecked(cvHome[c * 2]), unchecked(cvHome[c * 2 + 1]), 80.0, c);
    return;
  }
  // wandering: look for prey now and then
  if (unchecked(cvAiTimer[c]) <= 0) {
    unchecked((cvAiTimer[c] = 0.25));
    const prey = findPrey(c);
    if (prey >= 0) {
      unchecked((cvAiTarget[c] = prey));
      unchecked((cvAiState[c] = AI_CHASE));
      unchecked((cvAiTimer[c] = 0));
      return;
    }
  }
  if (arrived) randomPointNear(unchecked(cvHome[c * 2]), unchecked(cvHome[c * 2 + 1]), 420.0, c);
}

export function updateAi(dt: f64): void {
  for (let c = 0; c < MAX_CONVOYS; c++) {
    const st = unchecked(cvState[c]);
    if (st == CV_FREE || st == CV_HALTED) continue;
    const owner = unchecked(cvOwner[c]);
    if (owner == OWNER_TRADER) updateTrader(c, dt);
    else if (owner == OWNER_PIRATE) updatePirate(c, dt);
  }
}

/**
 * After an encounter: release both convoys. The pirate keeps away for a while.
 */
export function releaseEncounter(player: i32, pirate: i32): void {
  if (player >= 0 && unchecked(cvState[player]) == CV_HALTED) {
    unchecked((cvState[player] = unchecked(cvPathIdx[player]) < unchecked(cvPathLen[player]) || unchecked(cvTown[player]) < 0 ? CV_SAILING : CV_DOCKED));
  }
  if (pirate >= 0 && unchecked(cvState[pirate]) == CV_HALTED) {
    unchecked((cvState[pirate] = CV_SAILING));
    unchecked((cvAiState[pirate] = AI_RETURN));
    unchecked((cvAiTimer[pirate] = 3.0));
    randomPointNear(unchecked(cvHome[pirate * 2]), unchecked(cvHome[pirate * 2 + 1]), 80.0, pirate);
  }
  if (pirate >= 0 && shipCount(pirate) == 0) unchecked((cvState[pirate] = CV_FREE));
}

/** Auto-resolve an encounter between the player and pirates. Returns 1 if the player won. */
export function autoResolve(player: i32, pirate: i32): i32 {
  const sp = convoyStrength(player);
  const se = convoyStrength(pirate);
  const playerWins = rand() < (sp + 1.0) / (sp + se + 2.0);
  const loser = playerWins ? pirate : player;
  // both sides take damage proportional to the other's strength
  for (let s = 0; s < MAX_SHIPS; s++) {
    if (unchecked(shActive[s]) == 0) continue;
    const cv = unchecked(shConvoy[s]);
    if (cv != player && cv != pirate) continue;
    const enemy = cv == player ? se : sp;
    const own = cv == player ? sp : se;
    const dmg = 40.0 * enemy / (own + enemy + 1.0) * (0.6 + rand() * 0.8);
    unchecked((shHull[s] = Math.max(cv == loser ? 5.0 : 20.0, unchecked(shHull[s]) - dmg)));
    unchecked((shCrew[s] = Math.max(1.0, Math.floor(unchecked(shCrew[s]) * (1.0 - dmg / 250.0)))));
  }
  if (playerWins) {
    // plunder: pirates' cargo plus some gold
    for (let g = 0; g < numGoods; g++) {
      const take = Math.min(unchecked(cvCargo[pirate * MAX_GOODS + g]), freeSpace(player));
      unchecked((cvCargo[player * MAX_GOODS + g] += Math.floor(take)));
    }
    destroyConvoy(pirate);
    releaseEncounter(player, -1);
  } else {
    // pirates take the player's cargo
    for (let g = 0; g < numGoods; g++) unchecked((cvCargo[player * MAX_GOODS + g] = 0));
    releaseEncounter(player, pirate);
  }
  return playerWins ? 1 : 0;
}
