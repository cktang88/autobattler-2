// Weapon size audit: builds every ground weapon at its own size class (housing = DRAW_D) and prints its rest-pose
// bounding box (length x along the barrel, width z, height y above the deck) in cells and as a multiple of the class
// size. Width / height should stay within about 1.1-1.2 x the class size (barrels may be longer); rows over that are
// flagged.   node scripts/3d/weapon-size.ts        ONLY=massdriver,tactnuke node scripts/3d/weapon-size.ts
const ctx2d: unknown = new Proxy({}, { get(_t, k) {
  if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  return () => {}; }, set() { return true; } });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };
const R = new URL('../../', import.meta.url).pathname;
const THREE = await import(R + 'node_modules/three/build/three.module.js');
const { buildTurret, DRAW_D } = await import(R + 'src/client/proto3d/weapons3d.ts');
const { makeKit } = await import(R + 'src/client/proto3d/materials.ts');
const { MODULES } = await import(R + 'src/shared/parts.ts');
const only = process.env.ONLY?.split(',');
const LIM = Number(process.env.LIM ?? 1.2);
const kit = makeKit(0);
for (const m of MODULES as any[]) {
  if (m.kind !== 'weapon' || (only && !only.includes(m.id))) continue;
  const D = DRAW_D[m.mount as keyof typeof DRAW_D];
  let t; try { t = buildTurret(m, 3, kit, false, m.mount, D); } catch (e) { console.log(m.id, 'ERR', (e as Error).message); continue; }
  t.yaw.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(t.yaw);
  const L = b.max.x - b.min.x, W = b.max.z - b.min.z, H = b.max.y - Math.max(0, b.min.y);
  const flag = W > LIM * D || H > LIM * D ? '  <-- over' : '';
  console.log(`${m.id.padEnd(14)} ${m.mount.padEnd(2)} D ${D.toFixed(2)}  L ${L.toFixed(2)} W ${W.toFixed(2)} H ${H.toFixed(2)}  (x D: L ${(L / D).toFixed(2)} W ${(W / D).toFixed(2)} H ${(H / D).toFixed(2)})${flag}`);
}
