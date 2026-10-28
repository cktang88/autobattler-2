// Year-2500 weapon designs: not modern weapons scaled up but new hardware on new physics, in the Mechabellum vein
// (angular armoured housings, faceted glowing cores, hollow bores, team-colour warheads). Same rig contract as the
// other families (weapons/wkit.ts): b = yaw housing, p = pitch cradle, rc = recoil, sp = spin; +X = muzzle.
//
//   rotary      rotary pulse driver (minigun, avenger): thick hex barrels round a glowing core rod, clamp plates,
//               hollow front collars, power cells on the receiver
//   blades      missile blades (rocket pods, MLRS, SAM, swarm, VLS, AA pair, rail rocket, ATGM): two tall angular launch
//               slabs either side of an elevating core, staggered cells of team-colour pyramid warheads in their faces
//   arc         arc projector (tesla family): angular pylons round a floating faceted core in a halo of plates
//   lens        lens projector (lasers): long finned emitter body, glowing channel, hollow hood round a glowing iris
//   cradle      plasma cradle: armoured jaws gripping an elongated glowing crystal core, hollow emitter nozzle
//   flame       flame projector: flat flared nozzle with a hot mouth, armoured fuel cells on the back

import type { V3 } from '../geo.ts';
import type { Bld } from '../geo.ts';
import type { MatLike } from '../materials.ts';
import { barrel, bx, cbox, jacket, mechHousing, plinth, type WCtx } from './wkit.ts';

/** hollow hex muzzle collar along +X from x (length l, outer radius Ro): inner wall + a near-black core inside */
export function hollowMuzzle(C: WCtx, B: Bld, x: number, y: number, z: number, Ro: number, l: number, mat: MatLike = C.kit.metal): void {
  const Ri = Ro * 0.58;
  B.lathe(mat, [[Ri, 0], [Ro * 0.9, 0], [Ro, l * 0.25], [Ro, l], [Ri, l], [Ri, 0]], [x, y, z], 'x', 6);
  B.lathe(C.kit.rubber, [[0, l * 0.3], [Ri * 1.01, l * 0.3], [Ri * 1.01, l * 0.36], [0, l * 0.36]], [x, y, z], 'x', 6);
}

/** faceted crystal (octahedron) of radius R and half-height h along `axis` */
function crystal(B: Bld, mat: MatLike, x: number, y: number, z: number, R: number, h: number, axis: 'x' | 'y' = 'y'): void {
  B.lathe(mat, [[0, -h], [R, 0], [0, h]], [x, y, z], axis, 4);
}

/** rectangular ring in the y-z plane at x (half-height hh, half-width ww) */
const rect = (x: number, hh: number, ww: number, y = 0, z = 0): V3[] => [[x, y + hh, z - ww], [x, y + hh, z + ww], [x, y - hh, z + ww], [x, y - hh, z - ww]];

// ---- rotary pulse driver --------------------------------------------------------------------------------------------
export function rotary(C: WCtx): void {
  const { p, rc, sp, kit, r, y0 } = C;
  const big = C.tier >= 4, n = big ? 4 : 3;
  const h = r * 0.5;
  mechHousing(C, r * 1.5, r * 0.7, h, 0.6);
  C.t.pitch.position.set(r * 0.5, y0 + h * 0.55, 0);
  const cr = r * (big ? 0.2 : 0.17), br = cr * 0.62, len = C.D * (big ? 0.95 : 0.8);
  // receiver block and power cells
  cbox(p, kit.trim, 0, 0, 0, r * 0.5, h * 0.85, r * 0.7, r * 0.06, undefined, 0.85);
  for (const s of [-1, 1]) {
    cbox(p, kit.hull, -r * 0.05, 0, s * r * 0.42, r * 0.5, h * 0.75, r * 0.16, r * 0.03);
    bx(p, kit.glow, r * 0.05, h * 0.18, s * r * 0.5, r * 0.24, r * 0.03, r * 0.02);
  }
  // rear clamp (recoils), the spinning cluster: thick hex barrels round a glowing core, a mid clamp, hollow collars
  jacket(rc, kit.hull, r * 0.18, r * 0.42, 0, 0, (cr + br) * 2.3, (cr + br) * 2.3, 0.94);
  C.spin('x', [r * 0.42, 0, 0]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, yy = Math.sin(a) * cr, zz = Math.cos(a) * cr;
    sp.lathe(kit.metal, [[0, 0], [br, 0], [br, len - br * 2.2], [0, len - br * 2.2]], [0, yy, zz], 'x', 6);
    hollowMuzzle(C, sp, len - br * 2.2, yy, zz, br * 1.3, br * 2.2);
  }
  sp.lathe(kit.plasma, [[0, 0], [cr * 0.32, 0], [cr * 0.32, len * 0.86], [0, len * 0.86]], [0, 0, 0], 'x', 6);
  jacket(sp, kit.trim, len * 0.42, len * 0.5, 0, 0, (cr + br) * 2.15, (cr + br) * 2.15, 0.95);
  C.muzzle(r * 0.42 + len + r * 0.04, 0, 0);
  C.t.rate = big ? 0.05 : 0.07;
}

