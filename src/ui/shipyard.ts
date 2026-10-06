/** Port dialogs: shipyard (buy, repair, arm, sell ships) and harbour master (fleet management). */
import { audio } from '../audio.ts';
import { shipSheetUrl } from '../assets.ts';
import { Owner } from '../core/core.ts';
import type { ShipDef } from '../core/data.ts';
import { fmt, h, modal, toast } from './dom.ts';
import type { PortContext } from './market.ts';

const CANNON_PRICE = 350;
const CANNON_RESALE = 150;
const CANNON_SPACE = 3;

/** Ship types a town's shipyard builds, by town rank. */
function shipsForSale(rank: string, ships: ShipDef[]): ShipDef[] {
  const colony = [0, 1, 2, 3, 5];
  const governor = [...colony, 6, 7, 8, 11, 12, 13];
  const ids = rank === 'colony' ? colony : rank === 'governor' ? governor : ships.map((s) => s.id).filter((id) => id !== 4 && id !== 16);
  return ids.map((i) => ships[i]).filter(Boolean);
}

export function shipPicture(type: number, size = 100): HTMLElement {
  // frame 4 of the 16-heading sheet (row 1, column 0) is a nice three-quarter view
  const scale = size / 100;
  return h('div', {
    class: 'pic',
    style: `width:${size}px;height:${size * 0.8}px;background-image:url('${shipSheetUrl(type)}');background-size:${512 * scale}px ${512 * scale}px;background-position:0 ${-100 * scale - 10 * scale}px`,
  });
}

function stats(t: ShipDef): HTMLElement {
  const st = (k: string, v: string | number) => h('span', null, `${k} `, h('b', null, String(v)));
  return h('div', { class: 'stats' },
    st('Cargo', t.cargo), st('Speed', `${t.vmin}-${t.vmax} kn`), st('Cannons', t.guns), st('Crew', t.crew),
    st('Agility', `${t.agility}%`), st('Hull', t.hull), st('Upkeep', `${t.upkeep}/day`), st('Draught', ['shallow', 'medium', 'deep'][t.draught] ?? '?'));
}

/** All player ships in this port: in docked convoys or laid up in the harbour. */
function portShips(ctx: PortContext): number[] {
  const core = ctx.session.core;
  const out: number[] = [];
  for (const c of ctx.convoys()) out.push(...core.shipsOf(c));
  out.push(...core.harbourShips(ctx.town));
  return out;
}

