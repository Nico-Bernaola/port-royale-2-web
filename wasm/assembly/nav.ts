// Sea navigation: A* over the game's own passability grid (NavData/nav_matrix.dat, one bit per
// 4x4 map pixels), with a coastal-clearance cost so routes keep off the shore, followed by
// line-of-sight smoothing into a short list of waypoints.

export const MAX_NAV: i32 = 1280 * 1024;
const MAX_HEAP: i32 = 600000;
export const MAX_PATH_OUT: i32 = 96;

export let navW: i32 = 0;
export let navH: i32 = 0;
export let cellPx: f64 = 4.0; // map pixels per nav cell

export const navGrid = new StaticArray<u8>(MAX_NAV); // 1 = land / blocked
const clearance = new StaticArray<u8>(MAX_NAV); // distance to land in cells (capped)
const ocean = new StaticArray<u8>(MAX_NAV); // 1 = connected to the open Atlantic
const gScore = new StaticArray<f32>(MAX_NAV);
const parent = new StaticArray<i32>(MAX_NAV);
const visit = new StaticArray<u32>(MAX_NAV); // gen*2 = open, gen*2+1 = closed
const heapNode = new StaticArray<i32>(MAX_HEAP);
const heapF = new StaticArray<f32>(MAX_HEAP);
let heapSize: i32 = 0;
let gen: u32 = 1;

const rawPath = new StaticArray<i32>(MAX_NAV / 4);
export const pathX = new StaticArray<f64>(MAX_PATH_OUT);
export const pathY = new StaticArray<f64>(MAX_PATH_OUT);
export let pathLen: i32 = 0;

const CLEAR_CAP: i32 = 6;

/** Host writes the unpacked grid (one byte per cell) into navGrid, then calls this. */
export function navInit(w: i32, h: i32, mapWidthPx: f64): void {
  navW = w;
  navH = h;
  cellPx = mapWidthPx / <f64>w;
  // multi-source BFS from land cells for the clearance field
  const n = w * h;
  const queue = parent; // reuse as BFS queue
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) {
    if (unchecked(navGrid[i]) != 0) {
      unchecked((clearance[i] = 0));
      unchecked((queue[qt++] = i));
    } else unchecked((clearance[i] = <u8>CLEAR_CAP));
  }
  while (qh < qt) {
    const i = unchecked(queue[qh++]);
    const d = <i32>unchecked(clearance[i]);
    if (d + 1 >= CLEAR_CAP) continue;
    const x = i % w;
    const y = i / w;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k == 0 ? 1 : k == 1 ? -1 : 0);
      const ny = y + (k == 2 ? 1 : k == 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (<i32>unchecked(clearance[j]) > d + 1) {
        unchecked((clearance[j] = <u8>(d + 1)));
        unchecked((queue[qt++] = j));
      }
    }
  }
  // flood-fill the main sea from every water cell on the east (Atlantic) edge, so isolated
  // lagoons in the grid are never used as start or end points
  qh = 0;
  qt = 0;
  for (let i = 0; i < n; i++) unchecked((ocean[i] = 0));
  for (let y = 0; y < h; y++) {
    const i = y * w + (w - 1);
    if (unchecked(navGrid[i]) == 0) {
      unchecked((ocean[i] = 1));
      unchecked((queue[qt++] = i));
    }
  }
  while (qh < qt) {
    const i = unchecked(queue[qh++]);
    const x = i % w;
    const y = i / w;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k == 0 ? 1 : k == 1 ? -1 : 0);
      const ny = y + (k == 2 ? 1 : k == 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (unchecked(navGrid[j]) == 0 && unchecked(ocean[j]) == 0) {
        unchecked((ocean[j] = 1));
        unchecked((queue[qt++] = j));
      }
    }
  }
}

export function navPtr(): usize {
  return changetype<usize>(navGrid);
}

@inline function blocked(x: i32, y: i32): bool {
  if (x < 0 || y < 0 || x >= navW || y >= navH) return true;
  return unchecked(navGrid[y * navW + x]) != 0;
}

