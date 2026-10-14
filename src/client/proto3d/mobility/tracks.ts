// Tracked running gear, stylized: chunky track loops (raised front idler, big rear sprocket) with blocky grousers and a
// few oversized road wheels, dressed in one of several looks chosen from the hull shape so tanks do not all sit on the
// same two long strips:
//   skirt    armoured side skirts with a fender lip, nose-tapered (default for any hull)
//   round    rounded teardrop track nacelles: only the bottom run shows (sleek line tanks: warden 'hex')
//   pods     four short armoured track pods at the corners, hull bridging them (fortress tanks: bastion)
//   exposed  bare narrow tracks, big spoked road wheels, no skirt (thin-skinned artillery: longarm, siegeplat)
//   wall     tall slab skirts reaching the ground, slanted, studded (wall-of-armour hulls: juggernaut)
//   bogies   four short bare track bogies at the corners, toed out, on swing arms (siege platforms: siegeplat)
//   twin     two tracks per side with linked fenders (wide heavy hulls: colossus 'titan')
// treads / halftrack / megatracks. Exported trackStance / trackUnit / trackStyle are reused by other mobility files.

import * as THREE from 'three';
import { Bld, type P2, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type Stance, type StanceIn } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';
import { place, XBld } from '../chassis/tanks-kit.ts';

export type TrackStyle = 'skirt' | 'round' | 'pods' | 'exposed' | 'wall' | 'twin' | 'bogies';
const STYLE: Record<string, TrackStyle> = { hex: 'round', fortress: 'pods', long: 'exposed', siegeplat: 'bogies', juggernaut: 'wall', titan: 'twin' };
export function trackStyle(shape: string, mobId = 'treads'): TrackStyle {
  if (mobId !== 'treads') return 'skirt';
  return STYLE[shape] ?? 'skirt';
}

function dims(s: StanceIn) {
  const mega = s.mobId === 'megatracks';
  const style = trackStyle(s.shape, s.mobId);
  const h = mega ? 0.36 + 0.19 * s.S : 0.22 + 0.11 * s.S;
  let w = mega ? s.W * 0.15 : Math.max(0.17, s.W * 0.22);
  if (style === 'exposed' || style === 'bogies') w = Math.max(0.15, Math.min(w, 0.2 + 0.06 * s.S));
  if (style === 'twin') w = s.W * 0.13;
  if (style === 'wall') w = Math.min(w, 0.22 + 0.1 * s.S);
  const edge = (k: number) => k * (s.W / 2 - w / 2 - 0.01);
  const zs = mega ? [-0.425, -0.24, 0.24, 0.425].map((k) => k * s.W)
    : style === 'twin' ? [-1, -0.62, 0.62, 1].map((k) => edge(k))
    : [-1, 1].map(edge);
  return { mega, style, h, w, zs };
}

export function trackStance(s: StanceIn): Stance {
  const { mega, style, h, w, zs } = dims(s);
  const y0 = h * (mega ? 0.55 : style === 'exposed' || style === 'bogies' ? 0.5 : 0.42);
  const inner = Math.min(...zs.map(Math.abs));
  const wi = style === 'twin' ? inner - w / 2 - 0.01 : s.W / 2 - w - 0.01;
  return { y0, yt: h * 0.98, wi: Math.max(0.2, wi), tracked: true, legs: null, thick: 0, hipY: 0 };
}

/** loop outline in (x, y): rear sprocket arc, flat bottom run, ramp up to a raised front idler, top return run */
function outline(L: number, h: number): P2[] {
  const R = h / 2, Ri = h * 0.36;
  const xr = -L / 2 + R, xf = L / 2 - Ri, yf = h - Ri;
  const pts: P2[] = [];
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  arc(xr, R, R, Math.PI / 2, Math.PI * 1.5, 6);            // rear, top -> bottom
  pts.push([xf - h * 0.55, 0]);                              // bottom run
  arc(xf, yf, Ri, -Math.PI * 0.62, Math.PI / 2, 6);          // ramp onto the idler, over the front
  return pts;
}

