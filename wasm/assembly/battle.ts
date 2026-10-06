// Real-time sea battle: ship physics with wind, broadsides as simulated projectiles, the
// original ammunition damage table (BattleConst.ini [Munition] MS/MH/MC, 16.16 fixed point),
// boarding, escape, and a tactical AI for every ship not steered by the player.
import {
  MAX_GOODS, numGoods, world, typeCargo, typeVmin, typeVmax, typeCrew, typeHull, typeAgility,
  shActive, shType, shConvoy, shOwner, shHull, shSails, shCrew, shCannons, cvCargo,
  EV_BATTLE_HIT, EV_BATTLE_SPLASH, EV_BATTLE_FIRE, EV_BATTLE_SUNK, EV_BATTLE_BOARDED, EV_BATTLE_END,
  OWNER_PLAYER, pushEvent, rand,
} from './state';
import { removeShip } from './fleet';

export const MAX_BS: i32 = 16;
export const MAX_BALLS: i32 = 768;

export const ARENA_W: f64 = 1800.0;
export const ARENA_H: f64 = 1300.0;

// ammunition kinds the player can choose (index into the original table: 2 round, 4 grape, 6 chain)
export const AMMO_ROUND: i32 = 0;
export const AMMO_GRAPE: i32 = 1;
export const AMMO_CHAIN: i32 = 2;
const DMG_SAIL: StaticArray<f64> = [6552.0 / 65536.0, 6552.0 / 65536.0, 98304.0 / 65536.0];
const DMG_HULL: StaticArray<f64> = [65536.0 / 65536.0, 19660.0 / 65536.0, 13107.0 / 65536.0];
const DMG_CREW: StaticArray<f64> = [19660.0 / 65536.0, 52428.0 / 65536.0, 6552.0 / 65536.0];
const AMMO_RANGE: StaticArray<f64> = [430.0, 260.0, 330.0];
const DAMAGE_SCALE: f64 = 2.6;

// flags
export const BF_SUNK: i32 = 1;
export const BF_CAPTURED: i32 = 2;
export const BF_ESCAPED: i32 = 4;
export const BF_FLEEING: i32 = 8;

export const bsShip = new StaticArray<i32>(MAX_BS);
export const bsSide = new StaticArray<i32>(MAX_BS);
export const bsType = new StaticArray<i32>(MAX_BS);
export const bsFlags = new StaticArray<i32>(MAX_BS);
export const bsX = new StaticArray<f64>(MAX_BS);
export const bsY = new StaticArray<f64>(MAX_BS);
export const bsHeading = new StaticArray<f64>(MAX_BS);
export const bsSpeed = new StaticArray<f64>(MAX_BS);
export const bsSail = new StaticArray<f64>(MAX_BS); // ordered sail 0..1
export const bsHull = new StaticArray<f64>(MAX_BS);
export const bsHullMax = new StaticArray<f64>(MAX_BS);
export const bsSails = new StaticArray<f64>(MAX_BS); // condition 0..100
export const bsCrew = new StaticArray<f64>(MAX_BS);
export const bsCannons = new StaticArray<f64>(MAX_BS);
export const bsReloadL = new StaticArray<f64>(MAX_BS);
export const bsReloadR = new StaticArray<f64>(MAX_BS);
export const bsAmmo = new StaticArray<i32>(MAX_BS);
export const bsTargetX = new StaticArray<f64>(MAX_BS);
export const bsTargetY = new StaticArray<f64>(MAX_BS);
export const bsManual = new StaticArray<i32>(MAX_BS); // 1 = steered by the player
export const bsAutoFire = new StaticArray<i32>(MAX_BS);
export const bsLength = new StaticArray<f64>(MAX_BS);
export let bsCount: i32 = 0;

export const ballX = new StaticArray<f64>(MAX_BALLS);
export const ballY = new StaticArray<f64>(MAX_BALLS);
export const ballVX = new StaticArray<f64>(MAX_BALLS);
export const ballVY = new StaticArray<f64>(MAX_BALLS);
export const ballLife = new StaticArray<f64>(MAX_BALLS); // seconds left, <= 0 = free
export const ballAmmo = new StaticArray<i32>(MAX_BALLS);
export const ballSide = new StaticArray<i32>(MAX_BALLS);
export const ballOwner = new StaticArray<i32>(MAX_BALLS);

