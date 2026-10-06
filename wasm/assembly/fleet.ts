// Convoys and ships: creation, cargo, trading, and movement along planned routes.
import {
  MAX_CONVOYS, MAX_SHIPS, MAX_GOODS, MAX_WP, CV_FREE, CV_DOCKED, CV_SAILING, CV_HALTED, EV_ARRIVED,
  EV_PATH_FAILED, OWNER_PLAYER, numGoods, world, townX, townY, townStock,
  cvState, cvOwner, cvNation, cvX, cvY, cvHeading, cvSpeed, cvTown, cvDest, cvPathLen, cvPathIdx, cvPath,
  cvCargo, cvAiState, cvAiTimer, cvAiTarget, cvGold,
  shActive, shType, shConvoy, shTown, shOwner, shHull, shSails, shCrew, shCannons,
  typeCargo, typeVmin, typeVmax, typeGuns, typeCrew, pushEvent,
} from './state';
import { findPath, pathLen, pathX, pathY } from './nav';
import { buyPrice, quoteBuy, quoteSell, affordable } from './economy';

/** Map pixels travelled per day at one knot. */
export const PX_PER_KNOT_DAY: f64 = 30.0;
/** Space taken by one cannon, in barrels (manual: "3 barrels per cannon"). */
export const CANNON_SPACE: f64 = 3.0;

// ---- ships --------------------------------------------------------------------------------

export function createShip(type: i32, owner: i32, town: i32): i32 {
  for (let s = 0; s < MAX_SHIPS; s++) {
    if (unchecked(shActive[s]) != 0) continue;
    unchecked((shActive[s] = 1));
    unchecked((shType[s] = type));
    unchecked((shOwner[s] = owner));
    unchecked((shConvoy[s] = -1));
    unchecked((shTown[s] = town));
    unchecked((shHull[s] = 100));
    unchecked((shSails[s] = 100));
    unchecked((shCrew[s] = Math.ceil(unchecked(typeCrew[type]) * 0.5)));
    unchecked((shCannons[s] = Math.floor(unchecked(typeGuns[type]) * 0.5)));
    return s;
  }
  return -1;
}

export function removeShip(s: i32): void {
  unchecked((shActive[s] = 0));
  unchecked((shConvoy[s] = -1));
}

// ---- convoys ------------------------------------------------------------------------------

export function createConvoy(owner: i32, nation: i32, x: f64, y: f64, town: i32): i32 {
  for (let c = 0; c < MAX_CONVOYS; c++) {
    if (unchecked(cvState[c]) != CV_FREE) continue;
    unchecked((cvState[c] = town >= 0 ? CV_DOCKED : CV_SAILING));
    unchecked((cvOwner[c] = owner));
    unchecked((cvNation[c] = nation));
    unchecked((cvX[c] = x));
    unchecked((cvY[c] = y));
    unchecked((cvHeading[c] = 0));
    unchecked((cvSpeed[c] = 0));
    unchecked((cvTown[c] = town));
    unchecked((cvDest[c] = -1));
    unchecked((cvPathLen[c] = 0));
    unchecked((cvPathIdx[c] = 0));
    unchecked((cvAiState[c] = 0));
    unchecked((cvAiTimer[c] = 0));
    unchecked((cvAiTarget[c] = -1));
    unchecked((cvGold[c] = 0));
    for (let g = 0; g < MAX_GOODS; g++) unchecked((cvCargo[c * MAX_GOODS + g] = 0));
    return c;
  }
  return -1;
}

export function disbandConvoy(c: i32): void {
  for (let s = 0; s < MAX_SHIPS; s++) {
    if (unchecked(shActive[s]) != 0 && unchecked(shConvoy[s]) == c) {
      unchecked((shConvoy[s] = -1));
      unchecked((shTown[s] = unchecked(cvTown[c])));
    }
  }
  unchecked((cvState[c] = CV_FREE));
}

/** Destroy a convoy together with its ships and cargo. */
export function destroyConvoy(c: i32): void {
  for (let s = 0; s < MAX_SHIPS; s++) {
    if (unchecked(shActive[s]) != 0 && unchecked(shConvoy[s]) == c) removeShip(s);
  }
  unchecked((cvState[c] = CV_FREE));
}

export function addShipToConvoy(s: i32, c: i32): void {
  unchecked((shConvoy[s] = c));
  unchecked((shTown[s] = -1));
}

export function shipCount(c: i32): i32 {
  let n = 0;
  for (let s = 0; s < MAX_SHIPS; s++) if (unchecked(shActive[s]) != 0 && unchecked(shConvoy[s]) == c) n++;
  return n;
}

export function capacity(c: i32): f64 {
  let cap: f64 = 0;
  for (let s = 0; s < MAX_SHIPS; s++) {
    if (unchecked(shActive[s]) != 0 && unchecked(shConvoy[s]) == c) {
      cap += unchecked(typeCargo[shType[s]]) - unchecked(shCannons[s]) * CANNON_SPACE;
    }
  }
  return Math.max(0.0, cap);
}