// ---- missile blades ------------------------------------------------------------------------------------------------
export function blades(C: WCtx): void {
  const { p, rc, kit, r, y0 } = C;
  const n = Math.max(2, C.nb), per = Math.ceil(n / 2);
  const rows = Math.min(per, per > 4 ? Math.ceil(per / 2) : per), cols = Math.ceil(per / rows);
  plinth(C, 0.62, 0.24);
  C.t.pitch.position.set(-r * 0.1, y0 + r * 0.52, 0);
  C.t.pitch.rotation.z = 0.32;
  // elevating core between the blades
  cbox(p, kit.trim, 0, 0, 0, r * 0.62, r * 0.4, r * 0.34, r * 0.05, undefined, 0.85);
  bx(p, kit.glow, r * 0.16, r * 0.21, 0, r * 0.3, r * 0.02, r * 0.16);
  const cell = Math.min(r * 0.26, (r * 1.1) / rows), bl = r * 1.45;
  const bh = rows * cell + r * 0.14, bw = cols * cell + r * 0.08;
  const tip = C.mod.id === 'incendiary' ? kit.hot : kit.accent;
  for (const s of [-1, 1]) {
    const z = s * (r * 0.17 + bw / 2 + r * 0.03);
    // the blade: a long angular slab with a team spine along its top and a dark exhaust strip at the back
    cbox(rc, kit.hull, 0, 0, z, bl, bh, bw, Math.min(bw, bh) * 0.22, undefined, 0.88);
    cbox(rc, kit.panel, -bl * 0.1, bh / 2 + r * 0.04, z, bl * 0.7, r * 0.08, bw * 1.06, r * 0.025);
    // armoured wedge prow over the cell face and a side fin
    cbox(rc, kit.panel, bl * 0.42, bh / 2 + r * 0.02, z, bl * 0.26, r * 0.12, bw * 1.1, r * 0.04, [0, 0, -0.35]);
    cbox(rc, kit.trim, -bl * 0.15, -bh * 0.1, z + Math.sign(z) * (bw / 2 + r * 0.02), bl * 0.55, bh * 0.5, r * 0.04, r * 0.01);
    bx(rc, kit.trim, -bl / 2 - r * 0.02, 0, z, r * 0.05, bh * 0.8, bw * 0.8);
    // cells: dark sockets, team-colour pyramid warheads set into them, staggered by column
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (i * cols + j >= per) continue;
      const yy = (i - (rows - 1) / 2) * cell + (j % 2 ? cell * 0.25 : 0), zz = z + (j - (cols - 1) / 2) * cell;
      bx(rc, kit.rubber, bl / 2 + r * 0.004, yy, zz, r * 0.02, cell * 0.78, cell * 0.78);
      rc.lathe(tip, [[0, 0], [cell * 0.32, 0], [0, cell * 0.42]], [bl / 2 - cell * 0.12, yy, zz], 'x', 4);
      C.muzzle(bl / 2 + cell * 0.4, yy, zz);
    }
  }
  C.acc = true;
  C.t.shot = 'rocket';
  C.t.rate = n >= 8 ? 0.4 : 0.8;
}

