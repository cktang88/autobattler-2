// Kinetic guns: machine guns (pintle nests, ball mounts), autocannons (low wedges, quad AA cradles), scatterguns,
// gatlings (fork mounts with fat barrel clusters), tank cannons (cast domes, angular wedges, twin hexes, siege
// casemates), gauss (square coil barrels), sniper (open long rifle), rails (twin glowing prongs), flak and point defence.

import { calibreMm } from '../../render/weaponsize.ts';
import { accent, band, ball, barrel, bx, capsule, cbox, shell, type Station, type WCtx } from './wkit.ts';

export function buildGun(C: WCtx): void {
  const v = C.mod.visual;
  if (v === 'gatling') return gatling(C);
  if (v === 'shotgun') return scatter(C);
  if (v === 'pointdef') return pointDefence(C);
  if (v === 'flak') return flak(C);
  if (v === 'cannon') return C.tier >= 4 ? siegeCasemate(C) : C.nb >= 2 ? twinHex(C) : C.c < 0.6 ? castDome(C) : wedgeTank(C);
  if (v === 'gauss') return gauss(C);
  if (v === 'sniper') return sniper(C);
  if (v === 'rail') return rail(C);
  // 'gun'
  if (C.nb >= 4) return quadAA(C);
  if (C.tier === 1) return calibreMm(C.mod) < 15 ? pintle(C) : ballMount(C);
  return wedgeAC(C);
}

const zs = (n: number, gap: number) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);

/** MG nest: octagonal pedestal, receiver, slanted gun shield, ammo can. */
function pintle(C: WCtx) {
  const { b, p, rc, kit, r, y0, nb } = C;
  const R = C.bore;
  b.lathe(kit.hull, [[0, 0], [r * 0.72, 0], [r * 0.72, r * 0.14], [r * 0.55, r * 0.26], [0, r * 0.26]], [0, y0, 0], 'y', 8);
  b.cyl(kit.metal, r * 0.12, r * 0.1, r * 0.3, [0, y0 + r * 0.26, 0], 'y', 6);
  C.t.pitch.position.set(r * 0.05, y0 + r * 0.62, 0);
  const w = nb > 1 ? r * 0.5 : r * 0.32;
  cbox(p, kit.trim, -r * 0.05, 0, 0, r * 0.75, r * 0.3, w);
  bx(p, kit.panel, -r * 0.05, -r * 0.05, w / 2 + r * 0.12, r * 0.38, r * 0.3, r * 0.22);
  // gun shield: leaning plate, wider than the gun
  cbox(p, kit.hull, r * 0.38, r * 0.02, 0, r * 0.1, r * 0.72, r * 1.15, r * 0.04, [0, 0, -0.28]);
  accent(C, r * 0.45, r * 0.02, -r * 0.32, r * 0.08, r * 0.2, [0, 0, -0.28 + Math.PI / 2], p);
  const len = C.D * (0.95 + 0.35 * C.c);
  for (const z of zs(nb, w * 0.62)) barrel(C, rc, { len, rad: R, x0: r * 0.25, z, seg: 6, brake: calibreMm(C.mod) > 10 ? 'cone' : 'none', taper: 0.9 });
  C.t.rate = 0.12;
}

/** Small autocannon in a squashed ball with a sight pod. */
function ballMount(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = C.bore;
  ball(b, kit.hull, 0, y0 + r * 0.42, 0, r * 0.82, 0.62, 10);
  bx(b, kit.panel, -r * 0.2, y0 + r * 0.4, r * 0.78, r * 0.5, r * 0.32, r * 0.18);
  C.t.pitch.position.set(r * 0.55, y0 + r * 0.42, 0);
  ball(p, kit.trim, 0, 0, 0, r * 0.3, 1, 8, 'x');
  cbox(p, kit.metal, -r * 0.1, r * 0.32, -r * 0.22, r * 0.4, r * 0.2, r * 0.2);
  bx(p, kit.glass, r * 0.11, r * 0.32, -r * 0.22, r * 0.03, r * 0.12, r * 0.14);
  barrel(C, rc, { len: C.D * 1.1, rad: R, x0: r * 0.1, seg: 7, brake: 'flash' });
  accent(C, -r * 0.35, y0 + r * 0.92, 0, r * 0.4, r * 0.12);
  C.t.rate = 0.2;
}

