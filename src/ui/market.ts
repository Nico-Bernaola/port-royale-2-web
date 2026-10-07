/** Port dialogs: market (trading), tavern (crew, rumours) and town hall (town economy). */
import { audio } from '../audio.ts';
import { CvState } from '../core/core.ts';
import type { Session } from '../game/session.ts';
import { fmt, h, modal, toast } from './dom.ts';

export interface PortContext {
  session: Session;
  town: number;
  /** player convoys docked in this town */
  convoys(): number[];
  active(): number;
  setActive(c: number): void;
  changed(): void;
}

const HIRE_COST = 40;

function convoyPicker(ctx: PortContext, onChange: () => void): HTMLElement | null {
  const list = ctx.convoys();
  if (list.length <= 1) return null;
  const sel = h('select', { style: 'font-family:inherit;font-weight:bold;font-size:15px;padding:2px 6px' },
    ...list.map((c) => h('option', { value: c, selected: c === ctx.active() }, ctx.session.convoyName(c)))) as HTMLSelectElement;
  sel.addEventListener('change', () => {
    ctx.setActive(Number(sel.value));
    onChange();
  });
  return h('span', null, 'Convoy: ', sel);
}

export function openMarket(ctx: PortContext): void {
  const s = ctx.session;
  const core = s.core;
  const data = s.data;
  const t = ctx.town;
  audio.play('market');
  const info = h('div', { class: 'row', style: 'margin-bottom:8px;font-size:16px' });
  const tbody = h('tbody');
  const table = h(
    'table',
    { class: 'grid trade-table' },
    h('thead', null, h('tr', null,
      h('th', null, 'Goods'), h('th', { class: 'num' }, 'In town'), h('th', { class: 'num' }, 'Buy at'), h('th', null, ''),
      h('th', null, ''), h('th', { class: 'num' }, 'Sell at'), h('th', { class: 'num' }, 'Aboard'))),
    tbody,
  );

  const act = (fn: () => number, sound = true) => {
    const n = fn();
    if (n > 0 && sound) audio.sfx('click', 0.5);
    if (n === 0) audio.sfx('negative', 0.4);
    render();
    ctx.changed();
  };

  const render = () => {
    const c = ctx.active();
    const docked = c >= 0 && core.s.cvState[c] === CvState.Docked && core.s.cvTown[c] === t;
    const cap = docked ? core.x.capacity(c) : 0;
    const load = docked ? core.x.cargoTotal(c) : 0;
    info.replaceChildren(
      h('span', null, '💰 ', h('b', null, fmt(core.x.gold()))),
      h('span', { class: 'spacer' }),
      convoyPicker(ctx, render) ?? '',
      docked ? h('span', null, 'Hold: ', h('b', null, `${fmt(load)} / ${fmt(cap)}`), ' barrels') : h('span', { class: 'bad' }, 'No convoy in port — you can look but not trade.'),
    );
    tbody.replaceChildren(
      ...data.goods.map((g) => {
        const stock = core.stock(t, g.id);
        const buy = core.x.buyPrice(t, g.id);
        const sell = core.x.sellPrice(t, g.id);
        const aboard = docked ? core.cargo(c, g.id) : 0;
        const rel = buy / g.basePrice;
        const buyCls = rel < 0.85 ? 'good' : rel > 1.4 ? 'bad' : '';
        const sellRel = sell / g.basePrice;
        const sellCls = sellRel > 1.3 ? 'good' : sellRel < 0.75 ? 'bad' : '';
        const bbtn = (label: string, n: () => number) =>
          h('button', { class: 'btn small', disabled: !docked || stock < 1, onclick: () => act(() => core.x.buy(c, g.id, n())) }, label);
        const sbtn = (label: string, n: () => number) =>
          h('button', { class: 'btn small', disabled: !docked || aboard < 1, onclick: () => act(() => core.x.sell(c, g.id, n())) }, label);
        return h(
          'tr',
          null,
          h('td', null, h('span', { class: 'good-name', title: `Average price ${g.basePrice}` }, g.name)),
          h('td', { class: 'num' }, fmt(stock)),
          h('td', { class: `num ${buyCls}` }, stock >= 1 ? fmt(buy) : '—'),
          h('td', null, h('div', { class: 'trade-amounts' }, bbtn('1', () => 1), bbtn('10', () => 10), bbtn('Max', () => 9999))),
          h('td', null, h('div', { class: 'trade-amounts' }, sbtn('1', () => 1), sbtn('10', () => 10), sbtn('All', () => 9999))),
          h('td', { class: `num ${sellCls}` }, fmt(sell)),
          h('td', { class: 'num' }, aboard ? fmt(aboard) : ''),
        );
      }),
    );
  };
  render();
  modal(`Market of ${data.towns[t].name}`, h('div', null, info, table, h('div', { class: 'muted price-hint', style: 'margin-top:6px' },
    'Prices follow supply: each barrel you buy makes the next one dearer, each one you sell cheaper. Green = good deal, red = poor deal.')),
  { width: 860, onClose: () => audio.play('town') });
}

