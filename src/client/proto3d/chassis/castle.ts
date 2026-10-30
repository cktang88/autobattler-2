// Tug of war castle (shared/tug.ts castleDesign: a Monolith hull on an anchor, design id 'tug-castle', one gun of ANY
// class). A squat octagonal keep with four round corner bastions and a gate, and on its roof an armoured gun cupola
// that turns with the gun (torso mode). The castle buys bigger and smaller guns during a game, so the cupola is sized
// round the equipped gun's class (DRAW_D): a slim pillbox cap under a heavy MG, a broad armoured dome under a titan
// gun. The gun itself stays its class size like everywhere else; only the castle's housing follows it.

import { DRAW_D } from '../weapons3d.ts';
import { MODULE_BY_ID } from '../../../shared/parts.ts';
import type { MountClass } from '../../../shared/types.ts';
import type { P2, V3 } from '../geo.ts';
import type { ChassisCtx, ChassisOut, MountSpec } from './registry.ts';
import { block, both, glow, hazard } from './shapes.ts';
import { banner, glowGrille, ngon, planLoft } from './giants-kit.ts';
import { armorPlate, cagedLamp, fineFor, frame, rectP } from './hs-kit.ts';

/** shared/tug.ts castleDesign's id (not imported: the proto3d bundle stays free of the game rules) */
export const CASTLE_ID = 'tug-castle';
/** is this the castle? ('tug-castle#n': several in one proto3d lab lineup) */
export const isCastle = (id: string): boolean => id === CASTLE_ID || id.startsWith(CASTLE_ID + '#');

