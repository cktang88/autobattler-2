// Fallback running gear (wheels, hover skirt, anchor plate, flyers) from running3d.ts until each gets its own
// stylized builder. Stance heights mirror buildGear() exactly.

import { buildGear } from '../running3d.ts';
import { registerMobility, type Stance, type StanceIn } from '../chassis/registry.ts';

export function genericStance(s: StanceIn): Stance {
  const base = { tracked: false, legs: null, thick: 0, hipY: 0 } as const;
  switch (s.mobId) {
    case 'wheels': { const wr = 0.1 + 0.08 * s.S, w = wr * 0.8; return { ...base, y0: wr * 1.15, yt: wr * 2.0, wi: s.W / 2 - w * 0.8 }; }
    case 'anchor': return { ...base, y0: 0.14, yt: 0.2, wi: s.W * 0.4 };
    case 'rotor': case 'gravlift': case 'jet': return { ...base, y0: 0, yt: 0.1, wi: s.W * 0.4 };
    default: { const hgt = 0.12 + 0.05 * s.S; return { ...base, y0: hgt * 0.9, yt: hgt * 1.4, wi: s.W * 0.4 }; }
  }
}

registerMobility(['generic', 'wheels', 'hover', 'anchor', 'rotor', 'gravlift', 'jet'], {
  stance: genericStance,
  build(c) {
    const g = buildGear(c.root, c.mobId, c.L, c.W, c.S, c.kit, []);
    return g.update;
  },
});
