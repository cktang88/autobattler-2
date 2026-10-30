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

/** largest per-frame jump of any foot (model units) over a scripted motion: (dx, dz, sim-moving) per frame */
function footJumps(d: Design, motion: (f: number) => [number, number, boolean], frames: number): number {
  const rig = new UnitLayer().acquire(d, 0);
  const root = rig.tpl.unit.root;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), H = box.max.y - box.min.y, v = new THREE.Vector3();
  const feet = rig.tpl.animated.filter((k) => v.setFromMatrixPosition(rig.tpl.nodes[k]!.src.matrixWorld).y < H * 0.12);
  const objs = (rig as unknown as { objs: { matrixWorld: Matrix4 }[] }).objs;
  const dt = 1 / 60, prev = new Map<number, Vector3>();
  let x = 0, z = 0, worst = 0;
  for (let f = 0; f < frames; f++) {
    const [dx, dz, mv] = motion(f);
    x += dx; z += dz;
    rig.root.position.set(x, 0, z);
    rig.locomote(Math.hypot(dx, dz), mv, f * dt, dt, dx, dz, 0);
    rig.update(dt);
    for (const k of feet) {
      const p = new THREE.Vector3().setFromMatrixPosition(objs[k]!.matrixWorld).sub(new THREE.Vector3(x, 0, z));
      const q = prev.get(k);
      if (q && f > 30) worst = Math.max(worst, p.distanceTo(q));
      prev.set(k, p);
    }
  }
  return worst;
}

test('legs do not twitch: jitter leaves the feet still, reversing does not whip them round', () => {
  const spider = D('spider', 'striker', 'spider', ['mortar', 'mortar']);
  // a standing unit nudged back and forth by a hair every frame (separation / interpolation noise)
  const jitter = footJumps(spider, (f) => [Math.sin(f * 2.3) * 0.002, Math.cos(f * 1.7) * 0.002, false], 240);
  assert.ok(jitter < 0.01, `feet twitch ${jitter.toFixed(3)} per frame on a jittering standing unit`);
  // walking sideways, reversing every 0.7 s (a spider's sidestep): no foot jumps much more than a walking step
  const step = 1.2 / 60;
  const rev = footJumps(spider, (f) => [0, (Math.floor(f / 42) % 2 ? -1 : 1) * step, true], 400);
  assert.ok(rev < step * 6, `a foot jumps ${rev.toFixed(3)} per frame when the walk reverses (step ${step.toFixed(3)})`);
});
