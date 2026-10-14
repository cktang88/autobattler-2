// Procedural 3D unit assembly from a Design: mobility stance -> chassis builder (chassis/registry.ts) -> running gear ->
// turrets at mountOffsets(). See chassis/registry.ts for the builder architecture and conventions.
// Unit-local frame: +X = forward, +Y = up, +Z = right (sim +y). 1 unit = 1 cell (5 m).
// Static sub-geometry is merged per material, so a typical vehicle is ~10-25 draw calls plus its turrets.

import * as THREE from 'three';
import { CHASSIS_BY_ID, MODULE_BY_ID, MOBILITY_BY_ID } from '../../shared/parts.ts';
import { mountOffsets } from '../../shared/mountgeo.ts';
import type { Design } from '../../shared/types.ts';
import { makeKit, rng } from './materials.ts';
import { buildTurret, type Turret } from './weapons3d.ts';
import { Bld } from './geo.ts';
import './chassis/index.ts';
import { chassisBuilder, mobilityBuilder, type ChassisOut, type MountSpec } from './chassis/registry.ts';
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
  const tur = mods.map((mod) => (mod ? buildTurret(mod, S, kit, flying) : null));
  const specs: MountSpec[] = [];
  tur.forEach((tu, i) => { if (tu && offs[i]) specs.push({ i, x: offs[i].x, z: offs[i].y, r: tu.r, cls: ch.mounts[i] ?? 'S', mod: mods[i]! }); });

  if (flying) {
    if (ch.domain === 'jet' || mob.id === 'jet') air = buildJet(hb, kit, L, W, S);
    else air = buildRotor(hb, kit, body, ch.id, L, W, S);
    updates.push((t) => air!.update(t));
  } else {
    const mb = mobilityBuilder(mob.id);
    const stance = mb.stance({ mobId: mob.id, L, W, S, shape: ch.shape });
    out = chassisBuilder(ch)({ b: hb, kit, design, ch, mob, L, W, S, stance, mounts: specs, rnd, body, root, updates });
    const upd = mb.build({ root, kit, mobId: mob.id, L, W, S, shape: ch.shape, stance, hips: out.hips });
    if (upd) updates.push((t, _dt, mv) => upd(t, mv));
  }

  // ---- turrets -------------------------------------------------------------------------------------
  for (const m of specs) {
    const tu = tur[m.i]!;
    let y: number;
    if (flying) {
      y = air!.hpY(m.x, m.z);
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
    tu.yaw.position.set(flying && air?.hpX ? air.hpX(m.x, m.z) : m.x, y, m.z);
    body.add(tu.yaw);
    turrets.push(tu);
  }
  hb.mount(body, kit.decal);
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
