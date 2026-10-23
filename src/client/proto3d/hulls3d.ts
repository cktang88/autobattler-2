// Hull modelling: cross-section lofts with sloped glacis, chamfered shoulders and stepped superstructures, plus the
// deck furniture (hatches, louvres, stowage, drums, exhausts, antennas) and giant-class details.

import * as THREE from 'three';
import { Bld, sec8, mtx, type V3 } from './geo.ts';
import { atlasUV, type Kit, type MatLike } from './materials.ts';

export interface LoftInfo { pts: { x: number; wm: number; wt: number; y2: number; y3: number }[] }
export interface Hull { lofts: LoftInfo[]; top: number; L: number; W: number; yt: number; Hd: number }

/** [x (-1..1), half-width (frac of W/2), top width (frac of that), height (frac of deck height)] */
const RECIPES: Record<string, [number, number, number, number][]> = {
  wedge: [[-1, 0.8, 0.82, 0.8], [-0.9, 1, 0.86, 1.05], [-0.1, 1, 0.8, 1.05], [0.15, 1, 0.78, 0.85], [0.62, 0.9, 0.6, 0.6], [1, 0.52, 0.5, 0.3]],
  box: [[-1, 0.9, 0.9, 0.85], [-0.92, 1, 0.92, 1.08], [-0.1, 1, 0.9, 1.08], [0.15, 1, 0.88, 0.9], [0.6, 1, 0.86, 0.9], [0.78, 0.95, 0.7, 0.68], [1, 0.78, 0.6, 0.42]],
  hex: [[-1, 0.7, 0.8, 0.85], [-0.82, 0.96, 0.85, 1.12], [-0.2, 1, 0.82, 1.12], [0.05, 1, 0.8, 0.92], [0.45, 0.96, 0.7, 0.82], [1, 0.5, 0.5, 0.38]],
  long: [[-1, 0.7, 0.8, 0.8], [-0.9, 0.95, 0.86, 0.95], [0.5, 0.98, 0.8, 1], [0.82, 0.85, 0.6, 0.75], [1, 0.55, 0.5, 0.4]],
  cross: [[-1, 0.74, 0.8, 0.8], [-0.8, 0.9, 0.8, 0.95], [-0.3, 1, 0.8, 1], [0.3, 1, 0.8, 1], [0.6, 0.8, 0.7, 0.8], [1, 0.46, 0.5, 0.45]],
  round: [[-1, 0.5, 0.7, 0.7], [-0.8, 0.9, 0.8, 0.95], [-0.4, 1, 0.8, 1], [0.4, 1, 0.8, 1], [0.8, 0.9, 0.7, 0.85], [1, 0.5, 0.6, 0.55]],
  fortress: [[-1, 0.86, 0.9, 0.8], [-0.9, 1, 0.92, 1], [0.55, 1, 0.86, 1], [0.8, 0.94, 0.7, 0.75], [1, 0.74, 0.6, 0.5]],
  titan: [[-1, 0.84, 0.88, 0.78], [-0.9, 1, 0.9, 1], [0.4, 1, 0.84, 1], [0.78, 0.92, 0.66, 0.72], [1, 0.62, 0.58, 0.42]],
  goliath: [[-1, 0.88, 0.9, 0.85], [-0.9, 1, 0.92, 1], [0.45, 1, 0.86, 1], [0.8, 0.94, 0.66, 0.78], [1, 0.66, 0.6, 0.46]],
  colossal: [[-1, 0.88, 0.9, 0.82], [-0.9, 1, 0.92, 1], [0.5, 1, 0.86, 1], [0.82, 0.94, 0.66, 0.76], [1, 0.68, 0.6, 0.44]],
};
const ALIAS: Record<string, string> = {
  scout: 'wedge', mantis: 'wedge', hunter: 'wedge', interceptor: 'wedge', pod: 'round', carriage: 'box', riot: 'fortress', juggernaut: 'fortress', crab: 'fortress',
  saucer: 'round', mech: 'hex', arachnid: 'round', warlord: 'titan', scorpion: 'goliath', centipede: 'long', siegeplat: 'long', leviathan: 'goliath',
  broodmother: 'goliath', arachne: 'colossal', citadel: 'colossal', colossus: 'titan', lance: 'long', monolith: 'fortress',
};

