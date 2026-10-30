// Fired ordnance leaves the launcher and shots start at their own gun: on the real render rig (units-adapter Rig),
// spent() hides a launcher's visible ammunition until it reloads, and every muzzle sits on its own turret (not at
// the unit centre), so FieldView3D can spawn each projectile at its own weapon.
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
const { UnitLayer } = await import('../src/client/render3d/units-adapter.ts');
import type { Design } from '../src/shared/types.ts';
import type { Mesh, Vector3 } from 'three';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

test('a fired launcher shows no ammunition until it reloads', () => {
  const layer = new UnitLayer();
  const rig = layer.acquire(D('nuke', 'lance', 'megatracks', ['tactnuke', null]), 0);
  const i = rig.turrets.findIndex((t) => t?.ammo);
  assert.ok(i >= 0, 'the launcher has visible ammunition');
  const ammo = rig.turrets[i]!.ammo!;
  const meshes: number[] = [];
  ammo.traverse((o) => { const j = rig.tpl.meshes.indexOf(o as Mesh); if (j >= 0) meshes.push(j); });
  assert.ok(meshes.length > 0);
  const size = () => { rig.update(0); const m = new THREE.Matrix4(); rig.meshMatrix(meshes[0]!, m); return new THREE.Vector3().setFromMatrixScale(m).length(); };
  const full = size();
  rig.spent(i, 2);
  assert.ok(size() < full * 0.01, 'hidden after firing');
  for (let t = 0; t < 30; t++) rig.update(0.1);
  assert.ok(size() > full * 0.99, 'back after the reload');
});

test('each muzzle sits on its own weapon, away from the unit centre', () => {
  const layer = new UnitLayer();
  const rig = layer.acquire(D('t', 'titan', 'megatracks', ['annihilator', 'siegeplasma', 'cannon', 'mlrs', null]), 0);
  rig.update(0);
  const m = new THREE.Vector3(), tp = new THREE.Vector3();
  rig.turrets.forEach((t, i) => {
    if (!t || !t.muzzles.length) return;
    rig.muzzleWorld(i, m); rig.turretWorld(i, tp);
    const dc = Math.hypot(m.x, m.z), dt = Math.hypot(m.x - tp.x, m.z - tp.z);
    assert.ok(dt < dc || dc > 0.5, `mount ${i}: muzzle ${dt.toFixed(2)} from its turret, ${dc.toFixed(2)} from the centre`);
  });
  const pts = rig.turrets.map((t, i) => (t?.muzzles.length ? rig.muzzleWorld(i, new THREE.Vector3())!.clone() : null)).filter(Boolean) as Vector3[];
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) assert.ok(pts[a]!.distanceTo(pts[b]!) > 0.3, 'weapons fire from different places');
});
