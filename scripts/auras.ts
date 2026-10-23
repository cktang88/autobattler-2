// [aura balance] Support-radius harness: how much of an army an aura really covers on the 96 x 92 field, whether
// auras stack, and what they are worth at cost parity. Real sim, small scripted fights.
// Run: node scripts/auras.ts [cover|fights|field|all] [seeds=4]
//
//  cover:  allies of a block covered by one support carrier parked behind it (escorting it), at deploy and averaged
//          over the battle (sim state: rateAura / maxAuraShield / jammed), for squads at spacing 0/1/2, a line of
//          medium hulls and a titan.
//  fights: mirrored head-to-head fights, both sides swapped, several seeds x lateral offsets. A = the army with the
//          support piece, B = the comparison army. Columns: supply A / B, A wins / B wins / draws, net = mean of
//          (A hp% left - B hp% left), cov = mean share of A's other units inside A's aura.
//  field:  pricing check. A small army (2 light squads, or 6 medium tanks) + ONE support carrier fights equal-supply
//          armies of every starter; the same army with the carrier's supply spent on gun carriers instead is the
//          yardstick. win% (aura) ~ win% (guns) = the aura is priced right for its best use (one carrier, no overlap).
//          Mirror fights (above) exaggerate small edges into sure wins; the field is the fairer pricing check (it is
//          coarse: the sim barely varies with the seed, and 2 light squads already beat most of the field).

import { Battle } from '../src/shared/sim/battle.ts';
import { DEPLOY_D, FIELD_W, blockDims } from '../src/shared/grid.ts';
import { MODULE_BY_ID } from '../src/shared/parts.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { MODULE_CAL, computeStats, validateDesign } from '../src/shared/stats.ts';

// AURA_CAL='{"uplink":2}' tries calibrations without editing stats.ts; AURA_ONLY=substring runs only matching fights
if (process.env.AURA_CAL) Object.assign(MODULE_CAL, JSON.parse(process.env.AURA_CAL));
const ONLY = process.env.AURA_ONLY ?? '';
import type { Design, Placement } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

const DESIGNS: Design[] = [
  D('raid', 'raider', 'wheels', ['hmg', 'hmg']), // 16-squad
  D('raidH', 'raider', 'halftrack', ['hmg', 'hmg']),
  D('war', 'warden', 'halftrack', ['autocannon', 'hmg']), // medium line unit
  D('upW', 'warden', 'halftrack', ['uplink', 'hmg']), // uplink carrier
  D('domeW', 'warden', 'halftrack', ['dome', 'hmg']), // dome carrier
  D('jamW', 'warden', 'halftrack', ['jammer', 'hmg']), // jammer carrier
  D('plainW', 'warden', 'halftrack', [null, 'hmg']), // same hull, empty slot
  D('pdW', 'warden', 'halftrack', ['autocannon', 'pointdef']),
  D('acW', 'warden', 'halftrack', ['autocannon', null]), // pdW without the PD
  D('titanPD', 'titan', 'megatracks', ['doomsday', 'cannon', 'cannon', 'cannon', 'pointdef']),
  D('titanNo', 'titan', 'megatracks', ['doomsday', 'cannon', 'cannon', 'cannon', null]),
  D('upCart', 'carriage', 'wheels', ['uplink']), // 16 cheap uplink carts
  D('titan', 'titan', 'megatracks', ['doomsday', 'cannon', 'cannon', 'cannon', 'autocannon']),
  D('aegisT', 'titan', 'megatracks', ['aegisT', 'cannon', 'cannon', 'cannon', 'autocannon']),
  D('mlrs', 'longarm', 'spider', ['mlrs']),
  D('rockets', 'raider', 'wheels', ['rocketL', 'hmg']),
  D('atgm', 'raider', 'legs', ['atgm', 'atgm']),
  D('medic', 'aegis', 'halftrack', [null, 'hmg']), // repairAura chassis
  D('golDome', 'goliath', 'megatracks', ['domeG', 'cannon', 'cannon', 'autocannon']),
  D('golGun', 'goliath', 'megatracks', ['siege240', 'cannon', 'cannon', 'autocannon']),
  D('aegisGun', 'aegis', 'halftrack', ['autocannon', 'hmg']),
];
// gun carriers used to spend the same supply as a support carrier
const GUNS: Design[] = [
  D('g-w1', 'warden', 'halftrack', [null, 'hmg']), D('g-w2', 'warden', 'halftrack', ['autocannon', 'hmg']), D('g-w3', 'warden', 'halftrack', ['cannon75', 'hmg']),
  D('g-s1', 'striker', 'halftrack', ['autocannon', 'twin30', 'hmg']), D('g-s2', 'striker', 'halftrack', ['autocannon', 'autocannon', 'hmg']),
  D('g-b1', 'bastion', 'treads', ['cannon75', 'autocannon', 'autocannon']), D('g-h1', 'hunter', 'halftrack', ['autocannon', null]),
  D('g-c1', 'colossus', 'treads', ['cannon', 'autocannon', 'autocannon', 'hmg']),
];
const ALL = [...DESIGNS, ...GUNS, ...STARTER_DESIGNS];
for (const d of ALL) { const e = validateDesign(d); if (e.length) throw new Error(`${d.id}: ${e.join('; ')}`); }
const ST = new Map(ALL.map((d) => [d.id, computeStats(d)]));
const cost = (id: string) => ST.get(id)!.cost;