/** Medium autocannon: low arrow-head wedge turret, mantlet, one/two long barrels, feed chute. */
function wedgeAC(C: WCtx) {
  const { b, p, rc, kit, r, y0, nb } = C;
  const R = C.bore, h = r * 0.52;
  const st: Station[] = [[-r * 0.9, r * 0.5, r * 0.36, h * 0.85], [-r * 0.6, r * 0.88, r * 0.62, h], [r * 0.2, r * 0.88, r * 0.62, h], [r * 0.95, r * 0.28, r * 0.16, h * 0.68]];
  shell(b, kit.hull, st, y0);
  C.t.pitch.position.set(r * 0.62, y0 + h * 0.52, 0);
  const gap = R * 3.4;
  cbox(p, kit.trim, 0, 0, 0, r * 0.3, h * 0.62, nb > 1 ? gap * nb + R * 3 : R * 5.5);
  const len = C.D * (1.0 + 0.35 * C.c);
  for (const z of zs(nb, gap)) barrel(C, rc, { len, rad: R, x0: r * 0.1, z, seg: 7, sleeve: C.c > 0.6, brake: C.c > 0.6 ? 'cone' : 'flash' });
  bx(b, kit.panel, -r * 0.35, y0 + h * 0.75, r * 0.72, r * 0.6, h * 0.5, r * 0.22);
  cbox(b, kit.trim, -r * 0.45, y0 + h + r * 0.06, -r * 0.2, r * 0.26, r * 0.12, r * 0.26);
  accent(C, -r * 0.1, y0 + h + 0.002, r * 0.25, r * 0.55, r * 0.1);
  C.t.rate = 0.18 + (1 - C.c) * 0.1;
}

/** Quad AA: central drum, two side cradles with stacked barrels, search radar at the back. */
function quadAA(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = C.bore;
  b.lathe(kit.hull, [[0, 0], [r * 0.6, 0], [r * 0.62, r * 0.4], [r * 0.45, r * 0.58], [0, r * 0.58]], [0, y0, 0], 'y', 10);
  b.cyl(kit.metal, r * 0.04, r * 0.04, r * 0.4, [-r * 0.45, y0 + r * 0.5, 0], 'y', 5);
  cbox(b, kit.panel, -r * 0.45, y0 + r * 0.95, 0, r * 0.08, r * 0.24, r * 0.6, r * 0.03, [0, 0, 0.3]);
  C.t.pitch.position.set(r * 0.05, y0 + r * 0.42, 0);
  C.t.pitch.rotation.z = 0.32;
  bx(p, kit.trim, 0, 0, 0, r * 0.3, r * 0.18, r * 1.0);
  const len = C.D * 1.0;
  for (const s of [-1, 1]) {
    cbox(p, kit.hull, r * 0.05, 0, s * r * 0.62, r * 0.75, r * 0.5, r * 0.3);
    for (const y of [-r * 0.12, r * 0.12]) barrel(C, rc, { len, rad: R, x0: r * 0.35, y, z: s * r * 0.62, seg: 6, brake: 'flash' });
  }
  accent(C, r * 0.05, r * 0.26, -r * 0.62, r * 0.5, r * 0.2, undefined, p);
  C.t.rate = 0.1;
}

/** Scattergun: blunt riot casemate, short fat barrel with a bell muzzle, drum magazine. */
function scatter(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const h = r * 0.55;
  shell(b, kit.hull, [[-r * 0.75, r * 0.62, r * 0.48, h], [r * 0.45, r * 0.7, r * 0.5, h], [r * 0.72, r * 0.55, r * 0.36, h * 0.72]], y0);
  C.t.pitch.position.set(r * 0.62, y0 + h * 0.5, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.25, h * 0.6, r * 0.55);
  const R = Math.max(C.bore, r * 0.17);
  barrel(C, rc, { len: C.D * 0.62, rad: R, x0: r * 0.05, seg: 8, brake: 'cone', taper: 1 });
  rc.cylb(kit.panel, r * 0.24, r * 0.2, r * 0.03, [r * 0.38, -R - r * 0.16, 0], 'y', 8);
  C.t.rate = 0.5;
}

