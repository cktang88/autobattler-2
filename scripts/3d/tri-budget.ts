// Triangle totals of every starter design at several mesh-simplification errors (geo.ts setSimplify).
//   ERRS=0,0.004 V=1 node scripts/3d/tri-budget.ts     (V=1 prints each design)
const ctx2d: unknown = new Proxy({}, { get(_t, k) {
  if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  return () => {}; }, set() { return true; } });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };
const R = new URL('../../', import.meta.url).pathname;
const { buildUnit } = await import(R + 'src/client/proto3d/units3d.ts');
const { setSimplify } = await import(R + 'src/client/proto3d/geo.ts');
const { STARTER_DESIGNS } = await import(R + 'src/shared/starters.ts');
const errs = (process.env.ERRS ?? '0,0.003,0.005,0.008').split(',').map(Number);
const tot = errs.map(() => 0);
for (const d of STARTER_DESIGNS) {
  const row = errs.map((e, j) => { setSimplify(e); const t = buildUnit(d, 0).tris; tot[j] += t; return t; });
  if (process.env.V) console.log(d.chassis.padEnd(12), row.map(Math.round).join(' '));
}
console.log('err', errs.join(' '), '| total', tot.map(Math.round).join(' '), '| ratio', tot.map((v) => (v / tot[0]).toFixed(2)).join(' '));