export interface TrackOpts {
  skirt: boolean;
  heavy?: boolean;
  /** skip the fender (housings / pods provide their own cover) */
  noFender?: boolean;
  /** only grousers below this height are modelled (covered tops) */
  cleatMaxY?: number;
  /** spoked, larger road wheels for exposed running gear */
  bigWheels?: boolean;
}

/** one track assembly centred at lateral z, outer side `side` (+1 right / -1 left) */
export function trackUnit(b: Bld, kit: Kit, L: number, h: number, w: number, z: number, side: number, o: TrackOpts) {
  const pts = outline(L, h);
  // rubber loop as a solid slab (inside is hidden by wheels / skirt / hull)
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const bv = Math.min(0.02, w * 0.12);
  const eg = new THREE.ExtrudeGeometry(shape, { depth: w - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv, bevelSegments: 1, curveSegments: 1 });
  b.g(eg, kit.rubber, new THREE.Matrix4().makeTranslation(0, 0, z - (w - 2 * bv) / 2));
  // grousers: blocky cleats along the loop
  const loop = [...pts, pts[0]];
  const lens = [0];
  for (let i = 1; i < loop.length; i++) lens.push(lens[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
  const total = lens[lens.length - 1];
  const pitch = h * (o.heavy ? 0.42 : 0.36);
  const n = Math.round(total / pitch);
  const cmax = o.cleatMaxY ?? 1e9;
  let sg = 0;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * total;
    while (sg < lens.length - 2 && lens[sg + 1] < s) sg++;
    const f = (s - lens[sg]) / (lens[sg + 1] - lens[sg] || 1);
    const [ax, ay] = loop[sg], [cx, cy] = loop[sg + 1];
    const px = ax + (cx - ax) * f, py = ay + (cy - ay) * f;
    if (py > cmax) continue;
    const ang = Math.atan2(cy - ay, cx - ax);
    // outward normal of a CCW loop is (dy, -dx)
    const nx = Math.sin(ang), ny = -Math.cos(ang);
    b.g(new THREE.BoxGeometry(pitch * 0.5, h * 0.09, w * 1.04), kit.metal, new THREE.Matrix4().makeRotationZ(ang).setPosition(px + nx * h * 0.02, py + ny * h * 0.02, z));
  }
  // road wheels / sprocket / idler on the outer face (only the lower part shows under the skirt)
  const R = h / 2, Ri = h * 0.36;
  const xr = -L / 2 + R, xf = L / 2 - Ri;
  const zo = z + side * (w / 2 + 0.004);
  const ax = side > 0 ? 'z' : '-z';
  const disc = (x: number, y: number, r: number, hub = true) => {
    b.lathe(kit.metal, [[0, 0], [r, 0], [r, w * 0.12], [r * 0.82, w * 0.2], [0, w * 0.2]], [x, y, zo], ax, 10);
    if (hub) b.lathe(kit.steel, [[0, w * 0.18], [r * 0.38, w * 0.18], [r * 0.3, w * 0.28], [0, w * 0.28]], [x, y, zo], ax, 6);
  };
  const big = (x: number, y: number, r: number) => {
    // dished road wheel: rubber rim, recessed disc in hull paint, steel hub
    b.lathe(kit.rubber, [[0, 0], [r, 0], [r, w * 0.16], [r * 0.86, w * 0.2], [0, w * 0.2]], [x, y, zo], ax, 12);
    b.lathe(kit.panel, [[0, w * 0.18], [r * 0.8, w * 0.18], [r * 0.7, w * 0.24], [0, w * 0.24]], [x, y, zo], ax, 12);
    b.lathe(kit.steel, [[0, w * 0.22], [r * 0.3, w * 0.22], [r * 0.24, w * 0.32], [0, w * 0.32]], [x, y, zo], ax, 6);
  };
  if (o.bigWheels) {
    const nW = Math.max(3, Math.round((xf - xr) / (R * 1.9)));
    const wr = R * 0.86;
    for (let i = 0; i < nW; i++) big(xr + R * 0.8 + ((xf - xr - R * 1.4) * i) / Math.max(1, nW - 1), wr + h * 0.02, wr);
    disc(xr, R, R * 0.7);
    disc(xf, h - Ri, Ri * 0.75);
  } else {
    const nW = Math.max(3, Math.round((xf - xr) / (R * 1.6)));
    const wr = R * 0.72;
    for (let i = 0; i < nW; i++) disc(xr + R * 0.9 + ((xf - xr - R * 1.6) * i) / Math.max(1, nW - 1), wr + h * 0.02, wr, !o.noFender);
    disc(xr, R, R * 0.8);
    disc(xf, h - Ri, Ri * 0.8);
  }
  const st = Math.max(0.03, w * 0.16);
  if (o.skirt) {
    // armoured side skirt over the upper ~55% of the loop, nose cut back on a slope, fender lip on top
    const sl = L * 0.84, sh = h * 0.64;
    const zs = z + side * (w / 2 + st * 0.6);
    block(b, kit.hull, -L * 0.05, h * 0.38, zs, sl, st, sh, { ch: st * 0.4, bev: st * 0.3, bot: st * 0.3, top: [0.97, 0.7], mid: [[0.4, 1.0, 1.0]], shift: [L * 0.03, 0] });
    b.box(kit.trim, sl * 0.86, sh * 0.14, st * 0.4, -L * 0.05, h * 0.56, zs + side * st * 0.42, sh * 0.04);
    const nt = Math.max(2, Math.round(sl / (h * 1.4)));
    for (let i = 0; i < nt; i++) b.box(kit.panel, h * 0.16, sh * 0.5, st * 0.5, -L * 0.05 - sl / 2 + (sl * (i + 0.5)) / nt, h * 0.38 + sh * 0.5, zs + side * st * 0.3, h * 0.03);
  }
  if (!o.noFender) {
    // fender: thick chamfered mudguard over the whole run, sloped at the front
    const fw = w * 1.12 + (o.skirt ? st * 0.8 : 0);
    const fz = z + side * (o.skirt ? st * 0.35 : 0);
    block(b, kit.hull, -L * 0.04, h * 0.98, fz, L * 0.84, fw, h * 0.1, { ch: h * 0.05, bev: h * 0.03 });
    b.box(kit.hull, h * 0.5, h * 0.08, fw * 0.96, L / 2 - h * 0.42, h * 0.92, fz, h * 0.03, [0, 0, -0.55]);
  }
}

/** superellipse ring in the yz plane for nacelles: flattened bottom */
function nring(x: number, cy: number, cz: number, ry: number, rz: number, n = 10, flat = 0.55): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    let y = Math.sign(s) * Math.pow(Math.abs(s), 0.75) * ry;
    if (y < 0) y *= 1 - flat;
    out.push([x, cy + y, cz + Math.sign(c) * Math.pow(Math.abs(c), 0.75) * rz]);
  }
  return out;
}