export function openShipyard(ctx: PortContext): void {
  const s = ctx.session;
  const core = s.core;
  const data = s.data;
  const town = data.towns[ctx.town];
  let tab: 'buy' | 'repair' | 'arm' | 'sell' = 'buy';
  const tabs = h('div', { class: 'row', style: 'margin-bottom:10px' });
  const body = h('div', { style: 'width:680px;min-height:360px' });
  const gold = () => h('div', { style: 'margin-bottom:6px' }, '💰 ', h('b', null, fmt(core.x.gold())));

  const render = () => {
    tabs.replaceChildren(
      ...(['buy', 'repair', 'arm', 'sell'] as const).map((k) =>
        h('button', { class: `btn small ${tab === k ? 'active' : ''}`, onclick: () => { tab = k; render(); } },
          { buy: 'Buy ships', repair: 'Repair', arm: 'Cannons', sell: 'Sell ships' }[k])));
    if (tab === 'buy') body.replaceChildren(gold(), ...shipsForSale(town.rank, data.ships).map((t) => buyCard(t)));
    else if (tab === 'repair') body.replaceChildren(gold(), ...repairRows());
    else if (tab === 'arm') body.replaceChildren(gold(), ...armRows());
    else body.replaceChildren(gold(), ...sellRows());
  };

  const buyCard = (t: ShipDef) =>
    h('div', { class: 'ship-card' }, shipPicture(t.id), h('div', { class: 'info' }, h('b', null, t.name), stats(t)),
      h('div', { class: 'col', style: 'align-items:flex-end' }, h('b', null, `${fmt(t.price)} gold`),
        h('button', {
          class: 'btn small', disabled: core.x.gold() < t.price, onclick: () => {
            core.x.setGold(core.x.gold() - t.price);
            const id = core.x.createShip(t.id, Owner.Player, ctx.town);
            if (id < 0) { toast('The harbour is full.'); return; }
            const c = ctx.active();
            if (c >= 0) core.x.addShipToConvoy(id, c);
            audio.sfx('dock');
            toast(c >= 0 ? `The ${t.name} joins ${s.convoyName(c)}.` : `The ${t.name} lies in the harbour. Form a convoy at the harbour master.`);
            render();
            ctx.changed();
          },
        }, 'Buy')));

  const repairCost = (sh: number) => {
    const t = data.ships[core.s.shType[sh]];
    return Math.ceil((100 - core.s.shHull[sh]) * t.price * 0.0015 + (100 - core.s.shSails[sh]) * t.price * 0.0005);
  };
  const repairRows = () => {
    const ships = portShips(ctx).filter((sh) => core.s.shHull[sh] < 99.5 || core.s.shSails[sh] < 99.5);
    if (!ships.length) return [h('p', { class: 'muted' }, 'All your ships here are in good repair.')];
    const total = ships.reduce((a, sh) => a + repairCost(sh), 0);
    const repair = (list: number[]) => {
      for (const sh of list) {
        const cost = repairCost(sh);
        if (core.x.gold() < cost) { toast('Not enough gold.'); break; }
        core.x.setGold(core.x.gold() - cost);
        core.s.shHull[sh] = 100;
        core.s.shSails[sh] = 100;
      }
      audio.sfx('click');
      render();
      ctx.changed();
    };
    return [
      h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'Ship'), h('th', { class: 'num' }, 'Hull'), h('th', { class: 'num' }, 'Sails'), h('th', { class: 'num' }, 'Cost'), h('th', null, ''))),
        h('tbody', null, ...ships.map((sh) => h('tr', null, h('td', null, s.shipName(sh)), h('td', { class: 'num' }, `${Math.round(core.s.shHull[sh])}%`),
          h('td', { class: 'num' }, `${Math.round(core.s.shSails[sh])}%`), h('td', { class: 'num' }, fmt(repairCost(sh))),
          h('td', null, h('button', { class: 'btn small', onclick: () => repair([sh]) }, 'Repair')))))),
      h('div', { style: 'margin-top:8px;text-align:right' }, h('button', { class: 'btn', onclick: () => repair(ships) }, `Repair all (${fmt(total)})`)),
    ];
  };

  const armRows = () => {
    const ships = portShips(ctx);
    if (!ships.length) return [h('p', { class: 'muted' }, 'You have no ships in this port.')];
    return [
      h('p', { class: 'muted' }, `Cannons cost ${CANNON_PRICE} gold (resale ${CANNON_RESALE}) and take ${CANNON_SPACE} barrels of hold space each.`),
      h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'Ship'), h('th', { class: 'num' }, 'Cannons'), h('th', null, ''))),
        h('tbody', null, ...ships.map((sh) => {
          const t = data.ships[core.s.shType[sh]];
          const n = core.s.shCannons[sh];
          const c = core.s.shConvoy[sh];
          const change = (d: number) => {
            if (d > 0) {
              if (core.x.gold() < CANNON_PRICE * d) { toast('Not enough gold.'); return; }
              if (c >= 0 && core.x.freeSpace(c) < CANNON_SPACE * d) { toast('Unload some cargo first: cannons need hold space.'); return; }
              core.x.setGold(core.x.gold() - CANNON_PRICE * d);
            } else core.x.setGold(core.x.gold() + CANNON_RESALE * -d);
            core.s.shCannons[sh] = Math.max(0, Math.min(t.guns, n + d));
            audio.sfx('click');
            render();
            ctx.changed();
          };
          return h('tr', null, h('td', null, s.shipName(sh), h('span', { class: 'muted' }, ` (${t.name})`)), h('td', { class: 'num' }, `${n} / ${t.guns}`),
            h('td', null, h('div', { class: 'trade-amounts' },
              h('button', { class: 'btn small', disabled: n <= 0, onclick: () => change(-2) }, '−2'),
              h('button', { class: 'btn small', disabled: n >= t.guns, onclick: () => change(2) }, '+2'),
              h('button', { class: 'btn small', disabled: n >= t.guns, onclick: () => change(t.guns - n) }, 'Full'))));
        }))),
    ];
  };

  const sellRows = () => {
    const ships = portShips(ctx);
    if (!ships.length) return [h('p', { class: 'muted' }, 'You have no ships in this port.')];
    return ships.map((sh) => {
      const t = data.ships[core.s.shType[sh]];
      const value = Math.round(t.price * 0.5 * (0.3 + 0.7 * core.s.shHull[sh] / 100) + core.s.shCannons[sh] * CANNON_RESALE);
      return h('div', { class: 'ship-card' }, shipPicture(t.id, 80), h('div', { class: 'info' }, h('b', null, s.shipName(sh)), ` ${t.name} · hull ${Math.round(core.s.shHull[sh])}%`),
        h('button', {
          class: 'btn small danger', onclick: () => {
            const c = core.s.shConvoy[sh];
            if (c >= 0 && core.shipsOf(c).length === 1 && core.x.cargoTotal(c) > 0) { toast('Sell the cargo of that convoy first.'); return; }
            core.x.removeShip(sh);
            core.x.setGold(core.x.gold() + value);
            if (c >= 0 && core.shipsOf(c).length === 0) core.x.destroyConvoy(c);
            s.shipNames.delete(sh);
            audio.sfx('click');
            render();
            ctx.changed();
          },
        }, `Sell for ${fmt(value)}`));
    });
  };

  render();
  modal(`Shipyard of ${town.name}`, h('div', null, tabs, body), {});
}

