// Sim vs render drift: for every starter design, the distance (cells, top view) between each weapon's sim mount
// point (shared/mountgeo.ts mountOffsets, what the battle sim fires from) and where the 3D model draws that turret.
//   node scripts/3d/mount-drift.ts          ONLY=colossal node scripts/3d/mount-drift.ts      MAX=0.5 (flag threshold)
const ctx2d: unknown = new Proxy({}, { get(_t, k) {
  if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  return () => {}; }, set() { return true; } });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };
const R = new URL('../../', import.meta.url).pathname;
const THREE = await import(R + 'node_modules/three/build/three.module.js');
const { buildUnit } = await import(R + 'src/client/proto3d/units3d.ts');
const { STARTER_DESIGNS } = await import(R + 'src/shared/starters.ts');
const { fireOffsets: mountOffsets } = await import(R + "src/shared/mountgeo.ts");
const { MODULE_BY_ID, MODULES, CHASSIS } = await import(R + 'src/shared/parts.ts');
const only = process.env.ONLY?.split(','), MAX = Number(process.env.MAX ?? 0.5);
const v = new THREE.Vector3();
// RAND=1: also every chassis x mobility with deterministic module fills (as test/mountgeo.test.ts)
const RANKC: Record<string, number> = { S: 1, M: 2, L: 3, XL: 4 };
const designs = [...STARTER_DESIGNS];
if (process.env.RAND) for (const c of CHASSIS) for (const mob of c.mobility ?? ['wheels']) for (let s = 0; s < 6; s++)
  designs.push({ id: `${c.id}-${s}`, name: '', chassis: c.id, mobility: mob, mounts: c.mounts.map((cls: string, i: number) => {
    const fit = MODULES.filter((m: any) => RANKC[m.mount] <= RANKC[cls]);
    return (i + s) % 5 === 4 ? null : fit[(i * 7 + s * 13) % fit.length].id; }) });
for (const d of designs) {
  if (only && !only.includes(d.chassis)) continue;
  const u = buildUnit(d, 0);
  u.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(u.root.matrixWorld).invert();
  const offs = mountOffsets(d);
  let k = 0;
  const out: string[] = [];
  d.mounts.forEach((id: string | null, i: number) => {
    const t = u.turrets[k];
    if (!id || !offs[i]) return;
    k++;
    if (!t || MODULE_BY_ID.get(id)?.kind !== 'weapon') return;
    v.setFromMatrixPosition(t.pitch.matrixWorld).applyMatrix4(inv);
    const dist = Math.hypot(v.x - offs[i].x, v.z - offs[i].y);
    out.push(`${i}:${id} ${dist.toFixed(2)}${dist > MAX ? ' !!' : ''} (sim ${offs[i].x.toFixed(2)},${offs[i].y.toFixed(2)} drawn ${v.x.toFixed(2)},${v.z.toFixed(2)})`);
  });
  console.log(`${d.chassis}:${d.mobility}`.padEnd(24), out.join(' | '));
}
