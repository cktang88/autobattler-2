// Detailed round stats: after a battle, every unit's combat record (Battle.unitTally) as a ranked bar chart. One
// dropdown picks the statistic (damage dealt / taken, per supply, kills, value traded...), the other how units are
// grouped (each unit, each placed block, unit type, chassis); a third control shows my side, the enemy or both.

import { h } from '../app.ts';
import { sfx } from '../audio.ts';
import * as kit from './kit.ts';
import { openModal } from './match-ui.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import { TICK_RATE } from '../../shared/sim/types.ts';
import { placementValue } from '../../shared/match.ts';
import { CHASSIS_BY_ID } from '../../shared/parts.ts';
import type { Side } from '../../shared/types.ts';

type Metric =
  | 'dealt' | 'taken' | 'dealtPerCost' | 'takenPerCost' | 'kills' | 'valueKilled' | 'trade'
  | 'lost' | 'valueLost' | 'shield' | 'healed' | 'survival' | 'lifetime' | 'cost';
type Group = 'unit' | 'block' | 'design' | 'chassis';
type Show = 'both' | 'mine' | 'enemy';

/** sums over a group of units; every metric is derived from these, so ratios are total / total, not an average */
interface Acc {
  side: Side; units: number; blocks: Set<number>; alive: number; cost: number;
  dealt: number; taken: number; shield: number; healed: number; kills: number; valueKilled: number; valueLost: number; lifeS: number;
}

const METRICS: { value: Metric; label: string; hint: string; fmt: (v: number) => string; get: (a: Acc) => number }[] = [
  { value: 'dealt', label: 'Damage dealt', hint: 'To enemy hulls and shields', fmt: int, get: (a) => a.dealt },
  { value: 'taken', label: 'Damage taken', hint: 'Hull and shields, from any source', fmt: int, get: (a) => a.taken },
  { value: 'dealtPerCost', label: 'Damage dealt / cost', hint: 'Per 100 supply invested (purchase + upgrades)', fmt: dec, get: (a) => per100(a.dealt, a.cost) },
  { value: 'takenPerCost', label: 'Damage taken / cost', hint: 'Per 100 supply invested: how much it soaked for its price', fmt: dec, get: (a) => per100(a.taken, a.cost) },
  { value: 'kills', label: 'Kills', hint: 'Killing blows on enemy units (a squad unit counts as one)', fmt: int, get: (a) => a.kills },
  { value: 'valueKilled', label: 'Supply destroyed', hint: 'Supply value of the enemy units it finished off', fmt: int, get: (a) => a.valueKilled },
  { value: 'trade', label: 'Supply destroyed / cost', hint: 'Above 1× it killed more than it cost', fmt: (v) => `${v.toFixed(2)}×`, get: (a) => (a.cost > 0 ? a.valueKilled / a.cost : 0) },
  { value: 'lost', label: 'Units lost', hint: 'Units of the group destroyed this battle', fmt: int, get: (a) => a.units - a.alive },
  { value: 'valueLost', label: 'Supply lost', hint: 'Supply value of the group\'s destroyed units', fmt: int, get: (a) => a.valueLost },
  { value: 'shield', label: 'Shield absorbed', hint: 'Damage its own shields and allied domes soaked', fmt: int, get: (a) => a.shield },
  { value: 'healed', label: 'Repairs done', hint: 'Hull repaired on allies (repair beams, repair aura)', fmt: int, get: (a) => a.healed },
  { value: 'survival', label: 'Survival', hint: 'Share of units still alive at the end', fmt: (v) => `${Math.round(v)}%`, get: (a) => (a.units ? (100 * a.alive) / a.units : 0) },
  { value: 'lifetime', label: 'Time alive', hint: 'Average seconds each unit lasted', fmt: (v) => `${v.toFixed(1)}s`, get: (a) => (a.units ? a.lifeS / a.units : 0) },
  { value: 'cost', label: 'Supply fielded', hint: 'Purchase + upgrades of the units in the fight', fmt: int, get: (a) => a.cost },
];
const GROUPS: { value: Group; label: string; hint: string }[] = [
  { value: 'unit', label: 'Every unit', hint: 'Each unit on its own, squad members included' },
  { value: 'block', label: 'Every block', hint: 'Each placed block (a squad counts once)' },
  { value: 'design', label: 'Unit type', hint: 'All blocks of the same design together' },
  { value: 'chassis', label: 'Chassis', hint: 'All units on the same hull together' },
];

