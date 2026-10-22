import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { MODULE_BY_ID } from '../src/shared/parts.ts';
import { computeStats, weaponDps } from '../src/shared/stats.ts';
import { designInfo, fireMods, mountDps, unitDps } from '../src/client/ui/deckstats.ts';
import type { Design } from '../src/shared/types.ts';

const starter = (name: string): Design => STARTER_DESIGNS.find((d) => d.name === name)!;

test('mountDps matches weaponDps on a plain design and follows the sim for fire-rate / reload utilities', () => {
  const plain = fireMods({ ...starter('Commander'), mounts: [null, 'twin30', 'hmg'] });
  for (const id of ['twin30', 'hmg', 'ac20', 'mg']) {
    const m = MODULE_BY_ID.get(id)!;
    assert.ok(Math.abs(mountDps(m, plain) - weaponDps(m)) < 1e-9, id);
    assert.ok(Math.abs(mountDps(m, plain, 2) - weaponDps(m) * 1.3) < 1e-9, `${id} level 2`);
  }
  const base = unitDps({ ...starter('Commander'), mounts: [null, 'twin30', 'hmg'] });
  const oc = unitDps({ ...starter('Commander'), mounts: ['overclock', 'twin30', 'hmg'] });
  assert.ok(Math.abs(oc.ground - base.ground * 1.2) < 1e-9, 'overclock: cooldowns tick 20% faster');
  // autoloader shortens clip reloads only (ac20 has a magazine)
  const ac = MODULE_BY_ID.get('ac20')!;
  assert.ok(ac.magazine && ac.reload);
  assert.ok(mountDps(ac, { fireRate: 1, reloadMult: 0.6 }) > weaponDps(ac));
});

test('designInfo: squad totals are per-unit dps x squad; frontline is judged per unit', () => {
  const buzz = starter('Buzzsaw');
  const st = computeStats(buzz);
  assert.equal(st.squad, 16);
  const i = designInfo(buzz)!;
  assert.ok(Math.abs(i.gnd - unitDps(buzz).ground * 16) < 1e-9);
  // 16 paper scouts add up to 2240 hp but hold no line
  for (const n of ['Buzzsaw', 'Torchbug', 'Tank Hunter', 'Lancer', 'Hornet', 'Gnasher']) assert.ok(!designInfo(starter(n))!.caps.has('front'), n);
  for (const n of ['Bulwark', 'Ironclad', 'Aegis Wall', 'Gargantua']) assert.ok(designInfo(starter(n))!.caps.has('front'), n);
});
