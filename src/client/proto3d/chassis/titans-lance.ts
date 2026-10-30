// Lance Dreadnought / lance (6 wide x 10 long): a titan weapon on legs and little else. The XL gun (a 5.25-cell
// housing, up to 11 cells long) IS the body: it lies in a long faceted gun keel that twists on the hip ring with it
// (torso mode), held between two tall trunnion cheeks with glowing axle bearings, like a field railgun on its own
// carriage (weapon_cool "Reaper", hull_b). Under the keel: capacitor banks with glow slots and coolant runs, a
// counterweight tail with radiator fins and two thrusters astern. Behind the breech stands a slim command tower whose
// roof carries the medium so it fires over the titan gun. From above: one long gun with a tower at its heel, nothing
// else, lean and long. The static body is only a compact hip block (on legs) or a low armoured carriage deck.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, registerTorso, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, glow, hazard } from './shapes.ts';
import { banner, glowGrille } from './giants-kit.ts';
import { armorPlate, cableBundle, eraGrid, fineFor, frame, hexSec, piston, plateStack, recessPanel, rectP, stowBox, trapP } from './hs-kit.ts';
import { armourWalls, latticeMast, ngonT, octStack, planLoftT, searchlight, xPrism } from './hs-kit-titan.ts';
import { pipeRun, sensorDome } from './titan-greebles.ts';
import { torsoHP, torsoSlots } from './torso-kit.ts';
import { shiftTo } from './titans.ts';
import type { Bld } from '../geo.ts';

