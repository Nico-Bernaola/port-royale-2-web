import * as THREE from 'three';
import './styles.css';
import wasmUrl from './wasm/build/core.wasm?url';
import { fetchBytes, registerStyleAssets, worldUrl } from './assets.ts';
import { audio } from './audio.ts';
import { Core, CvState, Ev } from './core/core.ts';
import type { GameData } from './core/data.ts';
import { world } from './data/world.ts';
import { Session } from './game/session.ts';
import { SeaMapView } from './render/seaMap.ts';
import { SeaController } from './game/seaController.ts';
import { TownScreen } from './game/townScreen.ts';
import { BattleScreen } from './game/battleScreen.ts';
import { clear, h, modal, toast, uiRoot } from './ui/dom.ts';
import { onSettingsChange, settings } from './settings.ts';
import { startTexturePainting } from './render/town/textures.ts';
import { openSettings } from './ui/settings.ts';

export type Screen = 'menu' | 'sea' | 'town' | 'battle';

export class App {
  readonly renderer: THREE.WebGLRenderer;
  core!: Core;
  data!: GameData;
  nav!: Uint8Array;
  session: Session | null = null;
  sea: SeaMapView | null = null;
  seaCtl: SeaController | null = null;
  town: TownScreen | null = null;
  battle: BattleScreen | null = null;
  screen: Screen = 'menu';
  private last = performance.now();
  private lastDrawn = 0;
  private fpsEl: HTMLElement | null = null;
  private fpsFrames = 0;
  private fpsSince = performance.now();