export function openTavern(ctx: PortContext): void {
  const s = ctx.session;
  const core = s.core;
  const data = s.data;
  audio.play('tavern');
  const body = h('div', { style: 'min-width:560px' });
  const render = () => {
    const c = ctx.active();
    const ships = c >= 0 ? core.shipsOf(c) : [];
    const rows = ships.map((sh) => {
      const type = data.ships[core.s.shType[sh]];
      const crew = core.s.shCrew[sh];
      const max = type.crew;
      const missing = Math.max(0, max - crew);
      const hire = (n: number) => {
        const k = Math.min(n, missing, Math.floor(core.x.gold() / HIRE_COST));
        if (k <= 0) { audio.sfx('negative'); return; }
        core.x.setGold(core.x.gold() - k * HIRE_COST);
        core.s.shCrew[sh] = crew + k;
        audio.sfx('click');
        render();
        ctx.changed();
      };
      return h('tr', null,
        h('td', null, s.shipName(sh), h('span', { class: 'muted' }, ` (${type.name})`)),
        h('td', { class: 'num' }, `${crew} / ${max}`),
        h('td', null, h('div', { class: 'trade-amounts' },
          h('button', { class: 'btn small', disabled: missing === 0, onclick: () => hire(5) }, '+5'),
          h('button', { class: 'btn small', disabled: missing === 0, onclick: () => hire(missing) }, `Fill (${fmt(missing * HIRE_COST)})`))));
    });
    body.replaceChildren(
      h('p', null, `Sailors here sign on for ${HIRE_COST} gold each. A full crew sails faster, reloads quicker and wins boarding fights.`),
      convoyPicker(ctx, render) ?? '',
      ships.length
        ? h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'Ship'), h('th', { class: 'num' }, 'Crew'), h('th', null, 'Hire'))), h('tbody', null, ...rows))
        : h('p', { class: 'muted' }, 'You have no convoy in port.'),
      h('h3', { style: 'margin-top:14px;font-size:22px' }, 'Overheard at the bar'),
      ...rumours(s, ctx.town).map((r) => h('p', { style: 'margin:4px 0' }, '“', r, '”')),
    );
  };
  render();
  modal('Tavern', body, { onClose: () => audio.play('town') });
}

/** Trade tips from the live economy: cheap here or nearby, dear elsewhere. */
function rumours(s: Session, town: number): string[] {
  const core = s.core;
  const data = s.data;
  const tx = data.towns[town].x, ty = data.towns[town].y;
  const near = data.towns.filter((t) => Math.hypot(t.x - tx, t.y - ty) < 1300);
  const deals: { gain: number; text: string }[] = [];
  for (const g of data.goods) {
    let cheap = -1, cheapP = 1e9, dear = -1, dearP = 0;
    for (const t of near) {
      if (core.stock(t.id, g.id) < 15) continue;
      const p = core.x.buyPrice(t.id, g.id);
      if (p < cheapP) { cheapP = p; cheap = t.id; }
    }
    for (const t of near) {
      const p = core.x.sellPrice(t.id, g.id);
      if (p > dearP) { dearP = p; dear = t.id; }
    }
    if (cheap >= 0 && dear >= 0 && cheap !== dear && dearP > cheapP * 1.4) {
      deals.push({ gain: dearP - cheapP, text: `${g.name} goes for ${fmt(cheapP)} in ${data.towns[cheap].name}, and ${data.towns[dear].name} pays ${fmt(dearP)} for it.` });
    }
  }
  deals.sort((a, b) => b.gain - a.gain);
  const out = deals.slice(0, 3).map((d) => d.text);
  if (!out.length) out.push('Trade is slow these days, captain. Try your luck further afield.');
  return out;
}

export function openTownHall(ctx: PortContext): void {
  const s = ctx.session;
  const core = s.core;
  const data = s.data;
  const t = data.towns[ctx.town];
  audio.play('governor');
  const pop = core.s.townPop[t.id];
  const sat = core.s.townSatisfaction[t.id];
  const G = core.MAX_GOODS;
  const rows = data.goods.map((g) => {
    const stock = core.stock(t.id, g.id);
    const need = core.x.dailyDemand(t.id, g.id);
    const made = core.s.townProduced[t.id * G + g.id];
    const days = need > 0 ? stock / need : 99;
    const cls = days < 3 ? 'bad' : days > 20 ? 'good' : '';
    return h('tr', null,
      h('td', null, g.name, t.produces.includes(g.id) ? h('span', { class: 'good' }, ' ⚒') : ''),
      h('td', { class: 'num' }, made > 0 ? made.toFixed(1) : ''),
      h('td', { class: 'num' }, need.toFixed(1)),
      h('td', { class: 'num' }, fmt(stock)),
      h('td', { class: `num ${cls}` }, days >= 99 ? '∞' : days.toFixed(0)));
  });
  const rank = t.rank === 'viceroy' ? 'Seat of the Viceroy' : t.rank === 'governor' ? 'Governor town' : 'Colony';
  modal(
    t.rank === 'colony' ? `Town hall of ${t.name}` : `Governor's house, ${t.name}`,
    h('div', { style: 'min-width:520px' },
      h('div', { class: 'row', style: 'gap:24px;font-size:16px;margin-bottom:8px' },
        h('span', null, h('b', null, t.nation), ` · ${rank}`),
        h('span', null, 'Inhabitants: ', h('b', null, fmt(pop))),
        h('span', null, 'Supply: ', h('b', { class: sat > 0.7 ? 'good' : sat < 0.45 ? 'bad' : '' }, `${Math.round(sat * 100)}%`))),
      h('table', { class: 'grid' },
        h('thead', null, h('tr', null, h('th', null, 'Goods'), h('th', { class: 'num' }, 'Made/day'), h('th', { class: 'num' }, 'Needed/day'), h('th', { class: 'num' }, 'Stock'), h('th', { class: 'num' }, 'Days left'))),
        h('tbody', null, ...rows)),
      h('p', { class: 'muted', style: 'font-size:13px' }, '⚒ = produced here. Towns that run short of goods stop growing; deliver what they lack and they flourish.')),
    { onClose: () => audio.play('town') },
  );
}

export function notInPort(): void {
  toast('Bring a convoy into this port first.');
}