function lance(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 10, kz = W / 6, k = Math.min(kx, kz);
  const fine = fineFor(c.S);
  const pu = 0.1 * k;
  const ts = torsoSlots(c);
  const heroM = ts.hero >= 0 ? c.mounts.find((m) => m.i === ts.hero) : undefined;
  const biped = stance.legs === 'biped';

  // ---- static carriage: a compact hip block on legs, or a low armoured deck on tracks / anchor / spider legs
  let hy: number;
  const hx = -0.6 * kx;
  if (biped) {
    hy = stance.hipY + 0.35 * k;
    block(b, kit.mech, hx, stance.hipY - 0.7 * k, 0, 2.2 * kx, 2.6 * kz, 1.1 * k, { top: [0.9, 0.85], ch: 0.3 * k, bot: 0.2 * k });
    // hip armour: a front wedge and side plates over the hip joints
    armorPlate(b, kit, kit.armor, frame([hx + 1.15 * kx, stance.hipY - 0.2 * k, 0], [1, -0.3, 0], [0, 1, 0]), trapP(0.9 * k, 1.6 * kz, 2.2 * kz, 0.12 * k), pu * 1.3, { standoff: pu * 0.6 });
    both((s) => armorPlate(b, kit, kit.armor2, frame([hx, stance.hipY - 0.1 * k, s * 1.55 * kz], [0, -0.15, s], [1, 0, 0]), rectP(1.6 * kx, 0.9 * k, 0.12 * k), pu * 1.1, { standoff: pu * 0.8 }));
  } else {
    const y1 = Math.max(stance.yt, 0.4), dy = y1 + 0.8 * k;
    const P = ngonT(8, L * 0.36, W * 0.4);
    planLoftT(b, kit.mech, ngonT(8, L * 0.3, W * 0.3), [[stance.y0, 0.95], [y1, 1.0]], [hx, 0]);
    planLoftT(b, kit.armor, P, [[y1 - 0.08 * k, 0.95], [y1 + 0.05 * k, 1.0], [dy - 0.08 * k, 0.97], [dy, 0.88]], [hx, 0]);
    armourWalls(b, kit, P, [y1 + 0.06 * k, 1.0], [dy - 0.09 * k, 0.97], { at: [hx, 0], u: pu * 0.6, pitch: 1.4 * k, fill: 0.62, era: false });
    both((s) => hazard(b, kit, hx + 2.6 * kx, dy + 0.01, s * 1.0 * kz, 0.9 * kx, 0.3 * kz, 4, 0));
    hy = dy + 0.3 * k;
  }
  // slewing ring the gun keel turns on
  planLoftT(b, kit.mech, ngonT(10, 1.15 * k, 1.15 * k), [[hy - 0.45 * k, 1.0], [hy - 0.05 * k, 1.0]], [hx, 0]);
  planLoftT(b, kit.joint, ngonT(10, 1.3 * k, 1.3 * k), [[hy - 0.14 * k, 1.0], [hy, 0.96]], [hx, 0]);
  for (const dz of [-0.7, 0.7]) piston(b, kit, [hx - 0.9 * kx, hy - 1.1 * k, dz * kz], [hx - 1.2 * kx, hy - 0.2 * k, dz * 1.2 * kz], 0.08 * k, 0.55, fine);

  // ---- weapon hardpoints (hull frame); the keel pivot is at [hx, hy, 0]
  const yK = hy + 1.0 * k; // keel deck under the gun's belly
  const tx = -3.8 * kx, tTop = yK + 2.55 * k; // command tower behind the breech, its roof the medium's seat
  const base = (i: number): V3 => (i === 0 ? [0.55 * kx, yK - 0.3 * k, 0] : i === 1 ? [tx, tTop - 0.3 * k, 0] : [tx, tTop - 0.3 * k, 0]);

  const keel = (t: Bld, armed: (i: number) => boolean) => {
    // the gun keel: a long hexagonal-section girder from the counterweight tail to under the gun's chase, tapering
    const k0 = -5.0 * kx, k1 = 3.4 * kx;
    t.loft(kit.armor2, [
      hexSec(k0, hy + 0.05 * k, 0.5 * kz, 0.95 * kz, hy + 0.25 * k, yK - 0.35 * k, 0.8 * kz, yK + 0.2 * k),
      hexSec(-2.6 * kx, hy - 0.1 * k, 0.75 * kz, 1.35 * kz, hy + 0.2 * k, yK - 0.3 * k, 1.2 * kz, yK),
      hexSec(1.0 * kx, hy - 0.05 * k, 0.6 * kz, 1.25 * kz, hy + 0.3 * k, yK - 0.3 * k, 1.15 * kz, yK),
      hexSec(k1, hy + 0.45 * k, 0.3 * kz, 0.8 * kz, hy + 0.65 * k, yK - 0.2 * k, 0.7 * kz, yK - 0.05 * k),
    ]);
    // flank armour: plate pairs along the keel sides, ERA on the forward pair, a glow seam under them
    both((s) => {
      for (let i = 0; i < 4; i++) {
        const x = -3.9 * kx + i * 1.75 * kx, wz = i === 3 ? 1.08 * kz : 1.3 * kz;
        const top = armorPlate(t, kit, i % 2 ? kit.armor : kit.shell, frame([x, (hy + yK) / 2 - 0.05 * k, s * wz], [0, 0, s], [1, 0, 0]), rectP(1.55 * kx, (yK - hy) * 0.75, 0.12 * k), pu * 1.2, { standoff: pu * 0.6 });
        if (i === 3) eraGrid(t, kit, frame([x, (hy + yK) / 2 - 0.05 * k, s * (wz + top)], [0, 0, s], [1, 0, 0]), 2, 3, 0.45 * kx, 0.3 * k, pu * 0.6, kit.armor2);
      }
      glow(t, kit, -1.0 * kx, hy + 0.15 * k, s * 1.12 * kz, 5.6 * kx, 0.08 * k, 0.06 * k, undefined, kit.plasma);
      // capacitor bank slung under each flank: dark drums with glowing bands
      for (let i = 0; i < 3; i++) {
        const x = -1.9 * kx + i * 1.25 * kx;
        xPrism(t, kit.mech, 8, [[x - 0.5 * kx, 0.3 * k, 0.3 * k], [x + 0.5 * kx, 0.3 * k, 0.3 * k]], [hy - 0.05 * k, s * 1.0 * kz]);
        xPrism(t, kit.plasma, 8, [[x - 0.08 * kx, 0.33 * k, 0.33 * k], [x + 0.08 * kx, 0.33 * k, 0.33 * k]], [hy - 0.05 * k, s * 1.0 * kz]);
      }
      if (fine) pipeRun(t, kit, [[-4.6 * kx, yK - 0.1 * k, s * 0.75 * kz], [-3.0 * kx, yK + 0.05 * k, s * 1.0 * kz], [1.6 * kx, yK + 0.05 * k, s * 0.95 * kz]], 0.05 * k, kit.joint);
    });
    // gun bed: a dark trough with a glowing feed channel under the gun
    planLoftT(t, kit.mech, rectP(4.6 * kx, 1.7 * kz, 0.3 * k), [[yK - 0.05 * k, 1.0], [yK + 0.08 * k, 0.96]], [-0.4 * kx, 0]);
    glow(t, kit, -0.4 * kx, yK + 0.1 * k, 0, 4.0 * kx, 0.05 * k, 0.5 * kz, undefined, kit.plasma);
    // chin under the chase: a hazard-striped prow lip with two searchlights
    hazard(t, kit, 3.2 * kx, yK - 0.1 * k, 0, 0.18 * kx, 1.2 * kz, 5, Math.PI / 2);
    both((s) => searchlight(t, kit, 3.0 * kx, hy + 0.4 * k, s * 0.5 * kz, s * 0.3, 0.22 * k, fine));
    if (armed(0)) {
      // trunnion cheeks: two tall faceted plates either side of the gun at its pitch axis, glowing axle bearings into
      // the gun, rams from the keel up the cheeks; swept back so the breech clears them
      const [bx0] = base(0), ax = bx0 + 0.5 * kx, ayy = yK + 0.9 * k;
      both((s) => {
        const z = s * 2.62 * kz;
        block(t, kit.armor, ax - 0.25 * kx, yK - 0.6 * k, z, 2.4 * kx, 0.42 * kz, 2.2 * k, { top: [0.55, 0.8], shift: [-0.5 * kx, 0], ch: 0.1 * k, bev: 0.06 * k, mid: [[0.45, 1.05, 1.1]] });
        armorPlate(t, kit, kit.armor2, frame([ax - 0.4 * kx, yK + 0.4 * k, z + s * 0.2 * kz], [0, 0, s], [1, 0.35, 0]), trapP(1.7 * kx, 0.9 * k, 1.2 * k, 0.12 * k), pu * 1.2, { standoff: pu * 0.6 });
        // axle: bearing drum through the cheek, glowing cap outboard, the axle inboard into the gun's side
        t.cyl(kit.joint, 0.5 * k, 0.5 * k, 0.55 * kz, [ax, ayy, z], 'z', 14);
        t.cyl(kit.plasma, 0.3 * k, 0.3 * k, 0.08 * kz, [ax, ayy, z + s * 0.3 * kz], 'z', 12);
        t.cyl(kit.mech, 0.28 * k, 0.28 * k, 1.1 * kz, [ax, ayy, s * 1.95 * kz], 'z', 10);
        // cheek foot onto the keel flank (a sloped buttress)
        block(t, kit.armor2, ax - 0.3 * kx, hy + 0.1 * k, s * 1.85 * kz, 2.2 * kx, 1.2 * kz, yK - hy - 0.55 * k, { top: [0.9, 0.55], shift: [0, s * 0.45 * kz], ch: 0.15 * k });
        piston(t, kit, [ax - 1.3 * kx, hy + 0.3 * k, s * 1.4 * kz], [ax - 0.9 * kx, yK + 0.4 * k, s * 2.35 * kz], 0.11 * k, 0.55, fine);
      });
    }
    // counterweight tail: stepped armour blocks, radiator fins, twin thrusters, grille
    block(t, kit.armor, -5.2 * kx, hy - 0.2 * k, 0, 1.3 * kx, 2.3 * kz, yK - hy + 0.4 * k, { top: [0.75, 0.9], shift: [0.15 * kx, 0], ch: 0.25 * k, bev: 0.05 * k, bot: 0.15 * k });
    both((s) => {
      for (let i = 0; i < 3; i++) t.box(kit.mech, 0.8 * kx, 0.7 * k, 0.07 * kz, -4.6 * kx + i * 0.15 * kx, yK + 0.15 * k, s * (0.35 + i * 0.25) * kz, 0.01, [0.4 * s, 0, 0]);
      xPrism(t, kit.mech, 8, [[-5.6 * kx, 0.36 * k, 0.36 * k], [-6.0 * kx, 0.42 * k, 0.42 * k]], [hy + 0.3 * k, s * 0.75 * kz]);
      t.cyl(kit.hot, 0.32 * k, 0.32 * k, 0.04, [-6.02 * kx, hy + 0.3 * k, s * 0.75 * kz], '-x', 10);
    });
    glowGrille(t, kit, -5.9 * kx, yK - 0.15 * k, 0, 0.9 * kz, 0.45 * k, 2, -1);

    // ---- command tower behind the breech: a slim swept plated tower, visor band forward, the medium on its roof
    const TP: P2[] = [[0.8 * kx, 0], [0.45 * kx, 0.85 * kz], [-0.75 * kx, 0.95 * kz], [-0.95 * kx, 0.5 * kz], [-0.95 * kx, -0.5 * kz], [-0.75 * kx, -0.95 * kz], [0.45 * kx, -0.85 * kz]];
    planLoftT(t, kit.armor, TP, [[yK - 0.05, 1.0], [yK + 1.2 * k, 0.96, -0.1 * kx], [tTop - 0.3 * k, 0.86, -0.18 * kx], [tTop, 0.78, -0.2 * kx]], [tx, 0]);
    both((s) => {
      armorPlate(t, kit, kit.shell, frame([tx + 0.1 * kx, yK + 1.0 * k, s * 0.92 * kz], [0.2, 0, s], [1, 0, 0]), rectP(1.3 * kx, 1.4 * k, 0.12 * k), pu * 1.2, { standoff: pu * 0.6 });
      glow(t, kit, tx + 0.62 * kx, tTop - 0.75 * k, s * 0.32 * kz, 0.08 * k, 0.12 * k, 0.5 * kz, [0, s * 0.6, 0]);
    });
    t.box(kit.glass, 0.06 * k, 0.16 * k, 1.0 * kz, tx + 0.66 * kx, tTop - 0.55 * k, 0, 0.01, [0, 0, -0.5]);
    armorPlate(t, kit, kit.armor2, frame([tx + 0.35 * kx, tTop - 0.2 * k, 0], [0.5, 1, 0], [1, 0, 0]), trapP(0.7 * kx, 1.2 * kz, 1.5 * kz, 0.1 * k), pu, { standoff: pu * 0.4 });
    if (!armed(1)) {
      sensorDome(t, kit, tx - 0.2 * kx, tTop - 0.02, 0, 0.4 * k);
    }
    latticeMast(t, kit, tx - 0.75 * kx, tTop - 0.2 * k, -0.55 * kz, 1.8 * k, 0.13 * k, 0.3);
    banner(t, kit, tx - 0.85 * kx, tTop - 0.4 * k, 0.6 * kz, 2.2 * k, 0.7 * k, 1);
    octStack(t, kit, tx - 1.0 * kx, yK + 0.4 * k, 0.75 * kz, 0.18 * k, 1.5 * k, [0, 0, 1]);
    for (const dy of [0, 0.4]) stowBox(t, kit, frame([tx - 0.3 * kx, yK + dy * k, -1.15 * kz], [0, 0, -1], [1, 0, 0]), 0.6 * kx, 0.25 * k, 0.4 * k, kit.shell);
    if (fine) cableBundle(t, kit, [tx + 0.6 * kx, yK + 0.5 * k, 0.6 * kz], [base(0)[0] - 2.5 * kx, yK + 0.15 * k, 0.75 * kz], 0.04 * k, [0, 1, 0], 3, 0.1);
    recessPanel(t, kit, frame([tx - 0.97 * kx, yK + 1.2 * k, 0], [-1, 0, 0], [0, 0, 1]), 1.0 * kz, 1.1 * k, 0.08 * k, { slats: 4 });
  };

  let hips: Hip[] | undefined;
  if (biped) hips = ([-1, 1] as const).map((s) => ({ p: [hx, stance.hipY, s * 1.45 * kz] as V3, side: s, t: stance.thick * 1.25, foot: [hx + 0.2 * kx, 0, s * 1.8 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
  const at: V3 = [hx, hy, 0];
  if (!heroM) keel(b, (i) => c.mounts.some((m) => m.i === i && m.mod.kind === 'weapon'));
  const toYaw = (p: V3): V3 => [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
  return {
    deckAt: (x, z) => (x > -4.5 * kx && x < 2.5 * kx && Math.abs(z) < 1.0 * kz ? yK : -1), top: tTop + 1.5 * k, custom: true, dressed: true, hips,
    seat: (m: MountSpec) => {
      if (m === heroM) return { y: hy, socket: true };
      if (m.mod.kind === 'weapon') return { y: base(m.i)[1], socket: true };
      // a utility rides the static carriage: a bracket off the slewing ring
      // (under the keel's sweep: slung off the back of the hip block, or on the carriage deck)
      const y = biped ? stance.hipY - 0.75 * k : hy - 0.35 * k;
      beam(b, kit.mech, [hx, y - 0.25 * k, 0], [m.x, y - 0.25 * k, m.z], 0.35 * k, 0.3 * k);
      block(b, kit.armor2, m.x, y - 0.55 * k, m.z, m.r * 1.6, m.r * 1.6, 0.55 * k, { ch: m.r * 0.3 });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.05 * k, 12);
      return { y, socket: true };
    },
    torso: heroM ? (t, { heroR }) => {
      keel(shiftTo(t, at), ts.armed);
      return { hp: torsoHP(ts, (i) => toYaw(base(i)), heroR), at };
    } : undefined,
  };
}

registerChassis('lance', lance);
registerTorso('lance');