export let battleTime: f64 = 0;
export let battleOver: i32 = -1; // -1 running, 0 player won, 1 enemy won, 2 player escaped

const BALL_SPEED: f64 = 240.0;

export function battleBegin(): void {
  bsCount = 0;
  battleTime = 0;
  battleOver = -1;
  for (let i = 0; i < MAX_BALLS; i++) unchecked((ballLife[i] = 0));
}

export function battleAddShip(ship: i32, side: i32, x: f64, y: f64, heading: f64): i32 {
  if (bsCount >= MAX_BS) return -1;
  const i = bsCount++;
  const t = unchecked(shType[ship]);
  unchecked((bsShip[i] = ship));
  unchecked((bsSide[i] = side));
  unchecked((bsType[i] = t));
  unchecked((bsFlags[i] = 0));
  unchecked((bsX[i] = x));
  unchecked((bsY[i] = y));
  unchecked((bsHeading[i] = heading));
  unchecked((bsSpeed[i] = 0));
  unchecked((bsSail[i] = 0.8));
  const hullMax = unchecked(typeHull[t]) * 2.0;
  unchecked((bsHullMax[i] = hullMax));
  unchecked((bsHull[i] = hullMax * unchecked(shHull[ship]) / 100.0));
  unchecked((bsSails[i] = unchecked(shSails[ship])));
  unchecked((bsCrew[i] = unchecked(shCrew[ship])));
  unchecked((bsCannons[i] = unchecked(shCannons[ship])));
  unchecked((bsReloadL[i] = 2.0 + rand() * 2.0));
  unchecked((bsReloadR[i] = 2.0 + rand() * 2.0));
  unchecked((bsAmmo[i] = AMMO_ROUND));
  unchecked((bsTargetX[i] = x + Math.cos(heading) * 300.0));
  unchecked((bsTargetY[i] = y + Math.sin(heading) * 300.0));
  unchecked((bsManual[i] = 0));
  unchecked((bsAutoFire[i] = 1));
  unchecked((bsLength[i] = 34.0 + unchecked(typeCargo[t]) * 0.12 + unchecked(typeHull[t]) * 0.15));
  return i;
}

@inline function active(i: i32): bool {
  return (unchecked(bsFlags[i]) & (BF_SUNK | BF_CAPTURED | BF_ESCAPED)) == 0;
}

export function battleActive(i: i32): bool {
  return active(i);
}

function maxSpeed(i: i32): f64 {
  const t = unchecked(bsType[i]);
  const h = unchecked(bsHeading[i]);
  // wind factor (same curve as the sea map)
  const wind = unchecked(world[1]);
  let d = Math.abs(h - wind);
  while (d > Math.PI) d = Math.abs(d - 2.0 * Math.PI);
  const a = (Math.PI - d) / (Math.PI / 4.0);
  let wf: f64;
  if (a < 1.0) wf = 0.35 + 0.65 * a;
  else if (a < 2.0) wf = 1.0 - 0.2 * (a - 1.0);
  else if (a < 3.0) wf = 0.8 + 0.1 * (a - 2.0);
  else wf = 0.9 + 0.1 * (a - 3.0);
  const vmin = unchecked(typeVmin[t]);
  const vmax = unchecked(typeVmax[t]);
  const knots = vmin + (vmax - vmin) * wf;
  const sailCond = 0.3 + 0.7 * unchecked(bsSails[i]) / 100.0;
  const crewFactor = 0.6 + 0.4 * Math.min(1.0, unchecked(bsCrew[i]) / Math.max(1.0, unchecked(typeCrew[t]) * 0.5));
  return knots * 5.5 * unchecked(bsSail[i]) * sailCond * crewFactor;
}