function addLoft(b: Bld, mat: MatLike, rows: { x: number; wb: number; wm: number; wt: number; y0: number; y1: number; y2: number; y3: number }[]): LoftInfo {
  b.loft(mat, rows.map((r) => sec8(r.x, r.wb, r.wm, r.wt, r.y0, r.y1, r.y2, r.y3)));
  return { pts: rows.map((r) => ({ x: r.x, wm: r.wm, wt: r.wt, y2: r.y2, y3: r.y3 })) };
}

export function topAt(l: LoftInfo, x: number, z: number): number {
  const p = l.pts;
  if (x < p[0].x || x > p[p.length - 1].x) return -1;
  let i = 0;
  while (i < p.length - 2 && p[i + 1].x < x) i++;
  const f = (x - p[i].x) / (p[i + 1].x - p[i].x || 1);
  const lerp = (a: number, c: number) => a + (c - a) * f;
  const wm = lerp(p[i].wm, p[i + 1].wm), wt = lerp(p[i].wt, p[i + 1].wt), y2 = lerp(p[i].y2, p[i + 1].y2), y3 = lerp(p[i].y3, p[i + 1].y3);
  const az = Math.abs(z);
  if (az <= wt) return y3;
  if (az <= wm) return y3 - ((y3 - y2) * (az - wt)) / (wm - wt || 1);
  return -1;
}
export const deckAt = (h: Hull, x: number, z: number): number => {
  let t = -1;
  for (const l of h.lofts) t = Math.max(t, topAt(l, x, z));
  return t;
};

/** Main hull loft. yb = underside, yt = shoulder (track top / fender), Hd = deck height above the shoulder. */
export function buildHull(b: Bld, kit: Kit, shape: string, L: number, W: number, yb: number, yt: number, Hd: number, wi: number, tracked: boolean): Hull {
  const rec = RECIPES[shape] ?? RECIPES[ALIAS[shape] ?? 'box'] ?? RECIPES.box;
  const rows = rec.map(([x, wmF, wtF, hF]) => {
    const wm = (W / 2) * 0.985 * wmF;
    const y3 = yt + hF * Hd;
    return {
      x: (x * L) / 2, wm, wt: wm * wtF, wb: tracked ? Math.min(wm * 0.92, wi) : wm * 0.7,
      y0: yb, y1: yt, y2: yt + (y3 - yt) * 0.38, y3,
    };
  });
  const info = addLoft(b, kit.hull, rows);
  // lower belly plate / skid strip and a rear plate in darker paint for contrast
  b.box(kit.trim, L * 0.8, Math.max(0.03, (yt - yb) * 0.5), rows[2].wb * 2 * 0.98, 0, yb + Math.max(0.03, (yt - yb) * 0.5) / 2, 0, 0.01);
  const rr = rows[0];
  b.box(kit.trim, 0.04, (rr.y3 - yb) * 0.55, rr.wm * 2 * 0.9, rr.x - 0.012, yb + (rr.y3 - yb) * 0.4, 0, 0.01);
  return { lofts: [info], top: Math.max(...rows.map((r) => r.y3)), L, W, yt, Hd };
}

/** Stepped superstructure/casemate loft sitting on the main deck; returns false if there is no room. */
export function addCasemate(b: Bld, kit: Kit, hull: Hull, cx: number, hl: number, hw: number, hh: number): void {
  const base = deckAt(hull, cx, 0);
  if (base < 0) return;
  const y0 = base - 0.01;
  const rows = [
    { x: cx - hl, wb: hw * 0.98, wm: hw, wt: hw * 0.78, y0, y1: y0 + hh * 0.05, y2: y0 + hh * 0.55, y3: y0 + hh * 0.82 },
    { x: cx - hl * 0.82, wb: hw * 0.98, wm: hw, wt: hw * 0.7, y0, y1: y0 + hh * 0.05, y2: y0 + hh * 0.6, y3: y0 + hh },
    { x: cx + hl * 0.55, wb: hw * 0.98, wm: hw, wt: hw * 0.7, y0, y1: y0 + hh * 0.05, y2: y0 + hh * 0.6, y3: y0 + hh },
    { x: cx + hl, wb: hw * 0.8, wm: hw * 0.82, wt: hw * 0.5, y0, y1: y0 + hh * 0.05, y2: y0 + hh * 0.38, y3: y0 + hh * 0.56 },
  ];
  hull.lofts.push(addLoft(b, kit.hull, rows));
  hull.top = Math.max(hull.top, y0 + hh);
}

