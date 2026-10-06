# Port Royale 2 Web

Port Royale 2 running in the browser. The simulation (economy, sea navigation, AI traders and pirates, sea battles) is a WebAssembly module compiled from AssemblyScript. The Caribbean, ships and towns are drawn with WebGL (three.js) using the original art, which you extract from your own copy of the game.

**No game assets are included in this repository.** You need a legitimate install (for example the GOG version).

## Quick start

Requirements: Node.js 22.18 or newer and an installed copy of Port Royale 2.

```bash
npm install
```

```bash
npm run extract -- "C:\Games\Gog\Port Royale 2"
```

```bash
npm run dev
```

Then open http://localhost:5173. `npm run build` writes a static site to `dist/` (the extracted assets in `public/game/` are copied along).

Add `?quickstart` (or `?quickstart=Havana`) to the URL to skip the menus and start a game straight away.

## What you can do

- **Sea map**: the original painted map over an animated sea. Left-click a convoy to select it, right-click the sea or a town to sail there (routes are planned with A* on the game's own navigation grid), drag to scroll, wheel to zoom. Space pauses, 1/2/3 set the speed.
- **Ports**: an isometric town built from the town's real heightmap and the original building sprites. Click a building or use the bottom bar:
  - Market: buy and sell 19 goods; every barrel moves the price.
  - Shipyard: buy, repair, arm and sell ships.
  - Tavern: hire sailors and pick up trade rumours drawn from live prices.
  - Harbour master: lay up ships, form and merge convoys.
  - Town hall: production, demand and stock levels.
- **Pirates**: they patrol near their hideouts and hunt convoys. When they catch you, take command or let your captains fight it out.
- **Sea battles**: right-click to steer your flagship, Q/E fire port and starboard broadsides, 1/2/3 pick round, grape or chain shot, B boards.
- **Save and load** from the sea map or port (stored in the browser).

## Architecture

| Path | What it is |
| --- | --- |
| `scripts/extract/` | Asset pipeline (Node + TypeScript): `.cpr` archive reader, AIM image decoder, data and audio export |
| `wasm/assembly/` | Simulation core in AssemblyScript: `economy.ts`, `nav.ts`, `fleet.ts`, `ai.ts`, `battle.ts` |
| `src/core/` | Typed host wrapper around the WASM module (zero-copy views over its state arrays) |
| `src/render/` | three.js views: sea map, port view |
| `src/game/` | Screens and controllers: session, sea map input/HUD, town screen, battle screen |
| `src/ui/` | Port dialogs and DOM helpers |
| `tests/` | Integration tests for the core against the extracted data (`npm test`) |

All simulation state lives in fixed-capacity arrays inside the WASM module. The host reads them through typed-array views and snapshots them for save games.

## Reverse-engineered formats

- **`.cpr` archives** (`ASCARON_ARCHIVE V0.9`): a 0x20-byte header, then directory blocks (`u32 blockSize, used, count, dataLength`) of `(offset, size, flag, name\0)` entries. Each block's file data follows it; the next block starts at `blockStart + blockSize + dataLength`. Data is uncompressed.
- **AIM images** (`AIMRES2.00`): a `MIPMCONT` or `TILEDIM` container holding slices (`IMSLDXT1/3/5`, `IMSLD32`, `IMSLD8` with palette, 16-bit, JPEG, TGA, raw). Slice payloads are LZ-compressed blobs; the decompressor was ported from `AIM20.dll` (stored blobs are XOR 0x35). `TILEDIM` slices are stored column-major.
- **Ship sprite sheets**: 4×4 cells of 100 px; frame *i* faces `(i − 2) · 22.5°` clockwise from east.
- **Navigation grid**: `NavData/nav_matrix.dat`, `u16 w, u16 h` followed by MSB-first bits (1 = land), one bit per 4×4 map pixels.

## Status and limitations

Playable: trading, sailing, fleet management, pirates and sea battles. Not yet implemented: the original town building placement (ports are laid out procedurally), land battles, fencing, missions, nation politics and owning businesses. The economy uses the game's data files (goods, production chains, base prices), but some formulas are calibrated rather than taken from the original.

## Legal

Port Royale 2 and all of its assets are © Ascaron Entertainment and their successors. This project contains only original code and loads assets from your own installation at runtime.