function steer(i: i32, dt: f64): void {
  const t = unchecked(bsType[i]);
  const dx = unchecked(bsTargetX[i]) - unchecked(bsX[i]);
  const dy = unchecked(bsTargetY[i]) - unchecked(bsY[i]);
  const dist = Math.sqrt(dx * dx + dy * dy);
  let target = unchecked(bsHeading[i]);
  if (dist > 12.0) target = Math.atan2(dy, dx);
  let dh = target - unchecked(bsHeading[i]);
  while (dh > Math.PI) dh -= 2.0 * Math.PI;
  while (dh < -Math.PI) dh += 2.0 * Math.PI;
  // turn rate: BattleConst [Rotation] R1 (10 deg/s) scaled by agility and speed
  const vmax = Math.max(1.0, maxSpeed(i));
  const speedRatio = Math.min(1.0, unchecked(bsSpeed[i]) / Math.max(20.0, vmax));
  const rate = 0.1745 * unchecked(typeAgility[t]) / 100.0 * (0.35 + 0.65 * speedRatio);
  const turn = Math.max(-rate * dt, Math.min(rate * dt, dh));
  unchecked((bsHeading[i] += turn));
  // accelerate towards the speed allowed by sails and wind; slow down near the target point
  let want = vmax;
  if (unchecked(bsManual[i]) != 0 && dist < 40.0) want = Math.min(want, dist);
  const accel: f64 = 6.0;
  const sp = unchecked(bsSpeed[i]);
  unchecked((bsSpeed[i] = sp + Math.max(-accel * dt * 1.5, Math.min(accel * dt, want - sp))));
  unchecked((bsX[i] += Math.cos(unchecked(bsHeading[i])) * unchecked(bsSpeed[i]) * dt));
  unchecked((bsY[i] += Math.sin(unchecked(bsHeading[i])) * unchecked(bsSpeed[i]) * dt));
}

/** Fire one broadside (side -1 = port/left, +1 = starboard/right). */
function fire(i: i32, side: i32): void {
  const guns = <i32>Math.floor(unchecked(bsCannons[i]) / 2.0);
  if (guns <= 0) return;
  const ammo = unchecked(bsAmmo[i]);
  const h = unchecked(bsHeading[i]);
  const dir = h + <f64>side * Math.PI * 0.5;
  const len = unchecked(bsLength[i]);
  const range = unchecked(AMMO_RANGE[ammo]);
  // crew shortage slows reloading
  const t = unchecked(bsType[i]);
  const crewRatio = Math.min(1.0, unchecked(bsCrew[i]) / Math.max(1.0, unchecked(typeCrew[t]) * 0.6));
  const reload = 7.0 + 9.0 * (1.0 - crewRatio);
  if (side < 0) unchecked((bsReloadL[i] = reload));
  else unchecked((bsReloadR[i] = reload));
  let spawned = 0;
  for (let b = 0; b < MAX_BALLS && spawned < guns; b++) {
    if (unchecked(ballLife[b]) > 0) continue;
    const along = (<f64>spawned / Math.max(1.0, <f64>(guns - 1)) - 0.5) * len * 0.7;
    const spread = (rand() - 0.5) * 0.12;
    const d = dir + spread;
    const speed = BALL_SPEED * (0.92 + rand() * 0.16);
    unchecked((ballX[b] = unchecked(bsX[i]) + Math.cos(h) * along + Math.cos(dir) * 8.0));
    unchecked((ballY[b] = unchecked(bsY[i]) + Math.sin(h) * along + Math.sin(dir) * 8.0));
    // shots inherit the ship's motion
    unchecked((ballVX[b] = Math.cos(d) * speed + Math.cos(h) * unchecked(bsSpeed[i])));
    unchecked((ballVY[b] = Math.sin(d) * speed + Math.sin(h) * unchecked(bsSpeed[i])));
    unchecked((ballLife[b] = range / speed * (0.85 + rand() * 0.3)));
    unchecked((ballAmmo[b] = ammo));
    unchecked((ballSide[b] = unchecked(bsSide[i])));
    unchecked((ballOwner[b] = i));
    spawned++;
  }
  pushEvent(EV_BATTLE_FIRE, <f64>i, <f64>spawned);
}

