// Boss-scale running gear: megatracks as four articulated corner track pods (crawler-transporter style) instead of
// four full-length treads. Each pod is a trapezoid track loop with chunky grousers, big bogie wheels, an armoured
// cowling with hazard-striped ends and a slewing ring on top that the hull rests on. Size 5 pods are twin-loop bogies.
// The hull reads as a fortress riding on four separate feet: the lower hull fits between the pods (stance.wi), the
// upper hull spans over them (from stance.yt). Chassis builders can query megaPods() to notch around them.
// Registered after mobility/tracks.ts (chassis/index.ts import order), so this builder owns 'megatracks'.

import * as THREE from 'three';
import { Bld, type P2 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type Stance, type StanceIn } from '../chassis/registry.ts';
import { block, glow, hazard } from '../chassis/shapes.ts';

export interface MegaPod { x: number; z: number; l: number; w: number; h: number; side: -1 | 1; front: boolean }

/** pod height for a size class */
export const megaH = (S: number) => 0.36 + 0.19 * S;

/** the four corner pods (hull-local), front pair first */
export function megaPods(L: number, W: number, S: number): MegaPod[] {
  const h = megaH(S);
  const l = L * (S >= 5 ? 0.33 : 0.36), w = W * (S >= 5 ? 0.24 : 0.22);
  const out: MegaPod[] = [];
  for (const front of [true, false]) for (const side of [-1, 1] as const) {
    out.push({ x: (front ? 1 : -1) * (L / 2 - l / 2 - L * 0.015), z: side * (W / 2 - w / 2 - W * 0.01), l, w, h, side, front });
  }
  return out;
}

export function megaStance(s: StanceIn): Stance {
  const h = megaH(s.S);
  const w = s.W * (s.S >= 5 ? 0.24 : 0.22);
  return { y0: h * 0.6, yt: h * 1.06, wi: Math.max(0.3, s.W / 2 - w - s.W * 0.02), tracked: true, legs: null, thick: 0, hipY: 0 };
}

/** trapezoid loop outline (x, y): sprockets high at both ends, short ground run */
function loopOutline(l: number, h: number): P2[] {
  const R = h * 0.42, cy = h - R, cx = l / 2 - R;
  const pts: P2[] = [];
  const arc = (x0: number, a0: number, a1: number, n: number) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([x0 + Math.cos(a) * R, cy + Math.sin(a) * R]); } };
  const run = cx - h * 0.32;
  pts.push([-run, 0], [run, 0]);
  arc(cx, -Math.PI * 0.32, Math.PI / 2, 4);
  arc(-cx, Math.PI / 2, Math.PI * 1.32, 4);
  return pts;
}

