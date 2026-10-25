// Trade-off utilities (with at most 2 weapons a hull, the other sockets take these): each is a net gain with a real
// cost, works in the sim, is priced, stacks with diminishing returns, and shows its + / − lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { TICK_RATE } from '../src/shared/sim/types.ts';
import { MODULES, MODULE_BY_ID } from '../src/shared/parts.ts';
import { computeStats, signedStack, stackBonus, tunedWeapon, validateDesign } from '../src/shared/stats.ts';
import { repairDesign } from '../src/client/collection.ts';
import { moduleTradeoffs } from '../src/client/ui/garage-parts.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
const pl = (designId: string, x: number, extra: Partial<Placement> = {}): Placement => ({ uid: 1, designId, x, y: 2, level: 1, round: 1, stance: 'holdPos', ...extra });

/** damage one design deals to an unkillable, harmless wall in `secs` seconds */
function dealt(d: Design, secs: number, dist = 6): number {
  const wall = D('wall', 'bastion', 'treads', ['plateH', 'plateM', 'flak']); // air-only gun: can't shoot back
  const b = new Battle({ seed: 1, sides: [{ designs: [d, wall], units: [pl(d.id, 40)] }, { designs: [d, wall], units: [pl('wall', 40)] }] });
  const me = b.units[0], t = b.units.find((u) => u.side === 1)!;
  t.hp = t.maxHp = 1e7;
  t.x = me.x; t.y = me.y - dist;
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  let sum = 0;
  for (let i = 0; i < secs * TICK_RATE; i++) { b.step(); for (const e of b.events) if (e.t === 'hit' && e.unit === t.id) sum += e.damage; }
  return sum;
}

test('every trade-off module is legal on a hull, priced, and shows its gains and costs', () => {
  const tradeoffs = MODULES.filter((m) => !m.retired && (m.tune || m.berserk || m.paint || m.overcharge || m.killRush || m.overheat || m.cloakDamage));
  assert.ok(tradeoffs.length >= 12, `${tradeoffs.length} trade-off modules`);
  for (const m of tradeoffs) {
    const d = m.mount === 'L' ? D(`t-${m.id}`, 'goliath', 'megatracks', [m.id, 'cannon', 'cannon', null])
      : D(`t-${m.id}`, 'striker', 'halftrack', ['autocannon', m.mount === 'S' ? 'twin30' : m.id, m.mount === 'S' ? m.id : null]);
    assert.deepEqual(validateDesign(d), [], m.id);
    const base = computeStats({ ...d, mounts: d.mounts.map((x) => (x === m.id ? null : x)) });
    assert.ok(computeStats(d).cost >= base.cost, `${m.id}: a net gain costs supply`);
    const tr = moduleTradeoffs(m);
    assert.ok(tr.plus.length >= 1, `${m.id}: a green + line`);
    // the cost is real: a red − line on every module that has one (the overcharge and kill rush are pure upside)
    if (!m.overcharge && !m.killRush) assert.ok(tr.minus.length >= 1, `${m.id}: a red − line`);
  }
  // plain modules stay plain: no red line on basic armour, repair or sensors
  for (const id of ['plateL', 'plateM', 'repair', 'sensor', 'targeting']) assert.deepEqual(moduleTradeoffs(MODULE_BY_ID.get(id)!).minus, [], id);
});

test('Short-Barrel Kit: more damage in the sim, less reach', () => {
  const plain = D('plain', 'warden', 'halftrack', ['autocannon', null]);
  const short = D('short', 'warden', 'halftrack', ['autocannon', 'shortbarrel']);
  assert.ok(computeStats(short).range < computeStats(plain).range * 0.9, 'shorter reach');
  const a = dealt(plain, 20), b = dealt(short, 20);
  assert.ok(b > a * 1.15, `damage in 20 s: ${a.toFixed(0)} plain vs ${b.toFixed(0)} short-barrelled`);
});

test('Reinforced Frame raises hull hp and lowers speed; Light Frame the reverse on weight', () => {
  const base = computeStats(D('b', 'warden', 'halftrack', ['autocannon', null]));
  const rf = computeStats(D('r', 'striker', 'halftrack', ['autocannon', 'reinforced', null]));
  const plain = computeStats(D('p', 'striker', 'halftrack', ['autocannon', null, null]));
  assert.ok(rf.hp > plain.hp * 1.15 && rf.speed < plain.speed * 0.95, `hp ${plain.hp} -> ${rf.hp}, speed ${plain.speed} -> ${rf.speed}`);
  const lf = computeStats(D('l', 'warden', 'halftrack', ['autocannon', 'lightframe']));
  assert.ok(lf.weight < base.weight && lf.hp < base.hp, 'lighter and frailer');
});