/** Host command: fire a broadside if loaded. Returns true if it fired. */
export function battleFire(i: i32, side: i32): bool {
  if (!active(i)) return false;
  if (side < 0 && unchecked(bsReloadL[i]) > 0) return false;
  if (side > 0 && unchecked(bsReloadR[i]) > 0) return false;
  fire(i, side);
  return true;
}

/** Bearing of point (x,y) relative to ship i's side normal; returns -1 port, +1 starboard, 0 none. */
function sideFacing(i: i32, x: f64, y: f64, maxAngle: f64): i32 {
  const a = Math.atan2(y - unchecked(bsY[i]), x - unchecked(bsX[i]));
  let rel = a - unchecked(bsHeading[i]);
  while (rel > Math.PI) rel -= 2.0 * Math.PI;
  while (rel < -Math.PI) rel += 2.0 * Math.PI;
  if (Math.abs(rel - Math.PI * 0.5) < maxAngle) return 1;
  if (Math.abs(rel + Math.PI * 0.5) < maxAngle) return -1;
  return 0;
}

function nearestEnemy(i: i32): i32 {
  let best = -1;
  let bd: f64 = 1e18;
  for (let j = 0; j < bsCount; j++) {
    if (j == i || !active(j) || unchecked(bsSide[j]) == unchecked(bsSide[i])) continue;
    const dx = unchecked(bsX[j]) - unchecked(bsX[i]);
    const dy = unchecked(bsY[j]) - unchecked(bsY[i]);
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = j;
    }
  }
  return best;
}

function autoFire(i: i32): void {
  const range = unchecked(AMMO_RANGE[unchecked(bsAmmo[i])]) * 0.92;
  for (let j = 0; j < bsCount; j++) {
    if (!active(j) || unchecked(bsSide[j]) == unchecked(bsSide[i])) continue;
    const dx = unchecked(bsX[j]) - unchecked(bsX[i]);
    const dy = unchecked(bsY[j]) - unchecked(bsY[i]);
    if (dx * dx + dy * dy > range * range) continue;
    const s = sideFacing(i, unchecked(bsX[j]), unchecked(bsY[j]), 0.35);
    if (s < 0 && unchecked(bsReloadL[i]) <= 0) fire(i, -1);
    else if (s > 0 && unchecked(bsReloadR[i]) <= 0) fire(i, 1);
  }
}

/** Tactical AI: close in, present a loaded broadside, flee when beaten, board when stronger. */
function think(i: i32): void {
  const e = nearestEnemy(i);
  if (e < 0) return;
  const t = unchecked(bsType[i]);
  const ex = unchecked(bsX[e]);
  const ey = unchecked(bsY[e]);
  const dx = ex - unchecked(bsX[i]);
  const dy = ey - unchecked(bsY[i]);
  const d = Math.sqrt(dx * dx + dy * dy);
  const hullRatio = unchecked(bsHull[i]) / unchecked(bsHullMax[i]);
  const crewRatio = unchecked(bsCrew[i]) / Math.max(1.0, unchecked(bsCrew[e]));
  // flee (AutoBattle AFleeCond) when badly damaged and outgunned
  if (hullRatio < 0.25 && crewRatio < 1.5) unchecked((bsFlags[i] |= BF_FLEEING));
  if ((unchecked(bsFlags[i]) & BF_FLEEING) != 0) {
    unchecked((bsTargetX[i] = unchecked(bsX[i]) - dx / d * 600.0));
    unchecked((bsTargetY[i] = unchecked(bsY[i]) - dy / d * 600.0));
    unchecked((bsSail[i] = 1.0));
    return;
  }
  // board (AEntCond 1.1) when much stronger in crew and close
  if (crewRatio > 1.4 && unchecked(bsCrew[i]) > unchecked(typeCrew[t]) * 0.3) {
    unchecked((bsTargetX[i] = ex));
    unchecked((bsTargetY[i] = ey));
    unchecked((bsSail[i] = 1.0));
    if (d < (unchecked(bsLength[i]) + unchecked(bsLength[e])) * 0.55) tryBoard(i, e);
    return;
  }
  const range = unchecked(AMMO_RANGE[unchecked(bsAmmo[i])]);
  const ideal = range * 0.55;
  const bearing = Math.atan2(dy, dx);
  let goal: f64;
  if (d > range * 0.9) {
    goal = bearing; // close in
  } else {
    // sail perpendicular to the bearing, choosing the side whose guns are loaded
    const useRight = unchecked(bsReloadR[i]) <= unchecked(bsReloadL[i]);
    goal = bearing + (useRight ? -Math.PI * 0.5 : Math.PI * 0.5);
    // drift in or out towards the ideal distance
    goal += (d > ideal ? 0.35 : -0.35) * (useRight ? 1.0 : -1.0);
  }
  unchecked((bsTargetX[i] = unchecked(bsX[i]) + Math.cos(goal) * 250.0));
  unchecked((bsTargetY[i] = unchecked(bsY[i]) + Math.sin(goal) * 250.0));
  unchecked((bsSail[i] = d > range ? 1.0 : 0.75));
  // pick ammunition: chain at long range against fast ships, grape when close, else round shot
  if (d < 200.0 && unchecked(bsCrew[e]) > unchecked(bsCrew[i]) * 0.7) unchecked((bsAmmo[i] = AMMO_GRAPE));
  else if (unchecked(bsSails[e]) > 70.0 && rand() < 0.002) unchecked((bsAmmo[i] = AMMO_CHAIN));
  else unchecked((bsAmmo[i] = AMMO_ROUND));
}

