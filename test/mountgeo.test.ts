import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountOffsets } from '../src/shared/mountgeo.ts';
import { CHASSIS, MODULES } from '../src/shared/parts.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import type { Design, MountClass } from '../src/shared/types.ts';
// the unit art module has no DOM side effects at import (canvases are made lazily), so it runs under node
import { layoutOf } from '../src/client/render/unitart.ts';

const RANK: Record<MountClass, number> = { S: 1, M: 2, L: 3, XL: 4 };

function designs(): Design[] {
  const out: Design[] = [...STARTER_DESIGNS];
  for (const c of CHASSIS) {
    for (const mob of c.mobility ?? ['wheels']) {
      out.push({ id: `${c.id}-empty`, name: '', chassis: c.id, mobility: mob, mounts: c.mounts.map(() => null) });
      // deterministic module fills (exercise the hardpoint solver: weapons, utilities, plates, mixed classes)
      for (let s = 0; s < 6; s++) {
        out.push({
          id: `${c.id}-${s}`, name: '', chassis: c.id, mobility: mob,
          mounts: c.mounts.map((cls, i) => {
            const fit = MODULES.filter((m) => RANK[m.mount] <= RANK[cls]);
            return (i + s) % 5 === 4 ? null : fit[(i * 7 + s * 13) % fit.length].id;
          }),
        });
      }
      // identical weapons on every slot (mirrored pairs)
      const top = MODULES.find((m) => m.kind === 'weapon' && m.mount === 'S');
      if (top) out.push({ id: `${c.id}-pair`, name: '', chassis: c.id, mobility: mob, mounts: c.mounts.map(() => top.id) });
    }
  }
  return out;
}

test('mountOffsets matches the render layout (layoutOf) for every starter design and chassis', () => {
  let n = 0;
  for (const d of designs()) {
    const L = layoutOf(d);
    const off = mountOffsets(d);
    assert.equal(off.length, L.mounts.length, `${d.id}: mount count`);
    for (let i = 0; i < off.length; i++) {
      const tag = `${d.chassis}/${d.mobility} [${d.mounts.join(',')}] mount ${i}`;
      assert.ok(Math.abs(off[i].x - L.mounts[i].x) < 1e-9, `${tag}: x ${off[i].x} vs ${L.mounts[i].x}`);
      assert.ok(Math.abs(off[i].y - L.mounts[i].y) < 1e-9, `${tag}: y ${off[i].y} vs ${L.mounts[i].y}`);
      n++;
    }
  }
  assert.ok(n > 500);
});