export function openHarbour(ctx: PortContext): void {
  const s = ctx.session;
  const core = s.core;
  const data = s.data;
  const t = ctx.town;
  const body = h('div', { style: 'width:640px' });
  const picked = new Set<number>();

  const moveToHarbour = (sh: number) => {
    const c = core.s.shConvoy[sh];
    if (c >= 0 && core.shipsOf(c).length === 1 && core.x.cargoTotal(c) > 0) {
      toast('That is the last ship of the convoy and it still carries cargo.');
      return;
    }
    core.s.shConvoy[sh] = -1;
    core.s.shTown[sh] = t;
    if (c >= 0 && core.shipsOf(c).length === 0) core.x.disbandConvoy(c);
    // cargo that no longer fits stays aboard the convoy (overloaded) — warn the player
    if (c >= 0 && core.x.freeSpace(c) <= 0 && core.x.cargoTotal(c) > core.x.capacity(c)) toast('The convoy is overloaded now.');
  };

  const render = () => {
    const convoys = ctx.convoys();
    const laidUp = core.harbourShips(t);
    for (const sh of [...picked]) if (!laidUp.includes(sh)) picked.delete(sh);
    body.replaceChildren(
      ...convoys.map((c) =>
        h('div', { class: 'parchment plain', style: 'padding:8px 10px;margin-bottom:10px' },
          h('div', { class: 'row' },
            h('h3', { style: 'font-size:22px' }, s.convoyName(c)),
            c === ctx.active() ? h('span', { class: 'muted' }, '(selected)') : h('button', { class: 'btn small', onclick: () => { ctx.setActive(c); render(); } }, 'Select'),
            h('span', { class: 'spacer' }),
            h('span', { class: 'muted' }, `${fmt(core.x.cargoTotal(c))}/${fmt(core.x.capacity(c))} barrels`),
            convoys.length > 1 && c !== ctx.active()
              ? h('button', { class: 'btn small', onclick: () => { mergeInto(ctx.active(), c); render(); ctx.changed(); } }, `Merge into ${s.convoyName(ctx.active())}`)
              : null),
          ...core.shipsOf(c).map((sh) =>
            h('div', { class: 'ship-line', style: 'display:flex;justify-content:space-between;padding:3px 0' },
              h('span', null, s.shipName(sh), h('span', { class: 'muted' }, ` ${data.ships[core.s.shType[sh]].name} · crew ${core.s.shCrew[sh]} · ${core.s.shCannons[sh]} guns`)),
              h('button', { class: 'btn small', onclick: () => { moveToHarbour(sh); render(); ctx.changed(); } }, 'Lay up'))))),
      h('h3', { style: 'font-size:22px;margin:6px 0' }, 'Laid up in the harbour'),
      laidUp.length
        ? h('div', null, ...laidUp.map((sh) => {
          const cb = h('input', { type: 'checkbox', checked: picked.has(sh) }) as HTMLInputElement;
          cb.addEventListener('change', () => { if (cb.checked) picked.add(sh); else picked.delete(sh); });
          return h('div', { class: 'ship-line', style: 'display:flex;gap:8px;align-items:center;padding:3px 0' }, cb,
            h('span', { class: 'grow' }, s.shipName(sh), h('span', { class: 'muted' }, ` ${data.ships[core.s.shType[sh]].name}`)),
            convoys.length ? h('button', { class: 'btn small', onclick: () => { core.x.addShipToConvoy(sh, ctx.active()); render(); ctx.changed(); } }, `Add to ${s.convoyName(ctx.active())}`) : null);
        }),
        h('div', { style: 'margin-top:8px' }, h('button', {
          class: 'btn', onclick: () => {
            const list = picked.size ? [...picked] : laidUp;
            const first = data.towns[t];
            const c = core.x.createConvoy(Owner.Player, ['Spain', 'England', 'France', 'Holland'].indexOf(first.nation), core.s.townX[t], core.s.townY[t], t);
            if (c < 0) { toast('Too many convoys.'); return; }
            for (const sh of list) core.x.addShipToConvoy(sh, c);
            s.convoyName(c);
            ctx.setActive(c);
            audio.sfx('dock');
            render();
            ctx.changed();
          },
        }, picked.size ? 'Form convoy from selected ships' : 'Form convoy from all laid-up ships')))
        : h('p', { class: 'muted' }, 'No ships are laid up here. Laid-up ships cost half upkeep.'),
    );
  };

  const mergeInto = (target: number, src: number) => {
    for (const sh of core.shipsOf(src)) core.x.addShipToConvoy(sh, target);
    const G = core.MAX_GOODS;
    for (let g = 0; g < data.goods.length; g++) {
      core.s.cvCargo[target * G + g] += core.s.cvCargo[src * G + g];
      core.s.cvCargo[src * G + g] = 0;
    }
    core.x.disbandConvoy(src);
    audio.sfx('dock');
  };

  render();
  modal('Harbour master', body, {});
}
