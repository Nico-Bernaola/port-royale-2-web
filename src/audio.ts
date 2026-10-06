/** Music (streamed MP3 with cross-fades) and sound effects (Web Audio buffers). */
import { asset } from './assets.ts';

type Track = 'menu' | 'sea' | 'town' | 'battle' | 'market' | 'tavern' | 'governor';

const TRACKS: Record<Track, string[]> = {
  menu: ['menu.mp3'],
  sea: ['sea-atmo.mp3', 'score-0.mp3', 'score-1.mp3', 'score-2.mp3', 'score-3.mp3'],
  town: ['town-atmo.mp3'],
  battle: ['battle-0.mp3', 'battle-1.mp3'],
  market: ['market.mp3'],
  tavern: ['tavern.mp3'],
  governor: ['governor.mp3'],
};

class AudioManager {
  private music: HTMLAudioElement | null = null;
  private current: Track | null = null;
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  musicVolume = 0.45;
  sfxVolume = 0.7;
  muted = false;

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  play(track: Track): void {
    if (this.current === track) return;
    this.current = track;
    const list = TRACKS[track];
    const file = list[Math.floor(Math.random() * list.length)];
    const next = new Audio(asset(`audio/${file}`));
    next.loop = list.length === 1;
    next.volume = 0;
    next.onended = () => {
      if (this.current === track) {
        this.current = null;
        this.play(track);
      }
    };
    const prev = this.music;
    this.music = next;
    next.play().catch(() => {
      // autoplay blocked: retry on the next user gesture
      const resume = () => {
        if (this.music === next) void next.play();
        window.removeEventListener('pointerdown', resume);
      };
      window.addEventListener('pointerdown', resume);
    });
    this.fade(next, this.muted ? 0 : this.musicVolume, 1500);
    if (prev) this.fade(prev, 0, 1200, () => prev.pause());
  }

  private fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
    const from = a.volume;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = from + (to - from) * k;
      if (k < 1) requestAnimationFrame(step);
      else done?.();
    };
    requestAnimationFrame(step);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.music) this.music.volume = m ? 0 : this.musicVolume;
  }

  private buffer(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetch(asset(`audio/sfx/${name}.wav`))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(name))))
        .then((b) => this.context().decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }

  /** Play a sound effect; `pan` in -1..1, `volume` 0..1. */
  sfx(name: string, volume = 1, pan = 0): void {
    if (this.muted) return;
    void this.buffer(name).then((buf) => {
      if (!buf) return;
      const ctx = this.context();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
      const gain = ctx.createGain();
      gain.gain.value = volume * this.sfxVolume;
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      src.connect(gain).connect(panner).connect(ctx.destination);
      src.start();
    });
  }
}

export const audio = new AudioManager();
