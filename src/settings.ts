/**
 * Player settings: graphics quality, sound, gameplay and interface options. Stored in
 * localStorage; screens read the current values, and live settings notify subscribers.
 */

export type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

export interface Settings {
  preset: Preset;
  /** fraction of the device pixel ratio to render at (capped at 2) */
  renderScale: number;
  antialias: boolean;
  /** shadow map size, 0 = no shadows */
  shadows: 0 | 1024 | 2048 | 4096;
  /** density of grass, ferns, bushes and trees in towns, 0..1 */
  vegetation: number;
  /** cottages and clutter in towns */
  townDetail: 'low' | 'high';
  /** resolution of building textures */
  textureRes: 256 | 512 | 1024;
  water: 'simple' | 'detailed';
  /** frame-rate cap, 0 = none */
  maxFps: 0 | 30 | 60;

  master: number;
  music: number;
  ambience: number;
  effects: number;
  muted: boolean;

  /** autosave every n game days, 0 = off */
  autosaveDays: 0 | 7 | 30;
  startSpeed: 1 | 2 | 4;
  pauseOnEvents: boolean;
  battleSpeed: 0.5 | 1 | 2;

  uiScale: number;
  buildingTags: boolean;
  tooltips: boolean;
  hints: boolean;
  showFps: boolean;
}

type GraphicsKeys = 'renderScale' | 'antialias' | 'shadows' | 'vegetation' | 'townDetail' | 'textureRes' | 'water' | 'maxFps';

export const PRESETS: Record<Exclude<Preset, 'custom'>, Pick<Settings, GraphicsKeys>> = {
  low: { renderScale: 0.6, antialias: false, shadows: 0, vegetation: 0.15, townDetail: 'low', textureRes: 256, water: 'simple', maxFps: 30 },
  medium: { renderScale: 0.8, antialias: true, shadows: 1024, vegetation: 0.45, townDetail: 'low', textureRes: 512, water: 'simple', maxFps: 60 },
  high: { renderScale: 1, antialias: true, shadows: 2048, vegetation: 0.8, townDetail: 'high', textureRes: 512, water: 'detailed', maxFps: 0 },
  ultra: { renderScale: 1, antialias: true, shadows: 4096, vegetation: 1, townDetail: 'high', textureRes: 1024, water: 'detailed', maxFps: 0 },
};

export const GRAPHICS_KEYS = Object.keys(PRESETS.high) as GraphicsKeys[];

const DEFAULTS: Settings = {
  preset: 'high',
  ...PRESETS.high,
  master: 0.8,
  music: 0.7,
  ambience: 0.7,
  effects: 0.8,
  muted: false,
  autosaveDays: 7,
  startSpeed: 1,
  pauseOnEvents: true,
  battleSpeed: 1,
  uiScale: 1,
  buildingTags: true,
  tooltips: true,
  hints: true,
  showFps: false,
};

const KEY = 'caribbean-trader.settings.v1';

/** A first guess at a sensible preset for this device. */
function devicePreset(): Exclude<Preset, 'custom'> {
  const cores = navigator.hardwareConcurrency || 4;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && window.devicePixelRatio > 2) return 'low';
  if (touch || cores < 4) return 'medium';
  return 'high';
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // unreadable or blocked storage: fall back to defaults
  }
  const p = devicePreset();
  return { ...DEFAULTS, preset: p, ...PRESETS[p] };
}

export const settings: Settings = load();

const listeners = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();

export function onSettingsChange(fn: (s: Settings, changed: (keyof Settings)[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage full or blocked: settings still apply for this visit
  }
}

/** Change settings; editing a graphics option by hand turns the preset into "custom". */
export function updateSettings(patch: Partial<Settings>): void {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => settings[k] !== patch[k]);
  if (!changed.length) return;
  Object.assign(settings, patch);
  if (!('preset' in patch) && changed.some((k) => (GRAPHICS_KEYS as string[]).includes(k))) {
    settings.preset = 'custom';
    changed.push('preset');
  }
  persist();
  for (const fn of listeners) fn(settings, changed);
}

export function applyPreset(p: Exclude<Preset, 'custom'>): void {
  updateSettings({ preset: p, ...PRESETS[p] });
}

export function resetSettings(): void {
  const p = devicePreset();
  updateSettings({ ...DEFAULTS, preset: p, ...PRESETS[p] });
}
