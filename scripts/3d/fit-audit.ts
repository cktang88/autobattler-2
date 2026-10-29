// Fit audit: every ground chassis with every mount filled by a typical weapon of its class (S hmg, M autocannon,
// L avenger, XL annihilator). Prints the biggest housing vs the hull's narrow side and OVERLAP for separately standing
// turrets whose housings intersect (centre distance < 90% of the radii sum; the % is how close they are).
//   node scripts/3d/fit-audit.ts            ONLY=strider,saucer node scripts/3d/fit-audit.ts
const ctx2d: unknown = new Proxy({}, { get(_t, k) {
  if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  return () => {}; }, set() { return true; } });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };
const R = new URL('../../', import.meta.url).pathname;
const THREE = await import(R + 'node_modules/three/build/three.module.js');
const { buildUnit } = await import(R + 'src/client/proto3d/units3d.ts');
const { CHASSIS, MOBILITY, pairingError } = await import(R + 'src/shared/parts.ts');
const PICK: Record<string, string> = { S: 'hmg', M: 'autocannon', L: 'avenger', XL: 'annihilator' };
const only = process.env.ONLY?.split(',');
for (const ch of CHASSIS) {
  if (only && !only.includes(ch.id)) continue;
  if ((ch.domain ?? 'ground') !== 'ground') continue;
  const mob = MOBILITY.find((m: any) => !pairingError(ch.id, m.id) && m.kind === 'ground');
  if (!mob) continue;
  const d = { id: 'fit-' + ch.id, name: ch.id, chassis: ch.id, mobility: mob.id, mounts: ch.mounts.map((c: string) => PICK[c]) };
  let u; try { u = buildUnit(d as any, 0); } catch (e) { console.log(ch.id, 'ERR', (e as Error).message); continue; }
  u.root.updateMatrixWorld(true);
  const sep = u.turrets.filter((t: any) => t.host === undefined);
  const P = sep.map((t: any) => new THREE.Vector3().setFromMatrixPosition(t.yaw.matrixWorld));
  const bad: string[] = [];
  for (let i = 0; i < sep.length; i++) for (let j = i + 1; j < sep.length; j++) {
    const dd = Math.hypot(P[i].x - P[j].x, P[i].z - P[j].z), want = 0.9 * (sep[i].r + sep[j].r);
    if (dd < want && Math.abs(P[i].y - P[j].y) < 0.5 * (sep[i].r + sep[j].r)) bad.push(`${i}-${j} ${(dd / want * 100).toFixed(0)}%`);
  }
  const L = ch.footprint?.[1] ?? ch.size, W = ch.footprint?.[0] ?? ch.size;
  const maxD = Math.max(...u.turrets.map((t: any) => t.r * 2));
  console.log(`${ch.id.padEnd(12)} S${ch.size} ${W}x${L} mounts ${ch.mounts.join('')} maxD ${maxD.toFixed(2)} / minLW ${Math.min(L, W)} ${bad.length ? 'OVERLAP ' + bad.join(', ') : ''}`);
}