export function castle(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const k = Math.min(L, W) / 7;
  const fine = fineFor(c.S);
  const y0 = stance.y0;
  const gun = c.design.mounts[0] ? MODULE_BY_ID.get(c.design.mounts[0]!) : undefined;
  const D = DRAW_D[(gun?.mount ?? 'S') as MountClass];

  // ---- the keep: battered octagon, a dark plinth course, team band, roof parapet
  const R = 2.75 * k;
  const yRoof = y0 + 1.7 * k;
  const P: P2[] = ngon(8, R, R);
  planLoft(b, kit.trim, P, [[y0 - 0.02, 1.06], [y0 + 0.28 * k, 1.06]]);
  planLoft(b, kit.hull, P, [[y0 + 0.26 * k, 1.04], [yRoof - 0.3 * k, 0.94], [yRoof, 0.93]]);
  planLoft(b, kit.accent, P, [[y0 + 0.9 * k, 0.99], [y0 + 1.02 * k, 0.985]]);
  // parapet: a raised rim round the roof with merlon blocks (outside the cupola's sweep)
  planLoft(b, kit.armor2, P, [[yRoof - 0.02, 0.93], [yRoof + 0.22 * k, 0.93], [yRoof + 0.26 * k, 0.9]]);
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * (Math.PI / 4); // the octagon's corners
    const rr = R * 0.86;
    block(b, kit.armor2, Math.cos(a) * rr, yRoof + 0.2 * k, Math.sin(a) * rr, 0.42 * k, 0.42 * k, 0.32 * k, { top: [0.8, 0.8], ch: 0.08 * k });
  }
  // wall plates on the diagonal faces, a gate on the front, a grille astern
  for (let i = 0; i < 8; i++) {
    const a = i * (Math.PI / 4); // face normals (the gate faces +x)
    const n: V3 = [Math.cos(a), 0.12, Math.sin(a)];
    const rr = R * 0.99 * Math.cos(Math.PI / 8);
    const p: V3 = [Math.cos(a) * rr, y0 + 1.0 * k, Math.sin(a) * rr];
    if (Math.abs(a) < 0.2) continue; // the gate face
    armorPlate(b, kit, i % 2 ? kit.shell : kit.armor2, frame(p, n, [0, 1, 0]), rectP(0.7 * k, 1.2 * k, 0.06 * k), 0.09 * k, { standoff: 0.04 * k });
  }
  // gate: a dark recess with a glowing slit and hazard sill
  block(b, kit.trim, R * 0.9, y0 + 0.24 * k, 0, 0.5 * k, 1.3 * k, 0.95 * k, { top: [1, 0.85], ch: 0.1 * k });
  glow(b, kit, R * 1.0, y0 + 0.75 * k, 0, 0.08 * k, 0.12 * k, 0.95 * k);
  hazard(b, kit, R * 1.02, y0 + 0.26 * k, 0, 1.1 * k, 0.12 * k, 5, Math.PI / 2);
  glowGrille(b, kit, -R * 0.93, y0 + 0.75 * k, 0, 1.1 * k, 0.45 * k, 3, -1);

  // ---- corner bastions: round towers on the four diagonals, capped, with a lamp each
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 2.35 * k, z = sz * 2.35 * k, r = 0.85 * k, h = yRoof + 0.55 * k;
    b.lathe(kit.hull, [[0, y0 - 0.02], [r * 1.12, y0 - 0.02], [r * 1.02, y0 + 0.5 * k], [r, h - 0.25 * k], [r * 1.12, h - 0.2 * k], [r * 1.12, h], [0, h]], [x, 0, z], 'y', 16);
    b.cylb(kit.accent, r * 1.005, 0.1 * k, 0.01, [x, y0 + 0.9 * k, z], 'y', 16);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      block(b, kit.armor2, x + Math.cos(a) * r * 0.86, h - 0.02, z + Math.sin(a) * r * 0.86, 0.28 * k, 0.28 * k, 0.24 * k, { ch: 0.05 * k });
    }
    glow(b, kit, x + sx * r * 0.72, h - 0.55 * k, z + sz * r * 0.72, 0.12 * k, 0.22 * k, 0.12 * k);
    cagedLamp(b, kit, frame([x, h, z], [0, 1, 0], [1, 0, 0]), 0.18 * k, fine);
  }
  banner(b, kit, -1.4 * k, yRoof + 0.2 * k, 2.15 * k, 1.6 * k, 0.55 * k, -1);
  banner(b, kit, -1.4 * k, yRoof + 0.2 * k, -2.15 * k, 1.6 * k, 0.55 * k, -1);

  // ---- the cupola's seat: a dark race on the roof, always narrower than the cupola above it. A cupola wide enough to
  // reach the parapet / bastions (a giant or titan gun) rides a neck drum that lifts it clear of them.
  const cr = D * 0.58 + 0.15 * k; // cupola radius from the gun's drawn housing: S ~0.6, M ~1.0, L ~1.9, XL ~3.2 cells
  const ch = D * 0.3 + 0.12 * k; // cupola height
  const neck = cr > 2.2 * k ? 0.8 * k : cr > 1.5 * k ? 0.32 * k : 0.06 * k;
  const rn = Math.min(cr * 0.78, R * 0.8);
  planLoft(b, kit.trim, ngon(16, rn, rn), [[yRoof - 0.02, 1.08], [yRoof + neck * 0.35, 1.0], [yRoof + neck, 1.0]]);
  if (neck > 0.1) planLoft(b, kit.accent, ngon(16, rn, rn), [[yRoof + neck * 0.5, 1.01], [yRoof + neck * 0.62, 1.01]]);

  const at: V3 = [0, yRoof + neck, 0];
  /** the gun's trunnion on top of the cupola, a little forward (a slot in the front of the dome) */
  const hp0: V3 = [cr * 0.12, ch * 1.02, 0];
  const cupola = (t: typeof b) => {
    const Pc = ngon(8, cr, cr);
    planLoft(t, kit.armor, Pc, [[0, 0.92], [0.12 * ch, 1.0], [0.62 * ch, 1.0], [0.9 * ch, 0.86], [ch, 0.74]]);
    planLoft(t, kit.mech, Pc, [[0.12 * ch, 1.012], [0.2 * ch, 1.012]]);
    // a cheek plate on each side of the gun, standing proud of the dome, and a glowing sight slit forward
    both((s) => {
      armorPlate(t, kit, kit.armor2, frame([cr * 0.1, ch * 0.42, s * cr * 0.98], [0, 0.15, s], [1, 0, 0]), rectP(cr * 0.8, ch * 0.4, cr * 0.06), cr * 0.04, { standoff: cr * 0.02 });
      glow(t, kit, cr * 0.75, ch * 0.4, s * cr * 0.55, cr * 0.06, ch * 0.07, cr * 0.32);
    });
    // a commander's hatch and vent block astern on the roof of the dome
    block(t, kit.armor2, -cr * 0.48, ch * 0.96, 0, cr * 0.42, cr * 0.5, ch * 0.16, { top: [0.8, 0.8], ch: cr * 0.06 });
    hazard(t, kit, -cr * 0.95, ch * 0.2, 0, cr * 0.6, ch * 0.08, 4, Math.PI / 2);
  };
  return {
    deckAt: (x, z) => (Math.hypot(x, z) < R * 0.9 ? yRoof : -1), top: at[1] + ch + 0.5, custom: true, dressed: true,
    seat: (m: MountSpec) => ({ y: m === c.mounts[0] ? at[1] : yRoof + 0.25 * k, socket: true }),
    torso: (t) => {
      cupola(t);
      return { hp: [hp0], at };
    },
  };
}