/** APS: sensor dome with a lens emitter on a short arm. */
function pointDefence(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  b.lathe(kit.hull, [[0, 0], [r * 0.7, 0], [r * 0.62, r * 0.25], [r * 0.38, r * 0.5], [0, r * 0.58]], [0, y0, 0], 'y', 10);
  cbox(b, kit.panel, -r * 0.1, y0 + r * 0.62, 0, r * 0.1, r * 0.3, r * 0.5, r * 0.03, [0, 0, 0.35]);
  C.t.pitch.position.set(r * 0.35, y0 + r * 0.38, r * 0.3);
  ball(p, kit.trim, 0, 0, 0, r * 0.22, 1, 8, 'x');
  rc.cyl(kit.metal, r * 0.13, r * 0.11, r * 0.45, [0, 0, 0], 'x', 7);
  rc.cyl(kit.glass, r * 0.1, r * 0.1, r * 0.03, [r * 0.45, 0, 0], 'x', 7);
  rc.cyl(kit.rail, r * 0.05, r * 0.05, r * 0.02, [r * 0.47, 0, 0], 'x', 6);
  C.muzzle(r * 0.5, 0, 0);
  C.t.shot = 'beam';
  C.t.rate = 0.3;
}

/** Flak: open AA mount: drum base, tall cheek plates, elevated barrels with clip racks. */
function flak(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const n = Math.max(1, C.nb);
  const R = C.bore;
  b.lathe(kit.hull, [[0, 0], [r * 0.8, 0], [r * 0.8, r * 0.18], [r * 0.6, r * 0.3], [0, r * 0.3]], [0, y0, 0], 'y', C.tier >= 4 ? 12 : 10);
  const cols = n >= 4 ? 2 : n, rows = n >= 4 ? 2 : 1;
  const gap = R * 3.6, wid = cols * gap + R * 2;
  for (const s of [-1, 1]) shell(b, kit.trim, [[-r * 0.55, r * 0.07, r * 0.05, r * 0.75], [r * 0.25, r * 0.07, r * 0.05, r * 0.55]], y0 + r * 0.2, s * (wid / 2 + r * 0.1));
  C.t.pitch.position.set(0, y0 + r * 0.7, 0);
  C.t.pitch.rotation.z = 0.5;
  cbox(p, kit.hull, 0, 0, 0, r * 0.75, r * (0.35 + 0.22 * (rows - 1)), wid, r * 0.06);
  const len = C.D * (1.05 + 0.2 * C.c);
  for (let j = 0; j < rows; j++) for (const z of zs(cols, gap)) {
    const y = rows > 1 ? (j - 0.5) * R * 3.4 : 0;
    barrel(C, rc, { len, rad: R, x0: r * 0.2, y, z, seg: 7, brake: 'slot' });
    bx(rc, kit.panel, -r * 0.05, y + R * 2.2 + r * 0.05, z, r * 0.35, r * 0.12, R * 2.2);
  }
  accent(C, -r * 0.1, r * (0.18 + 0.11 * (rows - 1)), 0, r * 0.4, wid * 0.6, undefined, p);
  C.t.shot = 'shell';
  C.t.rate = 0.35;
}

/** Gatling: fork-mounted drum receiver with a fat spinning barrel cluster and a side ammo drum. */
function gatling(C: WCtx) {
  const { b, p, rc, sp, kit, r, y0 } = C;
  const n = Math.max(5, C.nb);
  const rb = Math.max(C.bore, r * 0.1), cr = Math.max(rb * 2.5, r * 0.28);
  // yoke
  b.lathe(kit.hull, [[0, 0], [r * 0.72, 0], [r * 0.72, r * 0.16], [r * 0.6, r * 0.24], [0, r * 0.24]], [0, y0, 0], 'y', 10);
  for (const s of [-1, 1]) cbox(b, kit.trim, -r * 0.05, y0 + r * 0.45, s * (cr + r * 0.3), r * 0.55, r * 0.55, r * 0.14, r * 0.05);
  C.t.pitch.position.set(-r * 0.05, y0 + r * 0.55, 0);
  // receiver drum (pitches with the barrels)
  p.lathe(kit.hull, [[0, -r * 0.55], [cr * 0.9, -r * 0.55], [cr + r * 0.12, -r * 0.4], [cr + r * 0.12, r * 0.2], [cr + r * 0.02, r * 0.32], [0, r * 0.32]], [0, 0, 0], 'x', 10);
  // side ammo drum + chute
  p.cylb(kit.panel, r * 0.32, r * 0.3, r * 0.05, [-r * 0.2, 0, -(cr + r * 0.16)], '-z', 10);
  bx(p, kit.trim, -r * 0.02, -r * 0.12, -(cr + r * 0.06), r * 0.3, r * 0.14, r * 0.12);
  accent(C, -r * 0.25, cr + r * 0.12, 0, r * 0.5, r * 0.14, undefined, p);
  const len = C.D * (0.95 + 0.25 * C.c);
  C.spin('x', [r * 0.32, 0, 0]);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; sp.cyl(kit.metal, rb, rb, len, [0, Math.sin(a) * cr, Math.cos(a) * cr], 'x', 6); }
  sp.cyl(kit.trim, cr * 0.55, cr * 0.55, len * 0.96, [0, 0, 0], 'x', 6);
  band(sp, kit.steel, len * 0.35, 0, 0, cr + rb * 1.2, r * 0.07, 8);
  band(sp, kit.steel, len * 0.96, 0, 0, cr + rb * 1.3, r * 0.1, 8);
  rc.lathe(kit.trim, [[0, 0], [cr + rb * 1.5, 0], [cr + rb * 1.5, r * 0.14], [0, r * 0.14]], [r * 0.25, 0, 0], 'x', 10);
  C.muzzle(r * 0.32 + len + r * 0.05, 0, 0);
  C.t.rate = 0.07;
}