const mode = process.argv[2] ?? 'all';
const SEEDS = Number(process.argv[3] ?? 4);
const OFFSETS = [0, 10];
const pad = (s: string | number, n: number) => String(s).padStart(n);
const padR = (s: string | number, n: number) => String(s).padEnd(n);

interface Spec { id: string; cx: number; y: number; spacing?: number; escort?: number }
let uidSeq = 1;
function place(side: 0 | 1, specs: Spec[]): Placement[] {
  const uids = specs.map(() => uidSeq++);
  return specs.map((b, i) => {
    const s = ST.get(b.id)!;
    const { w, h } = blockDims(s, b.spacing ?? 0);
    let x = Math.round(side === 0 ? b.cx - w / 2 : FIELD_W - b.cx - w / 2);
    x = Math.max(0, Math.min(FIELD_W - w, x));
    const y = Math.max(0, Math.min(DEPLOY_D - h, b.y));
    return { uid: uids[i], designId: b.id, x, y, level: 1, round: 1, spacing: b.spacing, escort: b.escort != null ? uids[b.escort] : undefined };
  });
}
/** a block in front, support/extra pieces right behind it */
const depthOf = (id: string, spacing = 0) => blockDims(ST.get(id)!, spacing).h;

type Kind = 'uplink' | 'dome' | 'jammer';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const covered = (bt: any, j: number, k: Kind) => (k === 'uplink' ? bt.ints[j].rateAura > 0 : k === 'dome' ? bt.units[j].maxAuraShield > 0 : bt.ints[j].jammed);

/** share of side `side`'s non-carrier units inside the aura, at tick 1 and averaged while fighting */
function coverage(bt: Battle, side: number, carrier: string, k: Kind): number {
  let n = 0, c = 0;
  for (const u of bt.units) {
    if (u.side !== side || !u.alive || u.design.id === carrier) continue;
    n++;
    if (covered(bt, u.id, k)) c++;
  }
  return n ? c / n : NaN;
}

