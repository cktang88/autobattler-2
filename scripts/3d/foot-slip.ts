// Foot slip: walks each legged starter (and a few hull x leg fits) straight ahead at sim speed through the real render
// rig (units-adapter Rig.locomote, as FieldView3D drives it) and measures how fast planted feet move over the ground
// (world frame). 0 = feet stay put while the body walks over them; 1 = feet skate at walking speed.
//   node scripts/3d/foot-slip.ts       WAY=1.57 (walk sideways, rad in the hull frame)
const ctx2d: unknown = new Proxy({}, { get(_t, k) {
  if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  return () => {}; }, set() { return true; } });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };
const R = new URL('../../', import.meta.url).pathname;
const THREE = await import(R + 'node_modules/three/build/three.module.js');
const { UnitLayer } = await import(R + 'src/client/render3d/units-adapter.ts');
const { STARTER_DESIGNS } = await import(R + 'src/shared/starters.ts');
const { computeStats } = await import(R + 'src/shared/stats.ts');
const WAY = Number(process.env.WAY ?? 0);
const layer = new UnitLayer();
const ds = STARTER_DESIGNS.filter((d: any) => ['legs', 'spider', 'jumpjets', 'titanlegs'].includes(d.mobility));
for (const d of ds) {
  const rig = layer.acquire(d, 0);
  const speed = computeStats(d).speed; // cells / s
  const dt = 1 / 60, v = new THREE.Vector3();
  // feet: animated nodes whose rest position is near the ground
  const box = new THREE.Box3().setFromObject(rig.tpl.unit.root);
  const H = box.max.y - box.min.y;
  const feet = rig.tpl.animated.filter((k: number) => { rig.tpl.unit.root.updateMatrixWorld(true); v.setFromMatrixPosition(rig.tpl.nodes[k].src.matrixWorld); return v.y < H * 0.12; });
  let x = 0, z = 0, worst = 0, sum = 0, n = 0;
  const tr = new Map<number, THREE.Vector3[]>();
  const steps: number[] = [];
  for (let f = 0; f < 600; f++) {
    const step = speed * dt;
    x += Math.cos(WAY) * step; z += Math.sin(WAY) * step;
    rig.root.position.set(x, 0, z);
    rig.locomote(step, true, f * dt, dt, Math.cos(WAY) * step, Math.sin(WAY) * step, 0);
    rig.update(dt);
    if (f < 120) continue; // let the stride amplitude settle
    steps.push(step);
    for (const k of feet) { const l = tr.get(k) ?? []; l.push(v.setFromMatrixPosition((rig as any).objs[k].matrixWorld).clone()); tr.set(k, l); }
  }
  // planted = within 1% of the leg height above that foot's lowest point
  for (const l of tr.values()) {
    const lo = Math.min(...l.map((p) => p.y));
    for (let i = 1; i < l.length; i++) if (l[i]!.y < lo + H * 0.01 && l[i - 1]!.y < lo + H * 0.01) {
      const s = Math.hypot(l[i]!.x - l[i - 1]!.x, l[i]!.z - l[i - 1]!.z) / steps[i]!; worst = Math.max(worst, s); sum += s; n++;
    }
  }
  console.log(`${d.chassis}:${d.mobility}`.padEnd(24), 'feet', feet.length, 'planted', n, 'slip mean', (sum / Math.max(1, n)).toFixed(2), 'max', worst.toFixed(2), 'speed', speed.toFixed(2));
}