const tankCommon = (C: WCtx, roofY: number, cx: number, cz: number) => {
  const { b, kit, r } = C;
  b.lathe(kit.trim, [[0, 0], [r * 0.17, 0], [r * 0.15, r * 0.1], [0, r * 0.12]], [cx, roofY - 0.002, cz], 'y', 8);
  bx(b, kit.glass, cx + r * 0.15, roofY + r * 0.05, cz, r * 0.03, r * 0.05, r * 0.12);
};

/** 75 mm class: rounded cast turret (squashed dome) with a bustle box and a long gun. */
function castDome(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = C.bore, h = r * 0.6;
  b.lathe(kit.hull, [[0, 0], [r * 0.82, 0], [r * 0.86, h * 0.3], [r * 0.7, h * 0.75], [r * 0.38, h], [0, h]], [-r * 0.08, y0, 0], 'y', 12);
  cbox(b, kit.panel, -r * 0.88, y0 + h * 0.45, 0, r * 0.35, h * 0.5, r * 0.9);
  tankCommon(C, y0 + h, -r * 0.3, -r * 0.3);
  accent(C, -r * 0.88, y0 + h * 0.71, 0, r * 0.3, r * 0.6);
  C.t.pitch.position.set(r * 0.62, y0 + h * 0.48, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.32, h * 0.6, R * 5.5, r * 0.06, undefined, 0.8);
  barrel(C, rc, { len: C.D * 1.2, rad: R, x0: r * 0.1, seg: 8, evac: true, brake: 'cone' });
  C.t.shot = 'shell';
  C.t.rate = 1.0;
}

/** 120 mm class: angular wedge turret with a long bustle, chunky mantlet, sleeve, evacuator, slot brake. */
function wedgeTank(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = C.bore, h = r * 0.5;
  shell(b, kit.hull, [[-r * 1.05, r * 0.42, r * 0.32, h * 0.85], [-r * 0.7, r * 0.8, r * 0.6, h], [r * 0.3, r * 0.86, r * 0.62, h], [r * 0.75, r * 0.62, r * 0.42, h * 0.85], [r * 0.98, r * 0.3, r * 0.2, h * 0.6]], y0);
  for (const s of [-1, 1]) cbox(b, kit.panel, -r * 0.3, y0 + h * 0.5, s * r * 0.9, r * 0.9, h * 0.55, r * 0.08, r * 0.025, [0, -s * 0.06, 0]);
  tankCommon(C, y0 + h, -r * 0.45, -r * 0.32);
  accent(C, -r * 0.2, y0 + h + 0.002, r * 0.3, r * 0.6, r * 0.12);
  C.t.pitch.position.set(r * 0.82, y0 + h * 0.52, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.35, h * 0.72, R * 6, r * 0.06, undefined, 0.8);
  barrel(C, rc, { len: C.D * 1.25, rad: R, x0: r * 0.12, seg: 8, sleeve: true, evac: true, brake: 'slot' });
  C.t.shot = 'shell';
  C.t.rate = 1.2;
}