// ---- arc projector ---------------------------------------------------------------------------------------------------
export function arc(C: WCtx): void {
  const { b, rc, kit, r, y0 } = C;
  const big = C.tier >= 4, n = C.tier >= 5 ? 3 : 2;
  plinth(C, 0.75, 0.28);
  const H = r * (big ? 1.6 : 1.35), cy = y0 + r * 0.25 + H * 0.74;
  // pylons: tall angular blades rising round the core, leaning in, a crystal tip on each
  for (let i = 0; i < n; i++) {
    const a = n === 2 ? (i ? Math.PI / 2 : -Math.PI / 2) : (i / n) * Math.PI * 2 + Math.PI;
    const px = Math.cos(a) * r * 0.46, pz = Math.sin(a) * r * 0.46;
    cbox(b, kit.hull, px, y0 + r * 0.25 + H * 0.45, pz, r * 0.5, H * 0.9, r * 0.18, r * 0.05, [0, -a, 0], 0.62);
    bx(b, kit.panel, px * 1.08, y0 + r * 0.25 + H * 0.3, pz * 1.06, r * 0.3, H * 0.3, r * 0.03, [0, -a, 0]);
    crystal(b, kit.rail, px * 0.9, y0 + r * 0.25 + H * 0.95, pz * 0.9, r * 0.07, r * 0.12);
  }
  // floating core in a halo of six plates (recoil group: it pulses when it fires)
  C.t.pitch.position.set(0, cy, 0);
  crystal(rc, kit.rail, 0, 0, 0, r * (big ? 0.34 : 0.3), r * (big ? 0.52 : 0.46));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    bx(rc, i % 2 ? kit.trim : kit.panel, Math.cos(a) * r * 0.52, 0, Math.sin(a) * r * 0.52, r * 0.07, r * 0.2, r * 0.22, [0, -a, 0]);
  }
  C.muzzle(r * 0.3, 0, 0);
  C.acc = true;
  C.t.rate = 0.95;
}

// ---- lens projector ------------------------------------------------------------------------------------------------
export function lens(C: WCtx): void {
  const { rc, kit, r, y0 } = C;
  const n = C.nb >= 2 ? 2 : 1, h = r * 0.55;
  mechHousing(C, r * 1.5, r * 0.68, h, 0.6);
  C.t.pitch.position.set(r * 0.35, y0 + h * 0.55, 0);
  for (let k = 0; k < n; k++) {
    const z = n > 1 ? (k - 0.5) * r * 0.62 : 0, L = C.D * 0.75, e = r * (n > 1 ? 0.19 : 0.25);
    cbox(rc, kit.hull, L * 0.45, 0, z, L * 0.9, e * 1.5, e * 1.5, e * 0.3, undefined, 0.9);
    for (const f of [0.12, 0.26, 0.4]) bx(rc, kit.trim, L * f, 0, z, L * 0.045, e * 1.95, e * 1.95);
    bx(rc, kit.rail, L * 0.55, e * 0.76, z, L * 0.6, e * 0.08, e * 0.3);
    rc.lathe(kit.trim, [[e * 0.8, 0], [e * 1.25, 0], [e * 1.45, e * 0.8], [e * 0.95, e * 0.8], [e * 0.8, 0]], [L * 0.9, 0, z], 'x', 6);
    rc.lathe(kit.glass, [[0, 0], [e * 0.9, 0], [e * 0.9, e * 0.1], [0, e * 0.1]], [L * 0.92, 0, z], 'x', 6);
    rc.lathe(kit.rail, [[0, 0], [e * 0.42, 0], [e * 0.42, e * 0.12], [0, e * 0.12]], [L * 0.95, 0, z], 'x', 6);
    C.muzzle(L + e, 0, z);
  }
  C.t.rate = n > 1 ? 0.4 : 0.5;
}