const dist = (a: [number, number], c: [number, number]) => Math.hypot(a[0] - c[0], a[1] - c[1]);

export interface Mount { x: number; z: number; r: number }

/** Deck furniture. Only on flat deck, never inside a turret ring. */
export function greeble(b: Bld, kit: Kit, hull: Hull, S: number, rnd: () => number, mounts: Mount[]) {
  const { L, W } = hull;
  const free = (x: number, z: number, rad: number) => mounts.every((m) => dist([m.x, m.z], [x, z]) > m.r + rad);
  const flat = (x: number, z: number, rad: number) => {
    const t = deckAt(hull, x, z);
    return t >= 0 && [[rad, 0], [-rad, 0], [0, rad], [0, -rad]].every(([dx, dz]) => Math.abs(deckAt(hull, x + dx, z + dz) - t) < 0.012) ? t : -1;
  };
  const u = 0.05 + 0.028 * S;
  const n = Math.round(5 + 7 * S);
  const kinds = ['hatch', 'vent', 'box', 'drum', 'ant', 'hatch', 'vent', 'light'];
  let drums = 0;
  for (let i = 0; i < n * 3 && n > 0; i++) {
    const x = (rnd() - 0.5) * L * 0.84, z = (rnd() - 0.5) * W * 0.78;
    const rad = u * 2.4;
    const top = flat(x, z, rad);
    if (top < 0 || !free(x, z, rad)) continue;
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    if (kind === 'hatch') {
      b.cylb(kit.trim, u * 1.0, u * 0.45, u * 0.1, [x, top, z], 'y', 12);
      b.box(kit.metal, u * 0.9, u * 0.1, u * 0.14, x, top + u * 0.5, z, 0.003);
      if (S >= 2) for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; b.box(kit.glass, u * 0.22, u * 0.14, u * 0.22, x + Math.cos(a) * u * 1.15, top + u * 0.28, z + Math.sin(a) * u * 1.15, 0.003, [0, -a, 0]); }
    } else if (kind === 'vent') {
      const w = u * 3.4, d = u * 2.2;
      b.box(kit.trim, w, u * 0.3, d, x, top + u * 0.15, z, 0.008);
      for (let k = 0; k < 5; k++) b.box(kit.metal, w * 0.86, u * 0.14, u * 0.14, x, top + u * 0.36, z - d * 0.36 + (k * d * 0.72) / 4, 0.002, [0.5, 0, 0]);
    } else if (kind === 'box') {
      const bw = u * (2.4 + rnd() * 1.6), bd = u * (1.6 + rnd() * 1.2), bh = u * (1.1 + rnd() * 0.8);
      const m = rnd() < 0.5 ? kit.panel : kit.trim;
      b.box(m, bw, bh, bd, x, top + bh / 2, z, 0.008);
      b.box(kit.metal, bw * 0.08, bh * 1.04, bd * 1.03, x - bw * 0.3, top + bh / 2, z, 0.002);
      b.box(kit.metal, bw * 0.08, bh * 1.04, bd * 1.03, x + bw * 0.3, top + bh / 2, z, 0.002);
      if (rnd() < 0.5) b.cylb(kit.canvas, u * 0.5, bw * 0.9, u * 0.1, [x - bw * 0.45, top + bh + u * 0.5, z], 'x', 8); // bedroll
    } else if (kind === 'drum' && drums < 4 && S >= 2) {
      drums++;
      for (let k = 0; k < 2; k++) {
        b.cylb(rnd() < 0.5 ? kit.hull : kit.trim, u * 0.8, u * 2.0, u * 0.1, [x, top, z + (k - 0.5) * u * 1.8], 'y', 10);
        b.cylb(kit.steel, u * 0.82, u * 0.14, 0.003, [x, top + u * 1.2, z + (k - 0.5) * u * 1.8], 'y', 10);
      }
    } else if (kind === 'ant') {
      b.cylb(kit.trim, u * 0.4, u * 0.3, 0.004, [x, top, z], 'y', 8);
      b.strut(kit.steel, [x, top + u * 0.3, z], [x - u * 0.2, top + u * (3 + rnd() * 3), z], u * 0.08, u * 0.04, 4);
    } else if (kind === 'light') {
      b.box(kit.trim, u * 0.8, u * 0.5, u * 0.8, x, top + u * 0.25, z, 0.005);
      b.cyl(kit.lamp, u * 0.3, u * 0.3, u * 0.12, [x + u * 0.4, top + u * 0.25, z], 'x', 8);
    }
  }
  // flank stowage along both shoulders: tool boxes, rolled tarps, jerry-can pairs
  if (S >= 2) {
    const wt = hull.lofts[0].pts[2].wt;
    for (const sg of [-1, 1]) for (let i = 0; i < 3; i++) {
      const x = L * (-0.3 + i * 0.2) + (rnd() - 0.5) * 0.1, z = sg * wt * 0.9;
      const top = flat(x, z, u * 1.6);
      if (top < 0 || !free(x, z, u * 1.6)) continue;
      const k = (i + (sg > 0 ? 1 : 0)) % 3;
      if (k === 0) { b.box(kit.panel, u * 3, u * 1.1, u * 1.5, x, top + u * 0.55, z, 0.008); b.box(kit.metal, u * 0.2, u * 1.15, u * 1.55, x, top + u * 0.56, z, 0.002); }
      else if (k === 1) { b.cylb(kit.canvas, u * 0.65, u * 3.2, u * 0.12, [x - u * 1.6, top + u * 0.7, z], 'x', 10); b.strut(kit.metal, [x - u * 0.6, top, z - u * 0.7], [x - u * 0.6, top + u * 1.4, z + u * 0.7], u * 0.06, u * 0.06, 4); }
      else { for (let q = 0; q < 2; q++) { b.box(kit.hull, u * 0.9, u * 1.3, u * 0.5, x, top + u * 0.65, z + (q - 0.5) * u * 0.8, 0.006); b.box(kit.metal, u * 0.5, u * 0.14, u * 0.3, x, top + u * 1.35, z + (q - 0.5) * u * 0.8, 0.002); } }
    }
  }
  // engine deck: louvred grille across the rear with a pair of exhaust stacks, on every hull
  const rx = -L * 0.5 + Math.max(0.1, L * 0.14);
  const top = deckAt(hull, rx, 0);
  if (top > 0) {
    const gw = Math.min(W * 0.42, hull.lofts[0].pts[1].wt * 1.5), gl = Math.max(0.12, L * 0.12);
    if (free(rx, 0, gw * 0.4)) {
      b.box(kit.trim, gl, u * 0.2, gw, rx, top + u * 0.1, 0, 0.006);
      const ns = Math.max(4, Math.round(gl / (u * 0.6)));
      for (let k = 0; k < ns; k++) b.box(kit.metal, u * 0.2, u * 0.22, gw * 0.88, rx - gl * 0.42 + (k * gl * 0.84) / (ns - 1), top + u * 0.28, 0, 0.002, [0, 0, 0.55]);
    }
  }
  // twin exhaust pipes on the rear plate
  const rear = hull.lofts[0].pts[0];
  for (const sg of [-1, 1]) {
    const x = rear.x + 0.03, z = sg * rear.wm * 0.45, y = rear.y3 - 0.02 - u * 0.2;
    b.cylb(kit.metal, u * 0.55, u * 2.0, u * 0.1, [x, y, z], 'y', 10);
    b.cyl(kit.rubber, u * 0.4, u * 0.4, 0.01, [x, y + u * 2.0, z], 'y', 8);
    b.box(kit.steel, u * 1.2, u * 1.2, u * 0.12, x - u * 0.6, y + u * 0.9, z, 0.002);
  }
}

