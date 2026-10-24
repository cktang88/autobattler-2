import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_YAW, OrbitCam, ZOOM_MAX, ZOOM_MIN, fitK, mountWorld, project, radiusPx, stageMode, stagePitch, type V3 } from '../src/client/render3d/stage-math.ts';
import { ELEV, ELEV_CLOSE, FOV } from '../src/client/render3d/view3d.ts';

const DEG = Math.PI / 180;

test('stage mode: 3D only when the renderer setting asks for it and WebGL works', () => {
  assert.equal(stageMode('3d', true), '3d');
  assert.equal(stageMode('2d', true), '2d');
  assert.equal(stageMode('3d', false), '2d');
  assert.equal(stageMode(undefined, true), '2d');
  assert.equal(stageMode('3d', true, true), '2d', 'a stage that failed to start falls back to 2D');
});

test('orbit camera: pitch stays in the battlefield range (43..60 deg) whatever the zoom and tilt', () => {
  const c = new OrbitCam();
  for (const z of [ZOOM_MIN, 0.8, 1, 1.75, 3, ZOOM_MAX]) {
    c.setZoom(z); c.settle();
    for (const dy of [-5000, -40, 0, 40, 5000]) {
      c.orbit(0, dy);
      const p = c.pitch();
      assert.ok(p >= ELEV_CLOSE - 1e-9 && p <= ELEV + 1e-9, `zoom ${z} tilt ${dy}: ${p / DEG}`);
    }
  }
  // the zoom alone: steep zoomed out, battle close-up pitch zoomed in, in between at the fit view
  assert.ok(Math.abs(stagePitch(ZOOM_MIN) - ELEV) < 1e-9);
  assert.ok(Math.abs(stagePitch(ZOOM_MAX) - ELEV_CLOSE) < 1e-9);
  assert.ok(stagePitch(1) < ELEV && stagePitch(1) > ELEV_CLOSE);
});

test('orbit camera: zoom clamps, eases to its targets and reset returns to the default view', () => {
  const c = new OrbitCam();
  c.zoomBy(100); assert.equal(c.tzoom, ZOOM_MAX);
  c.zoomBy(1e-4); assert.equal(c.tzoom, ZOOM_MIN);
  c.setZoom(2);
  c.orbit(300, 0);
  assert.ok(Math.abs(c.yaw - (DEFAULT_YAW + 300 * 0.004 - (DEFAULT_YAW + 1.2 > Math.PI ? 2 * Math.PI : 0))) < 1e-9, 'drag turns at the battle orbit speed');
  c.reset();
  let moving = true, n = 0;
  while (moving && n++ < 1000) moving = c.update(1 / 60);
  assert.ok(n < 1000, 'easing settles');
  assert.ok(Math.abs(c.yaw - DEFAULT_YAW) < 1e-3 && Math.abs(c.zoom - 1) < 1e-3 && c.tilt === 0 && c.px === 0 && c.pz === 0);
});

test('orbit camera: pan is limited and follows the drag direction', () => {
  const c = new OrbitCam();
  c.yaw = c.tyaw = 0; // camera at +z looking toward -z: screen right = +x
  c.panMax = 2;
  c.panBy(-c.k, 0); // drag left one cell -> the view moves right
  assert.ok(Math.abs(c.px - 1) < 1e-9 && Math.abs(c.pz) < 1e-9);
  c.panBy(-100 * c.k, 0);
  assert.equal(c.px, 2);
});

/** a three.js camera placed from an OrbitCam pose (what UnitStage3D does) */
function camFor(c: OrbitCam, w: number, h: number, target: V3): THREE.PerspectiveCamera {
  const pose = c.pose(h, target);
  const cam = new THREE.PerspectiveCamera(FOV, w / h, 0.3, 2000);
  cam.position.set(...pose.pos);
  cam.up.set(...pose.up);
  cam.lookAt(target[0] + c.px, target[1], target[2] + c.pz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

test('socket projection matches three.js and k px span one cell at the look-at point', () => {
  const W = 836, H = 611, target: V3 = [0, 0.6, 0];
  const c = new OrbitCam();
  c.fitK = c.tfitK = fitK(W, H, 3.4);
  for (const yaw of [0, 1, -2.4, 3]) for (const z of [0.6, 1, 2.5]) {
    c.yaw = c.tyaw = yaw; c.zoom = c.tzoom = z;
    const cam = camFor(c, W, H, target);
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    for (const p of [[0.3, 0.8, -0.4], [-1.2, 0.2, 0.9], [0, 2, 0]] as V3[]) {
      const ours = project(vp, p, W, H);
      const v = new THREE.Vector3(...p).project(cam);
      assert.ok(Math.abs(ours.x - (v.x + 1) * 0.5 * W) < 1e-6 && Math.abs(ours.y - (1 - v.y) * 0.5 * H) < 1e-6);
      // clip w = view depth
      const depth = -new THREE.Vector3(...p).applyMatrix4(cam.matrixWorldInverse).z;
      assert.ok(Math.abs(ours.w - depth) < 1e-6);
    }
    // the look-at point lands mid-screen; one cell across the view there is k px
    const t = project(vp, target, W, H);
    assert.ok(Math.abs(t.x - W / 2) < 1e-6 && Math.abs(t.y - H / 2) < 1e-6);
    const right: V3 = [target[0] + Math.cos(yaw), target[1], target[2] + Math.sin(yaw)];
    const r = project(vp, right, W, H);
    assert.ok(Math.abs(Math.hypot(r.x - t.x, r.y - t.y) - c.k) / c.k < 1e-6, `yaw ${yaw} zoom ${z}`);
    // and a ring of radius 1 there is ~k px
    assert.ok(Math.abs(radiusPx(1, t.w, H) - c.k) / c.k < 1e-6);
  }
});

test('mount points: hull-local offsets map like the battlefield rig (root.rotation.y = -angle, body scale)', () => {
  const root = new THREE.Group();
  for (const ang of [-Math.PI / 2, 0, 0.7, Math.PI]) {
    const bs = 0.78, pos: V3 = [3, 1.2, -2];
    root.position.set(...pos); root.rotation.set(0, -ang, 0); root.scale.setScalar(bs);
    root.updateMatrixWorld(true);
    for (const [x, y, h] of [[0.4, -0.3, 0.5], [-0.2, 0.25, 0.1]]) {
      const v = new THREE.Vector3(x, h, y).applyMatrix4(root.matrixWorld);
      const m = mountWorld(x, y, h, pos, ang, bs);
      assert.ok(Math.abs(m[0] - v.x) < 1e-9 && Math.abs(m[1] - v.y) < 1e-9 && Math.abs(m[2] - v.z) < 1e-9);
    }
  }
  // the side-0 facing puts the nose up-screen (-z) and the hull's right on +x
  const nose = mountWorld(1, 0, 0, [0, 0, 0], -Math.PI / 2, 1), right = mountWorld(0, 1, 0, [0, 0, 0], -Math.PI / 2, 1);
  assert.ok(Math.abs(nose[2] + 1) < 1e-9 && Math.abs(right[0] - 1) < 1e-9);
});
