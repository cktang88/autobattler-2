import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, keyBlocked } from '../src/client/render/camera.ts';

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

// turned view (Camera.yaw): right-drag orbit in the 3D battle view
const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) < eps;

test('yaw: toScreen / fromScreen are inverse at any turn', () => {
  const c = mk();
  c.setTarget(48, 46, c.minK * 3, true);
  for (const yaw of [0.3, 1.7, -2.6, Math.PI]) {
    c.yaw = c.tyaw = yaw;
    for (const [sx, sy] of [[100, 120], [600, 400], [1100, 760]]) {
      const w = c.fromScreen(sx, sy), s = c.toScreen(w.x, w.y);
      assert.ok(near(s, { x: sx, y: sy }), JSON.stringify({ yaw, s, sx, sy }));
    }
  }
});

test('yaw: screen right / down are (cos, sin) / (-sin, cos) in visual cells', () => {
  const c = mk();
  c.setTarget(48, 46, c.minK * 3, true);
  c.yaw = c.tyaw = Math.PI / 2;
  const o = c.fromScreen(c.vw / 2, c.vh / 2), r = c.fromScreen(c.vw / 2 + 10, c.vh / 2), d = c.fromScreen(c.vw / 2, c.vh / 2 + 10);
  assert.ok(Math.abs(r.x - o.x) < 1e-9 && r.y > o.y, 'screen right = +visual y at 90 deg');
  assert.ok(Math.abs(d.y - o.y) < 1e-9 && d.x < o.x, 'screen down = -visual x at 90 deg');
});

test('yaw: zooming about a point and panning keep the grabbed ground under the pointer', () => {
  const c = mk();
  c.setTarget(48, 46, c.minK * 2, true);
  c.rotateBy(0.9);
  const sx = 850, sy = 260;
  const w = c.fromScreen(sx, sy);
  c.zoomAtInstant(1.8, sx, sy);
  assert.ok(near(c.fromScreen(sx, sy), w));
  // drag: the ground under the pointer follows it
  const g = c.fromScreen(500, 400);
  c.panByScreen(40, -25);
  assert.ok(near(c.fromScreen(540, 375), g));
  // eased wheel zoom holds its anchor through the animation
  const a = c.fromScreen(300, 600);
  c.zoomBy(1.6, 300, 600);
  for (let i = 0; i < 40; i++) { c.update(1 / 60); assert.ok(near(c.fromScreen(300, 600), a)); }
});

test('yaw: rotateBy turns about the view centre; fit and resetYaw go back to the classic view the short way', () => {
  const c = mk();
  c.setTarget(40, 50, c.minK * 3, true);
  const cx = c.cx, cy = c.cy;
  c.rotateBy(0.5);
  assert.equal(c.cx, cx); assert.equal(c.cy, cy);
  assert.ok(Math.abs(c.yaw - 0.5) < 1e-12 && c.tyaw === c.yaw);
  // wraps into -PI..PI and eases back across the wrap, never the long way round
  c.rotateBy(2.9); // 3.4 -> -2.88
  assert.ok(c.yaw < 0 && c.yaw > -Math.PI);
  c.resetYaw();
  let prev = c.yaw;
  for (let i = 0; i < 120; i++) { c.update(1 / 60); assert.ok(c.yaw >= prev - 1e-12); prev = c.yaw; }
  assert.ok(Math.abs(c.yaw) < 1e-3);
  c.rotateBy(1);
  c.fit(true);
  assert.equal(c.yaw, 0);
});

test('yaw: frameBox frames the box along the turned screen axes', () => {
  const c = mk();
  c.setTarget(48, 46, c.minK * 2, true);
  c.rotateBy(Math.PI / 2);
  c.frameBox(20, 40, 60, 46, 2, 4); // a wide box: on a quarter-turned screen it stands upright
  for (let i = 0; i < 200; i++) c.update(1 / 30);
  const pts = [[20 - 2, 40 - 2], [60 + 2, 40 - 2], [60 + 2, 46 + 2], [20 - 2, 46 + 2]].map(([x, y]) => c.toScreen(x, y));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  assert.ok(w <= c.vw + 1e-6 && h <= c.vh + 1e-6, JSON.stringify({ w, h }));
  assert.ok(Math.abs(h - c.vh) < 1 || Math.abs(w - c.vw) < 1, 'tight on one axis');
  assert.ok(h > w, 'the long side runs up the screen');
});

test('yaw: keyboard pan moves along the screen axes', () => {
  const c = mk();
  c.setTarget(48, 46, c.minK * 3, true);
  c.yaw = c.tyaw = Math.PI / 2;
  const x0 = c.cx, y0 = c.cy;
  c.keyX = 1;
  for (let i = 0; i < 10; i++) c.update(1 / 60);
  c.keyX = 0;
  for (let i = 0; i < 60; i++) c.update(1 / 60);
  assert.ok(Math.abs(c.cx - x0) < 1e-6 && c.cy > y0, JSON.stringify([c.cx - x0, c.cy - y0]));
});

test('camera keys are ignored while typing in a control or with a dropdown / modal open', () => {
  const none = () => false;
  const el = (tagName: string, role: string | null = null, editable = false) => ({ tagName, isContentEditable: editable, getAttribute: (n: string) => (n === 'role' ? role : null) });
  assert.equal(keyBlocked(null, none), false);
  assert.equal(keyBlocked(el('CANVAS'), none), false);
  assert.equal(keyBlocked(el('BODY'), none), false);
  for (const t of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(keyBlocked(el(t), none), true, t);
  assert.equal(keyBlocked(el('DIV', null, true), none), true, 'contenteditable');
  assert.equal(keyBlocked(el('BUTTON', 'combobox'), none), true, 'kit dropdown button (type-ahead)');
  assert.equal(keyBlocked(el('BODY'), (s) => s === '.k-pop'), true, 'open dropdown popup');
  assert.equal(keyBlocked(el('BODY'), (s) => s === '.modal-back'), true, 'modal');
});
