// Monolith (size 5, 7 x 7): a walking bunker. Read from above it is a pinched, horned slab, not a box: a battered
// lower skirt whose plan flares into four armoured horns (front shield wings, rear engine wings) around a narrow
// waist; a dark recessed waist band; an arrow-nosed upper casemate whose lip OVERHANGS the waist before it batters
// back in (so the side view is an hourglass); a stepped octagonal plinth carrying the giant gun in a heavy roof
// cupola; flying buttresses down each flank; a commander's tower, two tall rear exhaust stacks, and a corner gun
// tower on the rear-right quarter for the medium gun. Hard-surface pass (chassis/hs-kit.ts): steep faceted walls with
// chamfered shoulders (no bell taper); every wall carries thick appliqué plates standing proud on shadow gaps, stacked
// two deep with ERA bricks on the front arc only; recessed louvre grilles; caged searchlights; a railed walkway round
// the roof with ladders down to the skirt (building-scale cues); coolant pipe runs from the stacks to the tower; rams
// on the hip housings. Very few guns.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { block, both, collar, glow, hazard, vent } from './shapes.ts';
import { banner, glowGrille, mast, ngon, planLoft } from './giants-kit.ts';
import {
  inside, boltRing, faceBox, faceFrame, faceSlit, hatch, mirror, pbox, pipeRun, sensorDome, wallFace, whip, type Face,
} from './titan-greebles.ts';
import { armorPlate, cagedLamp, eraGrid, fineFor, frame, handrail, inset, ladder, piston, plateStack, recessPanel, rectP } from './hs-kit.ts';
import type { Kit, MatLike } from '../materials.ts';
import type { Bld } from '../geo.ts';

/** hard-surface plate on a wall face (hs-kit armorPlate in face coordinates: thickness, bevel, shadow gap) */
const facePlateHS = (b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, t: number, mat: MatLike, so = t * 0.45) =>
  armorPlate(b, kit, mat, faceFrame(f, du, dv, 0), rectP(w, d, Math.min(w, d) * 0.08), t, { standoff: so, gap: t * 1.1 });
/** recessed louvre grille on a wall face */
const faceGrille = (b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, n: number) =>
  recessPanel(b, kit, faceFrame(f, du, dv, 0), w, d, Math.min(w, d) * 0.12, { slats: n });

