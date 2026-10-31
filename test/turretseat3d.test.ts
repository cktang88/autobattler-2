// No floating turrets: every weapon / utility housing on every chassis x legal mobility must sit ON something.
// Builds each unit in node (canvas stubbed), then for each turret drops vertical columns from its base (centre + rings
// at 0.5 r and 0.9 r) through the non-turret geometry (hull, running gear, the generic barbette) and walks the surface
// crossings with a nesting depth (columnGap). A column holds the turret when it reaches a solid layer >= SOLID thick
// (or the ground) after at most max(0.04, 0.3 r) of air, or when hull passes through the housing's own column; a turret
// floats when no column holds it. Flyers may also hang a pod from above, so their columns are walked upward too.
// A negative control (a lifted / side-shifted turret) proves the check can fail.
//
//   node test/turretseat3d.test.ts                 -> runs as a test (all chassis + starter designs)
//   FLOAT_RANDOM=12 ...                             -> 12 extra seeded random fills per pairing (incl. melee / empties)
//   FLOAT_LOD=0.5 ...                               -> check the far-view low-detail build instead
//   FLOAT_ONLY=bastion,hunter FLOAT_V=1 node test/turretseat3d.test.ts   -> subset, print every turret

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM / canvas stub (materials.ts paints textures on 2D canvases) ------------------------------------------
const ctx2d: unknown = new Proxy({}, {
  get(_t, k) {
    if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set() { return true; },
});
const g = globalThis as { document?: unknown };
g.document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };

const THREE = await import('three');
const { buildUnit } = await import('../src/client/proto3d/units3d.ts');
const { CHASSIS, MOBILITY, MODULES, MODULE_BY_ID, pairingError } = await import('../src/shared/parts.ts');
const { slotError } = await import('../src/shared/stats.ts');
const { weaponD } = await import('../src/client/render/weaponsize.ts');
const { withDetail } = await import('../src/client/proto3d/geo.ts');
const { STARTER_DESIGNS } = await import('../src/shared/starters.ts');
import type { Design, ModuleDef } from '../src/shared/types.ts';
import type { Material, Mesh } from 'three';

/** chassis the check skips (rebuilt separately) */
const SKIP = new Set<string>();
const SOLID = 0.035;

