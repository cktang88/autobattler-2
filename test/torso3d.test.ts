// Torso hulls keep their upper body: every starter design on a torso hull (shared/mountgeo.ts TORSO_HULLS) that carries
// a weapon must have a mounted torso (a userData.torso group with meshes) in its built unit. A merge once dropped the
// line that adds the torso to the hero's yaw group, so every mech / titan lost its chest and its guns floated.

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
const g = globalThis as { document?: unknown };
g.document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };

const { buildUnit } = await import('../src/client/proto3d/units3d.ts');
const { STARTER_DESIGNS } = await import('../src/shared/starters.ts');
const { TORSO_HULLS } = await import('../src/shared/mountgeo.ts');
const { MODULE_BY_ID, MOBILITY_BY_ID } = await import('../src/shared/parts.ts');

test('torso hulls build their upper body', () => {
  let n = 0;
  for (const d of STARTER_DESIGNS) {
    if (!TORSO_HULLS.has(d.chassis) || MOBILITY_BY_ID.get(d.mobility)?.kind === 'air') continue;
    if (!d.mounts.some((m) => m && MODULE_BY_ID.get(m)?.kind === 'weapon')) continue;
    const u = buildUnit(d, 0);
    let meshes = 0;
    u.root.traverse((o) => { if (o.userData.torso) o.traverse((c) => { if ((c as { isMesh?: boolean }).isMesh) meshes++; }); });
    assert.ok(meshes > 0, `${d.name} (${d.chassis}) has no torso`);
    n++;
  }
  assert.ok(n >= 3, `only ${n} torso starters checked`);
});