/** Boarding: crews fight; the winner captures the other ship. Returns true if captured. */
export function tryBoard(a: i32, b: i32): bool {
  if (!active(a) || !active(b) || unchecked(bsSide[a]) == unchecked(bsSide[b])) return false;
  const dx = unchecked(bsX[b]) - unchecked(bsX[a]);
  const dy = unchecked(bsY[b]) - unchecked(bsY[a]);
  const reach = (unchecked(bsLength[a]) + unchecked(bsLength[b])) * 0.6;
  if (dx * dx + dy * dy > reach * reach) return false;
  let ca = unchecked(bsCrew[a]);
  let cb = unchecked(bsCrew[b]);
  // BattleData EnterStr: attackers fight at 1.2x strength
  while (ca > 0 && cb > 0) {
    if (rand() * (ca * 1.2) > rand() * cb) cb -= 1.0;
    else ca -= 1.0;
  }
  unchecked((bsCrew[a] = Math.max(0.0, ca)));
  unchecked((bsCrew[b] = Math.max(0.0, cb)));
  if (ca > 0) {
    unchecked((bsFlags[b] |= BF_CAPTURED));
    unchecked((bsSpeed[b] = 0));
    pushEvent(EV_BATTLE_BOARDED, <f64>a, <f64>b);
    return true;
  }
  unchecked((bsFlags[a] |= BF_CAPTURED));
  unchecked((bsSpeed[a] = 0));
  pushEvent(EV_BATTLE_BOARDED, <f64>b, <f64>a);
  return false;
}

/** Host command: try to board the nearest enemy. */
export function battleBoard(i: i32): bool {
  const e = nearestEnemy(i);
  return e >= 0 && tryBoard(i, e);
}

function hit(b: i32, j: i32): void {
  const ammo = unchecked(ballAmmo[b]);
  const k = DAMAGE_SCALE * (0.7 + rand() * 0.6);
  unchecked((bsHull[j] -= unchecked(DMG_HULL[ammo]) * k));
  unchecked((bsSails[j] = Math.max(0.0, unchecked(bsSails[j]) - unchecked(DMG_SAIL[ammo]) * k * 1.6)));
  unchecked((bsCrew[j] = Math.max(0.0, unchecked(bsCrew[j]) - unchecked(DMG_CREW[ammo]) * k * (rand() < 0.6 ? 1.0 : 0.0))));
  if (ammo == AMMO_ROUND && rand() < 0.04) unchecked((bsCannons[j] = Math.max(0.0, unchecked(bsCannons[j]) - 1.0)));
  pushEvent(EV_BATTLE_HIT, <f64>j, <f64>ammo);
  if (unchecked(bsHull[j]) <= 0) {
    unchecked((bsHull[j] = 0));
    unchecked((bsFlags[j] |= BF_SUNK));
    pushEvent(EV_BATTLE_SUNK, <f64>j, 0);
  }
}

