// Detailed round stats: after a battle, every unit's combat record (Battle.unitTally) as a ranked bar chart. One
// dropdown picks the statistic (damage dealt / taken, per supply, kills, value traded...), the other how it is grouped
// (each unit, each placed block, unit type, chassis, size, ground / air, or by weapon and weapon category); a third
// control shows my side, the enemy or both.

import { h } from '../app.ts';
import { sfx } from '../audio.ts';
import * as kit from './kit.ts';
import { openModal, sizeLabel } from './match-ui.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import { TICK_RATE } from '../../shared/sim/types.ts';
import { placementValue } from '../../shared/match.ts';
import { CATEGORIES, CHASSIS_BY_ID, MODULE_BY_ID } from '../../shared/parts.ts';
import type { Side } from '../../shared/types.ts';

type Metric =
  | 'dealt' | 'taken' | 'dealtPerCost' | 'takenPerCost' | 'dps' | 'dealtAir' | 'dealtGround' | 'kills' | 'valueKilled' | 'trade'
  | 'lost' | 'valueLost' | 'shield' | 'healed' | 'survival' | 'lifetime' | 'cost';
type Group = 'unit' | 'block' | 'design' | 'chassis' | 'size' | 'domain' | 'weapon' | 'weaponCat';
type Show = 'both' | 'mine' | 'enemy';

/** sums over a group of units; every metric is derived from these, so ratios are total / total, not an average */
interface Acc {
  side: Side; units: number; blocks: Set<number>; alive: number; cost: number;
  dealt: number; dealtAir: number; taken: number; shield: number; healed: number; kills: number; valueKilled: number; valueLost: number; lifeS: number;
}
const SUMS = ['units', 'alive', 'cost', 'dealt', 'dealtAir', 'taken', 'shield', 'healed', 'kills', 'valueKilled', 'valueLost', 'lifeS'] as const;
const newAcc = (side: Side): Acc => ({ side, units: 0, blocks: new Set(), alive: 0, cost: 0, dealt: 0, dealtAir: 0, taken: 0, shield: 0, healed: 0, kills: 0, valueKilled: 0, valueLost: 0, lifeS: 0 });

/** `weapon`: also meaningful when grouped by weapon (a unit's other stats can't be split between its weapons) */
const METRICS: { value: Metric; label: string; hint: string; fmt: (v: number) => string; get: (a: Acc) => number; weapon?: boolean }[] = [
  { value: 'dealt', label: 'Damage dealt', hint: 'To enemy hulls and shields', fmt: int, get: (a) => a.dealt, weapon: true },
  { value: 'taken', label: 'Damage taken', hint: 'Hull and shields, from any source', fmt: int, get: (a) => a.taken },
  { value: 'dealtPerCost', label: 'Damage dealt / cost', hint: 'Per 100 supply invested (purchase + upgrades)', fmt: dec, get: (a) => per100(a.dealt, a.cost) },
  { value: 'takenPerCost', label: 'Damage taken / cost', hint: 'Per 100 supply invested: how much it soaked for its price', fmt: dec, get: (a) => per100(a.taken, a.cost) },
  { value: 'dps', label: 'Damage per second', hint: 'Damage dealt per second each unit was alive', fmt: dec, get: (a) => (a.lifeS > 0 ? a.dealt / a.lifeS : 0) },
  { value: 'dealtAir', label: 'Damage to aircraft', hint: 'Damage dealt to flying enemies', fmt: int, get: (a) => a.dealtAir, weapon: true },
  { value: 'dealtGround', label: 'Damage to ground', hint: 'Damage dealt to ground units and emplacements', fmt: int, get: (a) => a.dealt - a.dealtAir, weapon: true },
  { value: 'kills', label: 'Kills', hint: 'Killing blows on enemy units (a squad unit counts as one)', fmt: int, get: (a) => a.kills, weapon: true },
  { value: 'valueKilled', label: 'Supply destroyed', hint: 'Supply value of the enemy units it finished off', fmt: int, get: (a) => a.valueKilled, weapon: true },
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
  { value: 'size', label: 'Size class', hint: 'Light, medium, heavy, giant, titan' },
  { value: 'domain', label: 'Ground / air', hint: 'Flying units against ground units and emplacements' },
  { value: 'weapon', label: 'Weapon', hint: 'Damage and kills by each weapon (burns count for the weapon that lit them)' },
  { value: 'weaponCat', label: 'Weapon category', hint: 'Damage and kills by weapon family: cannons, rail, missiles…' },
];
const WEAPON_GROUPS: Group[] = ['weapon', 'weaponCat'];
const CAT_NAME = new Map(CATEGORIES.map((c) => [c.id as string, c.name]));
/** a damage source's name and category: a weapon module, or the sim's pseudo-sources */
function sourceOf(id: string): { name: string; cat: string } {
  if (id === 'crush') return { name: 'Crush (run over)', cat: 'Crush' };
  const m = MODULE_BY_ID.get(id);
  return m ? { name: m.name, cat: CAT_NAME.get(m.category) ?? m.category } : { name: id, cat: 'Other' };
}

function int(v: number): string { return Math.round(v).toLocaleString(); }
function dec(v: number): string { return v.toFixed(1); }
function per100(v: number, cost: number): number { return cost > 0 ? (100 * v) / cost : 0; }