/** Command bridge / sensor tower for giant hulls. */
export function addBridge(b: Bld, kit: Kit, hull: Hull, cx: number, S: number) {
  const base = deckAt(hull, cx, 0);
  if (base < 0) return;
  const u = 0.1 * S;
  const y0 = base;
  // armoured cab: faceted loft with visor slits
  b.loft(kit.hull, [
    sec8(cx - u * 1.5, u * 1.4, u * 1.5, u * 1.0, y0, y0 + u * 0.05, y0 + u * 0.7, y0 + u * 1.0),
    sec8(cx - u * 0.3, u * 1.6, u * 1.7, u * 1.2, y0, y0 + u * 0.05, y0 + u * 0.8, y0 + u * 1.2),
    sec8(cx + u * 1.0, u * 1.5, u * 1.6, u * 1.0, y0, y0 + u * 0.05, y0 + u * 0.7, y0 + u * 1.0),
    sec8(cx + u * 1.7, u * 1.1, u * 1.2, u * 0.7, y0, y0 + u * 0.05, y0 + u * 0.5, y0 + u * 0.7),
  ]);
  b.box(kit.glass, u * 0.12, u * 0.2, u * 1.8, cx + u * 1.62, y0 + u * 0.52, 0, 0.004, [0, 0, -0.5]);
  for (const sg of [-1, 1]) b.box(kit.glass, u * 1.1, u * 0.16, u * 0.06, cx + u * 0.4, y0 + u * 0.72, sg * u * 1.63, 0.003);
  // radar dish + mast cluster on top
  const ty = y0 + u * 1.2;
  b.cylb(kit.trim, u * 0.5, u * 0.25, u * 0.05, [cx - u * 0.6, ty, 0], 'y', 12);
  b.cyl(kit.metal, u * 0.08, u * 0.08, u * 0.9, [cx - u * 0.6, ty + u * 0.25, 0], 'y', 6);
  b.lathe(kit.panel, [[0, 0], [u * 0.2, 0.002], [u * 0.8, u * 0.12], [u * 0.8, u * 0.15], [u * 0.2, u * 0.05], [0, 0]], [cx - u * 0.6, ty + u * 1.2, 0], 'y', 16, [0, 0, 0.35]);
  for (const sg of [-1, 1]) {
    b.cyl(kit.steel, u * 0.03, u * 0.015, u * 3, [cx + u * 0.4, ty, sg * u * 1.1], 'y', 4);
    b.cyl(kit.lamp, u * 0.07, u * 0.07, u * 0.07, [cx + u * 0.4, ty + u * 3, sg * u * 1.1], 'y', 6);
  }
  for (const sg of [-1, 1]) { b.box(kit.trim, u * 0.5, u * 0.3, u * 0.4, cx + u * 1.0, ty - u * 0.2, sg * u * 0.9, 0.006); b.cyl(kit.lamp, u * 0.12, u * 0.12, u * 0.05, [cx + u * 1.27, ty - u * 0.05, sg * u * 0.9], 'x', 8); }
  b.decal(u * 1.4, u * 1.4, cx - u * 0.1, y0 + u * 1.205, 0, atlasUV(3), 0);
}