function monolith(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 7, kz = W / 7, k = Math.min(kx, kz);
  const legged = stance.legs !== null;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.3 * k : Math.max(stance.yt, y0 + 0.4);
  const sc = (pts: P2[]): P2[] => pts.map(([x, z]) => [x * kx, z * kz] as P2);
  const scl = (pts: P2[], s: number, dx = 0): P2[] => pts.map(([x, z]) => [x * s + dx, z * s] as P2);

  // keel between the running gear
  const wi = Math.min(stance.wi, 2.3 * kz);
  planLoft(b, kit.trim, ngon(8, 2.9 * kx, wi), [[y0, 0.9], [yt + 0.1, 1.0]]);

  // ---- tier 1: the battered skirt. Hourglass plan: front shield horns, a pinched waist, rear engine horns.
  const P1 = sc(mirror([[3.5, 0], [3.35, -1.0], [2.15, -3.48], [1.35, -3.3], [0.45, -2.3], [-0.9, -2.3], [-1.8, -3.3], [-2.55, -3.45], [-3.2, -2.35], [-3.5, -0.9], [-3.5, 0]]));
  const s1 = yt + 1.25 * k, sTop = 0.84;
  const sh1 = s1 - 0.28 * k; // shoulder: the wall stands almost upright to here, then a sharp chamfer
  const L1: [number, number][] = [[yt - 0.12, 0.9], [yt + 0.2 * k, 1.0], [sh1, 0.96], [s1, sTop]];
  planLoft(b, kit.hull, P1, L1);
  // plinth rim: a dark band and a team glow line around the skirt foot
  planLoft(b, kit.trim, P1, [[yt + 0.1 * k, 1.014], [yt + 0.26 * k, 1.014]]);
  // ---- waist: a dark recessed band the upper casemate overhangs
  const P2u = sc(mirror([[3.05, 0], [2.95, -0.55], [1.7, -2.15], [-1.5, -2.3], [-2.75, -1.6], [-2.75, 0]]));
  planLoft(b, kit.trim, P2u, [[s1 - 0.04, 0.84], [s1 + 0.42 * k, 0.86]]);
  // ---- tier 2: the upper casemate. Overhanging lip, then battered back in to the roof.
  const t2 = s1 + 1.75 * k;
  const sh2 = t2 - 0.3 * k;
  const L2: [number, number][] = [[s1 + 0.38 * k, 0.88], [s1 + 0.62 * k, 1.0], [s1 + 0.78 * k, 1.0], [sh2, 0.95], [t2 - 0.06 * k, 0.8], [t2, 0.78]];
  planLoft(b, kit.hull, P2u, L2);
  planLoft(b, kit.accent, P2u, [[s1 + 0.64 * k, 1.008], [s1 + 0.74 * k, 1.008]]);
  const roof2 = scl(P2u, 0.78);
  // ---- tier 3: stepped octagonal plinth under the giant-gun cupola
  const cx3 = 0.65 * kx;
  const P3 = ngon(8, 1.5 * kx, 1.42 * kz);
  const t3 = t2 + 0.5 * k;
  const cbx = -1.45 * kx, cbT = t2 + 0.85 * k;
  planLoft(b, kit.trim, P3, [[t2 - 0.04, 1.05], [t2 + 0.1 * k, 1.05]], [cx3, 0]);
  planLoft(b, kit.panel, P3, [[t2 + 0.08 * k, 1.0], [t3 - 0.08 * k, 0.9], [t3, 0.86]], [cx3, 0]);

  // ---- appliqué armour on every wall of the skirt and the casemate: thick plates on shadow gaps, stacked on the
  // front arc with ERA bricks, louvre grilles at the rear, vision slits on the forward casemate faces
  const u = 0.12 * k; // greeble unit
  const fine = fineFor(c.S);
  for (let i = 0; i < P1.length; i++) {
    const f = wallFace(P1, i, [yt + 0.26 * k, 1.0], [sh1, 0.96]);
    if (f.w < 0.5 * k) continue;
    const front = f.n.x > 0.85, rear = f.n.x < -0.85;
    const n = Math.max(1, Math.round(f.w / (1.5 * k)));
    for (let j = 0; j < n; j++) {
      const du = (j + 0.5 - n / 2) * (f.w / n), pw = (f.w / n) * 0.86 - 0.05;
      if (rear) continue;
      if (front) {
        const top = plateStack(b, kit, kit.armor, faceFrame(f, du, -f.h * 0.04, 0), rectP(pw, f.h * 0.72, u), [
          { inset: 0, thick: u * 1.2, standoff: u * 0.5 }, { inset: u * 1.4, thick: u * 0.9, mat: kit.armor2 },
        ], { gap: u * 1.2 });
        eraGrid(b, kit, faceFrame(f, du, -f.h * 0.04, top), 3, 4, pw * 0.2, f.h * 0.16, u * 0.55, kit.armor2);
      } else facePlateHS(b, kit, f, du, -f.h * 0.04, pw, f.h * 0.66, u * 1.1, j % 2 ? kit.shell : kit.armor2);
    }
    if (rear) {
      // reactor grille + exhaust slit on the rear plates
      faceGrille(b, kit, f, 0, 0, f.w * 0.62, f.h * 0.55, 5);
      faceSlit(b, kit, f, 0, -f.h * 0.38, f.w * 0.5, u * 0.5, kit.hot);
    }
  }
  // waist faces: a recessed grille on each pinch, a ladder from the skirt foot up onto the skirt top
  for (let i = 0; i < P1.length; i++) {
    const f = wallFace(P1, i, [yt + 0.26 * k, 1.0], [sh1, 0.96]);
    if (Math.abs(f.n.z) < 0.97 || Math.abs(f.c.x) > 1.2 * kx) continue;
    // (the flying buttress stands on the middle of this face: grille and ladder go either side of it)
    const ub = (x: number) => (lbX(x) - f.c.x) / (f.u.x || 1e-6);
    const lbX = (x: number) => x;
    faceGrille(b, kit, f, ub(0.62 * kx), f.h * 0.05, 0.42 * kx, f.h * 0.45, 4);
    const lb = wallFace(P1, i, [yt + 0.2 * k, 1.0], [s1, sTop]);
    const lu = ub(-0.82 * kx);
    const a = lb.c.clone().addScaledVector(lb.u, lu).addScaledVector(lb.v, -lb.h * 0.5);
    const e = lb.c.clone().addScaledVector(lb.u, lu).addScaledVector(lb.v, lb.h * 0.5);
    ladder(b, kit, [a.x, a.y, a.z], [e.x, e.y + 0.1 * k, e.z], 0.3 * k, [lb.u.x, lb.u.y, lb.u.z], [lb.n.x, lb.n.y, lb.n.z], 0.08 * k);
  }
  // casemate walls: plates proud of the walls, slits in the forward faces
  for (let i = 0; i < P2u.length; i++) {
    const f = wallFace(P2u, i, [s1 + 0.8 * k, 1.0], [sh2, 0.95]);
    if (f.w < 0.6 * k) continue;
    const fwd = f.n.x > 0.3;
    const n = Math.max(1, Math.round(f.w / (1.3 * k)));
    for (let j = 0; j < n; j++) {
      const du = (j + 0.5 - n / 2) * (f.w / n);
      facePlateHS(b, kit, f, du, -f.h * 0.06, (f.w / n) * 0.84, f.h * 0.62, u * 0.95, j % 2 ? kit.armor2 : kit.shell);
      if (fwd) faceSlit(b, kit, f, du, f.h * 0.38, (f.w / n) * 0.5, u * 0.4);
    }
  }

  // ---- flying buttresses down the flanks: from the casemate lip down to beyond the skirt foot
  both((s) => {
    for (const bx of [-0.22]) {
      const x = bx * kx, zi = s * 1.75 * kz, zo = s * 2.95 * kz;
      const ring = (z: number, hw: number, lo: number, hi: number): V3[] => [
        [x - hw, lo, z], [x + hw, lo, z], [x + hw, hi - hw * 0.6, z], [x + hw * 0.35, hi, z], [x - hw * 0.35, hi, z], [x - hw, hi - hw * 0.6, z]];
      b.loft(kit.hull, [ring(zi, 0.42 * kx, s1 - 0.2 * k, t2 - 0.35 * k), ring(zo, 0.32 * kx, yt - 0.1, yt + 0.5 * k)]);
      // capping plate along the ridge + rivets
      const a: V3 = [x, t2 - 0.3 * k, zi], e: V3 = [x, yt + 0.55 * k, zo];
      b.strut(kit.trim, [x, a[1] - 0.02 * k, a[2]], [x, e[1] - 0.02 * k, e[2]], 0.12 * k, 0.1 * k, 6);
      // foot pad where the buttress meets the ground line
      block(b, kit.trim, x, yt - 0.25 * k, zo - s * 0.1 * kz, 0.85 * kx, 0.5 * kz, 0.45 * k, { top: [0.8, 0.7], ch: 0.12 * k });
    }
    // waist conduits running the length of the pinch, clamped to the skirt top
    const zc = s * 2.18 * kz, yc = s1 + 0.12 * k;
    pipeRun(b, kit, [[1.6 * kx, yc, zc * 1.02], [0.4 * kx, yc, zc], [-0.6 * kx, yc + 0.05, zc], [-1.7 * kx, yc, zc * 1.03]], 0.07 * k);
    pipeRun(b, kit, [[1.4 * kx, yc + 0.18 * k, zc * 0.98], [-1.5 * kx, yc + 0.18 * k, zc * 0.98]], 0.05 * k, kit.steel);
    glow(b, kit, 0.2 * kx, s1 + 0.3 * k, s * 2.06 * kz, 1.6 * kx, 0.05, 0.05);
  });

  // ---- prow: ram blade under the glacis, hazard teeth, headlamps
  block(b, kit.metal, 3.25 * kx, Math.max(0.12, yt - 0.55 * k), 0, 0.9 * kx, 3.2 * kz, 0.85 * k, { top: [0.45, 0.9], shift: [-0.2 * kx, 0], ch: 0.25 * k, bev: 0.06 });
  for (let i = -3; i <= 3; i++) block(b, kit.steel, 3.62 * kx, Math.max(0.1, yt - 0.55 * k), i * 0.42 * kz, 0.3 * kx, 0.2 * kz, 0.3 * k, { top: [0.3, 0.6], shift: [0.08 * kx, 0], ch: 0.04 });
  hazard(b, kit, 3.36 * kx, yt + 0.18 * k, 0, 2.6 * kz, 0.08 * kx, 9, Math.PI / 2);
  both((s) => {
    for (const zz of [1.3, 0.95]) cagedLamp(b, kit, frame([3.38 * kx, yt + 0.3 * k, s * zz * kz], [0, 1, 0], [1, 0, 0]), 0.2 * k, fine);
  });

  // ---- roof (tier 2 top): hatches, vents, lamps, hazard edges, bolt rows
  both((s) => {
    hatch(b, kit, -1.55 * kx, t2, s * 1.2 * kz, 0.24 * k);
    vent(b, kit, -0.35 * kx, t2, s * 1.6 * kz, 0.7 * kx, 0.38 * kz, 3, 'x');
    hazard(b, kit, 1.65 * kx, t2 + 0.01, s * 1.0 * kz, 0.7 * kx, 0.12 * kz, 4, s * 0.62);
    cagedLamp(b, kit, frame([1.75 * kx, t2, s * 1.35 * kz], [0, 1, 0], [Math.cos(s * 0.5), 0, Math.sin(s * 0.5)]), 0.2 * k, fine);
  });
  // roof armour: a ring of raised plates following the roof edge (breaks up the flat top), gaps between them
  for (let i = 0; i < roof2.length; i++) {
    const [ax, az] = roof2[i], [bx2, bz] = roof2[(i + 1) % roof2.length];
    const len = Math.hypot(bx2 - ax, bz - az);
    if (len < 0.7 * k) continue;
    const ang = Math.atan2(bz - az, bx2 - ax), nx = -Math.sin(ang), nz = Math.cos(ang);
    const n = Math.max(1, Math.round(len / (1.1 * k)));
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n;
      let x = ax + (bx2 - ax) * f, z = az + (bz - az) * f;
      // step inward (toward the centre)
      const sg = nx * -x + nz * -z > 0 ? 1 : -1;
      x += nx * sg * 0.32 * k; z += nz * sg * 0.32 * k;
      if (Math.hypot(x - cx3, z) < 1.65 * k || Math.abs(x - cbx) < 0.75 * kx && Math.abs(z) < 0.8 * kz) continue;
      if (c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 2.2 + 0.3 * k)) continue;
      armorPlate(b, kit, j % 2 ? kit.armor2 : kit.armor, frame([x, t2 - 0.01, z], [0, 1, 0], [Math.cos(ang), 0, Math.sin(ang)]), rectP((len / n) * 0.84, 0.5 * k, 0.05 * k), 0.09 * k, { standoff: 0.04 * k, gap: 0.08 * k });
    }
  }
  // plinth: bolt ring and four short sensor posts
  boltRing(b, kit.metal, cx3, t3, 0, 1.15 * k, 16, u * 0.5);

  // ---- railed walkway round the skirt-top ledge (crew-scale cue), broken where the casemate overhangs it and where
  // the buttresses, the gun tower and the stacks stand
  if (fine) {
    const rail = inset(scl(P1, sTop), 0.2 * k), ry = s1 + 0.3 * k;
    const blocked = (x: number, z: number) => inside(P2u, x, z) || Math.abs(x + 0.22 * kx) < 0.55 * kx || x < -2.3 * kx
      || c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 2.2 + 0.9 * k);
    let run: V3[] = [];
    const flush = () => { if (run.length > 1) handrail(b, kit, run, 0.025 * k, 0.32 * k); run = []; };
    for (let i = 0; i < rail.length; i++) {
      const [ax, az] = rail[i], [bx, bz] = rail[(i + 1) % rail.length];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / (0.7 * k)));
      for (let j = 0; j <= n; j++) {
        const x = ax + ((bx - ax) * j) / n, z = az + ((bz - az) * j) / n;
        if (blocked(x, z)) flush(); else if (!run.length || Math.hypot(run[run.length - 1][0] - x, run[run.length - 1][2] - z) > 1e-4) run.push([x, ry, z]);
      }
    }
    flush();
  }

  // ---- commander's tower behind the cupola: tapered, periscopes, sensor dome, antennas, banner
  block(b, kit.trim, cbx, t2 - 0.02, 0, 1.25 * kx, 1.35 * kz, 0.22 * k, { ch: 0.2 * k });
  block(b, kit.hull, cbx, t2 + 0.15 * k, 0, 1.1 * kx, 1.2 * kz, cbT - t2 - 0.15 * k, { top: [0.7, 0.75], shift: [-0.12 * kx, 0], ch: 0.26 * k, bev: 0.06 });
  glow(b, kit, cbx + 0.42 * kx, t2 + 0.55 * k, 0, 0.05, 0.06 * k, 0.65 * kz, [0, 0, -0.55]);
  for (const z of [-0.3, 0.3]) pbox(b, kit.metal, 0.16 * k, 0.22 * k, 0.12 * k, cbx + 0.2 * kx, cbT + 0.1 * k, z * kz);
  sensorDome(b, kit, cbx - 0.15 * kx, cbT - 0.02, 0, 0.3 * k);
  whip(b, kit, cbx - 0.4 * kx, cbT - 0.02, -0.38 * kz, 1.7 * k);
  mast(b, kit, cbx - 0.45 * kx, cbT - 0.05, 0.4 * kz, 1.3 * k, 0.045 * k);

  // ---- rear: twin tall exhaust stacks clamped to the casemate's back wall, heat grilles between them
  both((s) => {
    const x = -2.62 * kx, z = s * 0.72 * kz, yb = s1 - 0.1 * k, h = t2 + 1.25 * k - yb, r = 0.27 * k;
    block(b, kit.trim, x, yb, z, 0.75 * kx, 0.72 * kz, 0.55 * k, { top: [0.85, 0.85], ch: 0.15 * k });
    b.cylb(kit.metal, r, h, r * 0.15, [x, yb, z], 'y', 12);
    for (const f of [0.35, 0.6, 0.85]) b.cylb(kit.trim, r * 1.14, 0.07 * k, 0.01, [x, yb + h * f, z], 'y', 12);
    b.cyl(kit.trim, r * 0.8, r * 0.8, 0.04, [x, yb + h - 0.01, z], 'y', 10);
    b.cyl(kit.hot, r * 0.62, r * 0.62, 0.03, [x, yb + h + 0.01, z], 'y', 10);
    pbox(b, kit.metal, 0.5 * kx, 0.08 * k, 0.12 * kz, x + 0.3 * kx, yb + h * 0.6, z);
    // coolant run from the stack base forward to the commander's tower (clamped to the roof)
    pipeRun(b, kit, [[x + 0.35 * kx, yb + 0.5 * k, z], [x + 0.6 * kx, t2 + 0.12 * k, z * 0.9], [cbx - 0.62 * kx, t2 + 0.12 * k, z * 0.7]], 0.07 * k, kit.joint);
  });
  glowGrille(b, kit, -3.4 * kx, yt + 0.72 * k, 0, 1.2 * kz, 0.55 * k, 3, -1);
  // crew access at the back: a ladder from the skirt-top ledge up the casemate wall, a rail along the roof's rear edge
  ladder(b, kit, [-2.86 * kx, s1, -1.2 * kz], [-2.86 * kx, t2 + 0.12 * k, -1.2 * kz], 0.32 * k, [0, 0, 1], [-1, 0, 0], 0.03 * k);
  if (fine) handrail(b, kit, [[-2.02 * kx, t2 + 0.3 * k, -1.25 * kz], [-2.02 * kx, t2 + 0.3 * k, -0.55 * kz], [-1.95 * kx, t2 + 0.3 * k, -0.35 * kz]], 0.025 * k, 0.3 * k);
  banner(b, kit, -2.25 * kx, t2 - 0.1, -1.55 * kz, 1.9 * k, 0.6 * k, -1);

  // ---- rear-right corner gun tower for the medium (built at the mount) + a plain sensor tower on the other side
  const towers = new Map<MountSpec, number>();
  const tt = t2 + 0.2 * k;
  const gunTower = (x: number, z: number, r: number, top: number) => {
    const P = ngon(8, r, r);
    planLoft(b, kit.hull, P, [[s1 - 0.45 * k, 1.22], [s1 + 0.1 * k, 1.14], [s1 + 0.9 * k, 0.86], [top - 0.4 * k, 0.86], [top - 0.3 * k, 1.08], [top - 0.05, 1.08], [top, 1.0]], [x, z]);
    planLoft(b, kit.trim, P, [[s1 + 0.1 * k, 1.16], [s1 + 0.22 * k, 1.12]], [x, z]);
    for (let i = 0; i < 8; i++) {
      const f = wallFace(P, i, [s1 + 0.9 * k, 0.86], [top - 0.42 * k, 0.86], [x, z]);
      if (f.n.x < -0.5 || (i % 2 === 0)) faceBox(b, kit.metal, f, 0, f.h * 0.35, f.w * 0.5, u * 0.5, u * 0.4);
      if (f.n.x > 0.3) faceSlit(b, kit, f, 0, f.h * 0.1, f.w * 0.55, u * 0.38);
    }
  };
  for (const m of c.mounts) {
    if (Math.hypot(m.x - cx3, m.z) < 1.0 * k) continue;
    gunTower(m.x, m.z, Math.max(0.85 * k, m.r * 1.7), tt);
    towers.set(m, tt);
  }

  // ---- legs: hip housings slung under the waist
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.2 * kx, stance.hipY, s * 1.85 * kz] as V3, side: s, t: stance.thick, foot: [-0.2 * kx, 0, s * 2.15 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => {
      block(b, kit.mech, -0.2 * kx, y0 - 0.3 * k, s * 1.85 * kz, 1.4 * kx, 0.9 * kz, 0.6 * k, { top: [0.8, 0.8], ch: 0.2 * k });
      // hip load rams: the housing hangs off the keel on two hydraulic rams
      for (const dx of [-0.5, 0.5]) piston(b, kit, [-0.2 * kx + dx * kx, y0 - 0.05 * k, s * 1.85 * kz], [-0.2 * kx + dx * 1.6 * kx, yt - 0.05, s * 1.7 * kz], 0.1 * k, 0.55, fine);
    });
  }
  const top3 = ngon(8, 1.5 * kx * 0.86, 1.42 * kz * 0.86).map(([x, z]) => [x + cx3, z] as P2);
  const top1 = scl(P1, sTop);
  const deck = (x: number, z: number) => {
    if (Math.abs(x - cbx) < 0.4 * kx && Math.abs(z) < 0.45 * kz) return cbT;
    if (inside(top3, x, z)) return t3;
    if (inside(roof2, x, z)) return t2;
    return inside(top1, x, z) ? s1 : -1;
  };
  return {
    deckAt: deck, top: t2 + 1.25 * k, custom: true, hips,
    seat: (m: MountSpec) => {
      const tw = towers.get(m);
      if (tw !== undefined) { collar(b, kit, m.x, tw, m.z, m.r, tw - 0.1, 18); return { y: tw, socket: true }; }
      // roof cupola: a heavy stepped ring drum rising out of the plinth
      const y = t3 + 0.32 * k, R = m.r * 1.35;
      b.lathe(kit.hull, [[0, 0], [R * 1.2, 0], [R * 1.12, 0.1 * k], [R, y - t3], [0, y - t3]], [m.x, t3 - 0.02, m.z], 'y', 22);
      b.lathe(kit.trim, [[R * 1.18, 0], [R * 1.24, 0], [R * 1.24, 0.08 * k], [R * 1.18, 0.08 * k]], [m.x, t3 + 0.02, m.z], 'y', 22);
      collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 22);
      return { y, socket: true };
    },
  };
}

registerChassis('monolith', monolith);
