/** Procedural audio: synthesized sound effects, ambience and a small generative tune. */
import { settings } from './settings.ts';

type Track = 'menu' | 'sea' | 'town' | 'battle' | 'market' | 'tavern' | 'governor';

// D dorian: a modal, shanty-like scale
const SCALE = [0, 2, 3, 5, 7, 9, 10];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private current: Track | null = null;
  private ambience: AudioScheduledSourceNode[] = [];
  private musicTimer = 0;
  private step = 0;
  muted = false;

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.ambBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      // a simple feedback delay for space
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = 0.33;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.32;
      this.musicBus.connect(this.master);
      this.musicBus.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(this.master);
      this.ambBus.connect(this.master);
      this.applySettings();
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Resume on the first user gesture (browsers block audio before one). */
  unlock(): void {
    const go = () => {
      this.context();
      if (this.current) {
        const t = this.current;
        this.current = null;
        this.play(t);
      }
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }

  /** Apply the volume settings; the old fixed mix is the 100% point of each slider. */
  applySettings(): void {
    this.muted = settings.muted;
    if (!this.ctx) return;
    this.master.gain.value = settings.muted ? 0 : settings.master;
    this.musicBus.gain.value = 0.2 * settings.music;
    this.ambBus.gain.value = 0.5 * settings.ambience;
    this.sfxBus.gain.value = settings.effects / 0.8;
  }

  // ---- building blocks ----------------------------------------------------------------------

  private noiseBurst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'lowpass', when = 0, pan = 0, dest?: AudioNode): AudioBufferSourceNode {
    const c = this.context();
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f).connect(g).connect(p).connect(dest ?? this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    return src;
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0, dest?: AudioNode, slideTo?: number): void {
    const c = this.context();
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---- effects ------------------------------------------------------------------------------

  sfx(name: string, volume = 1, pan = 0): void {
    if (this.muted) return;
    this.context();
    const v = volume;
    switch (name) {
      case 'click':
        this.tone(1400, 0.05, 0.08 * v, 'triangle');
        this.noiseBurst(0.04, 3000, 2, 0.05 * v, 'bandpass');
        break;
      case 'negative':
        this.tone(160, 0.25, 0.12 * v, 'square', 0, undefined, 110);
        break;
      case 'message':
        this.tone(880, 0.4, 0.1 * v, 'sine');
        this.tone(1320, 0.5, 0.07 * v, 'sine', 0.12);
        break;
      case 'dock': // ship's bell
        for (const [d, f] of [[0, 1046], [0.35, 1046]]) {
          this.tone(f, 1.6, 0.12 * v, 'sine', d);
          this.tone(f * 2.76, 0.8, 0.04 * v, 'sine', d);
        }
        break;
      case 'cannon-3':
      case 'cannon-10':
      case 'cannon-20': {
        const n = name === 'cannon-3' ? 3 : name === 'cannon-10' ? 6 : 10;
        for (let i = 0; i < n; i++) {
          const d = i * (0.05 + Math.random() * 0.07);
          this.noiseBurst(0.9, 420, 0.8, 0.5 * v, 'lowpass', d, pan);
          this.tone(70 + Math.random() * 20, 0.5, 0.35 * v, 'sine', d, undefined, 35);
        }
        break;
      }
      case 'hit-1':
      case 'hit-2':
        this.noiseBurst(0.25, 1800, 1.5, 0.35 * v, 'bandpass', 0, pan);
        this.tone(180, 0.15, 0.2 * v, 'triangle', 0, undefined, 90);
        break;
      case 'splash-1':
      case 'splash-2':
        this.noiseBurst(0.45, 2500, 0.6, 0.18 * v, 'highpass', 0, pan);
        break;
      case 'sink':
        this.noiseBurst(2.5, 300, 0.7, 0.3 * v, 'lowpass');
        this.tone(120, 2.2, 0.15 * v, 'sawtooth', 0, undefined, 40);
        break;
      case 'board':
        for (let i = 0; i < 6; i++) this.noiseBurst(0.12, 4000, 4, 0.15 * v, 'bandpass', i * 0.13);
        break;
      case 'mast':
        this.noiseBurst(1.0, 900, 1, 0.3 * v, 'bandpass');
        break;
      case 'victory':
        [0, 4, 7, 12].forEach((n, i) => this.tone(midi(62 + n), 0.5, 0.12 * v, 'triangle', i * 0.15));
        break;
      case 'defeat':
        [12, 7, 3, 0].forEach((n, i) => this.tone(midi(62 + n), 0.6, 0.12 * v, 'triangle', i * 0.2));
        break;
    }
  }

  // ---- music & ambience ---------------------------------------------------------------------

  play(track: Track): void {
    if (this.current === track) return;
    this.current = track;
    if (!this.ctx) return; // started on the first gesture (see unlock)
    for (const a of this.ambience) {
      try { a.stop(); } catch { /* already stopped */ }
    }
    this.ambience = [];
    window.clearInterval(this.musicTimer);
    const c = this.context();
    // waves: slowly swelling filtered noise
    if (track === 'sea' || track === 'town' || track === 'menu' || track === 'battle') {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = track === 'town' ? 500 : 700;
      const g = c.createGain();
      g.gain.value = 0.25;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.12;
      const lg = c.createGain();
      lg.gain.value = 0.18;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(this.ambBus);
      src.start();
      lfo.start();
      this.ambience.push(src, lfo);
    }
    // a gentle generative melody over a drone
    const tempo = track === 'battle' ? 150 : track === 'tavern' ? 200 : 360;
    const root = track === 'battle' ? 50 : 62;
    this.step = 0;
    this.musicTimer = window.setInterval(() => {
      if (this.muted || !this.ctx) return;
      const s = this.step++;
      if (s % 8 === 0) this.tone(midi(root - 12), (tempo / 1000) * 8, 0.18, 'triangle', 0, this.musicBus);
      if (track === 'battle' && s % 2 === 0) this.noiseBurst(0.12, 180, 1, 0.25, 'lowpass', 0, 0, this.musicBus);
      if (Math.random() < (track === 'sea' ? 0.55 : 0.75)) {
        const deg = Math.floor(Math.abs(Math.sin(s * 1.7 + root) * 9) + (s % 4 === 0 ? 0 : Math.random() * 3)) % 9;
        const oct = deg >= 7 ? 12 : 0;
        this.tone(midi(root + SCALE[deg % 7] + oct), (tempo / 1000) * 1.8, 0.12, track === 'tavern' ? 'square' : 'triangle', 0, this.musicBus);
      }
    }, tempo);
  }
}

export const audio = new AudioManager();
