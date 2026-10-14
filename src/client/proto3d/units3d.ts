// Procedural 3D unit assembly from a Design: running gear -> hull lofts -> superstructure -> turrets at mountOffsets().
// Unit-local frame: +X = forward, +Y = up, +Z = right (sim +y). 1 unit = 1 cell (5 m).
// Static sub-geometry is merged per material, so a typical vehicle is ~10-25 draw calls plus its turrets.

import * as THREE from 'three';
import { CHASSIS_BY_ID, MODULE_BY_ID, MOBILITY_BY_ID } from '../../shared/parts.ts';
import { mountOffsets } from '../../shared/mountgeo.ts';
import type { Design } from '../../shared/types.ts';
import { atlasUV, makeKit, rng } from './materials.ts';
import { buildTurret, type Turret } from './weapons3d.ts';
import { Bld } from './geo.ts';
import { buildGear, type Leg } from './running3d.ts';
import { addBridge, addCasemate, buildHull, deckAt, giantDetails, greeble, type Mount } from './hulls3d.ts';
import { buildJet, buildRotor, type Air } from './air3d.ts';

export interface Unit3D {
  root: THREE.Group;
  design: Design;
  team: 0 | 1;
  turrets: Turret[];
  L: number; W: number; S: number;
  flying: boolean;
  /** per-frame idle/locomotion animation (t = seconds, moving 0..1) */
  animate(t: number, dt: number, moving: number): void;
  radius: number;
  /** static triangle count of this unit */
  tris: number;
}

let blobTex: THREE.Texture | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;
/** soft contact shadow under a ground unit (grounds the model, cheap AO stand-in) */
export function contactShadow(L: number, W: number): THREE.Mesh {
  if (!blobMat) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 14, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    blobTex = new THREE.CanvasTexture(c);
    blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat);
  m.scale.set(L * 1.2, 1, W * 1.2);
  m.position.y = 0.012;
  m.renderOrder = 0;
  return m;
}

const DECK_H = [0, 0.17, 0.25, 0.36, 0.5, 0.65];