function int(v: number): string { return Math.round(v).toLocaleString(); }
function dec(v: number): string { return v.toFixed(1); }
function per100(v: number, cost: number): number { return cost > 0 ? (100 * v) / cost : 0; }

let lastMetric: Metric = 'dealt';
let lastGroup: Group = 'design';
let lastShow: Show = 'both';

/** Open the stats popup for a finished (or skipped-to-the-end) battle. `me` is the viewer's side. */
export function openRoundStats(battle: Battle, round: number, me: Side, names: [string, string]): void {
  const units = battle.units;
  const endS = battle.tick / TICK_RATE;
  // supply value of one unit: its block's investment shared by the squad
  const squadN = new Map<string, number>();
  for (const u of units) squadN.set(`${u.side}:${u.uid}`, (squadN.get(`${u.side}:${u.uid}`) ?? 0) + 1);
  const valueOf = units.map((u) => placementValue(u.design, u.level) / (squadN.get(`${u.side}:${u.uid}`) ?? 1));

  // labels: a design fielded in several blocks gets "Name 2", "Name 3"; squad members "Name · 4"
  const blockNo = new Map<string, number>();
  const perDesign = new Map<string, number>();
  for (const u of units) {
    const bk = `${u.side}:${u.uid}`;
    if (blockNo.has(bk)) continue;
    const dk = `${u.side}:${u.design.id}`;
    const n = (perDesign.get(dk) ?? 0) + 1;
    perDesign.set(dk, n);
    blockNo.set(bk, n);
  }
  const memberNo = new Map<number, number>();
  const seen = new Map<string, number>();
  for (const u of units) { const bk = `${u.side}:${u.uid}`; const n = (seen.get(bk) ?? 0) + 1; seen.set(bk, n); memberNo.set(u.id, n); }
  const blockLabel = (side: Side, uid: number, name: string, designId: string) =>
    (perDesign.get(`${side}:${designId}`) ?? 1) > 1 ? `${name} ${blockNo.get(`${side}:${uid}`)}` : name;

  function groups(g: Group): { key: string; label: string; sub: string; acc: Acc }[] {
    const out = new Map<string, { key: string; label: string; sub: string; acc: Acc; lv: Set<number> }>();
    for (const u of units) {
      const t = battle.unitTally(u.id);
      const sq = squadN.get(`${u.side}:${u.uid}`) ?? 1;
      const chassis = CHASSIS_BY_ID.get(u.design.chassis)?.name ?? u.design.chassis;
      const bl = blockLabel(u.side, u.uid, u.design.name, u.design.id);
      const [key, label] =
        g === 'unit' ? [`${u.side}:u${u.id}`, sq > 1 ? `${bl} · ${memberNo.get(u.id)}` : bl]
        : g === 'block' ? [`${u.side}:b${u.uid}`, bl]
        : g === 'design' ? [`${u.side}:d${u.design.id}`, u.design.name]
        : [`${u.side}:c${u.design.chassis}`, chassis];
      let e = out.get(key);
      if (!e) {
        e = { key, label, sub: '', lv: new Set(), acc: { side: u.side, units: 0, blocks: new Set(), alive: 0, cost: 0, dealt: 0, taken: 0, shield: 0, healed: 0, kills: 0, valueKilled: 0, valueLost: 0, lifeS: 0 } };
        out.set(key, e);
      }
      const a = e.acc;
      e.lv.add(u.level);
      a.units++;
      a.blocks.add(u.uid);
      if (u.alive) a.alive++; else a.valueLost += valueOf[u.id];
      a.cost += valueOf[u.id];
      a.dealt += t.dealt;
      a.taken += t.taken;
      a.shield += t.shieldTaken;
      a.healed += t.healed;
      a.kills += t.kills.length;
      for (const v of t.kills) a.valueKilled += valueOf[v];
      a.lifeS += t.deathTick >= 0 ? t.deathTick / TICK_RATE : endS;
    }
    for (const e of out.values()) {
      const a = e.acc, lv = [...e.lv].sort();
      const lvTxt = lv.length === 1 ? (lv[0] > 1 ? `Lv${lv[0]}` : '') : `Lv${lv[0]}–${lv[lv.length - 1]}`;
      const parts = g === 'unit'
        ? [lvTxt, a.alive ? 'survived' : 'destroyed']
        : [lvTxt, g !== 'block' ? `${a.blocks.size} block${a.blocks.size > 1 ? 's' : ''}` : '', a.units > 1 ? `${a.alive}/${a.units} alive` : a.alive ? 'survived' : 'destroyed'];
      e.sub = [...parts, `${int(a.cost)} supply`].filter(Boolean).join(' · ');
    }
    return [...out.values()];
  }

  const body = h('div.rstats');
  const draw = () => {
    const metric = METRICS.find((x) => x.value === lastMetric) ?? METRICS[0];
    const all = groups(lastGroup);
    const rows = all
      .filter((r) => lastShow === 'both' || (lastShow === 'mine') === (r.acc.side === me))
      .map((r) => ({ ...r, v: metric.get(r.acc) }))
      .sort((a, b) => b.v - a.v || a.label.localeCompare(b.label));
    const max = Math.max(1e-9, ...rows.map((r) => r.v));
    // side totals of the metric, from each side's whole army
    const sideAcc = (s: Side): Acc => {
      const t: Acc = { side: s, units: 0, blocks: new Set(), alive: 0, cost: 0, dealt: 0, taken: 0, shield: 0, healed: 0, kills: 0, valueKilled: 0, valueLost: 0, lifeS: 0 };
      for (const r of all) {
        if (r.acc.side !== s) continue;
        for (const k of ['units', 'alive', 'cost', 'dealt', 'taken', 'shield', 'healed', 'kills', 'valueKilled', 'valueLost', 'lifeS'] as const) t[k] += r.acc[k];
      }
      return t;
    };
    const opp = (1 - me) as Side;
    body.replaceChildren(
      h('div.rstats-ctl', null,
        kit.select({ value: lastMetric, label: 'Statistic', prefix: 'Stat', options: METRICS.map(({ value, label, hint }) => ({ value, label, hint })), onChange: (v) => { lastMetric = v; sfx('click'); draw(); } }),
        kit.select({ value: lastGroup, label: 'Group by', prefix: 'By', options: GROUPS, onChange: (v) => { lastGroup = v; sfx('click'); draw(); } }),
        kit.segmented({ value: lastShow, label: 'Side', options: [{ value: 'both', label: 'Both' }, { value: 'mine', label: 'Mine' }, { value: 'enemy', label: 'Enemy' }], onChange: (v) => { lastShow = v; sfx('click'); draw(); } }),
      ),
      h('p.rstats-hint.muted', null, metric.hint),
      h('div.rstats-tot', null,
        h('span.me', null, names[me] || 'You'), h('b.me', null, metric.fmt(metric.get(sideAcc(me)))),
        h('span.vs.muted', null, 'vs'),
        h('b.foe', null, metric.fmt(metric.get(sideAcc(opp)))), h('span.foe', null, names[opp] || 'Enemy'),
      ),
      rows.length
        ? h('ol.rstats-list', null, ...rows.map((r, i) => h('li', { class: r.acc.side === me ? 'me' : 'foe' },
          h('span.rk', null, String(i + 1)),
          h('div.nm', null, h('b', null, r.label), h('small', null, r.sub)),
          h('div.bar', null, h('i', { style: { width: `${Math.max(0, (100 * r.v) / max)}%` } })),
          h('b.v', null, metric.fmt(r.v)))))
        : h('p.muted', null, 'No units on this side.'),
    );
  };
  draw();
  const modal = openModal(`Round ${round} stats`, body);
  modal.el.classList.add('modal-wide');
}
