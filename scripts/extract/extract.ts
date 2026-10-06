/**
 * Extracts and converts the assets this port needs from an installed copy of Port Royale 2.
 *
 *   npm run extract -- "C:\Games\Gog\Port Royale 2"
 *
 * The game directory can also be given via the PR2_DIR environment variable. Output goes to
 * public/game/ (git-ignored: the game's assets are copyrighted and must come from your copy).
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { GameFiles } from './cpr.ts';
import { assemble, guessRows, parseAim } from './aim.ts';
import { type Ini, num, pair, parseIni } from './ini.ts';
import { type Rgba, blankImage, blit } from './pixels.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/game');
const gameDir = resolve(process.argv[2] ?? process.env.PR2_DIR ?? 'C:/Games/Gog/Port Royale 2');

if (!existsSync(join(gameDir, 'pr2_arcd.cpr'))) {
  console.error(`Port Royale 2 not found in "${gameDir}". Pass the install folder as an argument.`);
  process.exit(1);
}

const files = new GameFiles(gameDir);
let written = 0;

function outPath(rel: string): string {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

async function saveImage(img: Rgba, rel: string, opts: { quality?: number; lossless?: boolean } = {}): Promise<void> {
  const s = sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  });
  if (rel.endsWith('.png')) await s.png({ compressionLevel: 9 }).toFile(outPath(rel));
  else await s.webp({ quality: opts.quality ?? 88, alphaQuality: 100, lossless: opts.lossless ?? false, effort: 5 }).toFile(outPath(rel));
  written++;
}

async function loadImage(name: string): Promise<Rgba> {
  const aim = await parseAim(files.get(name));
  return assemble(aim.slices, guessRows(aim.slices, name));
}

function writeJson(rel: string, data: unknown): void {
  writeFileSync(outPath(rel), JSON.stringify(data, null, 1));
  written++;
}

/** Crop transparent borders. Returns the cropped image and its offset in the original. */
function trim(img: Rgba): { img: Rgba; x: number; y: number } {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { img, x: 0, y: 0 };
  const out = blankImage(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = 0; y < out.height; y++) {
    const s = ((y0 + y) * img.width + x0) * 4;
    out.data.set(img.data.subarray(s, s + out.width * 4), y * out.width * 4);
  }
  return { img: out, x: x0, y: y0 };
}

function step(name: string): void {
  console.log(`- ${name}`);
}

// ---------------------------------------------------------------------------------------------
// Game data
// ---------------------------------------------------------------------------------------------

const GOODS_EN: Record<string, string> = {
  Weizen: 'Wheat', 'Früchte': 'Fruit', Holz: 'Wood', Lehmziegel: 'Bricks', Mais: 'Corn', Zucker: 'Sugar',
  Baumwolle: 'Cotton', Hanf: 'Hemp', Fleisch: 'Meat', Kleidung: 'Textiles', Seile: 'Ropes', Rum: 'Rum',
  Kaffee: 'Coffee', Kakao: 'Cocoa', Farbstoffe: 'Dyes', Tabak: 'Tobacco', 'Gewürze': 'Spices', Wein: 'Wine',
  Werkzeug: 'Tools',
};
const NATION_EN: Record<string, string> = { Spanien: 'Spain', England: 'England', Frankreich: 'France', Holland: 'Holland' };
const SHIPS: [string, string, string][] = [
  // [BattleConst key, sprite/model folder, English name]
  ['PINASSE', '00_Pinasse', 'Pinnace'],
  ['SCHALUP', '01_Schaluppe', 'Sloop'],
  ['BRIGG', '02_Brigg', 'Brig'],
  ['BARKE', '03_Barke', 'Barque'],
  ['PIBARKE', '04_Piratenbarke', 'Pirate Barque'],
  ['FLEUTE', '05_Fleute', 'Fluyt'],
  ['HFLEUTE', '06_Handelsfleute', 'Merchant Fluyt'],
  ['KORVETT', '07_Korvette', 'Corvette'],
  ['FREGATT', '08_Fregatte', 'Frigate'],
  ['MILKORV', '09_Militaerkorvette', 'War Corvette'],
  ['MILFREG', '10_Militaerfregatte', 'War Frigate'],
  ['GALEONE', '11_Galeone', 'Galleon'],
  ['KARACKE', '12_Karacke', 'Carrack'],
  ['KARAVEL', '13_Karavelle', 'Caravel'],
  ['KRIEGSG', '14_Kriegsgaleone', 'War Galleon'],
  ['LINIENS', '15_LinienSchiff', 'Ship of the Line'],
  ['BONUSSF', '16_BonusSchiff', 'Paddle Steamer'],
];