// ---------------------------------------------------------------------------------------------
function cover() {
  console.log('\n=== Coverage: one carrier escorting a block (share of the block inside the aura; deploy / mean over battle) ===');
  const rows: [string, string, number, Kind][] = [];
  for (const sp of [0, 1, 2]) {
    rows.push(['raid', 'upW', sp, 'uplink'], ['raid', 'domeW', sp, 'dome'], ['raid', 'jamW', sp, 'jammer']);
  }
  for (const [blk, car, sp, k] of rows) {
    let t0 = 0, avg = 0, runs = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const A = place(0, [{ id: blk, cx: FIELD_W / 2, y: 0, spacing: sp }, { id: car, cx: FIELD_W / 2, y: depthOf(blk, sp) + 1, escort: 0 }]);
      const B = place(1, [{ id: 'raid', cx: FIELD_W / 2, y: 0 }]);
      const bt = new Battle({ seed: s * 101, sides: [{ designs: ALL, units: A }, { designs: ALL, units: B }] });
      bt.step();
      t0 += coverage(bt, 0, car, k);
      let acc = 0, m = 0;
      while (!bt.done) {
        bt.step();
        if (bt.tick % 10 === 0) { const v = coverage(bt, 0, car, k); if (Number.isFinite(v)) { acc += v; m++; } }
      }
      avg += m ? acc / m : 0;
      runs++;
    }
    console.log(`${padR(`${blk} sp${sp}`, 12)}${padR(car + ' ' + k, 16)} deploy ${pad((100 * t0 / runs).toFixed(0), 3)}%  battle ${pad((100 * avg / runs).toFixed(0), 3)}%`);
  }
  // a line of 4 medium hulls with the carrier behind its middle, and a titan with the carrier behind it
  for (const [blkIds, car, k] of [[['war', 'war', 'war', 'war'], 'upW', 'uplink'], [['titan'], 'upW', 'uplink'], [['titan'], 'domeW', 'dome']] as [string[], string, Kind][]) {
    const specs: Spec[] = blkIds.map((id, i) => ({ id, cx: FIELD_W / 2 + (i - (blkIds.length - 1) / 2) * 4, y: 0 }));
    specs.push({ id: car, cx: FIELD_W / 2, y: depthOf(blkIds[0]) + 1, escort: 0 });
    const bt = new Battle({ seed: 7, sides: [{ designs: ALL, units: place(0, specs) }, { designs: ALL, units: place(1, [{ id: 'raid', cx: FIELD_W / 2, y: 0 }]) }] });
    bt.step();
    console.log(`${padR(blkIds.length > 1 ? `${blkIds.length}x${blkIds[0]}` : blkIds[0], 12)}${padR(car + ' ' + k, 16)} deploy ${pad((100 * coverage(bt, 0, car, k)).toFixed(0), 3)}%`);
  }
}