function loop(b: Bld, kit: Kit, x: number, z: number, l: number, h: number, w: number, side: number) {
  const pts = loopOutline(l, h);
  const shape = new THREE.Shape(pts.map(([px, py]) => new THREE.Vector2(px, py)));
  const bv = Math.min(0.04, w * 0.1);
  const eg = new THREE.ExtrudeGeometry(shape, { depth: w - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv, bevelSegments: 1, curveSegments: 1 });
  b.g(eg, kit.rubber, new THREE.Matrix4().makeTranslation(x, 0, z - (w - 2 * bv) / 2));
  // grousers: fat cleats every ~0.45 h along the loop
  const lp = [...pts, pts[0]];
  const lens = [0];
  for (let i = 1; i < lp.length; i++) lens.push(lens[i - 1] + Math.hypot(lp[i][0] - lp[i - 1][0], lp[i][1] - lp[i - 1][1]));
  const total = lens[lens.length - 1], pitch = h * 0.42, n = Math.round(total / pitch);
  const cleat = new THREE.BoxGeometry(pitch * 0.48, h * 0.1, w * 1.06);
  let sg = 0;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * total;
    while (sg < lens.length - 2 && lens[sg + 1] < s) sg++;
    const f = (s - lens[sg]) / (lens[sg + 1] - lens[sg] || 1);
    const [ax, ay] = lp[sg], [cx, cy] = lp[sg + 1];
    const ang = Math.atan2(cy - ay, cx - ax);
    b.g(cleat.clone(), kit.metal, new THREE.Matrix4().makeRotationZ(ang).setPosition(x + ax + (cx - ax) * f + Math.sin(ang) * h * 0.02, ay + (cy - ay) * f - Math.cos(ang) * h * 0.02, z));
  }
  // sprockets at both ends + bogie wheels on the outer face
  const R = h * 0.42, zo = z + side * (w / 2 + 0.005), ax: 'z' | '-z' = side > 0 ? 'z' : '-z';
  const disc = (dx: number, y: number, r: number) => {
    b.lathe(kit.metal, [[0, 0], [r, 0], [r, w * 0.1], [r * 0.8, w * 0.17], [0, w * 0.17]], [x + dx, y, zo], ax, 12);
    b.lathe(kit.steel, [[0, w * 0.15], [r * 0.34, w * 0.15], [r * 0.26, w * 0.24], [0, w * 0.24]], [x + dx, y, zo], ax, 6);
  };
  disc(l / 2 - R, h - R, R * 0.86);
  disc(-(l / 2 - R), h - R, R * 0.86);
  const run = l / 2 - R - h * 0.32, wr = h * 0.24;
  for (let i = 0; i < 3; i++) disc(-run * 0.72 + (run * 1.44 * i) / 2, wr + h * 0.02, wr);
}

/** one corner pod: loop(s), cowling, slewing ring */
export function megaPod(b: Bld, kit: Kit, p: MegaPod, S: number) {
  const { x, z, l, h, w, side, front } = p;
  if (S >= 5) {
    // twin-loop bogie: two narrower loops side by side, a dark frame between them
    const lw = w * 0.44;
    loop(b, kit, x, z - side * w * 0.26, l, h, lw, -side);
    loop(b, kit, x, z + side * w * 0.26, l, h, lw, side);
    block(b, kit.trim, x, h * 0.18, z, l * 0.7, w * 0.2, h * 0.6, { ch: w * 0.05 });
  } else loop(b, kit, x, z, l, h, w * 0.9, side);
  // armoured cowling over the upper loop: sloped ends, panel cap, outer glow strip
  const cw = w * 1.08, ch0 = h * 0.62;
  block(b, kit.trim, x, ch0, z, l * 0.9, cw, h * 1.04 - ch0, { top: [0.82, 0.86], ch: cw * 0.14, bev: h * 0.06, bot: h * 0.04 });
  block(b, kit.panel, x, h * 1.0, z, l * 0.56, cw * 0.62, h * 0.08, { top: [0.9, 0.86], ch: cw * 0.1, bev: h * 0.03 });
  glow(b, kit, x, h * 0.8, z + side * cw * 0.5, l * 0.5, h * 0.05, h * 0.05);
  // hazard-striped leading / trailing ends
  const ex = x + (front ? 1 : -1) * l * 0.36;
  hazard(b, kit, ex, h * 1.0, z, cw * 0.66, l * 0.1, 4, Math.PI / 2);
  b.box(kit.lamp, 0.05, h * 0.06, cw * 0.18, ex + (front ? 1 : -1) * l * 0.07, h * 0.86, z + side * cw * 0.26, 0.012);
  // slewing ring / kingpin drum (the hull sits on it)
  b.cylb(kit.metal, Math.min(l, w) * 0.34, h * 0.06, h * 0.02, [x, h * 1.0, z], 'y', 14);
}

registerMobility('megatracks', {
  stance: megaStance,
  build(c) {
    const b = new Bld();
    for (const p of megaPods(c.L, c.W, c.S)) megaPod(b, c.kit, p, c.S);
    // dark belly frame between the pods so generic hulls never float
    const h = megaH(c.S);
    block(b, c.kit.trim, 0, h * 0.3, 0, c.L * 0.5, c.stance.wi * 1.7, h * 0.4, { ch: h * 0.2 });
    b.mount(c.root);
  },
});