/** Rounded teardrop nacelle over a track: fat rear-mid, tapered rounded nose; covers all but the lower run. */
export function trackNacelle(b: Bld, kit: Kit, L: number, h: number, w: number, z: number, side: number) {
  const top = h * 1.08, bot = h * 0.34;
  const ry = (top - bot) / 1.45, cy = top - ry, rz = w * 0.66;
  const prof: [number, number, number][] = [[-0.5, 0.62, 0.78], [-0.46, 0.92, 0.94], [-0.3, 1, 1], [0.2, 1, 1], [0.38, 0.9, 0.92], [0.48, 0.62, 0.74], [0.515, 0.25, 0.4]];
  b.loft(kit.hull, prof.map(([f, sy, sz]) => nring(L * f, cy - (1 - sy) * ry * 0.25, z + side * w * 0.04, ry * sy, rz * sz)));
  // lighter armour band along the flank and a team glow slit, bright plates read from the top camera
  b.loft(kit.panel, [[-0.36, 0.9], [-0.28, 1], [0.18, 1], [0.32, 0.9]].map(([f, s]) => nring(L * f, cy + ry * 0.05, z + side * w * 0.08, ry * 0.42 * s, rz * 1.03 * s, 8, 0.2)));
  b.box(kit.glow, L * 0.32, h * 0.04, h * 0.04, -L * 0.04, cy + ry * 0.05, z + side * (rz * 1.06 + w * 0.08), h * 0.01);
  // rounded lamp at the nose
  b.box(kit.lamp, h * 0.05, h * 0.08, w * 0.3, L * 0.5, cy, z + side * w * 0.04, h * 0.02);
}

