/**
 * Reader for Ascaron ".cpr" archives ("ASCARON_ARCHIVE V0.9").
 *
 * Layout: a 0x20-byte magic header, then a chain of directory blocks. Each block is
 *   u32 blockSize, u32 usedBytes, u32 entryCount, u32 dataLength
 * followed by entries (u32 offset, u32 size, u32 flag, NUL-terminated latin-1 name).
 * The block's file data follows the block; the next block starts at
 * blockStart + blockSize + dataLength. File data is stored uncompressed.
 */
import { readFileSync } from 'node:fs';

export interface CprEntry {
  name: string;
  offset: number;
  size: number;
}

export class CprArchive {
  readonly data: Buffer;
  readonly entries = new Map<string, CprEntry>();
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.data = readFileSync(path);
    if (this.data.toString('latin1', 0, 15) !== 'ASCARON_ARCHIVE') {
      throw new Error(`${path}: not an Ascaron archive`);
    }
    let pos = 0x20;
    while (pos + 16 <= this.data.length) {
      const blockSize = this.data.readUInt32LE(pos);
      const count = this.data.readUInt32LE(pos + 8);
      const dataLength = this.data.readUInt32LE(pos + 12);
      if (blockSize === 0) break;
      let p = pos + 16;
      for (let i = 0; i < count; i++) {
        const offset = this.data.readUInt32LE(p);
        const size = this.data.readUInt32LE(p + 4);
        p += 12;
        const end = this.data.indexOf(0, p);
        const name = this.data.toString('latin1', p, end).replace(/\\/g, '/');
        p = end + 1;
        this.entries.set(name.toLowerCase(), { name, offset, size });
      }
      pos = pos + blockSize + dataLength;
    }
  }

  get(name: string): Buffer | undefined {
    const e = this.entries.get(name.toLowerCase().replace(/\\/g, '/'));
    return e ? this.data.subarray(e.offset, e.offset + e.size) : undefined;
  }
}

/** All four game archives, searched in load order (later archives win). */
export class GameFiles {
  private archives: CprArchive[];

  constructor(gameDir: string) {
    this.archives = ['pr2_arcd.cpr', 'pr2_arcs.cpr', 'pr2_arct.cpr', 'pr2_loca.cpr'].map(
      (f) => new CprArchive(`${gameDir}/${f}`),
    );
  }

  get(name: string): Buffer {
    const b = this.tryGet(name);
    if (!b) throw new Error(`missing game file: ${name}`);
    return b;
  }

  tryGet(name: string): Buffer | undefined {
    for (let i = this.archives.length - 1; i >= 0; i--) {
      const b = this.archives[i].get(name);
      if (b) return b;
    }
    return undefined;
  }

  /** Names (original case) matching a predicate over the lower-cased path. */
  list(pred: (lowerName: string) => boolean): string[] {
    const out = new Set<string>();
    for (const a of this.archives) {
      for (const [k, e] of a.entries) if (pred(k)) out.add(e.name);
    }
    return [...out].sort();
  }
}
