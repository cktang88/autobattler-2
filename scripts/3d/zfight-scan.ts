// Z-fighting scan: for every starter design, coplanar same-facing overlapping triangles of DIFFERENT parts (the
// flicker zfix.ts removes at build time). Expect 0 or a few tiny pairs per unit.
//   node scripts/3d/zfight-scan.ts            ONLY=striker,titan node scripts/3d/zfight-scan.ts
//   SIMP=0 ...  (scan without mesh simplification)
// z-fighting scan: coplanar, same-facing, overlapping triangles from different parts (different mid or mesh)
const ctx2d: unknown = new Proxy({}, { get(_t, k) {
  if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  return () => {}; }, set() { return true; } });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };
const R = new URL('../../', import.meta.url).pathname;
const THREE = await import(R + 'node_modules/three/build/three.module.js');
const { buildUnit } = await import(R + 'src/client/proto3d/units3d.ts');
const { setSimplify } = await import(R + 'src/client/proto3d/geo.ts');
const { STARTER_DESIGNS } = await import(R + 'src/shared/starters.ts');
if (process.env.SIMP) setSimplify(Number(process.env.SIMP));
type T = { a: number[]; b: number[]; c: number[]; n: number[]; part: string; area: number };
const only = process.env.ONLY?.split(',');
const tot: Record<string, number> = {};
// the tug of war castle (chassis/castle.ts) with a gun of each class: its cupola is sized round the gun
const CASTLES = ['hmg', 'twin30', 'avenger', 'massdriver'].map((g, i) => ({ id: `tug-castle#${i}`, name: 'Castle', chassis: 'monolith', mobility: 'anchor', mounts: [g, null] }));
for (const d of [...STARTER_DESIGNS, ...CASTLES]) {
  if (only && !only.includes(d.chassis)) continue;
  const u = buildUnit(d, 0);
  u.root.updateMatrixWorld(true);
  const buckets = new Map<string, T[]>();
  let mi = 0;
  u.root.traverse((o: any) => {
    if (!o.isMesh || o.material?.isMeshBasicMaterial) return;
    const g = o.geometry, p = g.attributes.position, mid = g.attributes.mid, ix = g.index;
    const n = ix ? ix.count : p.count, m = o.matrixWorld, id = mi++;
    const v = (i: number) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
    for (let f = 0; f < n; f += 3) {
      const i0 = ix ? ix.getX(f) : f, i1 = ix ? ix.getX(f + 1) : f + 1, i2 = ix ? ix.getX(f + 2) : f + 2;
      const A = v(i0), B = v(i1), C = v(i2);
      const N = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      const area = N.length() / 2; if (area < 1e-6) continue; N.normalize();
      const dd = N.dot(A);
      const key = `${Math.round(N.x * 200)},${Math.round(N.y * 200)},${Math.round(N.z * 200)},${Math.round(dd * 2000)}`;
      const t: T = { a: A.toArray(), b: B.toArray(), c: C.toArray(), n: N.toArray(), part: `${id}:${mid ? Math.round(mid.getX(i0) * 1000) : 0}`, area };
      let l = buckets.get(key); if (!l) buckets.set(key, (l = [])); l.push(t);
    }
  });
  // overlap test in the plane: a vertex / centroid of one strictly inside the other
  const inside = (P: number[], t: T) => {
    const e = (x: number[], y: number[]) => { const c = [ (y[1]-x[1])*(P[2]-x[2]) - (y[2]-x[2])*(P[1]-x[1]), (y[2]-x[2])*(P[0]-x[0]) - (y[0]-x[0])*(P[2]-x[2]), (y[0]-x[0])*(P[1]-x[1]) - (y[1]-x[1])*(P[0]-x[0]) ]; return c[0]*t.n[0]+c[1]*t.n[1]+c[2]*t.n[2]; };
    const s0 = e(t.a, t.b), s1 = e(t.b, t.c), s2 = e(t.c, t.a), eps = 1e-7;
    return s0 > eps && s1 > eps && s2 > eps;
  };
  let hits = 0, area = 0; const where: string[] = [];
  for (const l of buckets.values()) {
    if (l.length < 2) continue;
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      const s = l[i], t = l[j]; if (s.part === t.part) continue;
      const cs = [0, 1, 2].map((k) => (s.a[k] + s.b[k] + s.c[k]) / 3), ct = [0, 1, 2].map((k) => (t.a[k] + t.b[k] + t.c[k]) / 3);
      if (inside(cs, t) || inside(ct, s)) { hits++; area += Math.min(s.area, t.area); if (where.length < 3) where.push(cs.map((x) => x.toFixed(2)).join(',')); }
    }
  }
  const k = d.id.startsWith('tug-castle') ? `castle:${d.mounts[0]}` : `${d.chassis}:${d.mobility}`;
  tot[k] = area;
  console.log(k.padEnd(24), 'pairs', hits, 'area', area.toFixed(4), where.join(' | '));
}