/** Twin 120: wide flat hex turret, two barrels on one broad mantlet. */
function twinHex(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = C.bore, h = r * 0.46, gap = R * 3.4;
  shell(b, kit.hull, [[-r * 0.95, r * 0.5, r * 0.4, h * 0.9], [-r * 0.5, r * 0.95, r * 0.75, h], [r * 0.45, r * 0.95, r * 0.75, h], [r * 0.95, r * 0.55, r * 0.42, h * 0.8]], y0);
  tankCommon(C, y0 + h, -r * 0.5, r * 0.4);
  cbox(b, kit.panel, -r * 0.4, y0 + h + r * 0.05, -r * 0.35, r * 0.4, r * 0.1, r * 0.3);
  accent(C, -r * 0.1, y0 + h + 0.002, 0, r * 0.2, r * 0.9);
  C.t.pitch.position.set(r * 0.85, y0 + h * 0.5, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.32, h * 0.7, gap + R * 6, r * 0.06, undefined, 0.85);
  for (const z of zs(2, gap)) barrel(C, rc, { len: C.D * 1.15, rad: R, x0: r * 0.1, z, seg: 8, evac: true, brake: 'slot' });
  C.t.shot = 'shell';
  C.t.rate = 0.9;
}

/** 240 mm siege gun: tall sloped casemate, monster barrel with recoil cylinders. */
function siegeCasemate(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = C.bore, h = r * 0.62;
  shell(b, kit.hull, [[-r * 0.95, r * 0.68, r * 0.45, h * 0.9], [r * 0.15, r * 0.78, r * 0.5, h], [r * 0.6, r * 0.78, r * 0.5, h * 0.7], [r * 0.9, r * 0.62, r * 0.42, h * 0.32]], y0);
  for (const s of [-1, 1]) cbox(b, kit.panel, -r * 0.35, y0 + h * 0.45, s * r * 0.82, r * 1.0, h * 0.6, r * 0.1, r * 0.03);
  tankCommon(C, y0 + h, -r * 0.55, r * 0.35);
  b.lathe(kit.metal, [[0, 0], [r * 0.09, 0], [r * 0.09, r * 0.18], [0, r * 0.2]], [-r * 0.7, y0 + h, -r * 0.4], 'y', 6);
  accent(C, -r * 0.35, y0 + h + 0.002, -r * 0.05, r * 0.7, r * 0.14);
  C.t.pitch.position.set(r * 0.55, y0 + h * 0.6, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.4, h * 0.85, R * 5, r * 0.07, undefined, 0.85);
  for (const s of [-1, 1]) p.cyl(kit.steel, R * 0.4, R * 0.4, C.D * 0.45, [r * 0.1, R * 1.5, s * R * 1.2], 'x', 6);
  barrel(C, rc, { len: C.D * 1.4, rad: R, x0: r * 0.15, seg: 10, sleeve: true, evac: true, brake: 'slot' });
  C.t.shot = 'shell';
  C.t.rate = 2.2;
}

/** Gauss: flat angular casemate, square-section barrel with glowing coil rings, rear capacitor tanks. */
function gauss(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = Math.max(C.bore, r * 0.14), h = r * 0.48;
  shell(b, kit.hull, [[-r * 0.9, r * 0.75, r * 0.52, h], [r * 0.4, r * 0.8, r * 0.55, h], [r * 0.85, r * 0.45, r * 0.3, h * 0.55]], y0);
  for (const s of [-1, 1]) {
    capsule(b, kit.panel, -r * 0.55, y0 + h + r * 0.1, s * r * 0.35, r * 0.15, r * 0.7, 'x', 8);
    bx(b, kit.rail, -r * 0.55, y0 + h + r * 0.255, s * r * 0.35, r * 0.4, r * 0.02, r * 0.05);
  }
  C.acc = true;
  accent(C, r * 0.25, y0 + h + 0.002, 0, r * 0.25, r * 0.6);
  C.t.pitch.position.set(r * 0.62, y0 + h * 0.55, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.3, h * 0.7, R * 4.4, r * 0.05);
  const len = C.D * 1.3;
  cbox(rc, kit.metal, len / 2 + r * 0.05, 0, 0, len, R * 2.1, R * 2.1, R * 0.35);
  for (let i = 1; i <= 4; i++) rc.lathe(i % 2 ? kit.rail : kit.steel, [[0, 0], [R * 1.75, 0], [R * 1.75, R * 0.7], [0, R * 0.7]], [len * (0.18 + i * 0.17), 0, 0], 'x', 4, [Math.PI / 4, 0, 0]);
  cbox(rc, kit.steel, len + r * 0.08, 0, 0, R * 1.2, R * 2.8, R * 2.8, R * 0.3);
  C.muzzle(len + r * 0.1 + R * 0.6, 0, 0);
  C.t.shot = 'shell';
  C.t.rate = 1.4;
}