export function isWater(px: f64, py: f64): bool {
  return !blocked(<i32>(px / cellPx), <i32>(py / cellPx));
}

/** Distance (in map px) from a point to the nearest land, capped. */
export function coastDistance(px: f64, py: f64): f64 {
  const x = <i32>(px / cellPx);
  const y = <i32>(py / cellPx);
  if (x < 0 || y < 0 || x >= navW || y >= navH) return 0;
  return <f64>unchecked(clearance[y * navW + x]) * cellPx;
}

/** Find the water cell nearest to (cx, cy), searching outward up to r cells. Returns index or -1. */
function nearestWater(cx: i32, cy: i32, r: i32, minClear: i32): i32 {
  for (let d = 0; d <= r; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (abs(dx) != d && abs(dy) != d) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (blocked(x, y)) continue;
        const i = y * navW + x;
        if (unchecked(ocean[i]) == 0) continue;
        if (<i32>unchecked(clearance[i]) < minClear) continue;
        return i;
      }
    }
  }
  return -1;
}

/** Snap a map position to the nearest navigable point; writes result to pathX[0]/pathY[0]. */
export function snapToWater(px: f64, py: f64): bool {
  const i = nearestWater(<i32>(px / cellPx), <i32>(py / cellPx), 60, 1);
  if (i < 0) return false;
  unchecked((pathX[0] = (<f64>(i % navW) + 0.5) * cellPx));
  unchecked((pathY[0] = (<f64>(i / navW) + 0.5) * cellPx));
  return true;
}

// ---- binary heap --------------------------------------------------------------------------
function heapPush(node: i32, f: f32): void {
  if (heapSize >= MAX_HEAP) return;
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (unchecked(heapF[p]) <= f) break;
    unchecked((heapF[i] = heapF[p]));
    unchecked((heapNode[i] = heapNode[p]));
    i = p;
  }
  unchecked((heapF[i] = f));
  unchecked((heapNode[i] = node));
}

function heapPop(): i32 {
  const top = unchecked(heapNode[0]);
  heapSize--;
  if (heapSize > 0) {
    const f = unchecked(heapF[heapSize]);
    const node = unchecked(heapNode[heapSize]);
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= heapSize) break;
      if (c + 1 < heapSize && unchecked(heapF[c + 1]) < unchecked(heapF[c])) c++;
      if (unchecked(heapF[c]) >= f) break;
      unchecked((heapF[i] = heapF[c]));
      unchecked((heapNode[i] = heapNode[c]));
      i = c;
    }
    unchecked((heapF[i] = f));
    unchecked((heapNode[i] = node));
  }
  return top;
}

@inline function octile(ax: i32, ay: i32, bx: i32, by: i32): f32 {
  const dx = <f32>abs(ax - bx);
  const dy = <f32>abs(ay - by);
  return dx > dy ? dx + 0.41421356 * dy : dy + 0.41421356 * dx;
}

@inline function stepPenalty(i: i32): f32 {
  const c = <i32>unchecked(clearance[i]);
  const k: i32 = 4 - c;
  return c >= 4 ? <f32>0.0 : <f32>k * <f32>0.6;
}

/** Line of sight between two cells over water that keeps at least one cell off the coast. */
function lineClear(ax: i32, ay: i32, bx: i32, by: i32): bool {
  const dx = <f64>(bx - ax);
  const dy = <f64>(by - ay);
  const steps = <i32>(Math.max(Math.abs(dx), Math.abs(dy)) * 2.0) + 1;
  for (let s = 0; s <= steps; s++) {
    const t = <f64>s / <f64>steps;
    const x = <i32>(<f64>ax + 0.5 + dx * t);
    const y = <i32>(<f64>ay + 0.5 + dy * t);
    if (blocked(x, y)) return false;
    if (unchecked(clearance[y * navW + x]) < 2) {
      // allow hugging only right at the ends (harbour approaches)
      if (s > 2 && s < steps - 2) return false;
    }
  }
  return true;
}

