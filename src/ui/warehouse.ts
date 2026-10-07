/** Warehouse: rent storage in a town and move goods between it and a docked convoy. */
import { audio } from '../audio.ts';
import { CvState } from '../core/core.ts';
import { WAREHOUSE_CAPACITY, WAREHOUSE_RENT } from '../game/session.ts';
import { fmt, h, modal, toast } from './dom.ts';
import type { PortContext } from './market.ts';

const RENT_DEPOSIT = 2000;

export function openWarehouse(ctx: PortContext): void {
  const s = ctx.session;
  const core = s.core;
  const data = s.data;
  const t = ctx.town;
  const body = h('div', { style: 'width:640px' });

  const render = () => {
    const wh = s.warehouse(t);
    if (!wh) {
      body.replaceChildren(
        h('p', null, `You have no warehouse in ${data.towns[t].name}. A warehouse stores up to ${WAREHOUSE_CAPACITY} barrels of goods in town, so you can stock up while prices are low and sell later, or leave cargo for another convoy to collect.`),
        h('p', { class: 'muted' }, `Rent: ${fmt(RENT_DEPOSIT)} gold up front, then ${WAREHOUSE_RENT} gold a day.`),
        h('button', {
          class: 'btn', disabled: core.x.gold() < RENT_DEPOSIT, onclick: () => {
            core.x.setGold(core.x.gold() - RENT_DEPOSIT);
            s.warehouses.push({ town: t, goods: data.goods.map(() => 0) });
            audio.sfx('click');
            render();
            ctx.changed();
          },
        }, `Rent a warehouse (${fmt(RENT_DEPOSIT)} gold)`),
      );
      return;
    }
    const c = ctx.active();
    const docked = c >= 0 && core.s.cvState[c] === CvState.Docked && core.s.cvTown[c] === t;
    const stored = wh.goods.reduce((a, b) => a + b, 0);
    const G = core.MAX_GOODS;
    const move = (g: number, n: number, toWarehouse: boolean) => {
      if (!docked) { toast('Bring a convoy into port to move goods.'); return; }
      const ci = c * G + g;
      let k: number;
      if (toWarehouse) {
        k = Math.min(n, Math.floor(core.s.cvCargo[ci]), WAREHOUSE_CAPACITY - stored);
        core.s.cvCargo[ci] -= k;
        wh.goods[g] += k;
      } else {
        k = Math.min(n, wh.goods[g], Math.floor(core.x.freeSpace(c)));
        core.s.cvCargo[ci] += k;
        wh.goods[g] -= k;
      }
      if (k > 0) audio.sfx('click');
      else audio.sfx('negative');
      render();
      ctx.changed();
    };
    const rows = data.goods
      .filter((g) => wh.goods[g.id] > 0 || (docked && core.cargo(c, g.id) > 0))
      .map((g) => {
        const aboard = docked ? core.cargo(c, g.id) : 0;
        const btn = (label: string, n: number, toW: boolean, disabled: boolean) =>
          h('button', { class: 'btn small', disabled, onclick: () => move(g.id, n, toW) }, label);
        return h('tr', null,
          h('td', null, g.name),
          h('td', { class: 'num' }, aboard ? fmt(aboard) : ''),
          h('td', null, h('div', { class: 'trade-amounts' }, btn('10 →', 10, true, !aboard), btn('All →', 9999, true, !aboard))),
          h('td', null, h('div', { class: 'trade-amounts' }, btn('← 10', 10, false, !wh.goods[g.id]), btn('← All', 9999, false, !wh.goods[g.id]))),
          h('td', { class: 'num' }, wh.goods[g.id] ? fmt(wh.goods[g.id]) : ''));
      });
    body.replaceChildren(
      h('div', { class: 'row', style: 'margin-bottom:8px' },
        h('span', null, 'Stored: ', h('b', null, `${fmt(stored)} / ${WAREHOUSE_CAPACITY}`), ' barrels'),
        h('span', { class: 'spacer' }),
        docked ? h('span', null, `${s.convoyName(c)}: `, h('b', null, `${fmt(core.x.cargoTotal(c))} / ${fmt(core.x.capacity(c))}`)) : h('span', { class: 'bad' }, 'No convoy in port')),
      rows.length
        ? h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'Goods'), h('th', { class: 'num' }, 'Aboard'), h('th', null, 'Store'), h('th', null, 'Load'), h('th', { class: 'num' }, 'In warehouse'))), h('tbody', null, ...rows))
        : h('p', { class: 'muted' }, 'The warehouse is empty and your convoy carries nothing. Buy goods at the market first.'),
      h('div', { style: 'margin-top:10px;text-align:right' }, h('button', {
        class: 'btn small danger', onclick: () => {
          if (stored > 0) { toast('Empty the warehouse before giving it up.'); return; }
          s.warehouses.splice(s.warehouses.indexOf(wh), 1);
          render();
          ctx.changed();
        },
      }, 'Give up the warehouse')),
    );
  };
  render();
  modal(`Warehouse in ${data.towns[t].name}`, body, {});
}