let lastMetric: Metric = 'dealt';
let lastGroup: Group = 'design';
let lastShow: Show = 'both';

/** Open the stats popup for a finished (or skipped-to-the-end) battle. `me` is the viewer's side. */
/** `title`: the modal's heading (default "Round N stats") */
export function openRoundStats(battle: Battle, round: number, me: Side, names: [string, string], title?: string): void {
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

  function weaponGroups(g: Group): { key: string; label: string; sub: string; acc: Acc }[] {
    const out = new Map<string, { key: string; label: string; sub: string; acc: Acc; kinds: Set<string> }>();
    for (const u of units) {
      const t = battle.unitTally(u.id);
      // every weapon it carries gets a row (even one that never hit), plus whatever else dealt damage (burns, crush)
      const ids = new Set<string>(Object.keys(t.byWeapon));
      for (const mid of u.design.mounts) if (mid && MODULE_BY_ID.get(mid)?.kind === 'weapon') ids.add(mid);
      for (const id of ids) {
        const src = sourceOf(id);
        const key = `${u.side}:${g === 'weapon' ? id : src.cat}`;
        let e = out.get(key);
        if (!e) { e = { key, label: g === 'weapon' ? src.name : src.cat, sub: '', acc: newAcc(u.side), kinds: new Set() }; out.set(key, e); }
        const a = e.acc, w = t.byWeapon[id];
        e.kinds.add(src.name);
        a.units++;
        a.blocks.add(u.uid);
        if (!w) continue;
        a.dealt += w.dealt;
        a.dealtAir += w.dealtAir;
        a.kills += w.kills.length;
        for (const v of w.kills) a.valueKilled += valueOf[v];
      }
    }
    for (const e of out.values()) {
      const a = e.acc;
      e.sub = [`on ${a.units} unit${a.units > 1 ? 's' : ''}`, g === 'weaponCat' ? [...e.kinds].join(', ') : '', a.kills ? `${a.kills} kill${a.kills > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    }
    return [...out.values()];
  }

  function groups(g: Group): { key: string; label: string; sub: string; acc: Acc }[] {
    if (WEAPON_GROUPS.includes(g)) return weaponGroups(g);
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
        : g === 'size' ? [`${u.side}:s${u.stats.size}`, sizeLabel(u.stats.size)]
        : g === 'domain' ? [`${u.side}:${u.stats.flying ? 'air' : 'gnd'}`, u.stats.flying ? 'Aircraft' : 'Ground']
        : [`${u.side}:c${u.design.chassis}`, chassis];
      let e = out.get(key);
      if (!e) {
        e = { key, label, sub: '', lv: new Set(), acc: newAcc(u.side) };
        out.set(key, e);
      }
      const a = e.acc;
      e.lv.add(u.level);
      a.units++;
      a.blocks.add(u.uid);
      if (u.alive) a.alive++; else a.valueLost += valueOf[u.id];
      a.cost += valueOf[u.id];
      a.dealt += t.dealt;
      a.dealtAir += t.dealtAir;
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
    const byWeapon = WEAPON_GROUPS.includes(lastGroup);
    if (byWeapon && !METRICS.find((x) => x.value === lastMetric)?.weapon) lastMetric = 'dealt';
    const metric = METRICS.find((x) => x.value === lastMetric) ?? METRICS[0];
    const all = groups(lastGroup);
    const rows = all
      .filter((r) => lastShow === 'both' || (lastShow === 'mine') === (r.acc.side === me))
      .map((r) => ({ ...r, v: metric.get(r.acc) }))
      .sort((a, b) => b.v - a.v || a.label.localeCompare(b.label));
    const max = Math.max(1e-9, ...rows.map((r) => r.v));
    // side totals of the metric, from each side's whole army
    const sideAcc = (s: Side): Acc => {
      const t = newAcc(s);
      for (const r of all) if (r.acc.side === s) for (const k of SUMS) t[k] += r.acc[k];
      return t;
    };
    const opp = (1 - me) as Side;
    body.replaceChildren(
      h('div.rstats-ctl', null,
        kit.select({ value: lastMetric, label: 'Statistic', prefix: 'Stat', options: METRICS.map(({ value, label, hint, weapon }) => ({ value, label, hint: byWeapon && !weapon ? 'Not split by weapon: group by unit to see it' : hint, disabled: byWeapon && !weapon })), onChange: (v) => { lastMetric = v; sfx('click'); draw(); } }),
        kit.select({ value: lastGroup, label: 'Group by', prefix: 'By', options: GROUPS, onChange: (v) => { lastGroup = v; sfx('click'); draw(); } }),
        kit.segmented({ value: lastShow, label: 'Side', options: [{ value: 'both', label: 'Both' }, { value: 'mine', label: 'Mine' }, { value: 'enemy', label: 'Enemy' }], onChange: (v) => { lastShow = v; sfx('click'); draw(); } }),
      ),
      h('p.rstats-hint.muted', null, metric.hint, byWeapon ? ' · by the weapon that dealt it' : ''),
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
  const modal = openModal(title ?? `Round ${round} stats`, body);
  modal.el.classList.add('modal-wide');
}
