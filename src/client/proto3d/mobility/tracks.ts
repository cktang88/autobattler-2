// Tracked running gear, stylized: chunky track loops (raised front idler, big rear sprocket) with blocky grousers,
// a few oversized road wheels, and armoured side skirts with a fender lip. treads / halftrack / megatracks.

import * as THREE from 'three';
import { Bld, type P2 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type Stance, type StanceIn } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';

function dims(s: StanceIn) {
  const mega = s.mobId === 'megatracks';
  const h = mega ? 0.36 + 0.19 * s.S : 0.22 + 0.11 * s.S;
  const w = mega ? s.W * 0.15 : Math.max(0.17, s.W * 0.22);
  const zs = mega ? [-0.425, -0.24, 0.24, 0.425].map((k) => k * s.W) : [-1, 1].map((k) => k * (s.W / 2 - w / 2 - 0.01));
  return { mega, h, w, zs };
}

export function trackStance(s: StanceIn): Stance {
  const { mega, h, w } = dims(s);
  return { y0: h * (mega ? 0.55 : 0.42), yt: h * 0.98, wi: Math.max(0.2, s.W / 2 - w - 0.01), tracked: true, legs: null, thick: 0, hipY: 0 };
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

/** one track assembly centred at lateral z, outer side `side` (+1 right / -1 left) */
export function trackUnit(b: Bld, kit: Kit, L: number, h: number, w: number, z: number, side: number, o: { skirt: boolean; heavy?: boolean }) {
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
  let sg = 0;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * total;
    while (sg < lens.length - 2 && lens[sg + 1] < s) sg++;
    const f = (s - lens[sg]) / (lens[sg + 1] - lens[sg] || 1);
    const [ax, ay] = loop[sg], [cx, cy] = loop[sg + 1];
    const px = ax + (cx - ax) * f, py = ay + (cy - ay) * f;
    const ang = Math.atan2(cy - ay, cx - ax);
    // outward normal of a CCW loop is (dy, -dx)
    const nx = Math.sin(ang), ny = -Math.cos(ang);
    b.g(new THREE.BoxGeometry(pitch * 0.5, h * 0.09, w * 1.04), kit.metal, new THREE.Matrix4().makeRotationZ(ang).setPosition(px + nx * h * 0.02, py + ny * h * 0.02, z));
  }
  // road wheels / sprocket / idler on the outer face (only the lower part shows under the skirt)
  const R = h / 2, Ri = h * 0.36;
  const xr = -L / 2 + R, xf = L / 2 - Ri;
  const zo = z + side * (w / 2 + 0.004);
  const disc = (x: number, y: number, r: number, hub = true) => {
    b.lathe(kit.metal, [[0, 0], [r, 0], [r, w * 0.12], [r * 0.82, w * 0.2], [0, w * 0.2]], [x, y, zo], side > 0 ? 'z' : '-z', 10);
    if (hub) b.lathe(kit.steel, [[0, w * 0.18], [r * 0.38, w * 0.18], [r * 0.3, w * 0.28], [0, w * 0.28]], [x, y, zo], side > 0 ? 'z' : '-z', 6);
  };
  const nW = Math.max(3, Math.round((xf - xr) / (R * 1.6)));
  const wr = R * 0.72;
  for (let i = 0; i < nW; i++) disc(xr + R * 0.9 + ((xf - xr - R * 1.6) * i) / Math.max(1, nW - 1), wr + h * 0.02, wr);
  disc(xr, R, R * 0.8);
  disc(xf, h - Ri, Ri * 0.8);
  if (o.skirt) {
    // armoured side skirt hanging over the upper ~55% of the loop, chamfered bottom edge, fender lip on top
    const sl = L * 0.88, sh = h * 0.64, st = Math.max(0.03, w * 0.16);
    const zs = z + side * (w / 2 + st * 0.6);
    block(b, kit.hull, -L * 0.02, h * 0.38, zs, sl, st, sh, { ch: st * 0.4, bev: st * 0.3, bot: st * 0.3, top: [0.97, 0.7] });
    // a darker inset band and a few bolt-down tabs read as plates from above and the side
    b.box(kit.trim, sl * 0.9, sh * 0.14, st * 0.4, -L * 0.02, h * 0.56, zs + side * st * 0.42, sh * 0.04);
    const nt = Math.max(2, Math.round(sl / (h * 1.4)));
    for (let i = 0; i < nt; i++) b.box(kit.panel, h * 0.16, sh * 0.5, st * 0.5, -L * 0.02 - sl / 2 + (sl * (i + 0.5)) / nt, h * 0.38 + sh * 0.5, zs + side * st * 0.3, h * 0.03);
  }
  // fender: thick chamfered mudguard over the whole run, sloped at the front
  const fw = w * 1.12 + (o.skirt ? Math.max(0.03, w * 0.16) * 0.8 : 0);
  const fz = z + side * (o.skirt ? Math.max(0.03, w * 0.16) * 0.35 : 0);
  block(b, kit.hull, -L * 0.04, h * 0.98, fz, L * 0.84, fw, h * 0.1, { ch: h * 0.05, bev: h * 0.03 });
  b.box(kit.hull, h * 0.5, h * 0.08, fw * 0.96, L / 2 - h * 0.42, h * 0.92, fz, h * 0.03, [0, 0, -0.55]);
}

registerMobility(['treads', 'halftrack', 'megatracks'], {
  stance: trackStance,
  build(c) {
    const b = new Bld();
    const { mega, h, w, zs } = dims(c);
    if (c.mobId === 'halftrack') {
      for (const z of zs) trackUnit(b, c.kit, c.L * 0.54, h, w, z, Math.sign(z), { skirt: false });
      // front wheels: fat tyres with chunky hubs and mudguards
      const wr = h * 0.55;
      for (const z of zs) {
        const x = c.L * 0.31, sd = Math.sign(z);
        b.lathe(c.kit.rubber, [[0, -w * 0.45], [wr * 0.86, -w * 0.45], [wr, -w * 0.3], [wr, w * 0.3], [wr * 0.86, w * 0.45], [0, w * 0.45]], [x, wr, z], 'z', 14);
        b.lathe(c.kit.metal, [[0, w * 0.4], [wr * 0.58, w * 0.4], [wr * 0.46, w * 0.52], [0, w * 0.52]], [x, wr, z], sd > 0 ? 'z' : '-z', 10);
        block(b, c.kit.hull, x, wr * 1.9, z, wr * 2.5, w * 1.25, h * 0.1, { ch: h * 0.05, bev: h * 0.03 });
      }
      b.cyl(c.kit.metal, h * 0.08, h * 0.08, c.W * 0.7, [c.L * 0.31, h * 0.5, -c.W * 0.35], 'z', 8);
    } else {
      for (const z of zs) trackUnit(b, c.kit, c.L * (mega ? 0.95 : 0.97), h, w, z, Math.sign(z), { skirt: (c.S >= 2 && !mega) || (mega && Math.abs(z) > c.W * 0.3), heavy: mega });
      if (mega) block(b, c.kit.trim, 0, h * 0.25, 0, c.L * 0.66, c.W * 0.56, h * 0.6, { ch: h * 0.2 });
    }
    b.mount(c.root);
  },
});
