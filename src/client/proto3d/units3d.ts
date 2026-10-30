// Procedural 3D unit assembly from a Design: mobility stance -> chassis builder (chassis/registry.ts) -> running gear ->
// turrets at mountOffsets(). See chassis/registry.ts for the builder architecture and conventions.
// Unit-local frame: +X = forward, +Y = up, +Z = right (sim +y). 1 unit = 1 cell (5 m).
// Static sub-geometry is merged per material, so a typical vehicle is ~10-25 draw calls plus its turrets.

import * as THREE from 'three';
import { CHASSIS_BY_ID, MODULE_BY_ID, MOBILITY_BY_ID } from '../../shared/parts.ts';
import { artBox, drawnSeats, mountOffsets, podSeat } from '../../shared/mountgeo.ts';
import type { Design } from '../../shared/types.ts';
import { makeKit, rng } from './materials.ts';
import { AUTO_DRESS, autoDress } from './chassis/hs-kit.ts';
import { buildTurret, DRAW_D, type Turret } from './weapons3d.ts';
import { CLASS_RANK, slotD } from '../render/weaponsize.ts';
import type { MountClass } from '../../shared/types.ts';
import { fixZFight } from './zfix.ts';
import { Bld } from './geo.ts';
import './chassis/index.ts';
import { chassisBuilder, mobilityBuilder, registered, type ChassisOut, type MobilityCtx, type MountSpec } from './chassis/registry.ts';
import { buildJet, buildRotor, type Air } from './air3d.ts';
import { applySkin, pickSkin } from './skins.ts';
import { pickFinish } from './finish3d.ts';

