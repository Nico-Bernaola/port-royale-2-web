// Town economy: production chains, consumption, population and stock-based prices.
import {
  MAX_GOODS, numGoods, numTowns, goodBasePrice, goodDemand, goodProd, goodRaw, goodRawUse,
  townPop, townStock, townBusinesses, townProduced, townConsumed, townSatisfaction, townRank, world,
} from './state';

// waren.ini gives relative demand in kg per inhabitant. The original consumption formula is
// not known; this divisor is calibrated so a town of 2000 eats ~4 barrels of wheat a day and
// a typical colony makes ~75% more than it consumes of its own goods, which leaves surpluses
// where goods are made and shortages elsewhere for traders to fill.
const DEMAND_DIVISOR: f64 = 9600.0;
// Stock considered "normal" in days of consumption (price factor 1.0 around here).
const NORMAL_DAYS: f64 = 12.0;
const BUY_MARGIN: f64 = 1.06; // town sells to player above its reference price
const SELL_MARGIN: f64 = 0.94; // town buys from player below it

@inline function idx(t: i32, g: i32): i32 {
  return t * MAX_GOODS + g;
}

export function dailyDemand(t: i32, g: i32): f64 {
  return unchecked(townPop[t]) * unchecked(goodDemand[g]) / DEMAND_DIVISOR;
}

/** Reference price for good g in town t at a given stock level. */
export function priceAt(t: i32, g: i32, stock: f64): f64 {
  const normal = Math.max(1.0, dailyDemand(t, g) * NORMAL_DAYS);
  const r = Math.max(0.0, stock) / normal;
  // 2.3x when empty, ~1.0x at normal stock, tending to 0.55x when flooded
  const f = 0.55 + 1.75 * Math.exp(-1.25 * r);
  return unchecked(goodBasePrice[g]) * f;
}

/** Price the town asks per barrel when the player buys the next barrel. */
export function buyPrice(t: i32, g: i32): f64 {
  return Math.round(priceAt(t, g, unchecked(townStock[idx(t, g)]) - 0.5) * BUY_MARGIN);
}

/** Price the town pays per barrel when the player sells the next barrel. */
export function sellPrice(t: i32, g: i32): f64 {
  return Math.round(priceAt(t, g, unchecked(townStock[idx(t, g)]) + 0.5) * SELL_MARGIN);
}

/** Total cost of buying n barrels (price rises as stock falls). */
export function quoteBuy(t: i32, g: i32, n: i32): f64 {
  let s = unchecked(townStock[idx(t, g)]);
  let total: f64 = 0;
  for (let i = 0; i < n; i++) {
    total += Math.round(priceAt(t, g, s - 0.5) * BUY_MARGIN);
    s -= 1.0;
  }
  return total;
}

/** Total revenue for selling n barrels (price falls as stock rises). */
export function quoteSell(t: i32, g: i32, n: i32): f64 {
  let s = unchecked(townStock[idx(t, g)]);
  let total: f64 = 0;
  for (let i = 0; i < n; i++) {
    total += Math.round(priceAt(t, g, s + 0.5) * SELL_MARGIN);
    s += 1.0;
  }
  return total;
}

/**
 * Largest n <= maxN such that buying n barrels costs at most `budget`.
 */
export function affordable(t: i32, g: i32, maxN: i32, budget: f64): i32 {
  let s = unchecked(townStock[idx(t, g)]);
  let total: f64 = 0;
  let n = 0;
  while (n < maxN) {
    const p = Math.round(priceAt(t, g, s - 0.5) * BUY_MARGIN);
    if (total + p > budget) break;
    total += p;
    s -= 1.0;
    n++;
  }
  return n;
}

