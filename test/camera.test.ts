import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/client/render/camera.ts';

// zoom-dependent foreshortening (the 3D view lowers its pitch as you zoom in)
const mk = () => {
  const c = new Camera(96, 92);
  c.setAspect(Math.sin(Math.PI / 3));
  c.ayFn = (z) => Math.sin(Math.PI / 3 - Math.min(1, Math.log(Math.max(1, z)) / Math.log(3.5)) * (17 * Math.PI) / 180);
  c.setViewport(1200, 800);
  c.fit(true);
  return c;
};

test('ayFn: fit view uses the base aspect', () => {
  const c = mk();
  assert.ok(Math.abs(c.ayAt(c.minK) - c.ay) < 1e-9);
});

test('ayFn: zooming about a point keeps that world point under the cursor', () => {
  const c = mk();
  const sx = 900, sy = 200;
  const before = c.fromScreen(sx, sy);
  c.zoomAtInstant(3, sx, sy);
  const after = c.fromScreen(sx, sy);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-6, JSON.stringify([before, after]));
  // eased zoom: the anchor holds through the animation
  // (start zoomed in, mid-field: at the fit view the edge clamp moves the view as it zooms)
  const c2 = mk();
  c2.setTarget(48, 46, c2.minK * 1.6, true);
  const w = c2.fromScreen(700, 450);
  c2.zoomBy(2, 700, 450);
  for (let i = 0; i < 60; i++) {
    c2.update(1 / 60);
    const p = c2.fromScreen(700, 450);
    assert.ok(Math.hypot(p.x - w.x, p.y - w.y) < 1e-6);
  }
});

test('ayFn: frameBox fits the box height at the zoom it lands on', () => {
  const c = mk();
  c.frameBox(30, 30, 50, 40, 2, 4);
  for (let i = 0; i < 200; i++) c.update(1 / 30);
  const top = c.toScreen(40, 30 - 2), bot = c.toScreen(40, 40 + 2);
  const left = c.toScreen(30 - 2, 35), right = c.toScreen(50 + 2, 35);
  const fitsH = bot.y - top.y <= c.vh + 1e-6, fitsW = right.x - left.x <= c.vw + 1e-6;
  assert.ok(fitsH && fitsW);
  assert.ok(Math.abs(bot.y - top.y - c.vh) < 1 || Math.abs(right.x - left.x - c.vw) < 1);
});
