import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitLightBounds, lightBasis, quantSize, type V3 } from '../src/client/render3d/shadow3d.ts';
import { CameraShake, SHAKE_MAX_PX } from '../src/client/render3d/shake3d.ts';

const EYE: V3 = [48 - 30 * 4, 40 * 4, 46 - 16 * 4], TGT: V3 = [48, 0, 46];
const dot = (a: number[], c: number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];

test('shadow fit: light basis matches three.js lookAt for the shadow camera', () => {
  const b = lightBasis(EYE, TGT);
  const cam = new THREE.OrthographicCamera();
  cam.position.set(...EYE);
  cam.lookAt(...TGT);
  cam.updateMatrixWorld();
  const p = new THREE.Vector3(10, 3, 70);
  const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
  const d = [p.x - EYE[0], p.y - EYE[1], p.z - EYE[2]];
  assert.ok(Math.abs(v.x - dot(d, b.x)) < 1e-9 && Math.abs(v.y - dot(d, b.y)) < 1e-9 && Math.abs(v.z - dot(d, b.z)) < 1e-9);
});

test('shadow fit: holds every point, snapped to the texel grid, size on quarter-octave steps', () => {
  const b = lightBasis(EYE, TGT);
  const pts = [20, 0, 30, 70, 0, 30, 80, 0, 80, 10, 0, 80, 20, 2.2, 30, 70, 2.2, 30, 80, 2.2, 80, 10, 2.2, 80];
  const f = fitLightBounds(pts, b, 2048);
  for (let i = 0; i < pts.length; i += 3) {
    const d = [pts[i] - EYE[0], pts[i + 1] - EYE[1], pts[i + 2] - EYE[2]];
    const lx = dot(d, b.x), ly = dot(d, b.y), lz = -dot(d, b.z);
    assert.ok(lx > f.left && lx < f.right && ly > f.bottom && ly < f.top && lz > f.near && lz < f.far);
  }
  assert.ok(Math.abs(f.left / f.texelX - Math.round(f.left / f.texelX)) < 1e-6);
  assert.ok(Math.abs(f.bottom / f.texelY - Math.round(f.bottom / f.texelY)) < 1e-6);
  assert.equal(quantSize(f.right - f.left), f.right - f.left);
  assert.ok(Math.abs((f.right - f.left) / 2048 - f.texelX) < 1e-12);
});

test('shadow fit: a small pan keeps the texel size and moves the box by whole texels (no shimmer)', () => {
  const b = lightBasis(EYE, TGT);
  const base = [30, 0, 40, 50, 0, 40, 52, 0, 55, 28, 0, 55];
  const a = fitLightBounds(base, b, 2048);
  for (const dx of [0.013, 0.21, 0.77]) {
    const moved = base.map((v, i) => (i % 3 === 0 ? v + dx : v));
    const m = fitLightBounds(moved, b, 2048);
    assert.equal(m.texelX, a.texelX);
    const shift = (m.left - a.left) / a.texelX;
    assert.ok(Math.abs(shift - Math.round(shift)) < 1e-6, String(shift));
  }
});

test('shake: none at the fit view, full from ~6x zoom; nearer and bigger booms shake more; settles to zero', () => {
  assert.equal(CameraShake.zoomWeight(1), 0);
  assert.equal(CameraShake.zoomWeight(8), 1);
  assert.ok(CameraShake.zoomWeight(2.5) > 0 && CameraShake.zoomWeight(2.5) < 1);
  assert.equal(CameraShake.distWeight(0, 10, 1), 1);
  assert.ok(CameraShake.distWeight(12, 10, 1) < CameraShake.distWeight(6, 10, 1));
  assert.equal(CameraShake.distWeight(40, 10, 1), 0);
  assert.ok(CameraShake.distWeight(14, 10, 5) > CameraShake.distWeight(14, 10, 0.5), 'big booms reach further');
  assert.ok(CameraShake.traumaOf(4) > CameraShake.traumaOf(1));
  const s = new CameraShake();
  s.setView(50, 50, 10, 1);
  s.add(50, 50, 3);
  assert.ok(s.trauma > 0);
  assert.equal(s.offset(0.3).sx, 0); // fit view: no shake at all
  s.setView(50, 50, 10, 6);
  const o2 = s.offset(0.3);
  assert.ok(Math.hypot(o2.sx, o2.sy) > 0);
  s.scale = 0;
  assert.equal(s.offset(0.3).sx, 0); // Screen shake setting off
  s.scale = 1;
  const t0 = s.trauma;
  s.update(0.1);
  assert.ok(s.trauma < t0);
  for (let i = 0; i < 100; i++) s.update(0.05);
  assert.equal(s.trauma, 0);
  // capped however many booms stack
  for (let i = 0; i < 50; i++) s.add(50, 50, 8);
  assert.ok(s.trauma <= 1);
  for (const t of [0.1, 1.234, 7.7]) {
    const o = s.offset(t);
    assert.ok(Math.abs(o.sx) <= SHAKE_MAX_PX + 1e-9 && Math.abs(o.sy) <= SHAKE_MAX_PX + 1e-9);
  }
  // a far boom (well outside the view) does nothing; a delayed jolt lands later
  s.clear();
  s.add(150, 50, 2);
  assert.equal(s.trauma, 0);
  s.add(50, 50, 2, 0.5);
  assert.equal(s.trauma, 0);
  s.update(0.6);
  assert.ok(s.trauma > 0);
});