// ---------------------------------------------------------------------------------------------
interface Out { win: number; net: number; cov: number; hits: number; zaps: number }
function fight(seed: number, A: Spec[], B: Spec[], aSide: 0 | 1, carrier: string, k: Kind | null): Out {
  const pa = place(aSide, A), pb = place((1 - aSide) as 0 | 1, B);
  const sides = aSide === 0 ? [{ designs: ALL, units: pa }, { designs: ALL, units: pb }] : [{ designs: ALL, units: pb }, { designs: ALL, units: pa }];
  const bt = new Battle({ seed, sides: sides as never });
  let acc = 0, m = 0, hits = 0, zaps = 0;
  while (!bt.done) {
    bt.step();
    for (const e of bt.events) {
      if (e.t === 'hit' && bt.units[e.unit].side === aSide && MODULE_BY_ID.get(e.moduleId)?.projectile === 'rocket') hits++;
      else if (e.t === 'explode' && e.moduleId === 'pointdef') zaps++;
    }
    if (k && bt.tick % 10 === 0) { const v = coverage(bt, aSide, carrier, k); if (Number.isFinite(v)) { acc += v; m++; } }
  }
  const s = bt.summary();
  const hp = (sd: number) => { const us = bt.units.filter((u) => u.side === sd); return us.reduce((a, u) => a + (u.alive ? u.hp : 0), 0) / us.reduce((a, u) => a + u.maxHp, 0); };
  return { win: s.winner === aSide ? 1 : s.winner === -1 ? 0.5 : 0, net: hp(aSide) - hp(1 - aSide), cov: m ? acc / m : NaN, hits, zaps };
}
function matchup(label: string, A: Spec[], B: Spec[], carrier = '', k: Kind | null = null, pd = false) {
  if (ONLY && !label.includes(ONLY)) return;
  const sup = (S: Spec[]) => S.reduce((a, s) => a + cost(s.id), 0);
  const w = [0, 0, 0];
  let net = 0, cov = 0, n = 0, hits = 0, zaps = 0;
  for (let s = 1; s <= SEEDS; s++) for (const off of OFFSETS) for (const side of [0, 1] as const) {
    const sh = (S: Spec[]) => S.map((x) => ({ ...x, cx: x.cx + (side ? off : 0) }));
    const r = fight(s * 977 + off * 13 + side, sh(A), sh(B), side, carrier, k);
    w[r.win === 1 ? 0 : r.win === 0 ? 1 : 2]++;
    net += r.net; cov += Number.isFinite(r.cov) ? r.cov : 0; n++; hits += r.hits; zaps += r.zaps;
  }
  console.log(`${padR(label, 46)} supply ${pad(sup(A), 5)} /${pad(sup(B), 5)}   W ${pad(`${w[0]}/${w[1]}/${w[2]}`, 8)}  net ${pad(((100 * net) / n).toFixed(0), 4)}%${k ? `  cov ${pad(((100 * cov) / n).toFixed(0), 3)}%` : ''}${pd ? `  rocket hits taken ${pad((hits / n).toFixed(1), 5)}  zaps ${pad((zaps / n).toFixed(1), 5)}` : ''}`);
}
/** Gun carriers (GUNS, repeats allowed) that add up to about `gap` supply: greedy, most expensive that still fits. */
function fillers(gap: number): string[] {
  const out: string[] = [];
  const byCost = [...GUNS].sort((x, y) => cost(y.id) - cost(x.id));
  while (gap > 15 && out.length < 12) {
    const g = byCost.find((x) => cost(x.id) <= gap + 10);
    if (!g) break;
    out.push(g.id);
    gap -= cost(g.id);
  }
  return out;
}
const supply = (S: Spec[]) => S.reduce((a, s) => a + cost(s.id), 0);
/** B topped up with gun carriers (escorting B's first block, in a row behind it) to A's supply */
function topUp(A: Spec[], B: Spec[]): Spec[] {
  const f = fillers(supply(A) - supply(B));
  const y = depthOf(B[0].id, B[0].spacing ?? 0) + 4;
  return [...B, ...f.map((id, i) => ({ id, cx: B[0].cx + (i - (f.length - 1) / 2) * 4, y: y + Math.floor(i / 6) * 3, escort: 0 }))];
}

