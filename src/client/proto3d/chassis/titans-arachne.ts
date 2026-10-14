// Weaver Titan / arachne (size 5, 10 x 10 footprint, body art ~7): a colossal spider-tank. A domed ten-sided
// carapace with radial armour ribs carries the titan gun on a raised turret tower; the head is a heavy armoured prow
// with a huge glowing cyclops lens ringed by smaller eyes, flanked by two pedipalp weapon housings for the giant guns;
// behind it a long segmented abdomen ends in a glowing spinneret reactor, with antenna masts and a team banner. Eight
// legs whose knees tower over the body and plant far outside it.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, glow, hazard, pod, vent } from './shapes.ts';
import { banner, inPoly, mast, ngon, planLoft, reactor } from './giants-kit.ts';

function arachne(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const u = Math.min(L, W) / 10;
  const spider = stance.legs === 'spider';
  const by = spider ? stance.hipY * 1.75 : stance.legs === 'biped' ? stance.hipY + 0.2 * u : Math.max(stance.yt, 0.6) + 1.0 * u;
  if (!spider && stance.legs !== 'biped') planLoft(b, kit.trim, ngon(10, 2.4 * u, 2.4 * u), [[0, 1.1], [by - 0.4 * u, 1.0], [by, 0.85]], [-0.4 * u, 0]);
  // carapace: ten-sided dome, dark belly below
  const cx = -0.4 * u, cp = ngon(10, 2.65 * u, 2.85 * u, 0);
  const cTop = by + 1.6 * u;
  planLoft(b, kit.trim, cp, [[by - 0.75 * u, 0.62], [by - 0.2 * u, 0.94], [by + 0.1 * u, 1.0]], [cx, 0]);
  planLoft(b, kit.hull, cp, [[by + 0.05 * u, 1.04], [by + 0.5 * u, 1.05], [by + 1.15 * u, 0.84], [cTop, 0.48]], [cx, 0]);
  // radial armour ribs with glow seams between them
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
    if (Math.cos(a) > 0.8) continue; // the head sits there
    const rx = Math.cos(a), rz = Math.sin(a);
    beam(b, kit.panel, [cx + rx * 1.25 * u, cTop - 0.15 * u, rz * 1.35 * u], [cx + rx * 2.68 * u, by + 0.5 * u, rz * 2.88 * u], 0.36 * u, 0.24 * u, [rx, 2, rz]);
    const a2 = a + Math.PI / 10;
    glow(b, kit, cx + Math.cos(a2) * 2.75 * u, by + 0.3 * u, Math.sin(a2) * 2.93 * u, 0.5 * u, 0.06 * u, 0.06 * u, [0, -a2 + Math.PI / 2, 0]);
  }
  // turret tower for the titan gun on top of the dome
  const tY = cTop + 1.35 * u;
  planLoft(b, kit.hull, ngon(8, 1.15 * u, 1.15 * u), [[cTop - 0.3 * u, 1.0], [cTop + 0.5 * u, 0.86], [tY - 0.12 * u, 0.82], [tY, 0.76]], [cx, 0]);
  b.lathe(kit.glow, [[0.98 * u, 0], [1.03 * u, 0], [1.03 * u, 0.1 * u], [0.98 * u, 0.1 * u]], [cx, cTop + 0.62 * u, 0], 'y', 16);
  // crown: swept armour fins ringing the turret tower
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6, rx = Math.cos(a), rz = Math.sin(a);
    beam(b, i % 2 ? kit.panel : kit.accent, [cx + rx * 0.95 * u, cTop + 0.1 * u, rz * 0.95 * u], [cx + rx * 1.45 * u, tY + 0.35 * u, rz * 1.45 * u], 0.12 * u, 0.42 * u, [rx, 0, rz]);
  }
  both((s) => hazard(b, kit, cx + 0.75 * u, tY - 0.2 * u, s * 0.45 * u, 0.5 * u, 0.16 * u, 3, 0.5 * s));
  // head: armoured prow with a cyclops lens and an eye ring
  const hx = 2.3 * u, hy = by + 0.15 * u;
  planLoft(b, kit.hull, [[1.25 * u, 0], [0.7 * u, 0.95 * u], [-0.6 * u, 1.05 * u], [-0.8 * u, 0], [-0.6 * u, -1.05 * u], [0.7 * u, -0.95 * u]] as P2[], [[hy - 0.6 * u, 0.7], [hy - 0.2 * u, 1.0], [hy + 0.5 * u, 0.95], [hy + 0.75 * u, 0.7]], [hx, 0]);
  reactor(b, kit, [hx + 0.95 * u, hy + 0.12 * u, 0], 0.42 * u, 'x', 2);
  const eyes: [number, number, number][] = [[0.75, 0.55, 0.42], [0.75, 0.55, -0.42], [0.95, -0.25, 0.55], [0.95, -0.25, -0.55], [0.55, 0.72, 0.15], [0.55, 0.72, -0.15]];
  for (const [ex, ey, ez] of eyes) b.cyl(kit.glow, 0.13 * u, 0.11 * u, 0.16 * u, [hx + ex * u, hy + ey * u, ez * u], 'x', 8);
  block(b, kit.panel, hx + 0.1 * u, hy + 0.7 * u, 0, 1.0 * u, 1.1 * u, 0.18 * u, { top: [0.7, 0.7], shift: [0.15 * u, 0], ch: 0.3 * u, bev: 0.05 * u });
  // chelicerae fangs under the lens
  both((s) => {
    beam(b, kit.metal, [hx + 0.8 * u, hy - 0.4 * u, s * 0.35 * u], [hx + 1.5 * u, hy - 0.9 * u, s * 0.45 * u], 0.26 * u, 0.3 * u);
    beam(b, kit.steel, [hx + 1.5 * u, hy - 0.9 * u, s * 0.45 * u], [hx + 1.6 * u, hy - 1.5 * u, s * 0.25 * u], 0.18 * u, 0.2 * u);
  });
  // abdomen: segmented, tapering back, glowing spinneret reactor at the tail
  const ax0 = -2.7 * u;
  b.cylb(kit.metal, 0.6 * u, 0.6 * u, 0.06 * u, [ax0 + 0.1 * u, by + 0.3 * u, 0], '-x', 12);
  for (let i = 0; i < 3; i++) {
    const x = ax0 - 0.55 * u - i * 0.75 * u, f = 1 - i * 0.16;
    pod(b, i % 2 ? kit.panel : kit.hull, [x, by + 0.65 * u - i * 0.14 * u, 0], 0.5 * u, 0.95 * u * f, 1.3 * u * f, 12, 5, 2.4, 0.3);
    if (i < 2) both((s) => glow(b, kit, x - 0.37 * u, by + 0.65 * u - i * 0.14 * u, s * 1.18 * u * f, 0.06 * u, 0.5 * u * f, 0.06 * u));
  }
  const spx = ax0 - 2.75 * u, spy = by + 0.35 * u;
  b.cylb(kit.trim, 0.5 * u, 0.3 * u, 0.05 * u, [spx + 0.25 * u, spy, 0], '-x', 12);
  b.cyl(kit.hot, 0.32 * u, 0.2 * u, 0.12 * u, [spx - 0.04 * u, spy, 0], '-x', 10);
  // masts and banner on the rear of the carapace
  mast(b, kit, cx - 1.4 * u, by + 0.6 * u, -1.2 * u, 2.6 * u, 0.06 * u);
  mast(b, kit, cx - 1.6 * u, by + 0.55 * u, 1.0 * u, 1.8 * u, 0.05 * u);
  banner(b, kit, cx - 1.1 * u, by + 0.75 * u, 1.55 * u, 2.4 * u, 0.8 * u, 1);
  both((s) => vent(b, kit, cx - 0.9 * u, by + 0.95 * u, s * 0.9 * u, 0.6 * u, 0.4 * u, 3, 'x'));
  // pedipalp weapon housings at the giant-gun mounts (front flanks of the head)
  const palp = new Map<MountSpec, number>();
  for (const m of c.mounts) {
    if (!(m.x > 0.9 * u && Math.abs(m.z) > 0.6 * u)) continue;
    const s = Math.sign(m.z), top = by + 1.3 * u;
    beam(b, kit.trim, [hx - 0.5 * u, by - 0.2 * u, s * 0.8 * u], [m.x, by - 0.1 * u, m.z], 0.45 * u, 0.5 * u);
    block(b, kit.trim, m.x, by - 0.25 * u, m.z, 1.5 * u, 0.9 * u, 0.4 * u, { ch: 0.2 * u });
    block(b, kit.hull, m.x + 0.45 * u, by + 0.05 * u, m.z, 2.2 * u, m.r * 2.5, top - by - 0.05 * u, { top: [0.82, 0.82], shift: [-0.1 * u, 0], ch: 0.3 * u, bev: 0.08 * u, bot: 0.05 * u });
    glow(b, kit, m.x + 0.1 * u, by + 0.35 * u, m.z + s * m.r * 1.26, 1.0 * u, 0.06 * u, 0.05 * u);
    palp.set(m, top);
  }
  // hips: eight legs around the carapace rim, alternating tetrapod gait
  let hips: Hip[] | undefined;
  if (spider) {
    hips = [];
    const rows: [number, number, number, number][] = [[1.2, 2.2, 4.1, 3.7], [0.25, 2.7, 1.5, 4.8], [-1.05, 2.7, -1.5, 4.8], [-2.05, 2.1, -4.0, 3.8]];
    rows.forEach(([hxr, hz, fx, fz], i) => {
      for (const s of [-1, 1] as const) {
        const p: V3 = [cx + hxr * u, by, s * hz * u];
        hips!.push({ p, side: s, t: stance.thick * 1.15, foot: [fx * u, 0, s * fz * u], phase: ((i % 2) ^ (s > 0 ? 1 : 0)) ? Math.PI : 0 });
        block(b, kit.trim, p[0], by - 0.5 * u, s * (hz - 0.2) * u, 0.7 * u, 0.6 * u, 0.85 * u, { top: [0.8, 0.8], ch: 0.18 * u });
      }
    });
  } else if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [cx, stance.hipY, s * 1.6 * u] as V3, side: s, t: stance.thick, foot: [cx, 0, s * 1.9 * u] as V3, phase: s > 0 ? Math.PI : 0 }));
  }
  const deck = (x: number, z: number) => (inPoly(cp.map(([px, pz]) => [px * 0.5 + cx, pz * 0.5] as P2), x, z) ? cTop : -1);
  return {
    deckAt: deck, top: tY, custom: true, hips,
    seat: (m: MountSpec) => {
      const pt = palp.get(m);
      if (pt !== undefined) { collar(b, kit, m.x, pt, m.z, m.r, pt - 0.1 * u, 18); return { y: pt, socket: true }; }
      if (Math.hypot(m.x - cx, m.z) < 0.9 * u) { collar(b, kit, m.x, tY, m.z, m.r, tY - 0.15 * u, 22); return { y: tY, socket: true }; }
      if (m.x < ax0 + 0.3 * u) {
        // tail gun on the first abdomen segment
        const y = by + 1.55 * u;
        collar(b, kit, m.x, y, m.z, m.r, y - 0.35 * u, 16);
        return { y, socket: true };
      }
      const d = deck(m.x, m.z), y = (d > 0 ? d : by + 0.9 * u) + 0.1 * u;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.4 * u, 16);
      return { y, socket: true };
    },
  };
}

registerChassis('arachne', arachne);
