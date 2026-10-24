// Procedural 3D unit assembly from a Design: mobility stance -> chassis builder (chassis/registry.ts) -> running gear ->
// turrets at mountOffsets(). See chassis/registry.ts for the builder architecture and conventions.
// Unit-local frame: +X = forward, +Y = up, +Z = right (sim +y). 1 unit = 1 cell (5 m).
// Static sub-geometry is merged per material, so a typical vehicle is ~10-25 draw calls plus its turrets.

import * as THREE from 'three';
import { CHASSIS_BY_ID, MODULE_BY_ID, MOBILITY_BY_ID } from '../../shared/parts.ts';
import { mountOffsets } from '../../shared/mountgeo.ts';
import type { Design } from '../../shared/types.ts';
import { makeKit, rng } from './materials.ts';
import { AUTO_DRESS, autoDress } from './chassis/hs-kit.ts';
import { buildTurret, type Turret } from './weapons3d.ts';
import { CLASS_RANK, weaponD } from '../render/weaponsize.ts';
import { Bld } from './geo.ts';
import './chassis/index.ts';
import { chassisBuilder, mobilityBuilder, registered, type ChassisOut, type MobilityCtx, type MountSpec } from './chassis/registry.ts';
import { buildJet, buildRotor, type Air } from './air3d.ts';
import { applySkin, pickSkin } from './skins.ts';

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
  let air: Air | null = null;
  let out: ChassisOut | null = null;

  const mods = design.mounts.map((mid) => (mid ? MODULE_BY_ID.get(mid) ?? null : null));
  // a utility in a smaller hardpoint than its class is drawn at the slot's size (as the 2D art does)
  const slotCls = (mod: NonNullable<(typeof mods)[number]>, i: number) => { const sl = ch.mounts[i]; return sl && mod.kind !== 'weapon' && CLASS_RANK[mod.mount] > CLASS_RANK[sl] ? sl : undefined; };
  // the unit's main gun (biggest cannon / autocannon housing on a ground unit) gets a hull-proportioned barrel: real
  // tank guns run ~0.75 x hull length; walkers carry theirs on an arm or shoulder, so shorter
  const LEGGED = new Set(['legs', 'spider', 'jumpjets', 'titanlegs']);
  let main = -1;
  if (!flying) mods.forEach((m, i) => {
    if (!m || (m.visual !== 'cannon' && m.visual !== 'gun') || slotCls(m, i)) return;
    if (main < 0 || weaponD(m) > weaponD(mods[main]!)) main = i;
  });
  const mainL = L * (LEGGED.has(mob.id) ? 0.62 : 1);
  const tur = mods.map((mod, i) => (mod ? buildTurret(mod, S, kit, flying, slotCls(mod, i), i === main ? mainL : 0) : null));
  // calibre-true housings can outgrow tightly packed hardpoints (four M guns down a land-train spine, twin dorsal
  // mounts on a small pod): shrink both housings of an overlapping ground pair until their rings just clear (>= 72%)
  if (!flying) {
    const sc = tur.map(() => 1);
    for (let i = 0; i < tur.length; i++) for (let j = i + 1; j < tur.length; j++) {
      const a = tur[i], b = tur[j], pa = offs[i], pb = offs[j];
      if (!a || !b || !pa || !pb) continue;
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y), want = 0.95 * (a.r + b.r);
      if (d < want) { const k = Math.max(0.72, d / want); sc[i] = Math.min(sc[i], k); sc[j] = Math.min(sc[j], k); }
    }
    tur.forEach((tu, i) => { if (tu && sc[i] < 1) { tu.yaw.scale.setScalar(sc[i]); tu.r *= sc[i]; } });
  }
  const specs: MountSpec[] = [];
  tur.forEach((tu, i) => { if (tu && offs[i]) specs.push({ i, x: offs[i].x, z: offs[i].y, r: tu.r, cls: ch.mounts[i] ?? 'S', mod: mods[i]! }); });

  // flyers with a registered airframe (chassis/air.ts) take the registry path like ground units; the airframe returns
  // its lift points (AirOut.lift) and the air mobility (mobility/air.ts) renders rotors / fans / nozzles / grav pods
  const reg = registered().chassis;
  if (flying && !reg.includes(ch.id) && !reg.includes(ch.shape)) {
    if (ch.domain === 'jet' || mob.id === 'jet') air = buildJet(hb, kit, L, W, S);
    else air = buildRotor(hb, kit, body, ch.id, L, W, S);
    updates.push((t) => air!.update(t));
  } else {
    const mb = mobilityBuilder(mob.id);
    const stance = mb.stance({ mobId: mob.id, L, W, S, shape: ch.shape });
    out = chassisBuilder(ch)({ b: hb, kit, design, ch, mob, L, W, S, stance, mounts: specs, rnd, body, root, updates });
    // hard-surface functional kit in the hull's named slots (chassis/hs-kit.ts) for hulls not dressed by hand
    const dress = AUTO_DRESS[ch.shape];
    if (dress && !flying && !out.dressed) autoDress({ b: hb, kit, L, W, S, mounts: specs }, out.deckAt, dress);
    const mctx: MobilityCtx & { lift?: unknown } = { root, kit, mobId: mob.id, L, W, S, shape: ch.shape, stance, hips: out.hips, lift: (out as { lift?: unknown }).lift };
    const upd = mb.build(mctx);
    if (upd) updates.push((t, _dt, mv) => upd(t, mv));
  }

  // ---- turrets -------------------------------------------------------------------------------------
  for (const m of specs) {
    const tu = tur[m.i]!;
    let y: number;
    if (air) {
      y = air.hpY(m.x, m.z);
      // pylon from the airframe to the weapon
      if (ch.domain === 'jet' || mob.id === 'jet') hb.box(kit.trim, 0.2 * tu.r + 0.1, Math.abs(y) + 0.05, 0.05, air!.hpX ? air!.hpX(m.x, m.z) : m.x, y / 2 + 0.02, m.z, 0.008);
    } else {
      const seat = out!.seat?.(m) ?? { y: Math.max(0, out!.deckAt(m.x, m.z)), socket: false };
      y = seat.y;
      if (!seat.socket) {
        // barbette: armoured base ring bridging any slope under the turret ring
        let lo = y;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2, d = out!.deckAt(m.x + Math.cos(a) * tu.r * 0.85, m.z + Math.sin(a) * tu.r * 0.85);
          if (d >= 0) lo = Math.min(lo, d);
        }
        const r = tu.r;
        hb.lathe(kit.hull, [[0, lo - 0.01], [r * 1.22, lo - 0.01], [r * 1.22, y - 0.012], [r * 1.05, y + 0.005], [0, y + 0.005]], [m.x, 0, m.z], 'y', 20);
        if (S >= 3) hb.cylb(kit.trim, r * 1.1, 0.02, 0.004, [m.x, y, m.z], 'y', 20);
      }
    }
    tu.yaw.position.set(air?.hpX ? air.hpX(m.x, m.z) : m.x, y, m.z);
    body.add(tu.yaw);
    turrets.push(tu);
  }
  hb.mount(body, kit.decal);
  // surface skin by role / domain / scale (skins.ts); turrets keep their own per-weapon skin
  applySkin(root, body, specs.map((m) => ({ obj: tur[m.i]!.yaw, mount: m.i })), kit.uber, pickSkin(design, ch, mob, mods), design.id);
  if (!flying) root.add(contactShadow(L, W));
  let tris = 0;
  root.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh && !(me.material as THREE.MeshBasicMaterial).isMeshBasicMaterial) tris += (me.geometry.index ? me.geometry.index.count : me.geometry.attributes.position.count) / 3; });

  return {
    root, design, team, turrets, L, W, S, flying, radius: Math.max(L, W) / 2, tris,
    animate(t, dt, moving) {
      for (const u of updates) u(t, dt, moving);
      if (!flying) body.position.y = Math.sin(t * 38 + L) * 0.0035 * (0.6 + moving) * Math.min(S, 3);
    },
  };
}