export function buildUnit(design: Design, team: 0 | 1): Unit3D {
  const ch = CHASSIS_BY_ID.get(design.chassis)!;
  const mob = MOBILITY_BY_ID.get(design.mobility)!;
  const kit = makeKit(team);
  const S = ch.size;
  const W = ch.footprint?.[0] ?? S, L = ch.footprint?.[1] ?? S;
  const rnd = rng([...design.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const root = new THREE.Group();
  const body = new THREE.Group(); // hull + turrets (bobs); running gear lives in root
  root.add(body);
  const flying = (ch.domain ?? 'ground') !== 'ground' || mob.kind === 'air';
  const turrets: Turret[] = [];
  const updates: ((t: number, dt: number, mv: number) => void)[] = [];
  const offs = mountOffsets(design);
  const hb = new Bld();
  let tris = 0;
  let air: Air | null = null;
  let hull: ReturnType<typeof buildHull> | null = null;
  let baseY = 0;
  const legs: Leg[] = [];

  const mods = design.mounts.map((mid) => (mid ? MODULE_BY_ID.get(mid) ?? null : null));
  const tur = mods.map((mod) => (mod ? buildTurret(mod, S, kit, flying) : null));
  const mounts: Mount[] = offs.map((o, i) => ({ x: o.x, z: o.y, r: tur[i]?.r ?? 0.1 }));

  if (flying) {
    if (ch.domain === 'jet' || mob.id === 'jet') air = buildJet(hb, kit, L, W, S);
    else air = buildRotor(hb, kit, body, ch.id, L, W, S);
    updates.push((t) => air!.update(t));
  } else {
    const gear = buildGear(root, mob.id, L, W, S, kit, legs);
    baseY = gear.y0;
    if (gear.update) updates.push((t, _dt, mv) => gear.update!(t, mv));
    const Hd = DECK_H[Math.min(5, S)] * (S >= 4 ? 1 : 1);
    hull = buildHull(hb, kit, ch.shape, L, W, gear.y0, gear.yt, Hd, gear.wi, gear.tracked);
    if (S >= 2) {
      // superstructure on the best free stretch of deck
      const rcase = Math.min(S === 2 ? 0.16 * L : 0.12 * L, 0.5), hw = Math.min(W * (S === 2 ? 0.17 : 0.2), 0.22 * S);
      let best = 0, bx = 0;
      for (let k = 0; k < 24; k++) {
        const cx = -L * 0.42 + k * L * 0.026;
        if (S === 2 && cx > -L * 0.12) continue;
        const clear = Math.min(...mounts.map((m) => Math.max(Math.abs(m.x - cx) - rcase, Math.abs(m.z) - hw) - m.r * 0.95), 5);
        if (clear > best && deckAt(hull, cx - rcase, 0) > 0 && deckAt(hull, cx + rcase, 0) > 0) { best = clear; bx = cx; }
      }
      if (best > 0.02) {
        addCasemate(hb, kit, hull, bx, rcase, hw, Hd * (S >= 3 ? 0.75 : 0.55));
        mounts.push({ x: bx, z: 0, r: Math.max(rcase, hw) * 1.1 });
        if (S >= 4) addBridge(hb, kit, hull, bx - rcase * 0.1, S * 0.55);
      }
    }
  }

  // ---- turrets -------------------------------------------------------------------------------------
  const hullTop = hull?.top ?? 0.1;
  tur.forEach((tu, i) => {
    if (!tu) return;
    const o = offs[i];
    let y: number;
    if (flying) {
      y = air!.hpY(o.x, o.y);
      // pylon from the airframe to the weapon
      if (ch.domain === 'jet' || mob.id === 'jet') hb.box(kit.trim, 0.2 * tu.r + 0.1, Math.abs(y) + 0.05, 0.05, air!.hpX ? air!.hpX(o.x, o.y) : o.x, y / 2 + 0.02, o.y, 0.008);
    } else {
      y = deckAt(hull!, o.x, o.y);
      if (y < 0) y = hullTop;
      let lo = y, hi = y;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, d = deckAt(hull!, o.x + Math.cos(a) * tu.r * 0.85, o.y + Math.sin(a) * tu.r * 0.85);
        if (d >= 0) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
      }
      y = hi;
      if (y - lo > 0.02 || true) {
        // barbette: armoured base ring bridging any slope under the turret ring
        const r = tu.r;
        hb.lathe(kit.hull, [[0, lo - 0.01], [r * 1.22, lo - 0.01], [r * 1.22, y - 0.012], [r * 1.05, y + 0.005], [0, y + 0.005]], [o.x, 0, o.y], 'y', 20);
        if (S >= 3) hb.cylb(kit.trim, r * 1.1, 0.02, 0.004, [o.x, y, o.y], 'y', 20);
      }
    }
    tu.yaw.position.set(flying && air?.hpX ? air.hpX(o.x, o.y) : o.x, y, o.y);
    body.add(tu.yaw);
    turrets.push(tu);
    tris += tu.tris;
  });

  if (!flying && hull) {
    greeble(hb, kit, hull, S, rnd, mounts);
    if (S >= 4) giantDetails(hb, kit, hull, S, rnd, mounts);
    // lamps, team marks and numbering
    const p = hull.lofts[0].pts;
    const nose = p[p.length - 2], rear = p[0];
    for (const sg of [-1, 1]) {
      hb.box(kit.lamp, 0.03, 0.025 + 0.01 * S, 0.04 + 0.012 * S, nose.x + 0.02, nose.y3 - 0.01, sg * nose.wt * 0.7, 0.004);
      hb.box(kit.glow, 0.02, 0.02, 0.04 + 0.01 * S, rear.x - 0.012, rear.y3 * 0.78 + baseY * 0.2, sg * rear.wm * 0.8, 0.003);
    }
    const num = Math.floor(rnd() * 90) + 10;
    const dk = deckAt(hull, -L * 0.3, W * 0.2);
    const ds = 0.1 + 0.05 * S;
    if (dk > 0 && mounts.every((m) => Math.hypot(m.x + L * 0.3, m.z - W * 0.2) > m.r + ds * 0.8)) {
      hb.decal(ds * 0.7, ds * 0.9, -L * 0.3 - ds * 0.4, dk + 0.003, W * 0.2, atlasUV(4 + Math.floor(num / 10)), 0);
      hb.decal(ds * 0.7, ds * 0.9, -L * 0.3 + ds * 0.4, dk + 0.003, W * 0.2, atlasUV(4 + (num % 10)), 0);
    }
    const dk2 = deckAt(hull, L * 0.12, -W * 0.2);
    if (dk2 > 0 && S <= 3 && mounts.every((m) => Math.hypot(m.x - L * 0.12, m.z + W * 0.2) > m.r + ds * 0.7)) hb.decal(ds * 1.1, ds * 1.1, L * 0.12, dk2 + 0.003, -W * 0.2, atlasUV(1), 0);
    // mast + pennant on big hulls
    if (S >= 3) {
      const mx = -L * 0.38, mz = -W * 0.3, top = deckAt(hull, mx, mz);
      if (top > 0 && mounts.every((m) => Math.hypot(m.x - mx, m.z - mz) > m.r + 0.1)) {
        hb.strut(kit.steel, [mx, top, mz], [mx, top + 0.45 + 0.1 * S, mz], 0.012, 0.008, 5);
        hb.box(kit.accent, 0.01, 0.1 + 0.02 * S, 0.2 + 0.03 * S, mx - 0.02, top + 0.4 + 0.1 * S, mz + 0.1 + 0.015 * S, 0.002);
      }
    }
  }
  hb.mount(body, kit.decal);
  tris += hb.tris;

  const root3 = root;
  if (!flying) root3.add(contactShadow(L, W));

  return {
    root, design, team, turrets, L, W, S, flying, radius: Math.max(L, W) / 2, tris,
    animate(t, dt, moving) {
      for (const u of updates) u(t, dt, moving);
      if (!flying) body.position.y = Math.sin(t * 38 + L) * 0.0035 * (0.6 + moving) * Math.min(S, 3);
    },
  };
}
