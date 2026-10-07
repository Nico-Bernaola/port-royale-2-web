// Battle-balance harness: node scripts/dev/battlesim.mjs (run from the repo root)
import { readFileSync } from 'node:fs';
const { Core } = await import('../../src/core/core.ts');
const { configureCore, newGame } = await import('../../src/core/world.ts');
const { world: data } = await import('../../src/data/world.ts');
for (const [seed, ptype] of [[1, 5], [2, 8], [3, 0]]) {
  const core = await Core.load(readFileSync('src/wasm/build/core.wasm'));
  configureCore(core, data, new Uint8Array(readFileSync('public/world/nav.bin')), seed);
  const { convoy } = newGame(core, data, { startTown: 25, gold: 1000, ships: [{ type: ptype, name: 'x' }] });
  const pirate = core.x.spawnPirate();
  core.x.battleBegin();
  for (const sh of core.shipsOf(convoy)) core.x.battleAddShip(sh, 0, 380, 650, 0);
  core.shipsOf(pirate).forEach((sh, i) => core.x.battleAddShip(sh, 1, 1420, 650 + i * 160, Math.PI));
  core.x.battleSetAuto(0, 0, 1);
  let fires = 0, hits = 0, splashes = 0, boards = 0;
  const n = core.x.battleShipCount();
  const log = [];
  let prev = '';
  for (let step = 0; step < 20 * 60 * 5; step++) {
    prev = [...Array(n).keys()].map(i => Math.round(core.s.bsCrew[i]) + '(' + Math.round(core.s.bsHull[i]) + ')' + (core.s.bsFlags[i])).join('/');
    core.x.battleStep(0.05);
    for (const e of core.drainEvents()) {
      if (e.type === 12) fires++; else if (e.type === 10) hits++; else if (e.type === 11) splashes++; else if (e.type === 14) { boards++; log.push(`BEFORE ${prev} BOARD attacker=${e.a} victim=${e.b} crew=${[...Array(n).keys()].map(i => Math.round(core.s.bsCrew[i])).join('/')} hull=${[...Array(n).keys()].map(i => Math.round(core.s.bsHull[i])).join('/')}`); } else if (e.type === 13) log.push('SUNK ' + e.a);
    }
    if (step % 200 === 0) {
      const s = core.s;
      let dmin = 1e9;
      for (let j = 1; j < n; j++) dmin = Math.min(dmin, Math.hypot(s.bsX[j] - s.bsX[0], s.bsY[j] - s.bsY[0]));
      log.push(`${(step * 0.05).toFixed(0)}s d=${dmin.toFixed(0)} hull=${[...Array(n).keys()].map(i => Math.round(s.bsHull[i])).join("/")} crew=${[...Array(n).keys()].map(i => Math.round(s.bsCrew[i])).join("/")} ammo=${[...Array(n).keys()].map(i => s.bsAmmo[i]).join("")}`);
    }
    if (core.x.battleResult() >= 0) break;
  }
  console.log(`player ${data.ships[ptype].name} vs ${core.shipsOf(pirate).map(s => data.ships[core.s.shType[s]].name)} -> result ${core.x.battleResult()} at ${core.x.battleClock().toFixed(0)}s; volleys ${fires} hits ${hits} splashes ${splashes} boards ${boards}`);
  console.log('  ' + log.join(' | '));
}