/**
 * Plan a route between two map positions. On success the waypoints (excluding the start,
 * including the goal) are in pathX/pathY[0..pathLen). Returns false when unreachable.
 */
export function findPath(sx: f64, sy: f64, tx: f64, ty: f64): bool {
  pathLen = 0;
  if (navW == 0) return false;
  const s = nearestWater(<i32>(sx / cellPx), <i32>(sy / cellPx), 40, 0);
  const goal = nearestWater(<i32>(tx / cellPx), <i32>(ty / cellPx), 40, 0);
  if (s < 0 || goal < 0) return false;
  const gx = goal % navW;
  const gy = goal / navW;
  gen++;
  const open = gen * 2;
  const closed = gen * 2 + 1;
  heapSize = 0;
  unchecked((gScore[s] = 0));
  unchecked((parent[s] = -1));
  unchecked((visit[s] = open));
  heapPush(s, octile(s % navW, s / navW, gx, gy));
  let found = false;
  let iterations = 0;
  while (heapSize > 0) {
    const cur = heapPop();
    if (unchecked(visit[cur]) == closed) continue;
    unchecked((visit[cur] = closed));
    if (cur == goal) {
      found = true;
      break;
    }
    if (++iterations > 900000) break;
    const cx = cur % navW;
    const cy = cur / navW;
    const g0 = unchecked(gScore[cur]);
    for (let k = 0; k < 8; k++) {
      const dx = k == 0 || k == 4 || k == 5 ? 1 : k == 1 || k == 6 || k == 7 ? -1 : 0;
      const dy = k == 2 || k == 4 || k == 6 ? 1 : k == 3 || k == 5 || k == 7 ? -1 : 0;
      const nx = cx + dx;
      const ny = cy + dy;
      if (blocked(nx, ny)) continue;
      if (dx != 0 && dy != 0 && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue;
      const ni = ny * navW + nx;
      const vs = unchecked(visit[ni]);
      if (vs == closed) continue;
      const stepLen: f32 = dx != 0 && dy != 0 ? 1.41421356 : 1.0;
      const ng = g0 + stepLen * (1.0 + stepPenalty(ni));
      if (vs == open && ng >= unchecked(gScore[ni])) continue;
      unchecked((gScore[ni] = ng));
      unchecked((parent[ni] = cur));
      unchecked((visit[ni] = open));
      heapPush(ni, ng + octile(nx, ny, gx, gy) * 1.05);
    }
  }
  if (!found) return false;

  // walk back
  let n = 0;
  let c = goal;
  const cap = MAX_NAV / 4;
  while (c >= 0 && n < cap) {
    unchecked((rawPath[n++] = c));
    c = unchecked(parent[c]);
  }
  // rawPath is goal..start; smooth from the start
  let out = 0;
  let anchor = n - 1;
  while (anchor > 0 && out < MAX_PATH_OUT) {
    const ax = unchecked(rawPath[anchor]) % navW;
    const ay = unchecked(rawPath[anchor]) / navW;
    let next = anchor - 1;
    // furthest visible cell (binary-ish scan with a step to keep it cheap)
    let probe = 0;
    while (probe < anchor) {
      const bx = unchecked(rawPath[probe]) % navW;
      const by = unchecked(rawPath[probe]) / navW;
      if (lineClear(ax, ay, bx, by)) {
        next = probe;
        break;
      }
      probe += probe < 8 ? 1 : max(1, (anchor - probe) >> 3);
    }
    if (next >= anchor) next = anchor - 1;
    const node = unchecked(rawPath[next]);
    unchecked((pathX[out] = (<f64>(node % navW) + 0.5) * cellPx));
    unchecked((pathY[out] = (<f64>(node / navW) + 0.5) * cellPx));
    out++;
    anchor = next;
  }
  // make sure the last waypoint is exactly the requested target when it is navigable
  if (out > 0 && isWater(tx, ty)) {
    unchecked((pathX[out - 1] = tx));
    unchecked((pathY[out - 1] = ty));
  }
  pathLen = out;
  return out > 0;
}