function stepBalls(dt: f64): void {
  for (let b = 0; b < MAX_BALLS; b++) {
    if (unchecked(ballLife[b]) <= 0) continue;
    const x0 = unchecked(ballX[b]);
    const y0 = unchecked(ballY[b]);
    const x1 = x0 + unchecked(ballVX[b]) * dt;
    const y1 = y0 + unchecked(ballVY[b]) * dt;
    unchecked((ballX[b] = x1));
    unchecked((ballY[b] = y1));
    unchecked((ballLife[b] -= dt));
    // collision with enemy hulls (oriented ellipse test at the new position)
    let struck = false;
    for (let j = 0; j < bsCount; j++) {
      if (!active(j) || unchecked(bsSide[j]) == unchecked(ballSide[b])) continue;
      const h = unchecked(bsHeading[j]);
      const rx = x1 - unchecked(bsX[j]);
      const ry = y1 - unchecked(bsY[j]);
      const lx = rx * Math.cos(h) + ry * Math.sin(h);
      const ly = -rx * Math.sin(h) + ry * Math.cos(h);
      const a = unchecked(bsLength[j]) * 0.5;
      const w = a * 0.32;
      if ((lx * lx) / (a * a) + (ly * ly) / (w * w) <= 1.0) {
        hit(b, j);
        unchecked((ballLife[b] = 0));
        struck = true;
        break;
      }
    }
    if (!struck && unchecked(ballLife[b]) <= 0) {
      // fell short: splash
      pushEvent(EV_BATTLE_SPLASH, x1, y1);
      unchecked((ballLife[b] = 0));
    }
  }
}

function separate(): void {
  // keep hulls from overlapping
  for (let i = 0; i < bsCount; i++) {
    if ((unchecked(bsFlags[i]) & (BF_SUNK | BF_ESCAPED)) != 0) continue;
    for (let j = i + 1; j < bsCount; j++) {
      if ((unchecked(bsFlags[j]) & (BF_SUNK | BF_ESCAPED)) != 0) continue;
      const dx = unchecked(bsX[j]) - unchecked(bsX[i]);
      const dy = unchecked(bsY[j]) - unchecked(bsY[i]);
      const d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
      const minD = (unchecked(bsLength[i]) + unchecked(bsLength[j])) * 0.28;
      if (d < minD) {
        const push = (minD - d) * 0.5;
        unchecked((bsX[i] -= dx / d * push));
        unchecked((bsY[i] -= dy / d * push));
        unchecked((bsX[j] += dx / d * push));
        unchecked((bsY[j] += dy / d * push));
        unchecked((bsSpeed[i] *= 0.9));
        unchecked((bsSpeed[j] *= 0.9));
      }
    }
  }
}

/** Advance the battle by dt seconds. */
export function battleStep(dt: f64): void {
  if (battleOver >= 0) return;
  battleTime += dt;
  for (let i = 0; i < bsCount; i++) {
    if (!active(i)) {
      // sinking / captured ships drift to a halt
      unchecked((bsSpeed[i] *= 0.98));
      continue;
    }
    if (unchecked(bsManual[i]) == 0) think(i);
    steer(i, dt);
    unchecked((bsReloadL[i] = Math.max(0.0, unchecked(bsReloadL[i]) - dt)));
    unchecked((bsReloadR[i] = Math.max(0.0, unchecked(bsReloadR[i]) - dt)));
    if (unchecked(bsAutoFire[i]) != 0 && (unchecked(bsFlags[i]) & BF_FLEEING) == 0) autoFire(i);
    // leaving the arena = escaping
    const m: f64 = 60.0;
    const x = unchecked(bsX[i]);
    const y = unchecked(bsY[i]);
    if (x < -m || y < -m || x > ARENA_W + m || y > ARENA_H + m) unchecked((bsFlags[i] |= BF_ESCAPED));
  }
  separate();
  stepBalls(dt);
  // victory conditions
  let p = 0;
  let e = 0;
  let pEsc = 0;
  for (let i = 0; i < bsCount; i++) {
    if (active(i)) {
      if (unchecked(bsSide[i]) == 0) p++;
      else e++;
    } else if ((unchecked(bsFlags[i]) & BF_ESCAPED) != 0 && unchecked(bsSide[i]) == 0) pEsc++;
  }
  if (e == 0) battleOver = 0;
  else if (p == 0) battleOver = pEsc > 0 ? 2 : 1;
  if (battleOver >= 0) pushEvent(EV_BATTLE_END, <f64>battleOver, 0);
}