// ---- plasma cradle ---------------------------------------------------------------------------------------------------
export function cradle(C: WCtx): void {
  const { rc, kit, r, y0 } = C;
  const big = C.tier >= 4, lance = C.mod.projectile === 'beam', n = Math.min(2, Math.max(1, C.nb));
  const h = r * (big ? 0.6 : 0.52);
  mechHousing(C, r * 1.6, r * 0.72, h, 0.7);
  C.t.pitch.position.set(r * 0.4, y0 + h * 0.55, 0);
  for (let k = 0; k < n; k++) {
    const z = n > 1 ? (k - 0.5) * r * 0.66 : 0, L = C.D * (lance ? 1.0 : 0.8), cr = r * (big ? 0.2 : 0.17) * (n > 1 ? 0.85 : 1);
    // armoured jaws above and below the core, a rear coupling block, a hollow emitter nozzle
    for (const s of [-1, 1]) cbox(rc, kit.hull, L * 0.45, s * cr * 1.3, z, L * 0.75, cr * 0.5, cr * 1.7, cr * 0.16, undefined, 0.84);
    rc.lathe(kit.plasma, [[0, 0], [cr, L * 0.15], [cr, L * 0.55], [0, L * 0.7]], [L * 0.1, 0, z], 'x', 6);
    cbox(rc, kit.trim, 0, 0, z, r * 0.25, cr * 3.0, cr * 2.0, r * 0.04);
    hollowMuzzle(C, rc, L * 0.8, 0, z, cr * 1.15, L * 0.2);
    C.muzzle(L + r * 0.05, 0, z);
  }
  C.t.shot = lance ? 'beam' : 'orb';
  C.t.rate = 1.6;
}

// ---- flame projector -------------------------------------------------------------------------------------------------
export function flame(C: WCtx): void {
  const { b, rc, kit, r, y0 } = C;
  const big = C.tier >= 4, h = r * 0.5;
  mechHousing(C, r * 1.6, r * 0.72, h, 0.5);
  for (const s of [-1, 1]) {
    cbox(b, kit.hull2, -r * 0.7, y0 + h + r * 0.12, s * r * 0.28, r * 0.6, r * 0.24, r * 0.22, r * 0.05);
    bx(b, kit.hot, -r * 0.7, y0 + h + r * 0.245, s * r * 0.28, r * 0.4, r * 0.02, r * 0.1);
  }
  C.t.pitch.position.set(r * 0.5, y0 + h * 0.5, 0);
  const L = C.D * (big ? 0.8 : 0.7), w = r * (big ? 0.26 : 0.22), hh = r * 0.13;
  // nozzle: a box section flaring flat and wide toward a hot mouth
  rc.loft(kit.hull, [rect(0, hh, w * 0.7), rect(L * 0.55, hh * 0.9, w * 0.75), rect(L * 0.85, hh * 0.7, w * 1.15), rect(L, hh * 0.62, w * 1.4)]);
  bx(rc, kit.trim, L * 0.3, hh * 0.95, 0, L * 0.4, r * 0.03, w * 1.1);
  bx(rc, kit.rubber, L + r * 0.002, 0, 0, r * 0.01, hh * 1.0, w * 2.4);
  bx(rc, kit.hot, L + r * 0.006, 0, 0, r * 0.01, hh * 0.5, w * 2.0);
  C.muzzle(L + r * 0.05, 0, 0);
  C.t.shot = 'flame';
  C.t.rate = 0.12;
}

// ---- pulse carbine (machine guns, autocannons, quad AA, scatterguns, flak, point defence, sniper) -----------------
export function carbine(C: WCtx): void {
  const { rc, kit, r } = C;
  const v = C.mod.visual, sniper = v === 'sniper', flak = v === 'flak', pd = v === 'pointdef', scat = v === 'shotgun';
  const h = r * (flak ? 0.55 : 0.5);
  mechHousing(C, r * (sniper ? 1.8 : 1.5), r * (scat ? 0.7 : 0.62), h, sniper ? 1.1 : 0.7);
  const nb = Math.max(1, C.nb), cols = nb >= 4 ? 2 : Math.min(nb, 3), rows = nb >= 4 ? 2 : 1;
  const R = C.bore * (scat ? 1.6 : 1), gap = Math.max(R * 3.2, r * 0.2);
  const len = C.D * (sniper ? 2.4 : scat ? 0.75 : flak ? 1.3 : 1.1);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    barrel(C, rc, { len, rad: R, x0: r * 0.1, y: (i - (rows - 1) / 2) * gap, z: (j - (cols - 1) / 2) * gap, sleeve: sniper, cap: sniper ? 44 : 18,
      brake: flak ? 'slot' : scat ? 'none' : sniper ? 'block' : 'flash' });
  }
  if (sniper) {
    cbox(rc, kit.trim, r * 0.45, R * 2.4 + r * 0.08, 0, r * 0.9, r * 0.12, r * 0.14, r * 0.03);
    bx(rc, kit.rail, r * 0.91, R * 2.4 + r * 0.08, 0, r * 0.02, r * 0.08, r * 0.1);
  }
  if (flak) C.t.pitch.rotation.z = 0.5;
  C.t.shot = flak ? 'shell' : pd ? 'beam' : 'tracer';
  C.t.rate = flak ? 0.35 : pd ? 0.3 : sniper ? 2.0 : scat ? 0.5 : nb >= 4 ? 0.1 : C.tier === 1 ? 0.12 : 0.2;
}

