// Measure where torso hulls draw their weapons (hero + pods) to generate shared/mountgeo.ts TORSO_SEATS.
//   node scripts/3d/torso-seats.ts            prints, per torso hull, the median seat per key and the worst residual
const ctx2d: unknown = new Proxy({}, { get(_t, k) {
  if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  return () => {}; }, set() { return true; } });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };
const R = new URL('../../', import.meta.url).pathname;
const THREE = await import(R + 'node_modules/three/build/three.module.js');
const { buildUnit } = await import(R + 'src/client/proto3d/units3d.ts');
const { drawnSeats, TORSO_HULLS } = await import(R + 'src/shared/mountgeo.ts');
const { MODULES, CHASSIS } = await import(R + 'src/shared/parts.ts');
const RK: Record<string, number> = { S: 1, M: 2, L: 3, XL: 4 };
const v = new THREE.Vector3();
const only = process.env.ONLY?.split(',');
for (const c of CHASSIS) {
  if (!TORSO_HULLS.has(c.id) || (only && !only.includes(c.id))) continue;
  const rows: { key: string; slot: string; x: number; y: number }[] = [];
  const weapons = MODULES.filter((m: any) => m.kind === 'weapon');
  for (const mob of c.mobility ?? ['wheels']) for (let s = 0; s < 40; s++) {
    const mounts = c.mounts.map((cls: string, i: number) => {
      const fit = MODULES.filter((m: any) => RK[m.mount] <= RK[cls]);
      const wf = weapons.filter((m: any) => RK[m.mount] <= RK[cls]);
      const r = (i * 7 + s * 13 + s * s * 3) % 11;
      return r === 10 ? null : r < 7 ? wf[(i * 5 + s * 17) % wf.length].id : fit[(i * 7 + s * 13) % fit.length].id;
    });
    const d = { id: `${c.id}-${mob}-${s}`, name: '', chassis: c.id, mobility: mob, mounts };
    const st = drawnSeats(d);
    if (st.flying || st.hero < 0) continue;
    const u = buildUnit(d, 0);
    u.root.updateMatrixWorld(true);
    let k = 0;
    mounts.forEach((id: string | null, i: number) => {
      if (!id) return;
      const t = u.turrets[k++];
      const m = MODULES.find((q: any) => q.id === id);
      if (!t || m.kind !== 'weapon') return;
      v.setFromMatrixPosition(t.pitch.matrixWorld);
      const role = i === st.hero ? 'H' : `P${st.pod[i]}`;
      rows.push({ key: `${role}:${m.mount}`, slot: `S${i}:${m.mount}:${role === 'H' ? 'H' : 'P'}`, x: v.x, y: v.z });
    });
  }
  const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
  const fit = (kf: (r: typeof rows[0]) => string) => {
    const g = new Map<string, typeof rows>();
    for (const r of rows) { const k = kf(r); if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); }
    let worst = 0; const tab: Record<string, [number, number]> = {};
    for (const [k, l] of g) { const mx = med(l.map((r) => r.x)), my = med(l.map((r) => r.y)); tab[k] = [+mx.toFixed(3), +my.toFixed(3)]; for (const r of l) worst = Math.max(worst, Math.hypot(r.x - mx, r.y - my)); }
    return { worst, tab };
  };
  const a = fit((r) => r.key), b = fit((r) => r.slot);
  console.log(c.id, 'role-worst', a.worst.toFixed(2), 'slot-worst', b.worst.toFixed(2));
  console.log('  role', JSON.stringify(a.tab));
  console.log('  slot', JSON.stringify(b.tab));
}