/** Short armoured corner pod: track loop in a chamfered box housing with a sloped nose. */
function cornerPod(b: Bld, kit: Kit, L: number, h: number, w: number, z: number, side: number, front: boolean) {
  trackUnit(b, kit, L, h, w, z, side, { skirt: false, noFender: true, cleatMaxY: h * 0.4 });
  const hz = z + side * w * 0.04;
  block(b, kit.hull, 0, h * 0.34, hz, L * 0.98, w * 1.22, h * 0.76, { ch: w * 0.3, bev: h * 0.12, bot: h * 0.06, top: [front ? 0.8 : 0.9, 0.82], shift: [front ? -L * 0.06 : L * 0.04, 0] });
  // outer armour plate + hazard stripes facing out from the corner
  block(b, front ? kit.panel : kit.hull, front ? L * 0.06 : -L * 0.04, h * 0.48, z + side * w * 0.66, L * 0.66, w * 0.14, h * 0.46, { ch: w * 0.05, bev: w * 0.04, top: [0.88, 0.6] });
  b.box(front ? kit.hazard : kit.trim, h * 0.1, h * 0.04, w * 0.8, (front ? 1 : -1) * L * 0.36, h * 1.1, hz, h * 0.01);
  if (front) b.box(kit.lamp, h * 0.04, h * 0.08, w * 0.3, L * 0.48, h * 0.8, hz, h * 0.02);
}

/** Tall slab skirt that reaches almost to the ground, leaning in, studded with big plates. */
function wallSkirt(b: Bld, kit: Kit, L: number, h: number, w: number, z: number, side: number) {
  trackUnit(b, kit, L, h, w, z, side, { skirt: false, noFender: true, heavy: true, cleatMaxY: h * 0.25 });
  const t = Math.max(0.05, w * 0.2), zs = z + side * (w / 2 + t * 0.4);
  block(b, kit.hull, -L * 0.03, h * 0.12, zs, L * 0.96, t, h * 1.0, { ch: t * 0.45, bev: t * 0.35, top: [0.88, 0.7], shift: [-L * 0.02, -side * t * 0.35], bot: t * 0.2 });
  const n = Math.max(3, Math.round(L / (h * 1.5)));
  for (let i = 0; i < n; i++) {
    const x = -L * 0.03 - L * 0.42 + (L * 0.84 * (i + 0.5)) / n;
    block(b, i % 2 ? kit.panel : kit.hull, x, h * 0.3, zs + side * t * 0.42, (L * 0.84) / n * 0.82, t * 0.5, h * 0.6, { ch: t * 0.15, bev: t * 0.12, top: [0.9, 0.6], shift: [0, -side * t * 0.12] });
  }
  b.box(kit.trim, L * 0.9, h * 0.08, w * 1.3, -L * 0.03, h * 1.1, z + side * t * 0.2, h * 0.03);
}