/** Sniper: open pedestal, long slender rifle, big block brake, scope with a glinting lens. */
function sniper(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = C.bore;
  b.lathe(kit.hull, [[0, 0], [r * 0.6, 0], [r * 0.55, r * 0.15], [r * 0.3, r * 0.24], [0, r * 0.24]], [0, y0, 0], 'y', 8);
  cbox(b, kit.trim, -r * 0.05, y0 + r * 0.4, 0, r * 0.35, r * 0.3, r * 0.3);
  C.t.pitch.position.set(0, y0 + r * 0.6, 0);
  cbox(rc, kit.hull, -r * 0.05, 0, 0, r * 1.0, r * 0.2, r * 0.16, r * 0.04);
  cbox(rc, kit.trim, -r * 0.6, -r * 0.04, 0, r * 0.3, r * 0.26, r * 0.13, r * 0.03);
  barrel(C, rc, { len: C.D * 1.75, rad: R, x0: r * 0.3, seg: 6, brake: 'block', taper: 0.9 });
  capsule(rc, kit.metal, r * 0.02, r * 0.22, 0, r * 0.075, r * 0.62, 'x', 6);
  rc.cyl(kit.glass, r * 0.07, r * 0.07, r * 0.02, [r * 0.33, r * 0.22, 0], 'x', 6);
  for (const s of [-1, 1]) rc.strut(kit.steel, [r * 0.8, -R, 0], [r * 1.0, -r * 0.4, s * r * 0.18], r * 0.022, r * 0.018, 4);
  accent(C, -r * 0.2, r * 0.11, 0, r * 0.4, r * 0.1, undefined, rc);
  C.t.rate = 2.0;
}

/** Rail: low wedge, twin steel prongs with a glowing channel and coil rings, rear capacitor block. */
function rail(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = Math.max(C.bore, r * 0.11), h = r * 0.46;
  const xl = C.tier >= 5;
  shell(b, kit.hull, [[-r * 0.95, r * 0.55, r * 0.4, h * 0.9], [-r * 0.4, r * 0.82, r * 0.58, h], [r * 0.5, r * 0.7, r * 0.5, h], [r * 0.95, r * 0.32, r * 0.2, h * 0.65]], y0);
  cbox(b, kit.trim, -r * 0.55, y0 + h + r * 0.1, 0, r * 0.5, r * 0.2, r * 0.55);
  for (const s of [-1, 1]) bx(b, kit.rail, -r * 0.55, y0 + h + r * 0.12, s * r * 0.28, r * 0.36, r * 0.1, r * 0.02);
  accent(C, r * 0.2, y0 + h + 0.002, 0, r * 0.4, r * 0.18);
  C.t.pitch.position.set(r * 0.5, y0 + h * 0.55, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.32, h * 0.75, R * 6);
  const len = C.D * (xl ? 1.6 : 1.3 + 0.2 * C.c);
  for (const s of [-1, 1]) cbox(rc, kit.steel, len / 2 + r * 0.05, 0, s * R * 1.35, len, R * 2.4, R * 1.0, R * 0.3);
  bx(rc, kit.rail, len / 2 + r * 0.1, 0, 0, len * 0.95, R * 1.2, R * 1.2);
  const nr = xl ? 5 : C.c > 0.6 ? 4 : 3;
  for (let i = 0; i < nr; i++) rc.lathe(kit.trim, [[0, 0], [R * 2.6, 0], [R * 2.6, R * 0.9], [0, R * 0.9]], [len * (0.12 + (0.7 * i) / Math.max(1, nr - 1)), 0, 0], 'x', 6, [Math.PI / 6, 0, 0]);
  C.muzzle(len + r * 0.08, 0, 0);
  C.t.shot = 'beam';
  C.t.rate = 2.0;
}
