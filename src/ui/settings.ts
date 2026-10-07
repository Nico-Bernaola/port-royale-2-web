/** The settings window: graphics, sound, gameplay and interface. */
import { audio } from '../audio.ts';
import { applyPreset, type Preset, resetSettings, type Settings, settings, updateSettings } from '../settings.ts';
import { h, modal } from './dom.ts';

type Tab = 'graphics' | 'sound' | 'gameplay' | 'interface';
let lastTab: Tab = 'graphics';

/** Keys whose change only shows on the next town visit or after a reload. */
const LATER: Partial<Record<keyof Settings, string>> = {
  antialias: 'after a reload',
  shadows: 'next time you enter a town',
  vegetation: 'next time you enter a town',
  townDetail: 'next time you enter a town or start a game',
  textureRes: 'next time you enter a town',
  water: 'next time you enter a town or start a game',
};

export function openSettings(): void {
  const body = h('div', { class: 'settings' });
  const tabs = h('div', { class: 'row', style: 'margin-bottom:12px;gap:6px' });
  const pending = new Set<string>();
  let needsReload = false;

  const row = (label: string, control: Node, help?: string) =>
    h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'set-label' }, label), help ? h('div', { class: 'set-help' }, help) : null), control);

  const changed = (k: keyof Settings) => {
    if (LATER[k]) {
      pending.add(LATER[k]!);
      if (k === 'antialias') needsReload = true;
    }
  };

  const select = <K extends keyof Settings>(k: K, options: [Settings[K], string][]) => {
    const el = h('select', {
      onchange: () => {
        const opt = options[(el as HTMLSelectElement).selectedIndex];
        updateSettings({ [k]: opt[0] } as Partial<Settings>);
        changed(k);
        render();
      },
    }, ...options.map(([v, label]) => h('option', { selected: settings[k] === v }, label)));
    return el;
  };

  const toggle = (k: keyof Settings) =>
    h('input', {
      type: 'checkbox',
      checked: settings[k] as boolean,
      onchange: (e: Event) => {
        updateSettings({ [k]: (e.target as HTMLInputElement).checked } as Partial<Settings>);
        changed(k);
        render();
      },
    });

  const slider = (k: keyof Settings, min: number, max: number, step: number, show: (v: number) => string, live = true) => {
    const out = h('span', { class: 'set-value' }, show(settings[k] as number));
    const input = h('input', {
      type: 'range', min, max, step, value: settings[k] as number,
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        out.textContent = show(v);
        if (live) updateSettings({ [k]: v } as Partial<Settings>);
      },
      onchange: (e: Event) => {
        updateSettings({ [k]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>);
        changed(k);
        if (k === 'effects') audio.sfx('click');
        render();
      },
    });
    return h('div', { class: 'set-slider' }, input, out);
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const graphics = () => {
    const presets: [Exclude<Preset, 'custom'>, string][] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']];
    return [
      row('Quality preset', h('div', { class: 'row', style: 'gap:6px' },
        ...presets.map(([p, label]) => h('button', {
          class: `btn small ${settings.preset === p ? 'active' : ''}`,
          onclick: () => {
            const aa = settings.antialias;
            applyPreset(p);
            for (const k of Object.keys(LATER) as (keyof Settings)[]) if (k !== 'antialias') changed(k);
            if (aa !== settings.antialias) changed('antialias');
            render();
          },
        }, label)),
        settings.preset === 'custom' ? h('span', { class: 'set-help', style: 'align-self:center' }, 'Custom') : null),
      'Low suits older laptops and phones, Ultra a strong graphics card.'),
      row('Resolution', slider('renderScale', 0.5, 1, 0.05, pct), 'Rendering below 100% is much faster on high-resolution screens.'),
      row('Shadows', select('shadows', [[0, 'Off'], [1024, 'Low'], [2048, 'Medium'], [4096, 'High']])),
      row('Vegetation', slider('vegetation', 0, 1, 0.05, pct, false), 'Grass, ferns, bushes and trees in towns.'),
      row('Town detail', select('townDetail', [['low', 'Low'], ['high', 'High']]), 'Number of houses and terrain detail.'),
      row('Textures', select('textureRes', [[256, 'Low'], [512, 'Medium'], [1024, 'High']])),
      row('Water', select('water', [['simple', 'Simple'], ['detailed', 'Detailed']])),
      row('Anti-aliasing', toggle('antialias'), 'Smooths jagged edges.'),
      row('Frame rate limit', select('maxFps', [[0, 'None'], [60, '60 fps'], [30, '30 fps']]), 'A limit saves battery on laptops.'),
    ];
  };

  const sound = () => [
    row('Mute everything', toggle('muted')),
    row('Master volume', slider('master', 0, 1, 0.05, pct)),
    row('Music', slider('music', 0, 1, 0.05, pct)),
    row('Ambience', slider('ambience', 0, 1, 0.05, pct), 'Waves, wind and town sounds.'),
    row('Effects', slider('effects', 0, 1, 0.05, pct), 'Cannons, clicks and messages.'),
  ];

  const gameplay = () => [
    row('Autosave', select('autosaveDays', [[0, 'Off'], [7, 'Every week'], [30, 'Every month']]), 'Saved in game days, over your saved game.'),
    row('Starting speed', select('startSpeed', [[1, 'Normal'], [2, 'Fast'], [4, 'Fastest']]), 'Game speed on the sea map when a game starts.'),
    row('Pause on events', toggle('pauseOnEvents'), 'Pause when a convoy arrives or a ship is launched.'),
    row('Battle speed', select('battleSpeed', [[0.5, 'Slow'], [1, 'Normal'], [2, 'Fast']]), 'Starting speed of sea battles.'),
  ];

  const ui = () => [
    row('Interface size', slider('uiScale', 0.8, 1.3, 0.05, pct, false)),
    row('Building names', toggle('buildingTags'), 'Name tags over the buildings in port.'),
    row('Tooltips', toggle('tooltips'), 'Descriptions when you hover over a building.'),
    row('Hints', toggle('hints'), 'Control hints when a screen opens.'),
    row('Frame-rate counter', toggle('showFps'), 'Shows frames per second, to help choose a quality level.'),
  ];

  const render = () => {
    const names: [Tab, string][] = [['graphics', 'Graphics'], ['sound', 'Sound'], ['gameplay', 'Gameplay'], ['interface', 'Interface']];
    tabs.replaceChildren(...names.map(([t, label]) => h('button', { class: `btn small ${lastTab === t ? 'active' : ''}`, onclick: () => { lastTab = t; render(); } }, label)));
    const rows = lastTab === 'graphics' ? graphics() : lastTab === 'sound' ? sound() : lastTab === 'gameplay' ? gameplay() : ui();
    const note = pending.size
      ? h('div', { class: 'set-note' }, `Some changes apply ${[...pending].join(', ')}.`, needsReload ? h('button', { class: 'btn small', style: 'margin-left:8px', onclick: () => location.reload() }, 'Reload now') : null)
      : null;
    body.replaceChildren(tabs, ...rows, note ?? '');
  };
  render();
  modal('Settings', body, {
    plain: true,
    footer: [h('button', { class: 'btn small', onclick: () => { resetSettings(); render(); } }, 'Restore defaults')],
  });
}