export function battleSetTarget(i: i32, x: f64, y: f64): void {
  unchecked((bsTargetX[i] = x));
  unchecked((bsTargetY[i] = y));
  unchecked((bsManual[i] = 1));
}
export function battleSetSail(i: i32, v: f64): void {
  unchecked((bsSail[i] = Math.max(0.0, Math.min(1.0, v))));
}
export function battleSetAmmo(i: i32, a: i32): void {
  unchecked((bsAmmo[i] = a));
}
export function battleSetAuto(i: i32, manual: i32, autoFire: i32): void {
  unchecked((bsManual[i] = manual));
  unchecked((bsAutoFire[i] = autoFire));
}
/** Concede the fight: every player ship is treated as having escaped. */
export function battleFlee(): void {
  for (let i = 0; i < bsCount; i++) if (unchecked(bsSide[i]) == 0 && active(i)) unchecked((bsFlags[i] |= BF_ESCAPED));
}

/**
 * Write the outcome back to the fleet: damage, crew losses, sunk ships removed, captured
 * enemy ships (and their cargo) join `playerConvoy`.
 */
export function battleApply(playerConvoy: i32, enemyConvoy: i32): i32 {
  let captured = 0;
  for (let i = 0; i < bsCount; i++) {
    const s = unchecked(bsShip[i]);
    if (unchecked(shActive[s]) == 0) continue;
    const f = unchecked(bsFlags[i]);
    if ((f & BF_SUNK) != 0) {
      removeShip(s);
      continue;
    }
    unchecked((shHull[s] = Math.max(1.0, unchecked(bsHull[i]) / unchecked(bsHullMax[i]) * 100.0)));
    unchecked((shSails[s] = Math.max(5.0, unchecked(bsSails[i]))));
    unchecked((shCrew[s] = Math.max(0.0, Math.floor(unchecked(bsCrew[i])))));
    unchecked((shCannons[s] = unchecked(bsCannons[i])));
    if ((f & BF_CAPTURED) != 0) {
      if (unchecked(bsSide[i]) == 1 && playerConvoy >= 0) {
        // prize: ship joins the player's convoy with a skeleton crew
        unchecked((shConvoy[s] = playerConvoy));
        unchecked((shOwner[s] = OWNER_PLAYER));
        unchecked((shCrew[s] = Math.max(1.0, Math.floor(unchecked(typeCrew[unchecked(shType[s])]) * 0.15))));
        captured++;
      } else if (unchecked(bsSide[i]) == 0 && enemyConvoy >= 0) {
        unchecked((shConvoy[s] = enemyConvoy));
        unchecked((shOwner[s] = 2));
      }
    }
  }
  // the winner takes the loser's cargo
  if (battleOver == 0 && enemyConvoy >= 0 && playerConvoy >= 0) {
    for (let g = 0; g < numGoods; g++) {
      unchecked((cvCargo[playerConvoy * MAX_GOODS + g] += unchecked(cvCargo[enemyConvoy * MAX_GOODS + g])));
      unchecked((cvCargo[enemyConvoy * MAX_GOODS + g] = 0));
    }
  } else if (battleOver == 1 && enemyConvoy >= 0 && playerConvoy >= 0) {
    for (let g = 0; g < numGoods; g++) {
      unchecked((cvCargo[enemyConvoy * MAX_GOODS + g] += unchecked(cvCargo[playerConvoy * MAX_GOODS + g])));
      unchecked((cvCargo[playerConvoy * MAX_GOODS + g] = 0));
    }
  }
  return captured;
}