registerMobility(['treads', 'halftrack', 'megatracks'], {
  stance: trackStance,
  build(c) {
    const b = new Bld();
    const { mega, style, h, w, zs } = dims(c);
    const k = c.kit;
    if (c.mobId === 'halftrack') {
      for (const z of zs) trackUnit(b, k, c.L * 0.54, h, w, z, Math.sign(z), { skirt: false });
      // front wheels: fat tyres with chunky hubs and mudguards
      const wr = h * 0.55;
      for (const z of zs) {
        const x = c.L * 0.31, sd = Math.sign(z);
        b.lathe(k.rubber, [[0, -w * 0.45], [wr * 0.86, -w * 0.45], [wr, -w * 0.3], [wr, w * 0.3], [wr * 0.86, w * 0.45], [0, w * 0.45]], [x, wr, z], 'z', 14);
        b.lathe(k.metal, [[0, w * 0.4], [wr * 0.58, w * 0.4], [wr * 0.46, w * 0.52], [0, w * 0.52]], [x, wr, z], sd > 0 ? 'z' : '-z', 10);
        block(b, k.hull, x, wr * 1.9, z, wr * 2.5, w * 1.25, h * 0.1, { ch: h * 0.05, bev: h * 0.03 });
      }
      b.cyl(k.metal, h * 0.08, h * 0.08, c.W * 0.7, [c.L * 0.31, h * 0.5, -c.W * 0.35], 'z', 8);
    } else if (mega) {
      for (const z of zs) trackUnit(b, k, c.L * 0.95, h, w, z, Math.sign(z), { skirt: Math.abs(z) > c.W * 0.3, heavy: true });
      block(b, k.trim, 0, h * 0.25, 0, c.L * 0.66, c.W * 0.56, h * 0.6, { ch: h * 0.2 });
    } else if (style === 'round') {
      for (const z of zs) {
        const s = Math.sign(z), TL = c.L * 0.95;
        trackUnit(b, k, TL, h, w, z, s, { skirt: false, noFender: true, cleatMaxY: h * 0.42 });
        trackNacelle(b, k, TL, h, w, z, s);
      }
    } else if (style === 'pods') {
      const PL = c.L * 0.4;
      for (const z of zs) for (const f of [-1, 1]) {
        const s = Math.sign(z);
        cornerPod(new XBld(b, place(f * c.L * 0.3, 0, 0, 0)), k, PL, h, w, z, s, f > 0);
      }
      // axle beams joining each pod pair under the hull
      for (const z of zs) b.box(k.trim, c.L * 0.2, h * 0.3, w * 0.6, 0, h * 0.5, z, h * 0.06);
    } else if (style === 'exposed') {
      for (const z of zs) trackUnit(b, k, c.L * 0.96, h, w, z, Math.sign(z), { skirt: false, bigWheels: true, noFender: true });
      // thin mudguard rails over the top run only, on stays
      for (const z of zs) {
        b.box(k.hull, c.L * 0.7, h * 0.05, w * 1.05, -c.L * 0.03, h * 1.06, z, h * 0.02);
        for (const f of [-0.28, 0.2]) b.box(k.metal, h * 0.06, h * 0.12, h * 0.06, c.L * f, h * 0.98, z - Math.sign(z) * w * 0.4, h * 0.01);
      }
    } else if (style === 'bogies') {
      const BL = c.L * 0.34;
      for (const z of zs) for (const f of [-1, 1]) {
        const s = Math.sign(z), x = f * c.L * 0.32, toe = f * s * -0.1;
        const xb = new XBld(b, place(x, 0, z, toe));
        trackUnit(xb, k, BL, h, w, 0, s, { skirt: false, bigWheels: true, noFender: true });
        // swing arm from the bogie hub up under the hull
        b.box(k.metal, BL * 0.5, h * 0.18, w * 0.5, x - f * BL * 0.1, h * 0.72, z - s * w * 0.6, h * 0.05, [0, toe, 0]);
        block(xb, k.hull, -BL * 0.04, h * 0.98, 0, BL * 0.7, w * 1.08, h * 0.1, { ch: h * 0.05, bev: h * 0.03, top: [0.85, 0.9] });
        b.box(f > 0 ? k.hazard : k.trim, h * 0.06, h * 0.05, w * 0.9, x + f * BL * 0.34, h * 1.06, z, h * 0.01, [0, toe, 0]);
      }
      for (const f of [-1, 1]) b.cyl(k.metal, h * 0.09, h * 0.09, c.W * 0.86, [f * c.L * 0.32, h * 0.5, -c.W * 0.43], 'z', 8);
    } else if (style === 'wall') {
      for (const z of zs) wallSkirt(b, k, c.L * 0.94, h, w, z, Math.sign(z));
    } else if (style === 'twin') {
      for (const z of zs) {
        const outer = Math.abs(z) > c.W * 0.3;
        trackUnit(b, k, c.L * (outer ? 0.9 : 0.97), h, w, z, Math.sign(z), { skirt: outer, heavy: true });
      }
      // fender bridge across each side pair
      for (const s of [-1, 1]) block(b, k.trim, -c.L * 0.04, h * 0.9, s * (Math.abs(zs[0]) + Math.abs(zs[1])) / 2, c.L * 0.7, Math.abs(zs[0] - zs[1]) - w * 0.6, h * 0.14, { ch: h * 0.05 });
    } else {
      for (const z of zs) trackUnit(b, k, c.L * 0.97, h, w, z, Math.sign(z), { skirt: c.S >= 2 });
    }
    b.mount(c.root);
  },
});