/** Set up businesses for a town: `produces` goods get businesses scaled by population. */
export function initTownEconomy(t: i32): void {
  const pop = unchecked(townPop[t]);
  let producing = 0;
  for (let g = 0; g < numGoods; g++) if (unchecked(townBusinesses[idx(t, g)]) > 0) producing++;
  // roughly 40% of the population works in the town's own businesses, 30 workers each
  const totalBusinesses = Math.max(4.0, pop * 0.4 / 30.0);
  for (let g = 0; g < numGoods; g++) {
    const i = idx(t, g);
    if (unchecked(townBusinesses[i]) > 0) {
      unchecked((townBusinesses[i] = Math.max(1.0, Math.round(totalBusinesses / <f64>producing))));
    }
    // start with roughly normal stock levels (more of what is produced locally)
    const d = dailyDemand(t, g);
    const local = unchecked(townBusinesses[i]) > 0 ? 2.0 : 0.6;
    unchecked((townStock[i] = Math.round(d * NORMAL_DAYS * local * (0.6 + 0.8 * fract(<f64>(t * 7 + g * 13) * 0.618)))));
  }
  unchecked((townSatisfaction[t] = 0.8));
}

@inline function fract(x: f64): f64 {
  return x - Math.floor(x);
}

/** Advance every town's economy by one day. */
export function economyDay(): void {
  for (let t = 0; t < numTowns; t++) {
    // production (processed goods consume raw materials)
    for (let g = 0; g < numGoods; g++) {
      const i = idx(t, g);
      const b = unchecked(townBusinesses[i]);
      let made: f64 = 0;
      if (b > 0) {
        made = b * unchecked(goodProd[g]);
        const raw = unchecked(goodRaw[g]);
        if (raw >= 0) {
          const need = b * unchecked(goodRawUse[g]);
          if (need > 0) {
            const ri = idx(t, raw);
            const have = unchecked(townStock[ri]);
            const ratio = Math.min(1.0, have / need);
            unchecked((townStock[ri] = have - need * ratio));
            if (unchecked(goodBasePrice[raw]) > unchecked(goodBasePrice[g])) {
              // tools for plantations: an input that boosts output rather than gating it
              made *= 0.5 + 0.5 * ratio;
            } else {
              // workshops: half of the raw material comes from the town's own farms
              made *= Math.min(1.0, 0.5 + ratio);
            }
          }
        }
        unchecked((townStock[i] += made));
      } else if (unchecked(goodProd[g]) == 0 && unchecked(townRank[t]) > 0) {
        // goods not made in the Caribbean (wine, spices, tools) arrive from Europe at the
        // governors' and viceroys' towns; traders distribute them from there
        made = dailyDemand(t, g) * (unchecked(townRank[t]) == 2 ? 7.0 : 4.5);
        unchecked((townStock[i] += made));
      }
      unchecked((townProduced[i] = made));
    }
    // consumption and satisfaction
    let wanted: f64 = 0;
    let got: f64 = 0;
    for (let g = 0; g < numGoods; g++) {
      const i = idx(t, g);
      const d = dailyDemand(t, g);
      const have = unchecked(townStock[i]);
      const c = Math.min(have, d);
      unchecked((townStock[i] = have - c));
      unchecked((townConsumed[i] = c));
      // goods with higher prices matter more for happiness
      const w = unchecked(goodBasePrice[g]);
      wanted += d * w;
      got += c * w;
      // overstock slowly spoils / is shipped away by locals
      const cap = d * NORMAL_DAYS * 5.0 + 20.0;
      if (unchecked(townStock[i]) > cap) unchecked((townStock[i] -= (unchecked(townStock[i]) - cap) * 0.05));
    }
    const sat = wanted > 0 ? got / wanted : 1.0;
    const prev = unchecked(townSatisfaction[t]);
    const s = prev * 0.85 + sat * 0.15;
    unchecked((townSatisfaction[t] = s));
    // population follows supply
    let pop = unchecked(townPop[t]);
    if (s > 0.8) pop *= 1.0 + (s - 0.8) * 0.01;
    else if (s < 0.5) pop *= 1.0 - (0.5 - s) * 0.008;
    unchecked((townPop[t] = Math.max(200.0, Math.min(20000.0, pop))));
  }
  unchecked((world[4] = Math.floor(unchecked(world[0]))));
}