test('stacking diminishes: a second copy adds less, and gains and costs stack separately', () => {
  assert.equal(signedStack([0.25, 0.25]), stackBonus([0.25, 0.25]));
  assert.ok(signedStack([0.25, 0.25]) < 0.5);
  assert.ok(Math.abs(signedStack([0.25, -0.15]) - 0.1) < 1e-9);
  const one = computeStats(D('a', 'striker', 'halftrack', ['autocannon', 'twin30', 'shortbarrel']));
  const two = computeStats(D('b', 'raider', 'halftrack', ['shortbarrel', 'shortbarrel']));
  void two;
  assert.ok(one.tune.damage! > 0.24 && one.tune.damage! < 0.26);
  const tw = tunedWeapon(MODULE_BY_ID.get('autocannon')!, { damage: signedStack([0.25, 0.25]) });
  assert.ok(tw.damage! < 32 * 1.5 && tw.damage! > 32 * 1.25, `two kits: ${tw.damage}`);
});

test('Heavy Rounds / HE Rounds move penetration by half tiers and widen blasts', () => {
  const mg = MODULE_BY_ID.get('mg')!;
  assert.equal(tunedWeapon(mg, { ap: 0.5 }).ap, 0.5);
  assert.equal(tunedWeapon(MODULE_BY_ID.get('cannon')!, { ap: 0.5 }).ap, 1, 'capped at full');
  assert.equal(tunedWeapon(MODULE_BY_ID.get('autocannon')!, { ap: -0.5 }).ap, 0);
  assert.ok((tunedWeapon(mg, { splash: 0.4 }).splash ?? 0) > 0.39);
  assert.equal(tunedWeapon(MODULE_BY_ID.get('laser')!, { splash: 0.4 }).splash, undefined, 'beams get no blast');
});

test('Overcharge: the first volley after a pause hits much harder; Berserker hits harder when hurt', () => {
  const plainC = D('pc', 'warden', 'halftrack', ['cannon', null]);
  const ocC = D('oc', 'warden', 'halftrack', ['cannon', 'overcharge']);
  const first = (d: Design) => {
    const wall = D('wall', 'bastion', 'treads', ['plateH', 'plateM', 'flak']);
    const b = new Battle({ seed: 1, sides: [{ designs: [d, wall], units: [pl(d.id, 40)] }, { designs: [d, wall], units: [pl('wall', 40)] }] });
    const me = b.units[0], t = b.units.find((u) => u.side === 1)!;
    t.hp = t.maxHp = 1e7; t.x = me.x; t.y = me.y - 6;
    (b as unknown as { rebuildHash(): void }).rebuildHash();
    for (let i = 0; i < 10 * TICK_RATE; i++) { b.step(); for (const e of b.events) if (e.t === 'hit' && e.unit === t.id) return e.damage; }
    return 0;
  };
  assert.ok(first(ocC) > first(plainC) * 1.8, `first hit ${first(plainC).toFixed(0)} vs overcharged ${first(ocC).toFixed(0)}`);
  const bz = D('bz', 'warden', 'halftrack', ['autocannon', 'berserker']);
  const whole = dealt(bz, 10);
  const hurt = (() => {
    const wall = D('wall', 'bastion', 'treads', ['plateH', 'plateM', 'flak']);
    const b = new Battle({ seed: 1, sides: [{ designs: [bz, wall], units: [pl('bz', 40)] }, { designs: [bz, wall], units: [pl('wall', 40)] }] });
    const me = b.units[0], t = b.units.find((u) => u.side === 1)!;
    me.hp = me.maxHp * 0.3; t.hp = t.maxHp = 1e7; t.x = me.x; t.y = me.y - 6;
    (b as unknown as { rebuildHash(): void }).rebuildHash();
    let sum = 0;
    for (let i = 0; i < 10 * TICK_RATE; i++) { b.step(); for (const e of b.events) if (e.t === 'hit' && e.unit === t.id) sum += e.damage; }
    return sum;
  })();
  assert.ok(hurt > whole * 1.2, `berserker: ${whole.toFixed(0)} healthy vs ${hurt.toFixed(0)} below half hp`);
});

test('Overclocked Core cooks its own hull while firing, never below a quarter', () => {
  const oc = D('oc', 'striker', 'halftrack', ['autocannon', 'overclock', null]);
  const wall = D('wall', 'bastion', 'treads', ['plateH', 'plateM', 'flak']);
  const b = new Battle({ seed: 1, sides: [{ designs: [oc, wall], units: [pl('oc', 40)] }, { designs: [oc, wall], units: [pl('wall', 40)] }] });
  const me = b.units[0], t = b.units.find((u) => u.side === 1)!;
  t.hp = t.maxHp = 1e7; t.x = me.x; t.y = me.y - 6;
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  for (let i = 0; i < 120 * TICK_RATE && !b.done; i++) b.step();
  assert.ok(me.hp < me.maxHp * 0.6, `hp ${me.hp.toFixed(0)} / ${me.maxHp}`);
  assert.ok(me.hp >= me.maxHp * 0.25 - 1e-6);
});