// ---- tiny triangle BVH ------------------------------------------------------------------------------------------------
interface Hit { t: number; dot: number }
interface Node { min: number[]; max: number[]; l: number; r: number; s: number; e: number }
class TriBVH {
  nodes: Node[] = [];
  idx: Uint32Array;
  tri: Float32Array;
  constructor(tri: Float32Array) {
    this.tri = tri;
    const n = tri.length / 9;
    this.idx = new Uint32Array(n).map((_, i) => i);
    const cen = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) cen[i * 3 + a] = (tri[i * 9 + a] + tri[i * 9 + 3 + a] + tri[i * 9 + 6 + a]) / 3;
    const build = (s: number, e: number): number => {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let k = s; k < e; k++) {
        const i = this.idx[k];
        for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) { const x = tri[i * 9 + v * 3 + a]; if (x < min[a]) min[a] = x; if (x > max[a]) max[a] = x; }
      }
      const id = this.nodes.length;
      this.nodes.push({ min, max, l: -1, r: -1, s, e });
      if (e - s <= 6) return id;
      let ax = 0;
      const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
      if (ext[1] > ext[ax]) ax = 1;
      if (ext[2] > ext[ax]) ax = 2;
      this.idx.set(Array.from(this.idx.subarray(s, e)).sort((p, q) => cen[p * 3 + ax] - cen[q * 3 + ax]), s);
      const m = (s + e) >> 1;
      const l = build(s, m), r = build(m, e);
      this.nodes[id].l = l; this.nodes[id].r = r;
      return id;
    };
    if (n) build(0, n);
  }
  /** every crossing along o + t d (t in (0, far]), nearest first; dot = facing of the surface vs d (> 0: its back) */
  cast(o: number[], d: number[], far = 50): Hit[] {
    const out: Hit[] = [];
    if (!this.nodes.length) return out;
    const T = this.tri, stack = [0];
    while (stack.length) {
      const nd = this.nodes[stack.pop()!];
      let t0 = 0, t1 = far;
      for (let a = 0; a < 3 && t0 <= t1; a++) {
        if (Math.abs(d[a]) < 1e-12) { if (o[a] < nd.min[a] || o[a] > nd.max[a]) t1 = -1; continue; }
        let ta = (nd.min[a] - o[a]) / d[a], tb = (nd.max[a] - o[a]) / d[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 > t1 + 1e-9) continue;
      if (nd.l >= 0) { stack.push(nd.l, nd.r); continue; }
      for (let k = nd.s; k < nd.e; k++) {
        const i = this.idx[k] * 9;
        const e1 = [T[i + 3] - T[i], T[i + 4] - T[i + 1], T[i + 5] - T[i + 2]], e2 = [T[i + 6] - T[i], T[i + 7] - T[i + 1], T[i + 8] - T[i + 2]];
        const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
        const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
        if (Math.abs(det) < 1e-12) continue;
        const id = 1 / det, s = [o[0] - T[i], o[1] - T[i + 1], o[2] - T[i + 2]];
        const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * id;
        if (u < -1e-7 || u > 1 + 1e-7) continue;
        const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
        const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * id;
        if (v < -1e-7 || u + v > 1 + 1e-7) continue;
        const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * id;
        if (t <= 1e-6 || t > far) continue;
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        out.push({ t, dot: (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / (Math.hypot(n[0], n[1], n[2]) || 1) });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
}

/** Air (cells) crossed walking the column from p along dir before reaching a solid layer >= SOLID thick (or the ground
 *  at groundY), stopping early once it exceeds limit. Walks the surface crossings with a nesting depth (entering =
 *  surface facing us, leaving = its back): stacked / overlapping primitives of the merged hull just nest, coincident
 *  faces leave before they enter, and a leave with nothing open means we started inside something (open shells). */
function columnGap(bvh: TriBVH, p: number[], dir: number[], limit: number, groundY: number | null): number {
  const hits = bvh.cast(p, dir).sort((a, b) => (Math.abs(a.t - b.t) < 1e-4 ? b.dot - a.dot : a.t - b.t));
  const end = groundY === null ? Infinity : Math.max(0, (p[1] - groundY) / -dir[1]);
  let depth = 0, air = 0, from = 0, solidFrom = 0;
  for (const h of hits) {
    if (h.t >= end) break;
    if (h.dot < 0) {
      if (depth === 0) { air += h.t - from; if (air > limit) return air; solidFrom = h.t; }
      depth++;
    } else if (depth === 0) {
      // leaving something we never saw enter: we were inside it since `from`
      if (h.t - from >= SOLID) return air;
      from = h.t;
    } else if (--depth === 0) {
      if (h.t - solidFrom >= SOLID) return air;
      from = h.t;
    }
  }
  if (depth > 0) return air;
  return air + (end - from);
}

interface Float { key: string; turret: number; mod: string; r: number; base: number[]; gap: number }

/** build one design and return its turrets' support gaps */
function checkDesign(d: Design, tamper?: (u: ReturnType<typeof buildUnit>) => void): Float[] {
  const u = withDetail(Number(process.env.FLOAT_LOD ?? 1), () => buildUnit(d, 0));
  u.animate(0, 0, 0);
  tamper?.(u);
  u.root.updateMatrixWorld(true);
  // a mech torso hangs under the hero's yaw but is body: what the hero, its pods and riding utilities stand on
  const torsoObjs = new Set<unknown>();
  u.root.traverse((o) => { if (o.userData.torso) o.traverse((c) => torsoObjs.add(c)); });
  const turretObjs = new Set<unknown>();
  for (const t of u.turrets) t.yaw.traverse((o) => { if (!torsoObjs.has(o)) turretObjs.add(o); });
  const tris: number[] = [];
  const v = new THREE.Vector3();
  u.root.traverse((o) => {
    const me = o as Mesh;
    if (!me.isMesh || turretObjs.has(me) || (me.material as Material & { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial) return;
    const geo = me.geometry, pos = geo.attributes.position, ix = geo.index;
    const n = ix ? ix.count : pos.count;
    for (let k = 0; k < n; k++) { v.fromBufferAttribute(pos, ix ? ix.getX(k) : k).applyMatrix4(me.matrixWorld); tris.push(v.x, v.y, v.z); }
  });
  const bvh = new TriBVH(new Float32Array(tris));
  const out: Float[] = [];
  const mods = d.mounts.filter((m) => m);
  const fill = d.mounts.map((m) => m ?? '-').join('|');
  u.turrets.forEach((t, k) => {
    // a weapon pod rides its host turret's flank on a bracket: the host is the one that must stand on the hull.
    // A utility riding a torso (armour, shields, sensors) must stand on the torso.
    if (t.host !== undefined && (MODULE_BY_ID.get(String(mods[k]))?.kind === 'weapon' || !torsoObjs.size)) return;
    const base = t.yaw.getWorldPosition(new THREE.Vector3());
    const limit = Math.max(0.04, 0.3 * t.r);
    const top = new THREE.Box3().setFromObject(t.yaw).max.y;
    let best = Infinity, held = 0, cgap = 0;
    const pts = [[0, 0]];
    for (const k of [0.5, 0.9]) for (let a = 0; a < 8; a++) pts.push([Math.cos(a * Math.PI / 4 + 0.13) * k * t.r, Math.sin(a * Math.PI / 4 + 0.13) * k * t.r]);
    for (const [dx, dz] of pts) {
      // tiny offsets keep columns off fan apexes / exact edges of the hull caps
      const x = base.x + dx + 0.0013, z = base.z + dz + 0.0007;
      let gap = columnGap(bvh, [x, base.y + 0.006, z], [0, -1, 0], limit, u.flying ? null : 0);
      // hull passing through the housing's own column (a pod clamped through a wing, a gun in a casemate) holds it too
      const thru = bvh.cast([x, top, z], [0, -1, 0], top - base.y + 0.006);
      if (thru.length) gap = 0;
      if (u.flying) gap = Math.min(gap, columnGap(bvh, [x, top - 0.006, z], [0, 1, 0], limit, null));
      if (gap <= limit) held++;
      if (dx === 0 && dz === 0) cgap = gap;
      best = Math.min(best, gap);
    }
    const cover = held / pts.length;
    if (best > limit) out.push({ key: `${d.chassis}:${d.mobility}`, turret: k, mod: String(mods[k]), r: +t.r.toFixed(3), base: [base.x, base.y, base.z].map((q) => +q.toFixed(2)), gap: +best.toFixed(3) });
    if (process.env.FLOAT_V) console.log(`${d.chassis}:${d.mobility}:${fill} t${k} ${mods[k]} r=${t.r.toFixed(2)} y=${base.y.toFixed(2)} gap=${best === Infinity ? 'inf' : best.toFixed(3)} cover=${cover.toFixed(2)} cgap=${cgap.toFixed(3)}${best > limit ? '  FLOATING' : ''}`);
  });
  return out;
}

/** mount fills per chassis x mobility: biggest legal weapon per slot, smallest legal weapon, biggest utility housing */
function fills(ch: (typeof CHASSIS)[number], mob: string): Record<string, (string | null)[]> {
  const pick = (i: number, ok: (m: ModuleDef) => boolean, big: boolean) => {
    const legal = MODULES.filter((m) => ok(m) && !slotError(ch, mob, i, m)).sort((a, b) => weaponD(b) - weaponD(a) || a.id.localeCompare(b.id));
    return (big ? legal[0] : legal[legal.length - 1])?.id ?? null;
  };
  const wpn = (m: ModuleDef) => m.kind === 'weapon' && m.projectile !== 'melee';
  const utl = (m: ModuleDef) => m.kind !== 'weapon' && m.visual !== 'plate';
  const out: Record<string, (string | null)[]> = {
    big: ch.mounts.map((_, i) => pick(i, wpn, true)),
    small: ch.mounts.map((_, i) => pick(i, wpn, false)),
    util: ch.mounts.map((_, i) => pick(i, utl, true)),
  };
  // armour plates next to the biggest weapon (a torso hull carries them on its back; they once floated over it)
  const plate = ch.mounts.map((_, i) => pick(i, (m) => m.visual === 'plate', true));
  if (plate.some((m) => m)) out.plate = plate.map((m, i) => (i === 0 ? out.big[0] : m));
  // melee tools ride the hull's front edge (meleeFront): their arms / rams must still reach back onto the hull
  const mel = ch.mounts.map((_, i) => pick(i, (m) => m.kind === 'weapon' && m.projectile === 'melee', true));
  if (mel.some((m) => m)) out.melee = mel;
  // FLOAT_RANDOM=n: n extra seeded random fills per pairing (any legal module incl. melee, or empty)
  let seed = [...ch.id + mob].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 9);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let n = 0; n < Number(process.env.FLOAT_RANDOM ?? 0); n++) {
    out[`rnd${n}`] = ch.mounts.map((_, i) => {
      const legal = MODULES.filter((m) => !slotError(ch, mob, i, m));
      return rnd() < 0.15 || !legal.length ? null : legal[Math.floor(rnd() * legal.length)].id;
    });
  }
  return out;
}

const only = process.env.FLOAT_ONLY?.split(',');
test('every turret on every chassis x mobility sits on something (no floating turrets)', () => {
  const bad: Float[] = [];
  for (const ch of CHASSIS) {
    if (only ? !only.includes(ch.id) : SKIP.has(ch.id)) continue;
    for (const mob of MOBILITY) {
      if (pairingError(ch.id, mob.id)) continue;
      for (const [f, mounts] of Object.entries(fills(ch, mob.id))) {
        bad.push(...checkDesign({ id: `float-${ch.id}-${mob.id}-${f}`, name: f, chassis: ch.id, mobility: mob.id, mounts } as Design));
      }
    }
  }
  if (!only) for (const d of STARTER_DESIGNS) if (!SKIP.has(d.chassis)) bad.push(...checkDesign(d));
  assert.equal(bad.length, 0, `floating turrets:\n${bad.map((b) => `  ${b.key} turret ${b.turret} (${b.mod}, r ${b.r}) at ${b.base.join(',')}: ${b.gap} cells of air under it`).join('\n')}`);
});

test('the support check catches a lifted or side-shifted turret (negative control)', () => {
  const d = { id: 'float-ctl', name: 'ctl', chassis: 'warden', mobility: 'treads', mounts: ['autocannon', 'mg'] } as Design;
  assert.equal(checkDesign(d).length, 0);
  assert.equal(checkDesign(d, (u) => { u.turrets[0].yaw.position.y += 0.35; }).length, 1, 'lifted turret');
  assert.equal(checkDesign(d, (u) => { u.turrets[0].yaw.position.z += u.W * 0.9; }).length, 1, 'turret beside the hull');
});
