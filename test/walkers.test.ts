// Walkers walk like walkers: planted feet stay put on the ground while the body walks over them (the render rig's gait
// clock against the distance travelled, any direction), and spider legs ('omni') sidestep across the line of fire
// while holding at range instead of standing still.
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
const { Battle } = await import('../src/shared/sim/battle.ts');
import type { Design, Placement } from '../src/shared/types.ts';
import type { Matrix4, Vector3 } from 'three';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

/** mean planted-foot ground speed over body speed (0 = feet stay put) walking `way` (rad, hull frame) */
function slip(d: Design, way: number): number {
  const rig = new UnitLayer().acquire(d, 0);
  const root = rig.tpl.unit.root;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), H = box.max.y - box.min.y, v = new THREE.Vector3();
  const feet = rig.tpl.animated.filter((k) => v.setFromMatrixPosition(rig.tpl.nodes[k]!.src.matrixWorld).y < H * 0.12);
  assert.ok(feet.length >= 2, `${d.id}: found its feet`);
  const objs = (rig as unknown as { objs: { matrixWorld: Matrix4 }[] }).objs;
  const tr = new Map<number, Vector3[]>();
  const dt = 1 / 60, step = 1.3 * dt;
  for (let f = 0; f < 480; f++) {
    rig.root.position.set(Math.cos(way) * step * f, 0, Math.sin(way) * step * f);
    rig.locomote(step, true, f * dt, dt, Math.cos(way) * step, Math.sin(way) * step, 0);
    rig.update(dt);
    if (f >= 60) for (const k of feet) { const l = tr.get(k) ?? []; l.push(new THREE.Vector3().setFromMatrixPosition(objs[k]!.matrixWorld)); tr.set(k, l); }
  }
  let sum = 0, n = 0;
  for (const l of tr.values()) {
    const lo = Math.min(...l.map((p) => p.y));
    for (let i = 1; i < l.length; i++) if (l[i]!.y < lo + H * 0.01 && l[i - 1]!.y < lo + H * 0.01) { sum += Math.hypot(l[i]!.x - l[i - 1]!.x, l[i]!.z - l[i - 1]!.z) / step; n++; }
  }
  assert.ok(n > 50, `${d.id}: feet touch the ground`);
  return sum / n;
}

test('planted feet stay put while the body walks over them (forward, sideways, backwards)', () => {
  for (const d of [D('biped', 'raider', 'legs', ['mg', 'mg']), D('spider', 'striker', 'spider', ['mortar', 'mortar']), D('jump', 'raider', 'jumpjets', ['mg', 'mg']), D('titan', 'titan', 'titanlegs', ['annihilator', null, null, null, null]), D('arachne', 'arachne', 'spider', ['annihilator', null, null, null])]) {
    for (const way of [0, Math.PI / 2, Math.PI]) {
      const s = slip(d, way);
      assert.ok(s < 0.2, `${d.id} walking ${way.toFixed(2)} rad: planted feet skate at ${s.toFixed(2)}x walking speed`);
    }
  }
});

test('spider legs sidestep across the line of fire while holding at range', () => {
  const designs = [D('spider', 'warden', 'spider', ['hmg', null]), D('wall', 'bastion', 'treads', ['plateH', 'plateM', 'flak'])];
  const pl = (designId: string, uid: number, extra: Partial<Placement> = {}): Placement => ({ uid, designId, x: 40, y: 0, level: 1, round: 1, ...extra });
  const b = new Battle({ seed: 3, sides: [{ designs, units: [pl('spider', 1)] }, { designs, units: [pl('wall', 2, { stance: 'holdPos' })] }] });
  let lo = Infinity, hi = -Infinity, fired = false;
  for (let i = 0; i < 1500 && !b.done; i++) {
    b.step();
    const s = b.units[0]!;
    if (s.mounts[0]!.target >= 0) { fired = true; lo = Math.min(lo, s.x); hi = Math.max(hi, s.x); }
  }
  assert.ok(fired, 'the spider got its gun on the wall');
  assert.ok(hi - lo > 1, `weaves ${(hi - lo).toFixed(2)} cells side to side while firing`);
});