function normKey(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').toLowerCase();
}

function section(ini: Ini, name: string): Map<string, string> {
  return ini.get(name) ?? new Map();
}

function extractData(): void {
  step('game data');
  const waren = parseIni(files.get('Data/waren.ini'));
  const staedte = parseIni(files.get('Data/staedte.ini'));
  const stadtDaten = parseIni(files.get('scripts/StadtDaten.ini'));
  const battle = parseIni(files.get('Data/BattleConst.ini'));
  const game = parseIni(files.get('scripts/game.ini'));
  const bau = parseIni(files.get('Data/bauwaren.ini'));
  const pir = parseIni(files.get('Data/Piratenverstecke.ini'));

  // Goods, in the game's canonical order ([Warenbedarf] lists all 19).
  const order = [...section(waren, 'Warenbedarf').keys()];
  const gewerbe = section(waren, 'Gewerbe');
  const goods = order.map((key, id) => {
    const g = gewerbe.get(key);
    const [workers, production, consumption] = g ? g.split(',').map((x) => Number(x.trim())) : [0, 0, 0];
    const building = bau.get(key);
    return {
      id,
      key,
      name: GOODS_EN[key] ?? key,
      basePrice: num(section(waren, 'SWP').get(key), 100),
      demandPerCitizen: num(section(waren, 'Warenbedarf').get(key)),
      totalDemand: num(section(waren, 'Gesamtwarenbedarf').get(key)),
      producible: !!g,
      workers: workers || 0,
      production: production || 0,
      consumption: consumption || 0,
      rawMaterial: section(waren, 'Rohstoff').get(key) ?? null,
      buildCost: building ? num(building.get('BAUKOSTEN')) : 0,
    };
  });
  const goodIndex = new Map(goods.map((g) => [g.key, g.id]));

  // Towns: positions from StadtDaten (Stadt0..59), economy from staedte.ini by normalised name.
  const econ = new Map<string, [string, Map<string, string>]>();
  for (const [name, sec] of staedte) if (name) econ.set(normKey(name), [name, sec]);
  const alias: Record<string, string> = { portdepaix: 'tortuga' };
  const towns = [];
  for (let i = 0; ; i++) {
    const sec = stadtDaten.get(`Stadt${i}`);
    if (!sec) break;
    const name = (sec.get('Name') ?? '').replace('Roat\u00e1n', 'Roatan');
    const k = normKey(name);
    const [key, e] = econ.get(alias[k] ?? k) ?? [name.replace(/\W/g, ''), new Map<string, string>()];
    const [x, y] = pair(sec.get('Stadtposition'));
    const [ax, ay] = pair(sec.get('Anfahrt'));
    const produces = [1, 2, 3, 4, 5].map((n) => goodIndex.get(e.get(`Ware${n}`) ?? '')).filter((v) => v !== undefined);
    const nation = NATION_EN[e.get('Nation') ?? ''] ?? 'Spain';
    const rank = e.get('Vizekoenig') === '1' ? 'viceroy' : e.get('Gouverneur') === '1' ? 'governor' : 'colony';
    towns.push({
      id: i,
      key,
      name,
      nation,
      rank,
      x,
      y,
      dock: [ax, ay],
      label: [...pair(sec.get('PosName')), sec.get('NameAusrichtung') ?? 'r'],
      seaSide: num(sec.get('MeerAusrichtung')),
      produces,
      hasTownView: files.tryGet(`towns/${key}_Heightmap.dat`) !== undefined,
    });
  }

  const ships = SHIPS.map(([key, folder, name], id) => {
    const s = section(battle, key);
    return {
      id,
      key,
      folder,
      name,
      agility: num(s.get('Agil')),
      crew: num(s.get('Crew')),
      hull: num(s.get('Heal')),
      cargo: num(s.get('Fass')) * 2,
      draught: num(s.get('Tief')),
      vmin: num(s.get('Vmin')),
      vmax: num(s.get('Vmax')),
      upkeep: num(s.get('GSpT')),
      guns: num(s.get('Guns')),
      price: num(s.get('Wert')) * 1000,
    };
  });

  const pirates: [number, number, number][] = [];
  const pp = section(pir, 'PiratenPositionen');
  for (let i = 0; i < num(pp.get('Anzahl')); i++) {
    const v = (pp.get(`Pos${i}`) ?? '').split(',').map(Number);
    if (v.length === 3) pirates.push(v as [number, number, number]);
  }

  const seemap = section(game, 'SEEMAP');
  const consts: Record<string, Record<string, number>> = {};
  for (const sec of ['Munition', 'AutoBattle', 'BattleData', 'Sails', 'Hull', 'Rotation', 'Deck']) {
    consts[sec] = Object.fromEntries([...section(battle, sec)].map(([k, v]) => [k, Number(v)]));
  }

  writeJson('data/game.json', {
    map: { width: num(seemap.get('SizeX'), 4864), height: num(seemap.get('SizeY'), 3840), tile: 256, cols: 20, rows: 15 },
    barrelKg: num(section(waren, 'Umrechnen').get('Fass'), 19200),
    goods,
    towns,
    ships,
    pirateHideouts: pirates,
    battle: consts,
  });
}