export function cargoTotal(c: i32): f64 {
  let n: f64 = 0;
  for (let g = 0; g < numGoods; g++) n += unchecked(cvCargo[c * MAX_GOODS + g]);
  return n;
}

export function freeSpace(c: i32): f64 {
  return Math.max(0.0, capacity(c) - cargoTotal(c));
}

export function convoyStrength(c: i32): f64 {
  let v: f64 = 0;
  for (let s = 0; s < MAX_SHIPS; s++) {
    if (unchecked(shActive[s]) != 0 && unchecked(shConvoy[s]) == c) {
      v += unchecked(shCannons[s]) * 2.0 + unchecked(shCrew[s]) * 0.5 + unchecked(shHull[s]) * 0.2;
    }
  }
  return v;
}

// ---- trading (player gold in world[3]; NPC convoys use cvGold) ------------------------------

@inline function goldOf(c: i32): f64 {
  return unchecked(cvOwner[c]) == OWNER_PLAYER ? unchecked(world[3]) : unchecked(cvGold[c]);
}
@inline function setGold(c: i32, v: f64): void {
  if (unchecked(cvOwner[c]) == OWNER_PLAYER) unchecked((world[3] = v));
  else unchecked((cvGold[c] = v));
}

/** Buy up to n barrels of good g for convoy c in its current town. Returns barrels bought. */
export function buy(c: i32, g: i32, n: i32): i32 {
  const t = unchecked(cvTown[c]);
  if (t < 0 || unchecked(cvState[c]) != CV_DOCKED) return 0;
  const si = t * MAX_GOODS + g;
  let k = min(n, <i32>Math.floor(unchecked(townStock[si])));
  k = min(k, <i32>Math.floor(freeSpace(c)));
  k = affordable(t, g, k, goldOf(c));
  if (k <= 0) return 0;
  const cost = quoteBuy(t, g, k);
  setGold(c, goldOf(c) - cost);
  unchecked((townStock[si] -= <f64>k));
  unchecked((cvCargo[c * MAX_GOODS + g] += <f64>k));
  return k;
}

/** Sell up to n barrels of good g from convoy c in its current town. Returns barrels sold. */
export function sell(c: i32, g: i32, n: i32): i32 {
  const t = unchecked(cvTown[c]);
  if (t < 0 || unchecked(cvState[c]) != CV_DOCKED) return 0;
  const ci = c * MAX_GOODS + g;
  const k = min(n, <i32>Math.floor(unchecked(cvCargo[ci])));
  if (k <= 0) return 0;
  const revenue = quoteSell(t, g, k);
  setGold(c, goldOf(c) + revenue);
  unchecked((townStock[t * MAX_GOODS + g] += <f64>k));
  unchecked((cvCargo[ci] -= <f64>k));
  return k;
}

/** Cheapest local price indicator used by the AI. */
export function localBuyPrice(t: i32, g: i32): f64 {
  return buyPrice(t, g);
}

// ---- movement -----------------------------------------------------------------------------

/** Speed factor from the angle between heading and wind (BattleConst [Sails] SpeedFaktor0..4). */
export function windFactor(heading: f64): f64 {
  const wind = unchecked(world[1]);
  let d = Math.abs(heading - wind);
  while (d > Math.PI) d = Math.abs(d - 2.0 * Math.PI);
  // d = 0: running before the wind; d = PI: beating into it. Factors sampled every 45 degrees.
  const a = (Math.PI - d) / (Math.PI / 4.0); // 0 = into the wind .. 4 = downwind
  const f0: f64 = 0.5, f1: f64 = 1.0, f2: f64 = 0.8, f3: f64 = 0.9, f4: f64 = 1.0;
  const i = <i32>Math.floor(a);
  const t = a - <f64>i;
  let lo: f64, hi: f64;
  if (i <= 0) { lo = f0; hi = f1; }
  else if (i == 1) { lo = f1; hi = f2; }
  else if (i == 2) { lo = f2; hi = f3; }
  else { lo = f3; hi = f4; }
  const base = lo + (hi - lo) * Math.min(1.0, t);
  const strength = unchecked(world[2]);
  return base * (0.7 + 0.3 * strength);
}

/** Current speed in knots: the slowest ship sets the pace; damage slows ships down. */
export function convoySpeed(c: i32, heading: f64): f64 {
  let v: f64 = 1e9;
  let any = false;
  const wf = windFactor(heading);
  for (let s = 0; s < MAX_SHIPS; s++) {
    if (unchecked(shActive[s]) == 0 || unchecked(shConvoy[s]) != c) continue;
    any = true;
    const t = unchecked(shType[s]);
    const vmin = unchecked(typeVmin[t]);
    const vmax = unchecked(typeVmax[t]);
    const cond = 0.5 + 0.5 * Math.min(unchecked(shSails[s]), unchecked(shHull[s])) / 100.0;
    const sv = (vmin + (vmax - vmin) * wf) * cond;
    if (sv < v) v = sv;
  }
  return any ? v : 0;
}

