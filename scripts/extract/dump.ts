/**
 * Debug helper: dump game images matching a substring to PNG files.
 *   node scripts/extract/dump.ts <gameDir> <outDir> <substring> [maxFiles]
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { GameFiles } from './cpr.ts';
import { assemble, guessRows, parseAim } from './aim.ts';

const [gameDir, outDir, needle, max] = process.argv.slice(2);
const files = new GameFiles(gameDir);
const names = files.list((n) => n.endsWith('.aim') && n.includes(needle.toLowerCase())).slice(0, Number(max ?? 1e9));
let ok = 0;
for (const name of names) {
  try {
    const aim = await parseAim(files.get(name));
    const img = assemble(aim.slices, guessRows(aim.slices, name));
    const out = join(outDir, name.replace(/\.aim$/i, '.png'));
    mkdirSync(dirname(out), { recursive: true });
    await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toFile(out);
    ok++;
  } catch (e) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
console.log(`${ok}/${names.length} written`);