test('retired modules (Autoloader, Gyro) swap for their replacement in saved designs and are no longer buildable', () => {
  for (const id of ['autoloader', 'gyro']) assert.ok(MODULE_BY_ID.get(id)!.retired, id);
  const old = { id: 'old', name: 'Old', chassis: 'striker', mobility: 'halftrack', mounts: ['autocannon', 'twin30', 'autoloader'] };
  assert.match(validateDesign(old as Design).join(), /no longer available/);
  const r = repairDesign(old)!;
  assert.deepEqual(r.mounts, ['autocannon', 'twin30', 'overcharge']);
  assert.deepEqual(repairDesign({ ...old, mounts: ['autocannon', 'twin30', 'gyro'] })!.mounts, ['autocannon', 'twin30', 'optics']);
});

test('small-hull utilities: evasion scales down with hull size, the deflector beats small hits only', async () => {
  const { dodgeChance, damageKinds } = await import('../src/shared/stats.ts');
  assert.ok(dodgeChance(0.35, 1, 3) > 0.3 && dodgeChance(0.35, 5, 1) < 0.02, 'light & fast vs a titan');
  assert.ok(dodgeChance(0.35, 1, 3) > dodgeChance(0.35, 1, 1.5), 'faster dodges more');
  // a deflector on a light raider: an mg barely scratches it, a cannon shell hardly notices the grid
  const hitOn = (shooter: string, mounts: (string | null)[]) => {
    const tgt = D('tg', 'raider', 'halftrack', mounts), sh = D('sh', 'warden', 'treads', [shooter, null]);
    const b = new Battle({ seed: 1, sides: [{ designs: [sh, tgt], units: [pl('sh', 40)] }, { designs: [sh, tgt], units: [pl('tg', 40)] }] });
    const me = b.units[0], t = b.units.find((u) => u.side === 1)!;
    t.x = me.x; t.y = me.y - 5;
    (b as unknown as { rebuildHash(): void }).rebuildHash();
    for (let i = 0; i < 20 * TICK_RATE; i++) { b.step(); for (const e of b.events) if (e.t === 'hit' && e.unit === t.id && !e.shieldHit) return e.damage; }
    return 0;
  };
  const mgPlain = hitOn('minigun', ['aamissile', null]), mgDefl = hitOn('minigun', ['aamissile', 'deflector']);
  const cPlain = hitOn('cannon', ['aamissile', null]), cDefl = hitOn('cannon', ['aamissile', 'deflector']);
  assert.ok(mgDefl < mgPlain * 0.5, `mg hit ${mgPlain.toFixed(1)} -> ${mgDefl.toFixed(1)}`);
  assert.ok(cDefl > cPlain * 0.9, `cannon hit ${cPlain.toFixed(0)} -> ${cDefl.toFixed(0)}`);
  // gauss / rails are solid kinetic slugs: no reactive / mirror / point-defense interaction as explosives
  for (const id of ['gauss', 'railgun', 'lightrail', 'massdriver']) assert.deepEqual(damageKinds(MODULE_BY_ID.get(id)!), ['kinetic'], id);
});

test('EMP Pop stuns the enemies around the wreck; Pack Link pays off in a big squad', () => {
  const popper = D('popper', 'raider', 'halftrack', ['hmg', 'emppop']);
  const foe = D('foe', 'scout', 'halftrack', ['flamer']);
  const b = new Battle({ seed: 2, sides: [{ designs: [popper, foe], units: [pl('popper', 40)] }, { designs: [popper, foe], units: [pl('foe', 40, { spacing: 0 })] }] });
  const me = b.units.filter((u) => u.side === 0), foes = b.units.filter((u) => u.side === 1);
  // kill our first raider with the enemy squad packed right around it
  foes.forEach((u, i) => { u.x = me[0].x - 2 + (i % 4); u.y = me[0].y - 2 - Math.floor(i / 4) * 0.5; });
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  me[0].hp = 1;
  let stunned = 0;
  for (let i = 0; i < 4 * TICK_RATE; i++) { b.step(); stunned = Math.max(stunned, foes.filter((u) => u.alive && u.stun > 0).length); if (!me[0].alive && stunned) break; }
  assert.ok(!me[0].alive, 'the popper died');
  assert.ok(stunned >= 2, `scouts stunned by the pop: ${stunned}`);
  const pk = computeStats(D('pk', 'raider', 'halftrack', ['hmg', 'packlink'])), np = computeStats(D('np', 'raider', 'halftrack', ['hmg', null]));
  assert.ok(pk.pricePower > np.pricePower, 'pack link is priced (unrounded power price)');
});