function fights() {
  console.log(`\n=== Fights (${SEEDS} seeds x offsets ${OFFSETS.join('/')} x both sides; B topped up with gun carriers to A's supply where noted) ===`);
  const C = FIELD_W / 2;
  const withCar = (blk: Spec[], cars: string[]): Spec[] => [...blk, ...cars.map((id, i) => ({ id, cx: C + (i - (cars.length - 1) / 2) * 4, y: depthOf(blk[0].id, blk[0].spacing ?? 0) + 1 + Math.floor(i / 4) * 3, escort: 0 }))];
  const raid: Spec[] = [{ id: 'raid', cx: C, y: 0, spacing: 1 }];
  const raid2: Spec[] = [{ id: 'raid', cx: C - 12, y: 0, spacing: 1 }, { id: 'raid', cx: C + 12, y: 0, spacing: 1 }];
  // exchange rate: what extra supply of guns is worth in this setup (net% per supply)
  for (const extra of [40, 80, 160]) matchup(`raid+${extra} guns vs raid (exchange rate)`, withCar(raid, fillers(extra)), raid);
  // one support carrier behind a block of 16 vs the same supply of guns
  for (const [car, k] of [['upW', 'uplink'], ['domeW', 'dome'], ['jamW', 'jammer'], ['medic', null]] as [string, Kind | null][]) {
    matchup(`raid+${car} vs raid+guns`, withCar(raid, [car]), topUp(withCar(raid, [car]), raid), car, k);
  }
  // jammer vs missiles
  matchup('2raid+jamW vs atgm squad', withCar(raid2, ['jamW']), [{ id: 'atgm', cx: C, y: 0, spacing: 1 }], 'jamW', 'jammer');
  matchup('2raid+guns vs atgm squad (control)', topUp(withCar(raid2, ['jamW']), raid2), [{ id: 'atgm', cx: C, y: 0, spacing: 1 }]);
  // stacking / abuse: a titan with N uplink carriers vs the same titan with ONE uplink + N-1 plain carriers
  // (identical hulls and guns; any gap is stacking or wider area), and vs the same supply of guns
  const titan: Spec[] = [{ id: 'titan', cx: C, y: 0 }];
  for (const n of [2, 4, 8]) {
    const A = withCar(titan, Array(n).fill('upW'));
    matchup(`titan+${n}xupW vs titan+1xupW+${n - 1}xplainW`, A, withCar(titan, ['upW', ...Array(n - 1).fill('plainW')]), 'upW', 'uplink');
    matchup(`titan+${n}xupW vs titan+guns`, A, topUp(A, titan), 'upW', 'uplink');
  }
  matchup('titan+1xupW vs titan+guns', withCar(titan, ['upW']), topUp(withCar(titan, ['upW']), titan), 'upW', 'uplink');
  {
    const A: Spec[] = [...titan, { id: 'upCart', cx: C, y: depthOf('titan') + 1, spacing: 0, escort: 0 }];
    matchup('titan+upCart(16 uplinks) vs titan+guns', A, topUp(A, titan), 'upCart', 'uplink');
  }
  // giant / titan domes over an army
  {
    const esc = raid2.map((r) => ({ ...r, escort: 0 })); // the squads escort the big dome carrier
    const A: Spec[] = [{ id: 'aegisT', cx: C, y: 6 }, ...esc];
    const B: Spec[] = [{ id: 'titan', cx: C, y: 6 }, ...esc];
    const [A2, B2] = supply(A) < supply(B) ? [topUp(B, A), B] : [A, topUp(A, B)];
    matchup('aegisT titan+2raid vs doomsday titan+2raid', A2, B2, 'aegisT', 'dome');
    const G: Spec[] = [{ id: 'golDome', cx: C, y: 6 }, ...esc], H: Spec[] = [{ id: 'golGun', cx: C, y: 6 }, ...esc];
    const [G2, H2] = supply(G) < supply(H) ? [topUp(H, G), H] : [G, topUp(G, H)];
    matchup('domeG giant+2raid vs gun giant+2raid', G2, H2, 'golDome', 'dome');
  }
  // point defense vs rocket salvos: 4 PD wardens (one PD covers its neighbours), and a titan
  const line = (id: string): Spec[] => [0, 1, 2, 3].map((i) => ({ id, cx: C + (i - 1.5) * 4, y: 0 }));
  matchup('pdW x4 vs rockets squad', line('pdW'), [{ id: 'rockets', cx: C, y: 0, spacing: 1 }], '', null, true);
  matchup('acW x4 vs rockets squad (no PD)', line('acW'), [{ id: 'rockets', cx: C, y: 0, spacing: 1 }], '', null, true);
  const mlrs: Spec[] = [0, 1, 2, 3].map((i) => ({ id: 'mlrs', cx: C + (i - 1.5) * 3, y: 0 }));
  matchup('titanPD vs 4 mlrs', [{ id: 'titanPD', cx: C, y: 0 }], mlrs, '', null, true);
  matchup('titanNo vs 4 mlrs (no PD)', [{ id: 'titanNo', cx: C, y: 0 }], mlrs, '', null, true);
}