/** Order a convoy to sail to a map position (town >= 0 to dock there on arrival). */
export function sailTo(c: i32, x: f64, y: f64, town: i32): bool {
  const st = unchecked(cvState[c]);
  if (st == CV_FREE || st == CV_HALTED) return false;
  if (!findPath(unchecked(cvX[c]), unchecked(cvY[c]), x, y)) {
    pushEvent(EV_PATH_FAILED, <f64>c, 0);
    return false;
  }
  const n = min(pathLen, MAX_WP);
  for (let i = 0; i < n; i++) {
    unchecked((cvPath[(c * MAX_WP + i) * 2] = pathX[i]));
    unchecked((cvPath[(c * MAX_WP + i) * 2 + 1] = pathY[i]));
  }
  unchecked((cvPathLen[c] = n));
  unchecked((cvPathIdx[c] = 0));
  unchecked((cvDest[c] = town));
  unchecked((cvTown[c] = -1));
  unchecked((cvState[c] = CV_SAILING));
  return true;
}

export function sailToTown(c: i32, t: i32): bool {
  if (unchecked(cvTown[c]) == t && unchecked(cvState[c]) == CV_DOCKED) return true;
  return sailTo(c, unchecked(townX[t]), unchecked(townY[t]), t);
}

export function stopConvoy(c: i32): void {
  if (unchecked(cvState[c]) == CV_SAILING) {
    unchecked((cvPathLen[c] = 0));
    unchecked((cvSpeed[c] = 0));
  }
}

/** Advance all sailing convoys by dt days. */
export function moveConvoys(dt: f64): void {
  for (let c = 0; c < MAX_CONVOYS; c++) {
    if (unchecked(cvState[c]) != CV_SAILING) continue;
    let budget: f64 = 0;
    const idx0 = unchecked(cvPathIdx[c]);
    const len = unchecked(cvPathLen[c]);
    if (idx0 >= len) {
      unchecked((cvSpeed[c] = 0));
      continue;
    }
    // speed for the current leg
    const wx = unchecked(cvPath[(c * MAX_WP + idx0) * 2]);
    const wy = unchecked(cvPath[(c * MAX_WP + idx0) * 2 + 1]);
    const heading = Math.atan2(wy - unchecked(cvY[c]), wx - unchecked(cvX[c]));
    const knots = convoySpeed(c, heading);
    unchecked((cvSpeed[c] = knots));
    // smooth heading changes so sprites do not flicker
    let dh = heading - unchecked(cvHeading[c]);
    while (dh > Math.PI) dh -= 2.0 * Math.PI;
    while (dh < -Math.PI) dh += 2.0 * Math.PI;
    unchecked((cvHeading[c] += dh * Math.min(1.0, dt * 24.0)));
    budget = knots * PX_PER_KNOT_DAY * dt;
    let i = idx0;
    while (budget > 0 && i < len) {
      const tx = unchecked(cvPath[(c * MAX_WP + i) * 2]);
      const ty = unchecked(cvPath[(c * MAX_WP + i) * 2 + 1]);
      const dx = tx - unchecked(cvX[c]);
      const dy = ty - unchecked(cvY[c]);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= budget) {
        unchecked((cvX[c] = tx));
        unchecked((cvY[c] = ty));
        budget -= d;
        i++;
      } else {
        unchecked((cvX[c] += dx / d * budget));
        unchecked((cvY[c] += dy / d * budget));
        budget = 0;
      }
    }
    unchecked((cvPathIdx[c] = i));
    if (i >= len) {
      const dest = unchecked(cvDest[c]);
      unchecked((cvSpeed[c] = 0));
      unchecked((cvPathLen[c] = 0));
      if (dest >= 0) {
        unchecked((cvState[c] = CV_DOCKED));
        unchecked((cvTown[c] = dest));
        unchecked((cvDest[c] = -1));
      }
      pushEvent(EV_ARRIVED, <f64>c, <f64>dest);
    }
  }
}

/** Remaining distance along the route in map px. */
export function routeRemaining(c: i32): f64 {
  let x = unchecked(cvX[c]);
  let y = unchecked(cvY[c]);
  let d: f64 = 0;
  for (let i = unchecked(cvPathIdx[c]); i < unchecked(cvPathLen[c]); i++) {
    const tx = unchecked(cvPath[(c * MAX_WP + i) * 2]);
    const ty = unchecked(cvPath[(c * MAX_WP + i) * 2 + 1]);
    d += Math.sqrt((tx - x) * (tx - x) + (ty - y) * (ty - y));
    x = tx;
    y = ty;
  }
  return d;
}
