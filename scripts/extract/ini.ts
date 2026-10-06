/** Minimal INI parser for the game's latin-1 config files. */

export type Ini = Map<string, Map<string, string>>;

export function parseIni(buf: Buffer): Ini {
  const out: Ini = new Map();
  let section = new Map<string, string>();
  out.set('', section);
  for (const rawLine of buf.toString('latin1').split(/\r?\n/)) {
    // some files (BattleConst.ini) prefix keys with NUL bytes
    const line = rawLine.replace(/[\u0000-\u0008]/g, '').trim();
    if (!line || line.startsWith(';') || line.startsWith('//') || line.startsWith('***')) continue;
    const m = /^\[(.+)\]$/.exec(line);
    if (m) {
      section = new Map();
      out.set(m[1].trim(), section);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) section.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return out;
}

export function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = Number(v.split(',')[0].trim());
  return Number.isFinite(n) ? n : fallback;
}

export function pair(v: string | undefined): [number, number] {
  const [a, b] = (v ?? '0,0').split(',').map((s) => Number(s.trim()));
  return [a || 0, b || 0];
}