export interface Unit3D {
  root: THREE.Group;
  design: Design;
  team: 0 | 1;
  turrets: Turret[];
  L: number; W: number; S: number;
  flying: boolean;
  /** per-frame idle/locomotion animation (t = seconds, moving 0..1, dir = travel direction in the hull frame, rad) */
  animate(t: number, dt: number, moving: number, dir?: number): void;
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
  const S = ch.size;
  // the drawn hull follows the chassis art box (ChassisDef.art, else the footprint): a hull carrying a weapon wider
  // than its footprint is drawn wide enough for it (weapons have a fixed size per class; the hull follows them)
  const [W, L] = artBox(ch);
  const rnd = rng([...design.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const root = new THREE.Group();
  const body = new THREE.Group(); // hull + turrets (bobs); running gear lives in root
  root.add(body);
  const flying = (ch.domain ?? 'ground') !== 'ground' || mob.kind === 'air';
  const turrets: Turret[] = [];
  const updates: ((t: number, dt: number, mv: number, dir?: number) => void)[] = [];
  const offs = mountOffsets(design);
  const hb = new Bld();
  let air: Air | null = null;
  let out: ChassisOut | null = null;

  const mods = design.mounts.map((mid) => (mid ? MODULE_BY_ID.get(mid) ?? null : null));
  // surface skin (skins.ts) and bare-metal finish of the mechanics (finish3d.ts): hull + running gear share one finish,
  // each weapon may override it for its barrels / coils (all finishes are rows of the team's one shared material)
  const skin = pickSkin(design, ch, mob, mods);
  const fin = pickFinish(design, ch, mob, mods, skin);
  const kit = makeKit(team, fin.hull);
  // a utility in a smaller hardpoint than its class is drawn at the slot's size (as the 2D art does)
  const slotCls = (mod: NonNullable<(typeof mods)[number]>, i: number) => { const sl = ch.mounts[i]; return sl && mod.kind !== 'weapon' && CLASS_RANK[mod.mount] > CLASS_RANK[sl] ? sl : undefined; };
  const tur = mods.map((mod, i) => {
    if (!mod) return null;
    const cls = slotCls(mod, i) ?? mod.mount;
    // only weapons get a weapon-class housing (a hull carries at most its weapon cap of them, parts.ts weaponCap);
    // utilities, armour and shields in the other sockets are compact add-on modules, never turret-sized, so a giant's
    // spare sockets don't read as more guns
    const d = mod.kind === 'weapon' ? DRAW_D[cls] : Math.min(DRAW_D[cls] * 0.6, 1.2);
    return buildTurret(mod, S, makeKit(team, fin.turret[i] ?? fin.hull), flying, slotCls(mod, i), flying ? 0 : d);
  });
  // weapon size is a property of the weapon, never of the hull it sits on or of whether it is the main gun: every
  // weapon of a size class has the same housing (DRAW_D, built at that size by buildTurret, no multipliers after);
  // only its barrels differ (bore from the calibre, length from the weapon), so a player reads a weapon anywhere. A hull's look comes from being built
  // round its biggest slots (its main weapon system), not from inflating whatever it carries. Aircraft keep their
  // hardpoint scale (a ground turret's housing would swallow a jet).
  // which weapon is the hero, which ride it as pods and where every standing module sits: shared/mountgeo.ts
  // drawnSeats, the same placement the battle sim fires from (fireOffsets). The hero takes the hull's primary seat;
  // on small / medium ground hulls whose weapons are not carried by limbs the secondary weapons ride the hero turret
  // as pods on its flanks (one cohesive weapon system that turns as a whole); torso hulls hang them on the torso; a
  // module whose housing still clashes with another moves to the nearest clear spot on the hull.
  const seats = drawnSeats(design);
  const hero = seats.hero;
  if (flying) tur.forEach((tu) => { if (tu) { tu.yaw.scale.setScalar(1.1); tu.r *= 1.1; } });
  const podOf = seats.pod;
  const torsoHull = seats.torso;
  const pos = offs.map((o, i) => seats.pos[i] ?? (o ? { x: o.x, y: o.y } : o));
  // utilities, armour and shields on a torso hull ride the torso too (they turn with it): the chassis places them
  // on the torso (torso() returns `up`), they never stand on the static lower body under the torso's sweep
  const riders = torsoHull && hero >= 0 && tur[hero] && !tur[hero]!.fixed
    ? mods.map((m, i) => (m && m.kind !== 'weapon' && tur[i] && offs[i] ? i : -1)).filter((i) => i >= 0) : [];
  const specs: MountSpec[] = [];
  tur.forEach((tu, i) => { if (tu && pos[i] && podOf[i] < 0 && !riders.includes(i)) specs.push({ i, x: pos[i]!.x, z: pos[i]!.y, r: tu.r, cls: ch.mounts[i] ?? 'S', mod: mods[i]! }); });

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
    const upd = out.ownGround ? undefined : mb.build(mctx);
    if (upd) updates.push((t, _dt, mv, dir) => upd(t, mv, dir));
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
  }
  // pods onto the hero turret (its local frame is scaled by the hero's size factor kH: positions in its unscaled units)
  const pods = podOf.map((s, i) => (s >= 0 ? i : -1)).filter((i) => i >= 0);
  if (pods.length) {
    const H = tur[hero]!, kH = H.yaw.scale.x, r0 = H.r / kH, py = H.pitch.position.y;
    const bk = new Bld();
    for (const i of pods) {
      const tu = tur[i]!, slot = podOf[i];
      tu.yaw.scale.multiplyScalar(1 / kH); // keeps its own drawn size inside the hero's scaled frame
      const rl = tu.r / kH, ps = podSeat(slot, r0, rl), s = Math.sign(ps.y);
      const x = ps.x, z = ps.y, y = slot < 2 ? py * ps.h : py + r0 * 0.3;
      tu.yaw.position.set(x, y, z);
      H.yaw.add(tu.yaw);
      // bracket arm from the housing to the pod's base (side pods), or a pillar (top pod)
      if (s) bk.box(kit.trim, rl * 1.3, rl * 0.32, Math.abs(z) - r0 * 0.55, x, y - rl * 0.05, s * (r0 * 0.55 + (Math.abs(z) - r0 * 0.55) / 2), rl * 0.06);
      else bk.box(kit.trim, rl * 0.9, y - py * 0.5, rl * 0.9, x, (y + py * 0.5) / 2, 0, rl * 0.06);
    }
    bk.mount(H.yaw);
  }
  // mech torso: the chassis builds the upper body into the hero's yaw group (so torso + weapons twist together) and
  // says where the hero and the pods hang; the hero's own ring / yoke and the pod brackets go
  if (out?.torso && hero >= 0 && tur[hero] && !tur[hero]!.fixed && !flying) {
    const H = tur[hero]!, kH = H.yaw.scale.x;
    for (const o of [...H.yaw.children]) if ((o as THREE.Mesh).isMesh) H.yaw.remove(o);
    const tb = new Bld(), T = new THREE.Group();
    T.scale.setScalar(1 / kH);
    T.userData.torso = true; // not part of the hero weapon itself (the garage socket / highlight skips it)
    const res = out.torso(tb, { heroR: H.r, podR: pods.map((i) => tur[i]!.r), utilR: riders.map((i) => tur[i]!.r) });
    tb.mount(T);
    if (res.at) H.yaw.position.set(...res.at);
    const p0 = res.hp[0] ?? [0, 0, 0];
    H.pitch.position.set(p0[0] / kH, p0[1] / kH, p0[2] / kH);
    pods.forEach((i, j) => {
      const p = res.hp[j + 1], tu = tur[i]!;
      if (p) tu.yaw.position.set(p[0] / kH, p[1] / kH, p[2] / kH);
    });
    // riding utilities: where the chassis put them on the torso, else spread across the back of the torso's top
    if (riders.length) {
      const bb = new THREE.Box3();
      T.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox!); } });
      riders.forEach((i, j) => {
        const tu = tur[i]!;
        let p = res.up?.[j];
        if (!p) {
          const n = riders.length, sz = bb.max.z - bb.min.z;
          p = [bb.min.x + (bb.max.x - bb.min.x) * 0.22, bb.max.y - tu.r * 0.15, (bb.min.z + bb.max.z) / 2 + (n > 1 ? (j / (n - 1) - 0.5) * sz * 0.5 : 0)];
        }
        tu.yaw.scale.multiplyScalar(1 / kH);
        tu.yaw.position.set(p[0] / kH, p[1] / kH, p[2] / kH);
        H.yaw.add(tu.yaw);
      });
    }
  }
  // turret list in design mount order (render3d maps mount i -> the i-th present turret)
  mods.forEach((_, i) => { if (tur[i] && offs[i]) turrets.push(tur[i]!); });
  for (const i of [...pods, ...riders]) if (tur[i]!.yaw.parent === tur[hero]?.yaw) tur[i]!.host = turrets.indexOf(tur[hero]!);
  hb.mount(body, kit.decal);
  // surface skin by role / domain / scale (skins.ts); turrets keep their own per-weapon skin
  // faces of different parts sharing a plane flicker (z-fighting): lift the smaller of each pair a hair off it
  fixZFight(root);
  applySkin(root, body, [...specs.map((m) => ({ obj: tur[m.i]!.yaw, mount: m.i })), ...[...pods, ...riders].map((i) => ({ obj: tur[i]!.yaw, mount: i }))], kit.uber, skin, design.id);
  if (!flying) root.add(contactShadow(L, W));
  let tris = 0;
  root.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh && !(me.material as THREE.MeshBasicMaterial).isMeshBasicMaterial) tris += (me.geometry.index ? me.geometry.index.count : me.geometry.attributes.position.count) / 3; });

  return {
    root, design, team, turrets, L, W, S, flying, radius: Math.max(L, W) / 2, tris,
    animate(t, dt, moving, dir = 0) {
      for (const u of updates) u(t, dt, moving, dir);
      if (!flying) body.position.y = Math.sin(t * 38 + L) * 0.0035 * (0.6 + moving) * Math.min(S, 3);
    },
  };
}

