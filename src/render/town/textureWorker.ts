/** Background painter for the town textures; posts each one back as soon as it is done. */
import { DEFS, paintRGBA, paintRoad, type Painted } from './paint.ts';

const post = (p: Painted) => (self as unknown as Worker).postMessage(p, [p.color.buffer, p.height.buffer]);

self.onmessage = (e: MessageEvent<{ keys: string[]; res: number }>) => {
  const { keys, res } = e.data;
  for (const k of keys) post(k === '__road' ? paintRoad() : paintRGBA(k, DEFS[k].px ?? res));
  (self as unknown as Worker).postMessage({ done: true });
};
