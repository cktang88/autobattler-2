// Role check: does a weapon actually do the job it is built for, and is it priced right against the other
// weapons people would pick for that job? Each weapon goes on the same hull as its peers, then fights equal-supply
// matchups (intel.ts matchup: both sides of the field, several seeds) against the units it is meant to counter.
//   margin = (share of our army's supply still alive at the end) - (share of theirs), averaged over both sides of the
//   field and the seeds: +1 = won without a scratch, 0 = even trade, -1 = wiped out for nothing.
// A good result: the weapon beats its intended targets (score well above 0.5), and its mean over those targets sits
// with its peers (not far above = underpriced, not far below = overpriced or not doing its job).
// Run: node scripts/role-check.ts [seeds=4] [budget=700] [roles...]
import { Battle } from '../src/shared/sim/battle.ts';
import { blockDims, DEPLOY_D, DEPLOY_W, rectsOverlap } from '../src/shared/grid.ts';
import { computeStats, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const seeds = Number(process.argv[2] ?? 4), budget0 = Number(process.argv[3] ?? 700);
const only = process.argv.slice(4);
const S = (id: string) => STARTER_DESIGNS.find((d) => d.id === `starter-${id}`)!;
const mk = (mounts: (string | null)[], chassis = 'warden', mobility = 'halftrack'): Design => ({ id: mounts.filter(Boolean).join('+'), name: mounts.filter(Boolean).join('+'), chassis, mobility, mounts });
const one = (w: string) => mk([w, null]);

interface Role { key: string; job: string; weapon: Design; peers: Design[]; targets: Design[]; off?: Design[] }
export const ROLES: Role[] = [
  { key: 'laser', job: 'fast movers and aircraft', weapon: one('laser'), peers: [one('mg'), one('hmg'), one('ac40'), one('guidedrocket')], targets: [S('strafer'), S('hornet'), S('buzzsaw')], off: [S('ironclad'), S('ripper')] },
  { key: 'twinlaser', job: 'single armoured targets (focus)', weapon: one('twinlaser'), peers: [one('cannon75'), one('autocannon'), one('atgm'), one('heatray')], targets: [S('ironclad'), S('bulwark'), S('aegiswall')], off: [S('buzzsaw'), S('hornet')] },
  { key: 'heatray', job: 'armour at knife range', weapon: one('heatray'), peers: [one('cannon75'), one('twinlaser'), one('atgm')], targets: [S('ironclad'), S('bulwark'), S('ripper')], off: [S('thunderhead'), S('hornet')] },
  { key: 'plasma', job: 'squads and columns (piercing lance)', weapon: one('plasma'), peers: [one('flechette'), one('minigun'), one('autocannon')], targets: [S('ripper'), S('torchbug'), S('hunter')], off: [S('ironclad')] },
  { key: 'plasmaorb', job: 'packed light squads (splash)', weapon: one('plasmaorb'), peers: [one('grenade'), one('rockets'), one('flechette')], targets: [S('buzzsaw'), S('torchbug'), S('ripper')], off: [S('ironclad'), S('strafer')] },
  { key: 'leech', job: 'sustained brawling vs mediums', weapon: one('leech'), peers: [one('autocannon'), one('minigun'), one('heatray')], targets: [S('bulwark'), S('stormcaller'), S('medic')], off: [S('buzzsaw'), S('thunderhead')] },
  { key: 'prism', job: 'swarms and drone clouds', weapon: one('prism'), peers: [one('minigun'), one('tesla'), one('flechette'), one('mg')], targets: [S('buzzsaw'), S('hornet'), S('torchbug')], off: [S('ironclad'), S('bulwark')] },
  { key: 'voidlance', job: 'giants and titans', weapon: one('voidlance'), peers: [one('cannon'), one('twinlaser'), one('railgun'), one('atgm')], targets: [S('juggernaut'), S('warlord'), S('behemoth')], off: [S('buzzsaw'), S('hornet')] },
  { key: 'entropy', job: 'stripping armour for the guns beside it', weapon: mk(['entropy', 'hmg']), peers: [mk(['autocannon', 'hmg']), mk(['cannon75', 'hmg']), mk(['heatray', 'hmg'])], targets: [S('ironclad'), S('bulwark'), S('aegiswall')], off: [S('buzzsaw')] },
];

function pack(list: Design[]): Placement[] {
  const out: Placement[] = []; const occ: { x: number; y: number; w: number; h: number }[] = []; let uid = 1;
  for (const d of list) {
    const { w, h } = blockDims(computeStats(d), 1);
    let placed = false;
    for (let y = 0; y + h <= DEPLOY_D && !placed; y++) for (let x = 0; x + w <= DEPLOY_W && !placed; x++) {
      if (occ.some((o) => rectsOverlap(x, y, w, h, o.x, o.y, o.w, o.h))) continue;
      occ.push({ x, y, w, h }); out.push({ uid: uid++, designId: d.id, x, y, level: 1, round: 1, spacing: 1 }); placed = true;
    }
  }
  return out;
}
/** blocks of `d` spending as close to `budget` as whole blocks allow (at least one) */
const buy = (d: Design, budget: number) => Array.from({ length: Math.max(1, Math.round(budget / computeStats(d).cost)) }, () => d);

/** remaining-value margin of `d` vs `t`, equal supply (the exact spend of whichever side buys more) */
function score(d: Design, t: Design): number {
  const budget = Math.max(budget0, computeStats(t).cost);
  const a = { ...d, id: 'role-a' }, b = { ...t, id: 'role-b' };
  let A = buy(a, budget), B = buy(b, budget);
  const ca = computeStats(a).cost * A.length, cb = computeStats(b).cost * B.length;
  // even out the spend: top up the cheaper side with whole blocks while that gets closer
  if (ca < cb) A = buy(a, cb); else if (cb < ca) B = buy(b, ca);
  const spend = [computeStats(a).cost * A.length, computeStats(b).cost * B.length];
  let m = 0, n = 0;
  for (let k = 0; k < seeds; k++) for (const side of [0, 1] as const) {
    const mine = { designs: [a], units: pack(A) }, theirs = { designs: [b], units: pack(B) };
    const bt = new Battle({ seed: 1 + k * 7 + side, sides: side === 0 ? [mine, theirs] : [theirs, mine] });
    while (!bt.done) bt.step();
    const left = [0, 0];
    for (const u of bt.units) if (u.alive) left[u.side === side ? 0 : 1] += (u.hp / u.maxHp) * u.stats.unitCost;
    m += left[0] / spend[0] - left[1] / spend[1]; n++;
  }
  return m / n;
}

for (const r of ROLES) {
  if (only.length && !only.includes(r.key)) continue;
  console.log(`\n== ${r.key}: ${r.job}`);
  console.log(`${''.padEnd(26)}${r.targets.map((t) => t.name.slice(0, 11).padStart(12)).join('')}   mean`);
  const rows: { d: Design; mean: number }[] = [];
  for (const d of [r.weapon, ...r.peers]) {
    if (validateDesign(d).length) { console.log(`${d.name.padEnd(26)}INVALID ${validateDesign(d).join('; ')}`); continue; }
    const sc = r.targets.map((t) => score(d, t));
    const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
    rows.push({ d, mean });
    const st = computeStats(d);
    console.log(`${(d === r.weapon ? '* ' : '  ') + `${d.name} ${st.cost}x${st.squad}`.padEnd(24)}${sc.map((v) => (v >= 0 ? '+' : '') + v.toFixed(2)).map((x) => x.padStart(12)).join('')}   ${mean.toFixed(2)}`);
  }
  const peers = rows.filter((x) => x.d !== r.weapon);
  const pm = peers.reduce((a, b) => a + b.mean, 0) / Math.max(1, peers.length);
  const w = rows.find((x) => x.d === r.weapon);
  if (w) console.log(`  -> ${r.key} ${w.mean.toFixed(2)} vs peer mean ${pm.toFixed(2)} (best peer ${Math.max(...peers.map((p) => p.mean)).toFixed(2)})`);
  // off-role: what it is NOT for should go badly (a specialist, not a do-everything gun)
  if (w && r.off?.length) console.log(`  off-role: ${r.off.map((t) => `${t.name} ${(score(r.weapon, t) >= 0 ? '+' : '') + score(r.weapon, t).toFixed(2)}`).join('  ')}`);
}