  constructor() {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.antialias, alpha: false, powerPreference: 'high-performance' });
    this.applyPixelRatio();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.applyLiveSettings();
    onSettingsChange((_s, changed) => {
      if (changed.includes('renderScale')) { this.applyPixelRatio(); this.resize(); }
      if (changed.includes('textureRes')) void startTexturePainting(settings.textureRes);
      this.applyLiveSettings();
    });
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.renderScale);
  }

  /** Settings that take effect immediately: sound, interface size, frame-rate overlay. */
  private applyLiveSettings(): void {
    audio.applySettings();
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
    document.body.classList.toggle('no-tags', !settings.buildingTags);
    document.body.classList.toggle('no-tips', !settings.tooltips);
    if (settings.showFps && !this.fpsEl) {
      this.fpsEl = h('div', { class: 'fps-meter' });
      document.body.append(this.fpsEl);
    } else if (!settings.showFps && this.fpsEl) {
      this.fpsEl.remove();
      this.fpsEl = null;
    }
  }

  openSettings(): void {
    openSettings();
  }

  private resize(): void {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight, false);
  }

  async boot(): Promise<void> {
    registerStyleAssets();
    audio.unlock();
    // paint the town textures in a background worker while the world loads
    void startTexturePainting(settings.textureRes);
    const loading = this.loadingScreen('Charting the Caribbean...');
    try {
      const [core, nav] = await Promise.all([Core.load(fetch(wasmUrl)), fetchBytes(worldUrl('nav.bin'))]);
      this.core = core;
      this.data = world;
      this.nav = nav;
      loading.set(1, 'Ready');
    } catch (e) {
      loading.el.remove();
      this.fatal(e as Error);
      return;
    }
    loading.el.remove();
    requestAnimationFrame((t) => this.frame(t));
    // ?quickstart[=Town] jumps straight into a normal-difficulty game (handy for testing)
    const quick = new URLSearchParams(location.search).get('quickstart');
    if (quick !== null) {
      const t = this.data.towns.find((x) => x.name === (quick || 'Port Royal'))?.id ?? 0;
      await this.startSession((s) => s.startNew('Captain', t, 25000, [5]));
      return;
    }
    this.showMainMenu();
  }

  private frame(t: number): void {
    // frame-rate cap: skip frames that come too soon
    if (settings.maxFps && t - this.lastDrawn < 1000 / settings.maxFps - 2) {
      requestAnimationFrame((tt) => this.frame(tt));
      return;
    }
    this.lastDrawn = t;
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.fpsEl) {
      this.fpsFrames++;
      if (t - this.fpsSince > 500) {
        const info = this.renderer.info.render;
        this.fpsEl.textContent = `${Math.round((this.fpsFrames * 1000) / (t - this.fpsSince))} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris`;
        this.fpsFrames = 0;
        this.fpsSince = t;
      }
    }
    if (this.session) {
      if (this.screen === 'sea' || this.screen === 'town') this.session.update(dt);
    }
    if (this.screen === 'sea' && this.sea) {
      this.seaCtl?.update(dt);
      this.sea.render(dt);
    } else if (this.screen === 'town' && this.town) {
      this.town.render(dt);
    } else if (this.screen === 'battle' && this.battle) {
      this.battle.update(dt);
    } else {
      this.renderer.setClearColor(0x000000);
      this.renderer.clear();
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }

  // ---- screens ----------------------------------------------------------------------------

  loadingScreen(msg: string) {
    const bar = h('div');
    const text = h('div', { class: 'msg' }, msg);
    const el = h('div', { class: 'loading' }, h('div', null, text, h('div', { class: 'bar' }, bar)));
    uiRoot().append(el);
    return {
      el,
      set(k: number, m?: string) {
        bar.style.width = `${Math.round(k * 100)}%`;
        if (m) text.textContent = m;
      },
    };
  }

  private fatal(e: Error): void {
    console.error(e);
    uiRoot().append(h('div', { class: 'overlay' }, h('div', { class: 'parchment plain missing-assets' }, h('h2', null, 'Something went wrong'), h('p', null, e.message))));
  }

  showMainMenu(): void {
    this.leaveCurrent();
    this.screen = 'menu';
    audio.play('menu');
    const ui = uiRoot();
    const canContinue = Session.hasSave();
    const box = h(
      'div',
      { class: 'menu-box parchment' },
      h('h1', null, 'Caribbean Trader'),
      h('div', { class: 'subtitle' }, 'Trade, build and fight your way across the Spanish Main, 1600'),
      h('button', { class: 'btn', onclick: () => this.showNewGame() }, 'New Game'),
      h('button', { class: 'btn', disabled: !canContinue, onclick: () => void this.continueGame() }, 'Continue'),
      h('button', { class: 'btn', onclick: () => this.showAbout() }, 'How to play'),
      h('button', { class: 'btn', onclick: () => this.openSettings() }, 'Settings'),
    );
    ui.append(h('div', { class: 'menu-screen', id: 'menu' }, box, h('div', { class: 'menu-foot' }, 'Inspired by Port Royale 2 · simulation in WebAssembly, graphics in WebGL · coastlines from Natural Earth')));
  }

  private showAbout(): void {
    modal(
      'About',
      h(
        'div',
        { class: 'col', style: 'max-width:560px;font-size:15px' },
        h('p', null, 'Start with a ship and some gold in a Caribbean port. Buy goods where they are cheap, sail them to towns that need them, and grow a merchant fleet. Pirates hunt convoys at sea: arm your ships, hire sailors, or outrun them.'),
        h('p', null, h('b', null, 'Sea map: '), 'left-click your convoy to select it, right-click the sea or a town to sail there. Drag to scroll, mouse wheel to zoom. Space pauses, 1/2/3 set the speed. Click a town where your convoy lies to go ashore.'),
        h('p', null, h('b', null, 'Ports: '), 'click a building — the market (trade), warehouse (store goods), shipyard (commission, buy, repair and arm ships), harbour (form convoys), tavern (sailors and trade rumours) and town hall (what the town makes and needs).'),
        h('p', null, h('b', null, 'Battles: '), 'right-click to steer your flagship, Q/E fire port/starboard broadsides, 1/2/3 choose round, grape or chain shot.'),
      ),
      { plain: true },
    );
  }

  private showNewGame(): void {
    const name = h('input', { value: 'Henry Morgan', maxlength: 24 }) as HTMLInputElement;
    // any governor's or viceroy's town can be home
    const homes = this.data.towns.filter((t) => t.rank !== 'colony').sort((a, b) => a.name.localeCompare(b.name));
    const town = h('select', null, ...homes.map((t) => h('option', { value: t.id, selected: t.name === 'Port Royal' }, `${t.name} (${t.nation})`))) as HTMLSelectElement;
    const diff = h(
      'select',
      null,
      h('option', { value: 'easy' }, 'Easy: 50,000 gold, a fluyt and a pinnace'),
      h('option', { value: 'normal', selected: true }, 'Normal: 25,000 gold and a fluyt'),
      h('option', { value: 'hard' }, 'Hard: 8,000 gold and a pinnace'),
    ) as HTMLSelectElement;
    const m = modal(
      'New Game',
      h('div', { class: 'newgame', style: 'width:380px' }, h('label', null, 'Your name'), name, h('label', null, 'Home port'), town, h('label', null, 'Difficulty'), diff),
      {
        plain: true,
        footer: [
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                m.close();
                const startTown = Number(town.value);
                const d = diff.value;
                const gold = d === 'easy' ? 50000 : d === 'normal' ? 25000 : 8000;
                const ships = d === 'easy' ? [5, 0] : d === 'normal' ? [5] : [0];
                void this.startSession((s) => s.startNew(name.value.trim() || 'Captain', startTown, gold, ships));
              },
            },
            'Set sail',
          ),
        ],
      },
    );
  }

  private async continueGame(): Promise<void> {
    await this.startSession((s) => {
      if (!s.load()) throw new Error('save game could not be read');
    });
  }

  private async startSession(init: (s: Session) => void): Promise<void> {
    this.leaveCurrent();
    clear(uiRoot());
    const loading = this.loadingScreen('Preparing the world...');
    await new Promise((r) => setTimeout(r, 30));
    // a fresh core instance per campaign keeps state clean
    this.core = await Core.load(fetch(wasmUrl));
    const session = await Session.create(this.core, this.data, this.nav, (Math.random() * 2 ** 31) | 0);
    init(session);
    this.session = session;
    this.sea?.dispose();
    this.sea = new SeaMapView(this.renderer, session);
    await this.sea.load((k) => loading.set(0.2 + k * 0.8, 'Charting the coasts...'));
    loading.el.remove();
    session.on((e) => this.onEvent(e));
    session.notes.add((n) => {
      if (n.kind === 'shipReady') {
        audio.sfx('dock');
        if (settings.pauseOnEvents && this.screen === 'sea') this.seaCtl?.pause();
        toast(`The ${n.order.name} has been launched in ${this.data.towns[n.order.town].name} and waits in the harbour.`, 6000);
        if (this.town?.town === n.order.town) this.enterTown(n.order.town);
      }
    });
    this.seaCtl = new SeaController(this, session, this.sea);
    const c = session.selected;
    if (c >= 0) this.sea.centerOn(this.core.s.cvX[c], this.core.s.cvY[c]);
    this.sea.zoom = 0.9;
    // start in the home port
    const home = c >= 0 ? this.core.s.cvTown[c] : -1;
    if (home >= 0) this.enterTown(home);
    else this.showSea();
  }

  private onEvent(e: { type: number; a: number; b: number }): void {
    const s = this.session!;
    if (e.type === Ev.Encounter) {
      this.onEncounter(e.a, e.b);
    } else if (e.type === Ev.Arrived && s.isPlayerConvoy(e.a)) {
      if (e.b >= 0) {
        audio.sfx('dock', 0.8);
        if (settings.pauseOnEvents && this.screen === 'sea') this.seaCtl?.pause();
        toast(`${s.convoyName(e.a)} has arrived in ${this.data.towns[e.b].name}.`);
      } else toast(`${s.convoyName(e.a)} has reached its destination.`);
    } else if (e.type === Ev.PathFailed && s.isPlayerConvoy(e.a)) {
      audio.sfx('negative');
      toast('No sea route to that place.');
    }
  }

  private onEncounter(player: number, pirate: number): void {
    const s = this.session!;
    s.holds++;
    audio.sfx('message');
    const pirateShips = this.core.shipsOf(pirate).length;
    const strength = this.core.x.convoyStrength(player) / Math.max(1, this.core.x.convoyStrength(pirate));
    const odds = strength > 1.5 ? 'You clearly outgun them.' : strength > 0.9 ? 'The odds look even.' : 'They look stronger than you.';
    const finish = () => s.holds--;
    const m = modal(
      'Pirates!',
      h(
        'div',
        { class: 'col', style: 'max-width:440px' },
        h('p', null, `A pirate convoy of ${pirateShips} ship${pirateShips > 1 ? 's' : ''} is attacking ${s.convoyName(player)}! ${odds}`),
      ),
      {
        plain: true,
        onClose: () => {
          // closing the window = let the captains fight it out
          if (!chosen) resolve();
        },
        footer: [
          h('button', { class: 'btn', onclick: () => { chosen = true; m.close(); this.startBattle(player, pirate, finish); } }, 'Take command'),
          h('button', { class: 'btn', onclick: () => { chosen = true; m.close(); resolve(); } }, 'Let the captains fight'),
        ],
      },
    );
    let chosen = false;
    const resolve = () => {
      const won = this.core.x.autoResolve(player, pirate);
      finish();
      if (won) {
        audio.sfx('victory');
        toast('Your captains beat off the pirates and took their loot!');
      } else {
        audio.sfx('defeat');
        toast('The pirates plundered your cargo.');
      }
      if (this.core.shipsOf(player).length === 0) this.convoyLost(player);
    };
  }

  convoyLost(c: number): void {
    const s = this.session!;
    toast(`${s.convoyName(c)} was lost.`);
    this.core.x.destroyConvoy(c);
    if (s.selected === c) s.selected = s.playerConvoys()[0] ?? -1;
  }

  // ---- screen switches ------------------------------------------------------------------------

  private leaveCurrent(): void {
    this.seaCtl?.detachUi();
    this.town?.dispose();
    this.town = null;
    this.battle?.dispose();
    this.battle = null;
    this.sea?.setVisible(false);
    clear(uiRoot());
  }

  showSea(): void {
    this.leaveCurrent();
    this.screen = 'sea';
    this.sea!.setVisible(true);
    this.seaCtl!.attachUi();
    audio.play('sea');
  }

  enterTown(t: number): void {
    const s = this.session!;
    this.leaveCurrent();
    this.screen = 'town';
    this.town = new TownScreen(this, s, t);
    audio.play('town');
  }

  startBattle(player: number, pirate: number, done: () => void): void {
    this.leaveCurrent();
    this.screen = 'battle';
    this.battle = new BattleScreen(this, this.session!, player, pirate, () => {
      done();
      if (this.core.shipsOf(player).length === 0) this.convoyLost(player);
      else this.core.x.releaseEncounter(player, pirate);
      this.showSea();
    });
    audio.play('battle');
  }

  /** Is convoy c docked in town t? */
  dockedIn(c: number, t: number): boolean {
    return this.session!.isPlayerConvoy(c) && this.core.s.cvState[c] === CvState.Docked && this.core.s.cvTown[c] === t;
  }
}

const app = new App();
void app.boot();
(window as unknown as { app: App }).app = app;