// ---- artillery cradle (mortar, howitzer, barrage, cluster, doomsday) ------------------------------------------------
export function artillery(C: WCtx): void {
  const { rc, kit, r } = C;
  const mortar = C.mod.visual === 'mortar', nb = Math.max(1, C.nb), xl = C.tier >= 5;
  mechHousing(C, r * (mortar ? 1.3 : 1.9), r * (nb > 1 ? 0.85 : 0.7), r * 0.6, mortar ? 0.5 : 1.0, 1);
  const R = C.bore * (mortar ? 1.4 : 1), gap = Math.max(R * 3.2, r * 0.26), len = C.D * (mortar ? 0.9 : 1.6);
  for (let k = 0; k < nb; k++) {
    const z = (k - (nb - 1) / 2) * gap;
    barrel(C, rc, { len, rad: R, x0: r * 0.1, z, sleeve: !mortar, evac: !mortar, brake: mortar ? 'none' : 'slot' });
    if (!mortar) for (const s of [-1, 1]) bx(rc, kit.steel, r * 0.1 + len * 0.22, R * 1.5 * s, z, len * 0.32, R * 0.32, R * 0.32);
  }
  C.t.pitch.rotation.z = mortar ? 0.9 : nb >= 3 ? 0.55 : 0.45;
  C.t.shot = 'shell';
  C.t.rate = mortar ? 1.4 : xl ? 3 : 2.4;
}

// ---- field emitter (heat ray, EMP / stun / disarm, slow beam, sonic, gravity) ---------------------------------------
export function emitter(C: WCtx): void {
  const { rc, kit, r } = C;
  const v = C.mod.visual, id = C.mod.id;
  const core = v === 'heatray' ? kit.hot : v === 'gravity' ? kit.plasma : v === 'slowbeam' ? kit.glow : v === 'sonic' ? kit.lamp : kit.rail;
  mechHousing(C, r * 1.5, r * 0.66, r * 0.55, 0.6);
  const L = C.D * 0.55, e = r * 0.3, x = r * 0.3 + L;
  // three angular prongs reaching forward round the core (top, lower left, lower right)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2, cy = Math.sin(a) * e * 1.05, cz = Math.cos(a) * e * 1.05;
    cbox(rc, kit.hull, r * 0.3 + L * 0.55, cy, cz, L * 1.0, e * 0.42, e * 0.42, e * 0.1, [a - Math.PI / 2, 0, 0], 0.7);
  }
  // hollow hex frame and the glowing core disc inside it
  rc.lathe(kit.trim, [[e * 0.7, 0], [e * 1.0, 0], [e * 1.0, e * 0.25], [e * 0.7, e * 0.25], [e * 0.7, 0]], [x - e * 0.1, 0, 0], 'x', 6);
  rc.lathe(core, [[0, 0], [e * 0.62, 0], [e * 0.62, e * 0.14], [0, e * 0.14]], [x - e * 0.05, 0, 0], 'x', 6);
  C.muzzle(x + e * 0.4, 0, 0);
  C.t.shot = v === 'sonic' || id === 'empcannon' ? 'orb' : 'beam';
  C.t.rate = v === 'heatray' ? 0.7 : id === 'stungun' ? 0.8 : id === 'empcannon' ? 1.3 : v === 'slowbeam' ? 1.0 : v === 'sonic' ? 1.1 : 1.2;
}
