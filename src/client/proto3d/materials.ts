// Prototype materials: military paint with a triplanar panel/grime texture, so every procedural primitive (boxes,
// cylinders, extrusions at any scale) gets the same panel-line / wear detail without needing UVs.

import * as THREE from 'three';
import { TEAM_PAL } from '../render/palette.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Greyscale panel-line / rivet / scuff texture; multiplied over the paint colour. */
function makePanelTexture(): THREE.CanvasTexture {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const r = rng(1234);
  g.fillStyle = '#e9e9e9';
  g.fillRect(0, 0, N, N);
  // soft blotches (uneven paint / grime)
  for (let i = 0; i < 90; i++) {
    const x = r() * N, y = r() * N, rad = 20 + r() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.7;
    gr.addColorStop(0, dark ? 'rgba(60,55,45,0.13)' : 'rgba(255,255,255,0.12)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // panel seams (wrap-safe: grid with jittered cuts)
  g.strokeStyle = 'rgba(25,25,25,0.55)';
  g.lineWidth = 2;
  const cuts = [0, 128, 256, 384, 512];
  for (const x of cuts) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, N); g.stroke(); }
  for (let row = 0; row < 4; row++) {
    const y0 = row * 128;
    g.beginPath(); g.moveTo(0, y0); g.lineTo(N, y0); g.stroke();
    // brick-offset cross seam
    const off = (row % 2) * 64 + (r() < 0.5 ? 0 : 32);
    for (let x = off; x < N + 64; x += 128) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + 128); g.stroke(); }
  }
  // rivets along seams
  g.fillStyle = 'rgba(30,30,30,0.5)';
  for (let x = 0; x < N; x += 16) for (const y of [4, 124, 132, 252, 260, 380, 388, 508]) { g.beginPath(); g.arc(x + 8, y, 1.4, 0, 7); g.fill(); }
  // fine speckle
  for (let i = 0; i < 9000; i++) {
    const v = r() < 0.5 ? 20 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.05 + r() * 0.08})`;
    g.fillRect(r() * N, r() * N, 1 + r() * 2, 1 + r() * 2);
  }
  // paint chips / scratches
  g.strokeStyle = 'rgba(30,30,30,0.28)';
  g.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const x = r() * N, y = r() * N;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 34, y + (r() - 0.5) * 34); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let panel: THREE.CanvasTexture | null = null;
const cache = new Map<string, THREE.MeshStandardMaterial>();

export interface PaintOpts { rough?: number; metal?: number; scale?: number; emissive?: string; emissiveIntensity?: number; flat?: boolean }

/** Standard material with triplanar panel texture (object-space, scale = panel repeats per cell). */
export function paint(color: string, o: PaintOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? 0.62}|${o.metal ?? 0.35}|${o.scale ?? 0.9}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 0}|${o.flat ? 1 : 0}`;
  let m = cache.get(key);
  if (m) return m;
  panel ??= makePanelTexture();
  const tex = panel;
  m = new THREE.MeshStandardMaterial({
    color, roughness: o.rough ?? 0.62, metalness: o.metal ?? 0.35,
    emissive: o.emissive ?? '#000000', emissiveIntensity: o.emissiveIntensity ?? 0,
  });
  if (!o.flat) {
    const scale = o.scale ?? 0.9;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.triMap = { value: tex };
      sh.uniforms.triScale = { value: scale };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos; varying vec3 vTriN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = position; vTriN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos; varying vec3 vTriN; uniform sampler2D triMap; uniform float triScale;')
        .replace('#include <map_fragment>', `
          vec3 tbn = pow(abs(normalize(vTriN)), vec3(6.0)); tbn /= (tbn.x + tbn.y + tbn.z);
          vec3 tp = vTriPos * triScale;
          vec4 tcol = texture2D(triMap, tp.zy) * tbn.x + texture2D(triMap, tp.xz) * tbn.y + texture2D(triMap, tp.xy) * tbn.z;
          diffuseColor.rgb *= tcol.rgb;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (1.25 - tcol.r * 0.35), 0.05, 1.0);');
    };
    m.customProgramCacheKey = () => 'tri';
  }
  cache.set(key, m);
  return m;
}

export interface Kit {
  body: THREE.Material; light: THREE.Material; dark: THREE.Material; deep: THREE.Material;
  camo: THREE.Material; metal: THREE.Material; rubber: THREE.Material; steel: THREE.Material;
  accent: THREE.Material; glow: THREE.Material; lamp: THREE.Material; glass: THREE.Material;
  hot: THREE.Material; plasma: THREE.Material; rail: THREE.Material;
  pal: (typeof TEAM_PAL)[0];
}

/** Muted military paint; the team colour appears only in `accent` (stripes) and `glow` (lights). */
export function makeKit(team: 0 | 1): Kit {
  const p = TEAM_PAL[team];
  return {
    body: paint(p.body, { rough: 0.7, metal: 0.18 }),
    light: paint(p.light, { rough: 0.66, metal: 0.18 }),
    dark: paint(p.dark, { rough: 0.72, metal: 0.2 }),
    deep: paint(p.deep, { rough: 0.8, metal: 0.25 }),
    camo: paint(p.camo, { rough: 0.74, metal: 0.15 }),
    metal: paint('#3a3d40', { rough: 0.42, metal: 0.8, scale: 1.6 }),
    steel: paint('#6a6e72', { rough: 0.35, metal: 0.9, scale: 2 }),
    rubber: paint('#1b1c1d', { rough: 0.92, metal: 0.05, scale: 2.4 }),
    accent: paint(p.accent, { rough: 0.5, metal: 0.1, flat: true }),
    glow: paint('#000', { flat: true, emissive: p.glow, emissiveIntensity: 2.2 }),
    lamp: paint('#000', { flat: true, emissive: '#fff4d6', emissiveIntensity: 2.4 }),
    glass: paint('#10161b', { flat: true, rough: 0.08, metal: 0.9 }),
    hot: paint('#000', { flat: true, emissive: '#ff7a2a', emissiveIntensity: 3.2 }),
    plasma: paint('#000', { flat: true, emissive: '#7dffe6', emissiveIntensity: 3.6 }),
    rail: paint('#000', { flat: true, emissive: '#7aa8ff', emissiveIntensity: 3.4 }),
    pal: p,
  };
}

export { rng };
