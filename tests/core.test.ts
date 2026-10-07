/**
 * Integration tests for the WASM simulation core, run against the game world.
 *   npm run build:wasm && npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Core, CvState, Ev, Owner } from '../src/core/core.ts';
import type { GameData } from '../src/core/data.ts';
import { configureCore, newGame } from '../src/core/world.ts';
import { world } from '../src/data/world.ts';

const WASM = 'src/wasm/build/core.wasm';
const NAV = 'public/world/nav.bin';
const ready = existsSync(WASM) && existsSync(NAV);

async function boot(seed = 1234) {
  const core = await Core.load(readFileSync(WASM));
  const data: GameData = world;
  configureCore(core, data, new Uint8Array(readFileSync(NAV)), seed);
  return { core, data };
}

function town(data: GameData, name: string) {
  const t = data.towns.find((x) => x.name === name);
  assert.ok(t, `town ${name}`);
  return t;
}

test('every town dock is reachable from Port Royale', { skip: !ready }, async () => {
  const { core, data } = await boot();
  const pr = town(data, 'Port Royal');
  const s = core.s;
  let failures: string[] = [];
  for (const t of data.towns) {
    if (t.id === pr.id) continue;
    if (!core.x.findPath(s.townX[pr.id], s.townY[pr.id], s.townX[t.id], s.townY[t.id])) failures.push(t.name);
  }
  assert.deepEqual(failures, []);
});

test('routes stay on water', { skip: !ready }, async () => {
  const { core, data } = await boot();
  const a = town(data, 'Havana'), b = town(data, 'Cartagena');
  const s = core.s;
  assert.ok(core.x.findPath(s.townX[a.id], s.townY[a.id], s.townX[b.id], s.townY[b.id]));
  const n = core.x.pathLength();
  assert.ok(n > 1 && n < 96);
  let px = s.townX[a.id], py = s.townY[a.id];
  for (let i = 0; i < n; i++) {
    const qx = s.pathX[i], qy = s.pathY[i];
    for (let k = 0; k <= 20; k++) {
      const x = px + (qx - px) * (k / 20), y = py + (qy - py) * (k / 20);
      assert.ok(core.x.isWater(x, y), `segment ${i} crosses land at ${x.toFixed(0)},${y.toFixed(0)}`);
    }
    px = qx;
    py = qy;
  }
});

test('economy runs and prices react to trade', { skip: !ready }, async () => {
  const { core, data } = await boot();
  const pr = town(data, 'Port Royal');
  const { convoy } = newGame(core, data, { startTown: pr.id, gold: 50000, ships: [{ type: 5, name: 'Test' }] });
  // trade the good this town has most of
  const wheat = data.goods.reduce((best, g) => (core.stock(pr.id, g.id) > core.stock(pr.id, best) ? g.id : best), 0);
  const before = core.x.buyPrice(pr.id, wheat);
  assert.ok(before > 10 && before < 1000, `price ${before}`);
  const gold0 = core.x.gold();
  const bought = core.x.buy(convoy, wheat, 40);
  assert.ok(bought > 0, 'bought something');
  assert.ok(core.x.gold() < gold0, 'paid for it');
  assert.ok(core.x.buyPrice(pr.id, wheat) >= before, 'price rises when stock falls');
  assert.equal(core.cargo(convoy, wheat), bought);
  const sold = core.x.sell(convoy, wheat, bought);
  assert.equal(sold, bought);
  assert.ok(core.x.gold() < gold0, 'round trip loses the margin');

  // a month of simulation keeps numbers sane and AI traders active
  for (let d = 0; d < 30 * 10; d++) core.x.tick(0.1);
  const events = core.drainEvents();
  assert.ok(events.some((e) => e.type === Ev.Day));
  const traders = core.convoys(Owner.Trader);
  assert.ok(traders.length >= 20, `traders: ${traders.length}`);
  const s = core.s;
  for (const t of data.towns) {
    assert.ok(Number.isFinite(s.townPop[t.id]) && s.townPop[t.id] > 100, `pop ${t.name}`);
    for (let g = 0; g < data.goods.length; g++) {
      const st = core.stock(t.id, g);
      assert.ok(Number.isFinite(st) && st >= 0, `stock ${t.name} ${g} = ${st}`);
    }
  }
});

test('player convoy sails to another town and docks', { skip: !ready }, async () => {
  const { core, data } = await boot();
  const pr = town(data, 'Port Royal'), dest = town(data, 'Santiago');
  const { convoy } = newGame(core, data, { startTown: pr.id, gold: 10000, ships: [{ type: 0, name: 'P' }] });
  assert.ok(core.x.sailToTown(convoy, dest.id));
  assert.equal(core.s.cvState[convoy] as number, CvState.Sailing);
  let arrived = false;
  for (let i = 0; i < 400 && !arrived; i++) {
    core.x.tick(0.05);
    for (const e of core.drainEvents()) if (e.type === Ev.Arrived && e.a === convoy) arrived = true;
    if ((core.s.cvState[convoy] as number) === CvState.Halted) core.x.autoResolve(convoy, -1);
  }
  assert.ok(arrived, 'arrived');
  assert.equal(core.s.cvTown[convoy], dest.id);
});

test('sea battle resolves', { skip: !ready }, async () => {
  const { core, data } = await boot();
  const pr = town(data, 'Port Royal');
  const { convoy } = newGame(core, data, { startTown: pr.id, gold: 10000, ships: [{ type: 8, name: 'Frigate' }] });
  const pirate = core.x.spawnPirate();
  assert.ok(pirate >= 0);
  core.x.battleBegin();
  for (const sh of core.shipsOf(convoy)) core.x.battleAddShip(sh, 0, 400, 650, 0);
  for (const sh of core.shipsOf(pirate)) core.x.battleAddShip(sh, 1, 1400, 650, Math.PI);
  let result = -1;
  for (let i = 0; i < 20 * 60 * 6 && result < 0; i++) {
    core.x.battleStep(0.05);
    result = core.x.battleResult();
    core.drainEvents();
  }
  assert.ok(result >= 0, 'battle finished within 6 minutes of simulated time');
  core.x.battleApply(convoy, pirate);
});