// ---------------------------------------------------------------------------------------------
// Sea map
// ---------------------------------------------------------------------------------------------

async function extractSeaMap(): Promise<void> {
  step('sea map tiles');
  const present: string[] = [];
  const overview = blankImage(20 * 64, 15 * 64);
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 15; y++) {
      const name = `images/karte/images/map${x}_${y}.aim`;
      if (!files.tryGet(name)) continue;
      const img = await loadImage(name);
      let opaque = false;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) { opaque = true; break; }
      if (!opaque) continue;
      await saveImage(img, `map/tiles/${x}_${y}.webp`, { quality: 90 });
      present.push(`${x}_${y}`);
      const small = await sharp(Buffer.from(img.data), { raw: { width: 256, height: 256, channels: 4 } })
        .resize(64, 64).raw().toBuffer();
      blit(overview, { width: 64, height: 64, data: new Uint8Array(small) }, x * 64, y * 64);
    }
  }
  writeJson('map/tiles.json', present);
  await saveImage(overview, 'map/overview.webp', { quality: 85 });

  step('sea colour, water animation, navigation grid');
  await saveImage(await loadImage('images/karte/images/Shading.aim'), 'map/sea-shading.webp', { quality: 92 });
  const frames = files.list((n) => n.startsWith('pr2mapwater/wat_'));
  const cols = 8, rows = Math.ceil(frames.length / cols);
  const atlas = blankImage(cols * 128, rows * 128);
  for (let i = 0; i < frames.length; i++) {
    const f = await loadImage(frames[i]);
    blit(atlas, f, (i % cols) * 128, Math.floor(i / cols) * 128);
  }
  await saveImage(atlas, 'map/water-atlas.webp', { quality: 92 });
  writeJson('map/water-atlas.json', { frames: frames.length, cols, size: 128 });
  writeFileSync(outPath('map/nav.bin'), files.get('NavData/nav_matrix.dat'));
  written++;
  for (const n of ['images/#clouds/Wolke01.aim', 'images/#clouds/Wolke03.aim', 'images/#clouds/Wolke05.aim']) {
    await saveImage(await loadImage(n), `map/${n.split('/').pop()!.replace('.aim', '.webp').toLowerCase()}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Ships, UI, town view
// ---------------------------------------------------------------------------------------------

async function extractShips(): Promise<void> {
  step('ship sprites');
  // each sheet: 4x4 cells of 100 px, one per heading. Ships are drawn at their relative size,
  // so record the largest opaque extent per sheet to let the renderer normalise them.
  const extents: Record<string, number> = {};
  for (const n of files.list((n) => n.startsWith('images/schiffstypen/'))) {
    const id = n.split('/').pop()!.slice(0, 2);
    const img = await loadImage(n);
    let ext = 0;
    for (let cell = 0; cell < 16; cell++) {
      const cx = (cell % 4) * 100, cy = Math.floor(cell / 4) * 100;
      let x0 = 100, y0 = 100, x1 = -1, y1 = -1;
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 100; x++) {
          if (img.data[((cy + y) * img.width + cx + x) * 4 + 3] > 40) {
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
        }
      }
      if (x1 >= 0) ext = Math.max(ext, x1 - x0 + 1, y1 - y0 + 1);
    }
    extents[String(Number(id))] = ext;
    await saveImage(img, `ships/${id}.webp`, { quality: 92 });
  }
  writeJson('ships/extents.json', extents);
}

const UI_IMAGES: Record<string, string> = {
  'images/#Menu/MenuInGameHG.aim': 'ui/parchment-globe.webp',
  'images/#Menu/LadescreenHG.aim': 'ui/loading-ship.webp',
  'images/#Menu/Einstellungsscreen01.aim': 'ui/settings-1.webp',
  'images/#Menu/Einstellungsscreen02.aim': 'ui/settings-2.webp',
  'images/#Menu/Karte_800x600.aim': 'ui/map-800.webp',
  'images/#Vorlaufkarte/Vorlaufkarte_1024x768.aim': 'ui/title-map.webp',
  'images/#Waitscreen_1024x768.aim': 'ui/wait-screen.webp',
  'images/#Schatzkarte_2432_Sephia.aim': 'ui/treasure-map.webp',
  'images/interface/tmb_bg_1024.aim': 'ui/wood.webp',
  'images/interface/werft_ausschnitt.aim': 'ui/shipyard.webp',
  'images/interface/windrosenzeiger.aim': 'ui/compass-needle.webp',
  'images/interface/nation00.aim': 'ui/flag-england.webp',
  'images/interface/nation01.aim': 'ui/flag-france.webp',
  'images/interface/nation02.aim': 'ui/flag-holland.webp',
  'images/interface/nation03.aim': 'ui/flag-spain.webp',
  'images/interface/nation_piraten.aim': 'ui/flag-pirate.webp',
  'images/Minimap_BG.aim': 'ui/minimap-bg.webp',
  'images/SeabattleMap_BG.aim': 'ui/seabattle-bg.webp',
  'images/#TMWater.aim': 'ui/tm-water.webp',
};

async function extractUi(): Promise<void> {
  step('interface images');
  for (const [src, dst] of Object.entries(UI_IMAGES)) {
    if (!files.tryGet(src)) continue;
    await saveImage(await loadImage(src), dst, { quality: 90 });
  }
  for (const [src, dst] of [['fonts/Tiepolo_bold.ttf', 'tiepolo-bold.ttf'], ['fonts/Tiepolo_black.ttf', 'tiepolo-black.ttf'], ['fonts/ELGRECO_.TTF', 'elgreco.ttf']]) {
    const b = files.tryGet(src);
    if (b) {
      writeFileSync(outPath(`fonts/${dst}`), b);
      written++;
    }
  }
  for (const n of files.list((n) => n.startsWith('images/interface/piraten/'))) {
    await saveImage(await loadImage(n), `ui/pirates/${n.split('/').pop()!.replace(/\.aim$/i, '.webp')}`);
  }
}

/** Isometric building sprites used to compose the port view. */
const TOWN_SPRITES = [
  'Kirche_England', 'Kirche_Frankreich', 'Kirche_Holland', 'Kirche_Spanien',
  'Stadtverwaltung_England', 'Stadtverwaltung_Frankreich', 'Stadtverwaltung_Holland', 'Stadtverwaltung_Spanien',
  'Gouverneur_England', 'Gouverneur_Frankreich', 'Gouverneur_Holland', 'Gouverneur_Spanien',
  'Kneipe', 'Markt05', 'Markt06', 'Markt07', 'Markt08', 'Markt09', 'Marktstand_0', 'Marktstand_1', 'Marktstand_2', 'Marktstand_3',
  'Werft_gr_SW', 'Werft_kl_SW', 'Hafendock_SW', 'Hafendock_SO', 'lagerhaus', 'Leuchtturm', 'Spital', 'Schule', 'Geschuetzturm',
  'Wohnhaus_Stufe01_England_A', 'Wohnhaus_Stufe02_England_A', 'Wohnhaus_Stufe03_England_A', 'Wohnhaus_Stufe04_England_A', 'Wohnhaus_Stufe05_England_A',
  'Wohnhaus_Stufe01_Spanien_A', 'Wohnhaus_Stufe02_Spanien_A', 'Wohnhaus_Stufe03_Spanien_A', 'Wohnhaus_Stufe04_Spanien_A', 'Wohnhaus_Stufe05_Spanien_A',
  'Wohnhaus_Stufe01_Frankreich_A', 'Wohnhaus_Stufe02_Frankreich_A', 'Wohnhaus_Stufe03_Frankreich_A', 'Wohnhaus_Stufe04_Frankreich_A', 'Wohnhaus_Stufe05_Frankreich_A',
  'Wohnhaus_Stufe01_Holland_A', 'Wohnhaus_Stufe02_Holland_A', 'Wohnhaus_Stufe03_Holland_A', 'Wohnhaus_Stufe04_Holland_A', 'Wohnhaus_Stufe05_Holland_A',
  'Wohnhaus_Stufe02_England_B', 'Wohnhaus_Stufe03_Spanien_B', 'Wohnhaus_Stufe04_Frankreich_B', 'Wohnhaus_Stufe02_Holland_B',
  'Getreidefarm_Stufe03', 'Fruechte_Stufe03', 'Holzfaeller', 'Lehmziegel', 'Maisfarm_stufe03', 'Zuckerrohr_Stufe03',
  'Baumwolle_Stufe03', 'Hanffarm_Stufe03', 'Fleisch', 'Kleidung', 'Seilerei', 'Rumbrennerei', 'Kaffeefarm_Stufe03',
  'Kakaofarm_Stufe03', 'Farbstoffe_Stufe03', 'Tabakfarm_Stufe03',
  'Fruechte_Bananenpalme_A', 'Fruechte_Bananenpalme_B', 'Fruechte_Orangenbaum_A', 'Bananenpalme_Busch01', 'Bananenpalme_Busch02',
  'Busch01', 'Busch03', 'Busch05', 'Busch07', 'Busch09', 'Busch11', 'Fels01', 'Fels03', 'Fels05', 'Kaktus01',
  'Faesser01_1x1', 'Kisten02_1x1', 'Ballen01_1x1', 'Holzstapel01_1x1', 'Ruderboot01_1x2', 'Wagen01_1x2', 'Laterne01_1x1',
];

async function extractTown(): Promise<void> {
  step('port view sprites');
  const lower = new Map(files.list((n) => n.startsWith('images/module_stadtkarte/')).map((n) => [n.toLowerCase(), n]));
  const meta: Record<string, { w: number; h: number; ax: number; ay: number }> = {};
  for (const s of TOWN_SPRITES) {
    const name = lower.get(`images/module_stadtkarte/${s.toLowerCase()}.aim`);
    if (!name) continue;
    const full = await loadImage(name);
    const shdName = lower.get(`images/module_stadtkarte/${s.toLowerCase()}_shd.aim`);
    if (shdName) {
      // composite the shadow underneath (shadows are drawn first in the original renderer)
      const shd = await loadImage(shdName);
      // shadow images are binary masks (black, alpha 0/255): draw them translucent
      for (let i = 3; i < shd.data.length; i += 4) shd.data[i] = Math.round(shd.data[i] * 0.42);
      const merged = blankImage(full.width, full.height);
      blit(merged, shd, 0, 0);
      for (let i = 0; i < full.data.length; i += 4) {
        const a = full.data[i + 3] / 255;
        if (a === 0) continue;
        for (let c = 0; c < 3; c++) merged.data[i + c] = full.data[i + c] * a + merged.data[i + c] * (1 - a);
        merged.data[i + 3] = Math.max(merged.data[i + 3], full.data[i + 3]);
      }
      full.data = merged.data;
    }
    const t = trim(full);
    await saveImage(t.img, `town/${s.toLowerCase()}.webp`, { quality: 90 });
    // anchor: original image centre-bottom, expressed in the trimmed image's pixel space
    meta[s.toLowerCase()] = { w: t.img.width, h: t.img.height, ax: full.width / 2 - t.x, ay: full.height - t.y };
  }
  writeJson('town/sprites.json', meta);

  step('port view terrain');
  const ground: Record<string, string> = {
    'Bodentextur_1_0': 'sand', 'Bodentextur_1_2': 'grass-dry', 'Bodentextur_2_3': 'grass', 'Bodentextur_2_4': 'cobble',
    'Bodentextur_0_4': 'rock', 'Bodentextur_1_1': 'grass-sand',
  };
  for (const [src, dst] of Object.entries(ground)) {
    const n = `images/Bodentexturen/${src}.aim`;
    if (files.tryGet(n)) await saveImage(await loadImage(n), `town/ground-${dst}.webp`, { quality: 90 });
  }
  for (const n of files.list((n) => /^towns\/[^/]+_heightmap\.dat$/.test(n))) {
    const key = n.split('/')[1].replace(/_Heightmap\.dat$/i, '');
    const h = files.get(n);
    const side = Math.round(Math.sqrt(h.length));
    await sharp(h.subarray(0, side * side), { raw: { width: side, height: side, channels: 1 } })
      .png({ compressionLevel: 9 }).toFile(outPath(`town/height/${key}.png`));
    written++;
  }
}

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------

function extractAudio(): void {
  step('music and sound');
  const music: Record<string, string> = {
    'Mainmenu/mainmenu_00.mp3': 'menu.mp3',
    'Atmo/atmo_seekarte_00.mp3': 'sea-atmo.mp3',
    'Atmo/atmo_00.mp3': 'town-atmo.mp3',
    'Seabattle/Battle_00.mp3': 'battle-0.mp3',
    'Seabattle/Battle_01.mp3': 'battle-1.mp3',
    'Buildings/market_00.mp3': 'market.mp3',
    'Buildings/pub_00.mp3': 'tavern.mp3',
    'Buildings/governor_00.mp3': 'governor.mp3',
    'Scores/music_00.mp3': 'score-0.mp3',
    'Scores/music_01.mp3': 'score-1.mp3',
    'Scores/music_02.mp3': 'score-2.mp3',
    'Scores/music_03.mp3': 'score-3.mp3',
  };
  for (const [src, dst] of Object.entries(music)) {
    const p = join(gameDir, 'Music', src);
    if (existsSync(p)) {
      copyFileSync(p, outPath(`audio/${dst}`));
      written++;
    }
  }
  const sfx: Record<string, string> = {
    'sfx/clicks/holzklick.wav': 'click.wav',
    'sfx/Ereignisse/Konvoi_Anlegen.wav': 'dock.wav',
    'sfx/Ereignisse/Nachricht.wav': 'message.wav',
    'sfx/Ereignisse/Negativ.wav': 'negative.wav',
    'sfx/Seeschlacht/Kanonenfeuer_x3.wav': 'cannon-3.wav',
    'sfx/Seeschlacht/Kanonenfeuer_x10.wav': 'cannon-10.wav',
    'sfx/Seeschlacht/Kanonenfeuer_x20.wav': 'cannon-20.wav',
    'sfx/Seeschlacht/Treffer_Massivkugel_01.wav': 'hit-1.wav',
    'sfx/Seeschlacht/Treffer_Massivkugel_03.wav': 'hit-2.wav',
    'sfx/Seeschlacht/Wasserplatscher_01.wav': 'splash-1.wav',
    'sfx/Seeschlacht/Wasserplatscher_02.wav': 'splash-2.wav',
    'sfx/Seeschlacht/Sinken.wav': 'sink.wav',
    'sfx/Seeschlacht/Entern.wav': 'board.wav',
    'sfx/Seeschlacht/Seeschlacht_Gewonnen.wav': 'victory.wav',
    'sfx/Seeschlacht/Seeschlacht_Verloren.wav': 'defeat.wav',
    'sfx/Seeschlacht/Mastbruch.wav': 'mast.wav',
  };
  for (const [src, dst] of Object.entries(sfx)) {
    const b = files.tryGet(src);
    if (b) {
      writeFileSync(outPath(`audio/sfx/${dst}`), b);
      written++;
    }
  }
}

// ---------------------------------------------------------------------------------------------

const t0 = Date.now();
console.log(`Extracting Port Royale 2 assets from ${gameDir}`);
extractData();
await extractSeaMap();
await extractShips();
await extractUi();
await extractTown();
extractAudio();
writeJson('manifest.json', { version: 1, extractedAt: new Date().toISOString(), files: written });
console.log(`Done: ${written} files in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
