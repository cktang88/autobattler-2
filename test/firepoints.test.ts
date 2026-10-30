// The battle sim fires each weapon from where the 3D model draws it: shared/mountgeo.ts fireOffsets (the sim's firing
// points) against the rest-pose trunnion (pitch pivot) of the built 3D turret, top view, for every starter design and
// a few deterministic fits of every ground chassis x mobility. Torso hulls read TORSO_SEATS (regenerate it with
// scripts/3d/torso-seats.ts when a torso builder's hardpoints move); every other hull shares drawnSeats with the render.
//   node test/firepoints.test.ts          (scripts/3d/mount-drift.ts prints the per-weapon table)

import { test } from 'node:test';
import assert from 'node:assert/strict';

const ctx2d: unknown = new Proxy({}, {
  get(_t, k) {
    if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set() { return true; },
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };

const THREE = await import('three');
const { buildUnit } = await import('../src/client/proto3d/units3d.ts');
const { fireOffsets, drawnSeats } = await import('../src/shared/mountgeo.ts');
const { CHASSIS, MODULES, MODULE_BY_ID } = await import('../src/shared/parts.ts');
const { STARTER_DESIGNS } = await import('../src/shared/starters.ts');
import type { Design, MountClass } from '../src/shared/types.ts';

/** cells a weapon's sim firing point may sit from its drawn trunnion (torso seats are medians over many fits) */
const MAX = 1.0;
const RK: Record<MountClass, number> = { S: 1, M: 2, L: 3, XL: 4 };

function designs(): Design[] {
  const out: Design[] = [...STARTER_DESIGNS];
  const weapons = MODULES.filter((m) => m.kind === 'weapon');
  for (const c of CHASSIS) {
    for (const mob of c.mobility ?? ['wheels']) for (let s = 0; s < 3; s++) {
      out.push({ id: `${c.id}-${mob}-${s}`, name: '', chassis: c.id, mobility: mob, mounts: c.mounts.map((cls, i) => {
        const fit = MODULES.filter((m) => RK[m.mount] <= RK[cls]), wf = weapons.filter((m) => RK[m.mount] <= RK[cls]);
        const r = (i * 7 + s * 13 + s * s * 3) % 11;
        return r === 10 ? null : r < 7 ? wf[(i * 5 + s * 17) % wf.length]!.id : fit[(i * 7 + s * 13) % fit.length]!.id;
      }) });
    }
  }
  return out;
}

test('weapons fire from where the 3D model draws them', () => {
  const v = new THREE.Vector3(), bad: string[] = [];
  let n = 0;
  for (const d of designs()) {
    if (drawnSeats(d).flying) continue;
    const u = buildUnit(d, 0);
    u.root.updateMatrixWorld(true);
    const offs = fireOffsets(d);
    let k = 0;
    d.mounts.forEach((id, i) => {
      if (!id || !offs[i]) return;
      const t = u.turrets[k++];
      if (!t || MODULE_BY_ID.get(id)?.kind !== 'weapon') return;
      v.setFromMatrixPosition(t.pitch.matrixWorld);
      const dist = Math.hypot(v.x - offs[i]!.x, v.z - offs[i]!.y);
      n++;
      if (dist > MAX) bad.push(`${d.chassis}/${d.mobility} [${d.mounts.join(',')}] mount ${i} ${id}: ${dist.toFixed(2)} cells off`);
    });
  }
  assert.ok(n > 300, `checked ${n} weapons`);
  assert.deepEqual(bad, []);
});