/** Reactive-armour tile arrays on the glacis and flanks, hazard-striped rear lip, towing cables, giant-scale details. */
export function giantDetails(b: Bld, kit: Kit, hull: Hull, S: number, rnd: () => number, mounts: Mount[]) {
  const { L, W } = hull;
  const p = hull.lofts[0].pts;
  const u = 0.1 * S;
  const free = (x: number, z: number, rad: number) => mounts.every((m) => dist([m.x, m.z], [x, z]) > m.r + rad);
  // ERA tiles on the sloped bow (between the last two stations)
  for (let seg = p.length - 3; seg < p.length - 1; seg++) {
    const a = p[seg], c = p[seg + 1];
    const ang = Math.atan2(a.y3 - c.y3, c.x - a.x);
    const cols = Math.max(4, Math.round((a.wt + c.wt) * 0.5 / (u * 0.65)));
    const rows = Math.max(1, Math.round((c.x - a.x) / (u * 1.7)));
    for (let ri = 0; ri < rows; ri++) {
      const f = (ri + 0.5) / rows;
      const x = a.x + (c.x - a.x) * f, y = a.y3 + (c.y3 - a.y3) * f, wt = a.wt + (c.wt - a.wt) * f;
      for (let k = 0; k < cols; k++) {
        const z = ((k + 0.5) / cols - 0.5) * 2 * (wt * 0.94);
        if (!free(x, z, u * 0.4)) continue;
        b.box(k % 2 ? kit.trim : kit.hull, u * 1.25, u * 0.32, (wt * 1.88) / cols * 0.84, x, y + u * 0.16, z, 0.008, [0, 0, -ang]);
      }
    }
  }
  // hazard-striped rear edge and bow chevrons
  const r0 = p[0];
  b.decal(r0.wt * 1.7, u * 1.6, r0.x + u * 1.0, r0.y3 + 0.004, 0, atlasUV(0), Math.PI / 2);
  // towing cables along the bow
  const bow = p[p.length - 2];
  for (const sg of [-1, 1]) {
    const x0 = bow.x - u * 0.4, z = sg * bow.wt * 0.8;
    b.strut(kit.metal, [x0, bow.y3 + u * 0.18, z], [x0 - u * 3.5, p[p.length - 3].y3 + u * 0.2, z], u * 0.06, u * 0.06, 5);
    b.cylb(kit.steel, u * 0.2, u * 0.25, 0.004, [x0, bow.y3 + u * 0.05, z], 'y', 8);
  }
  // reactor drum with stacks, in the best free spot on the rear half
  let best: [number, number] | null = null, bestD = 0;
  for (let i = 0; i < 40; i++) {
    const x = -L * (0.12 + rnd() * 0.3), z = (rnd() - 0.5) * W * 0.6;
    const top = deckAt(hull, x, z);
    if (top < 0) continue;
    const d = Math.min(...mounts.map((m) => dist([m.x, m.z], [x, z]) - m.r), 9);
    if (d > bestD) { bestD = d; best = [x, z]; }
  }
  if (best && bestD > u * 2.4) {
    const [x, z] = best;
    const top = deckAt(hull, x, z);
    const rr = Math.min(u * 1.35, bestD * 0.8);
    b.cylb(kit.trim, rr * 1.15, rr * 0.18, rr * 0.05, [x, top, z], 'y', 16);
    b.lathe(kit.hull, [[0, 0], [rr, 0], [rr, rr * 0.8], [rr * 0.86, rr * 1.0], [0, rr * 1.05]], [x, top + rr * 0.18, z], 'y', 16);
    for (let k = 0; k < 2; k++) b.cylb(kit.steel, rr * 1.04, rr * 0.07, 0.003, [x, top + rr * (0.35 + k * 0.4), z], 'y', 16);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; b.box(kit.hot, rr * 0.04, rr * 0.16, rr * 0.1, x + Math.cos(a) * rr * 0.99, top + rr * 0.55, z + Math.sin(a) * rr * 0.99, 0.002, [0, -a, 0]); }
    for (const sg of [-1, 1]) {
      b.cylb(kit.metal, rr * 0.22, rr * 1.7, rr * 0.03, [x - rr * 0.2, top + rr * 0.3, z + sg * rr * 0.62], 'y', 8);
      b.cylb(kit.steel, rr * 0.3, rr * 0.1, 0.004, [x - rr * 0.2, top + rr * 2.0, z + sg * rr * 0.62], 'y', 8);
    }
  }
  // flank sponson boxes with vent grilles along each shoulder
  const mid = p[2];
  for (const sg of [-1, 1]) for (const fx of [-0.6, 0.1]) {
    const x = L * fx * 0.5, z = sg * mid.wt * 0.97;
    if (!free(x, z, u * 1.0)) continue;
    const yy = deckAt(hull, x, sg * mid.wt * 0.9);
    if (yy < 0) continue;
    b.box(kit.panel, u * 3.0, u * 0.5, u * 0.7, x, yy + u * 0.15, z, 0.01);
    for (let k = 0; k < 6; k++) b.box(kit.metal, u * 0.18, u * 0.3, u * 0.5, x - u * 1.2 + k * u * 0.48, yy + u * 0.35, z, 0.002);
  }
  void mtx;
}
export type { V3 };
