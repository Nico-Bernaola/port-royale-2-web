# Caribbean Trader

A trading and naval strategy game for the browser, inspired by Port Royale 2. Buy cheap and sell dear across the Caribbean of 1600, grow a merchant fleet, commission ships, and fight off pirates.

**Play it:** https://nico-bernaola.github.io/port-royale-2-web/

Everything is original or public domain: the coastlines come from [Natural Earth](https://www.naturalearthdata.com/), and the ships, towns, terrain, music and sound effects are generated in code. No files from the original game are used or needed.

## Features

- **The real Caribbean**: 60 colonial ports at their historical positions, from Veracruz to Georgetown, owned by Spain, England, France and Holland.
- **A living economy**: towns produce and consume 19 goods, with production chains (corn → meat, sugar → rum, hemp → rope, cotton → cloth). Prices follow supply barrel by barrel, and AI merchants move goods between towns.
- **Sailing**: routes are planned with A* around the coastline, and wind speeds you up or slows you down.
- **Ports in 3D**: a harbour town with pier, shipyard slipway, warehouses, market square, town hall, church and tavern, each clickable.
- **Fleet management**: buy ready-built ships or commission new ones (the shipyard uses timber, rope and cloth from the local market, so build where they are cheap). Repair, arm, crew, form convoys, rent warehouses.
- **Pirates and sea battles**: real-time battles with wind, broadsides, round/grape/chain shot, boarding and prize ships.

## Controls

| Where | Action |
| --- | --- |
| Sea map | Left-click your ship to select it · right-click the sea or a town to sail · drag to scroll · wheel to zoom · Space pauses, 1/2/3 set speed |
| Port | Click buildings or the bottom bar · drag to look around · wheel to zoom · Q/E or right-drag to rotate |
| Battle | Click the sea to steer · Q/E fire port/starboard · 1/2/3 pick ammunition · B to board |

## Running locally

Requires Node.js 22.18+.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 (`?quickstart` skips the menus). `npm run build` writes a static site to `dist/`; `npm test` runs the simulation tests.

## How it works

| Path | What it is |
| --- | --- |
| `wasm/assembly/` | Simulation core in AssemblyScript, compiled to WebAssembly: economy, A* navigation, fleets, AI traders and pirates, sea battles |
| `src/core/` | Typed wrapper with zero-copy views over the WASM state arrays (also used for save games) |
| `src/data/` | The world: towns, goods, ship classes, map projection |
| `src/render/` | three.js scenes: sea map (terrain and water shaders), procedural ships, harbour towns |
| `src/game/`, `src/ui/` | Screens, input, HUD and dialogs |
| `scripts/geo/` | Builds `public/world/` (coastline distance field, navigation grid, minimap) from Natural Earth |
| `scripts/dev/battlesim.mjs` | Headless harness for balancing sea battles |

All simulation state lives in fixed-capacity arrays inside the WASM module. The browser reads them directly through typed arrays, which keeps the per-frame cost near zero and makes save games a straight copy.

To regenerate the geography (downloads about 11 MB from Natural Earth on first run):

```bash
node scripts/geo/build-world.ts
```

## Credits

Inspired by *Port Royale 2* (Ascaron, 2004). This is an independent fan project with original code and assets; it is not affiliated with or endorsed by the rights holders. Coastline data: Natural Earth (public domain).