// ---------------------------------------------------------------------------------------------
/** win rate of army A against equal-supply armies of each starter (blocks in rows across the front) */
function vsField(A: Spec[]): number {
  const S = supply(A);
  let score = 0, n = 0;
  for (const e of STARTER_DESIGNS) {
    const c = cost(e.id);
    if (c > 1.3 * S) continue;
    const k = Math.max(1, Math.round(S / c));
    const st = ST.get(e.id)!;
    const { w, h } = blockDims(st, 1);
    const perRow = Math.max(1, Math.min(k, Math.floor(80 / (w + 2))));
    const B: Spec[] = Array.from({ length: k }, (_, i) => {
      const r = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, k - r * perRow);
      return { id: e.id, cx: FIELD_W / 2 + (col - (inRow - 1) / 2) * (w + 2), y: r * (h + 1), spacing: 1 };
    });
    for (let sd = 1; sd <= Math.max(1, Math.round(SEEDS / 2)); sd++) for (const side of [0, 1] as const) {
      score += fight(sd * 31 + side, A, B, side, '', null).win;
      n++;
    }
  }
  return score / n;
}
function field() {
  console.log(`\n=== Field: small army + one support carrier vs equal-supply armies of every starter (win %), vs the same army with guns instead ===`);
  const C = FIELD_W / 2;
  const lights: Spec[] = [{ id: 'raid', cx: C - 12, y: 0, spacing: 1 }, { id: 'raid', cx: C + 12, y: 0, spacing: 1 }];
  const meds: Spec[] = [0, 1, 2, 3, 4, 5].map((i) => ({ id: 'war', cx: C + (i - 2.5) * 4, y: 0 }));
  for (const [name, blk] of [['2 raid squads', lights], ['6 medium tanks', meds]] as [string, Spec[]][]) {
    const y = depthOf(blk[0].id, blk[0].spacing ?? 0) + 1;
    for (const car of ['upW', 'domeW', 'jamW', 'medic']) {
      if (ONLY && !car.includes(ONLY)) continue;
      const A: Spec[] = [...blk, { id: car, cx: C, y, escort: 0 }];
      const G = topUp(A, blk);
      console.log(`${padR(name, 16)}${padR('+' + car, 8)} supply ${pad(supply(A), 5)}  aura ${pad((100 * vsField(A)).toFixed(0), 3)}%   guns (${pad(supply(G), 4)}) ${pad((100 * vsField(G)).toFixed(0), 3)}%`);
    }
  }
  // big domes: the dome hull (escorted by 2 light squads) vs the same hull class with a gun in that mount
  for (const [dome, gun] of [['golDome', 'golGun'], ['aegisT', 'titan']]) {
    if (ONLY && !dome.includes(ONLY)) continue;
    const esc = lights.map((r) => ({ ...r, escort: 0 }));
    const A: Spec[] = [{ id: dome, cx: C, y: 6 }, ...esc], B: Spec[] = [{ id: gun, cx: C, y: 6 }, ...esc];
    const [A2, B2] = supply(A) < supply(B) ? [topUp(B, A), B] : [A, topUp(A, B)];
    console.log(`${padR('2 raid squads', 16)}${padR('+' + dome, 8)} supply ${pad(supply(A2), 5)}  aura ${pad((100 * vsField(A2)).toFixed(0), 3)}%   ${gun} (${pad(supply(B2), 4)}) ${pad((100 * vsField(B2)).toFixed(0), 3)}%`);
  }
}

const t0 = performance.now();
console.log('costs: ' + ALL.map((d) => `${d.id} ${cost(d.id)}`).join(', '));
if (mode === 'cover' || mode === 'all') cover();
if (mode === 'fights' || mode === 'all') fights();
if (mode === 'field' || mode === 'all') field();
console.log(`\n(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
