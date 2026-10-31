// No floating turrets: every weapon / utility housing on every chassis x legal mobility must sit ON something.
// Builds each unit in node (canvas stubbed), then for each turret drops vertical columns from its base (centre + rings
// at 0.5 r and 0.9 r) through the non-turret geometry (hull, running gear, the generic barbette) and walks the surface
// crossings with a nesting depth (columnGap). A column holds the turret when it reaches a solid layer >= SOLID thick
// (or the ground) after at most max(0.04, 0.3 r) of air, or when hull passes through the housing's own column; a turret
// floats when no column holds it. Flyers may also hang a pod from above, so their columns are walked upward too.
// A negative control (a lifted / side-shifted turret) proves the check can fail.
//
//   node test/turretseat3d.test.ts                 -> runs as a test (all chassis + starter designs)
//   FLOAT_RANDOM=12 ...                             -> 12 extra seeded random fills per pairing (incl. melee / empties)
//   FLOAT_LOD=0.5 ...                               -> check the far-view low-detail build instead
//   FLOAT_ONLY=bastion,hunter FLOAT_V=1 node test/turretseat3d.test.ts   -> subset, print every turret

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHASSIS, MOBILITY, pairingError } from '../src/shared/parts.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import type { Design } from '../src/shared/types.ts';
import { inWorker } from './support/pool.ts';
import { checkDesign, fills, type Float } from './support/turretseat.ts';

/** chassis the check skips (rebuilt separately) */
const SKIP = new Set<string>();

const only = process.env.FLOAT_ONLY?.split(',');
test('every turret on every chassis x mobility sits on something (no floating turrets)', async () => {
  const designs: Design[] = [];
  for (const ch of CHASSIS) {
    if (only ? !only.includes(ch.id) : SKIP.has(ch.id)) continue;
    for (const mob of MOBILITY) {
      if (pairingError(ch.id, mob.id)) continue;
      for (const [f, mounts] of Object.entries(fills(ch, mob.id))) {
        designs.push({ id: `float-${ch.id}-${mob.id}-${f}`, name: f, chassis: ch.id, mobility: mob.id, mounts } as Design);
      }
    }
  }
  if (!only) for (const d of STARTER_DESIGNS) if (!SKIP.has(d.chassis)) designs.push(d);
  // ~100 independent builds: deal them out in small batches to worker threads (one per core)
  const batches = Array.from({ length: Math.ceil(designs.length / 4) }, (_, i) => designs.slice(i * 4, i * 4 + 4));
  const mod = new URL('./support/turretseat.ts', import.meta.url);
  const res = await Promise.all(batches.map((b) => inWorker<{ bad: Float[]; log: string[] }>(mod, 'checkDesigns', b)));
  for (const r of res) for (const l of r.log) console.log(l);
  const bad = res.flatMap((r) => r.bad);
  assert.equal(bad.length, 0, `floating turrets:\n${bad.map((b) => `  ${b.key} turret ${b.turret} (${b.mod}, r ${b.r}) at ${b.base.join(',')}: ${b.gap} cells of air under it`).join('\n')}`);
});

test('the support check catches a lifted or side-shifted turret (negative control)', () => {
  const d = { id: 'float-ctl', name: 'ctl', chassis: 'warden', mobility: 'treads', mounts: ['autocannon', 'mg'] } as Design;
  assert.equal(checkDesign(d).length, 0);
  assert.equal(checkDesign(d, (u) => { u.turrets[0].yaw.position.y += 0.35; }).length, 1, 'lifted turret');
  assert.equal(checkDesign(d, (u) => { u.turrets[0].yaw.position.z += u.W * 0.9; }).length, 1, 'turret beside the hull');
});
