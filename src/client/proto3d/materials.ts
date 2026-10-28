// Prototype materials. Unit parts share one painted-metal PBR "uber" material per team (makeKit): a per-vertex row id
// picks the part role (team armour, off-white shell, dark mechanics, gunmetal, steel, emissives; see PAINT_PLAN), and
// surface3d.ts adds triplanar plate seams / wear / grime. paint() is the older standalone triplanar panel material.

import * as THREE from 'three';
import { TEAM_PAL } from '../render/palette.ts';
import type { UMat, MatLike } from './geo.ts';
import { surfaceUniforms, loadSurfaceTextures, SD_VERT_DECL, SD_VERT_MAIN, SD_FRAG_DECL, SD_APPLY, sdBumpGLSL } from './surface3d.ts';
export type { UMat, MatLike };

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RGB data texture: R = albedo tint, G = height (seams, rivets, hatches), B = edge wear / chipping. Tileable. */
function makePanelTexture(): THREE.DataTexture {
  const N = 1024;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cr = mk(), cg = mk(), cb = mk();
  const gr = cr.getContext('2d')!, gg = cg.getContext('2d')!, gb = cb.getContext('2d')!;
  const r = rng(4242);
  gr.fillStyle = 'rgb(206,206,206)'; gr.fillRect(0, 0, N, N);
  gg.fillStyle = 'rgb(150,150,150)'; gg.fillRect(0, 0, N, N);
  gb.fillStyle = '#000'; gb.fillRect(0, 0, N, N);
  // recursive panel subdivision (borders land on 0/N so the texture tiles)
  const panels: [number, number, number, number][] = [];
  const split = (x: number, y: number, w: number, h: number, d: number) => {
    const minS = 150;
    if ((w < minS * 1.6 && h < minS * 1.6) || d > 4 || (d > 1 && r() < 0.18)) { panels.push([x, y, w, h]); return; }
    const vert = w > h ? true : h > w ? false : r() < 0.5;
    const cut = 0.38 + r() * 0.24;
    if (vert && w > minS * 1.3) { split(x, y, w * cut, h, d + 1); split(x + w * cut, y, w * (1 - cut), h, d + 1); }
    else if (!vert && h > minS * 1.3) { split(x, y, w, h * cut, d + 1); split(x, y + h * cut, w, h * (1 - cut), d + 1); }
    else panels.push([x, y, w, h]);
  };
  split(0, 0, N, N, 0);
  for (const [x, y, w, h] of panels) {
    const tint = 190 + r() * 38;
    gr.fillStyle = `rgb(${tint},${tint},${tint})`; gr.fillRect(x, y, w, h);
    // slow gradient across the panel (uneven repaint)
    const lg = gr.createLinearGradient(x, y, x + w * (r() < 0.5 ? 1 : 0.2), y + h * (r() < 0.5 ? 1 : 0.2));
    lg.addColorStop(0, 'rgba(255,255,255,0.05)'); lg.addColorStop(1, 'rgba(0,0,0,0.07)');
    gr.fillStyle = lg; gr.fillRect(x, y, w, h);
    // seam groove: dark in height + albedo
    gg.strokeStyle = 'rgb(40,40,40)'; gg.lineWidth = 4; gg.strokeRect(x + 2, y + 2, w - 4, h - 4);
    gg.strokeStyle = 'rgb(190,190,190)'; gg.lineWidth = 2; gg.strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);
    gr.strokeStyle = 'rgba(20,20,20,0.45)'; gr.lineWidth = 2.5; gr.strokeRect(x + 2, y + 2, w - 4, h - 4);
    // rivets
    for (let px = x + 14; px < x + w - 10; px += 36) for (const py of [y + 14, y + h - 14]) { gg.fillStyle = 'rgb(235,235,235)'; gg.beginPath(); gg.arc(px, py, 2.6, 0, 7); gg.fill(); }
    for (let py = y + 14; py < y + h - 10; py += 36) for (const px of [x + 14, x + w - 14]) { gg.fillStyle = 'rgb(235,235,235)'; gg.beginPath(); gg.arc(px, py, 2.6, 0, 7); gg.fill(); }
    // wear along the edges: chipped paint
    for (let i = 0; i < w / 6; i++) {
      const o = r() < 0.5;
      const px = x + r() * w, py = o ? y + 5 + r() * 6 : y + h - 11 + r() * 6;
      gb.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`; gb.fillRect(px, py, 2 + r() * 9, 1 + r() * 3);
    }
    for (let i = 0; i < h / 6; i++) {
      const o = r() < 0.5;
      const px = o ? x + 5 + r() * 6 : x + w - 11 + r() * 6, py = y + r() * h;
      gb.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`; gb.fillRect(px, py, 1 + r() * 3, 2 + r() * 9);
    }
    // features: hatch / vent slots / bolt plate
    const f = r();
    if (f < 0.3 && w > 90 && h > 90) {
      const hw = w * (0.35 + r() * 0.25), hh = h * (0.3 + r() * 0.25), hx = x + (w - hw) / 2, hy = y + (h - hh) / 2;
      gg.fillStyle = 'rgb(176,176,176)'; gg.fillRect(hx, hy, hw, hh);
      gg.strokeStyle = 'rgb(50,50,50)'; gg.lineWidth = 3; gg.strokeRect(hx, hy, hw, hh);
      gg.fillStyle = 'rgb(60,60,60)'; gg.fillRect(hx + hw * 0.4, hy + hh * 0.45, hw * 0.2, 7);
    } else if (f < 0.5 && w > 90 && h > 90) {
      const sx = x + w * 0.2, sw = w * 0.6;
      for (let k = 0; k < 6; k++) { gg.fillStyle = 'rgb(24,24,24)'; gg.fillRect(sx, y + h * 0.25 + k * (h * 0.5 / 6), sw, 5); gr.fillStyle = 'rgba(10,10,10,0.6)'; gr.fillRect(sx, y + h * 0.25 + k * (h * 0.5 / 6), sw, 5); }
    } else if (f < 0.62) {
      gr.fillStyle = 'rgba(255,255,255,0.06)'; gr.fillRect(x + 12, y + 12, w - 24, h - 24);
    }
  }
  // vertical grime streaks and blotches
  for (let i = 0; i < 90; i++) {
    const x = r() * N, y = r() * N, l = 40 + r() * 200;
    const g2 = gr.createLinearGradient(x, y, x, y + l);
    g2.addColorStop(0, 'rgba(30,24,16,0.0)'); g2.addColorStop(0.2, `rgba(30,24,16,${0.08 + r() * 0.1})`); g2.addColorStop(1, 'rgba(30,24,16,0)');
    gr.fillStyle = g2; gr.fillRect(x, y, 2 + r() * 5, l);
  }
  for (let i = 0; i < 160; i++) {
    const x = r() * N, y = r() * N, rad = 12 + r() * 60;
    const g2 = gr.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.7;
    g2.addColorStop(0, dark ? 'rgba(25,20,14,0.10)' : 'rgba(255,255,255,0.07)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    gr.fillStyle = g2; gr.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // scratches
  gb.strokeStyle = 'rgba(255,255,255,0.55)'; gb.lineWidth = 1;
  for (let i = 0; i < 160; i++) { const x = r() * N, y = r() * N; gb.beginPath(); gb.moveTo(x, y); gb.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 24); gb.stroke(); }
  // pack channels
  const out = new Uint8Array(N * N * 4);
  const dr = gr.getImageData(0, 0, N, N).data, dg = gg.getImageData(0, 0, N, N).data, db = gb.getImageData(0, 0, N, N).data;
  for (let i = 0; i < N * N; i++) { out[i * 4] = dr[i * 4]; out[i * 4 + 1] = dg[i * 4]; out[i * 4 + 2] = db[i * 4]; out[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(out, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

/** Decal atlas (4x4 tiles of 128 px): hazard stripes, team chevron / bars / roundel, white digits 0-9, stencil bar. */
function makeDecalAtlas(accent: string): THREE.CanvasTexture {
  const S = 512, T = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const tile = (i: number) => [(i % 4) * T, Math.floor(i / 4) * T] as const;
  { // 0 hazard
    const [x, y] = tile(0);
    g.save(); g.beginPath(); g.rect(x + 2, y + 2, T - 4, T - 4); g.clip();
    g.fillStyle = '#d3a92e'; g.fillRect(x, y, T, T);
    g.fillStyle = '#17181a';
    for (let k = -T; k < T * 2; k += 32) { g.beginPath(); g.moveTo(x + k, y + T); g.lineTo(x + k + 16, y + T); g.lineTo(x + k + 16 + T, y); g.lineTo(x + k + T, y); g.fill(); }
    g.restore();
  }
  { // 1 chevron
    const [x, y] = tile(1);
    g.fillStyle = accent;
    g.beginPath(); g.moveTo(x + 14, y + 20); g.lineTo(x + 70, y + 20); g.lineTo(x + 114, y + 64); g.lineTo(x + 70, y + 108); g.lineTo(x + 14, y + 108); g.lineTo(x + 58, y + 64); g.fill();
  }
  { // 2 bars
    const [x, y] = tile(2);
    g.fillStyle = accent; g.fillRect(x + 6, y + 14, T - 12, 28); g.fillRect(x + 6, y + 56, T - 12, 14); g.fillRect(x + 6, y + 84, T - 12, 14);
  }
  { // 3 roundel
    const [x, y] = tile(3);
    g.strokeStyle = accent; g.lineWidth = 10; g.beginPath(); g.arc(x + 64, y + 64, 44, 0, 7); g.stroke();
    g.fillStyle = accent; g.beginPath(); g.arc(x + 64, y + 64, 20, 0, 7); g.fill();
  }
  g.fillStyle = '#dcdfd6'; g.font = '700 104px Arial Narrow, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let d = 0; d < 10; d++) { const [x, y] = tile(4 + d); g.fillText(String(d), x + 64, y + 70); }
  { const [x, y] = tile(14); g.fillStyle = '#dcdfd6'; g.fillRect(x + 8, y + 52, T - 16, 22); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
/** uv rect of atlas tile i (v measured from the bottom, three's convention) */
export const atlasUV = (i: number): [number, number, number, number] => {
  const x = (i % 4) / 4, y = 1 - (Math.floor(i / 4) + 1) / 4;
  return [x + 0.004, y + 0.004, x + 0.25 - 0.004, y + 0.25 - 0.004];
};

let panelTex: THREE.DataTexture | null = null;
const cache = new Map<string, THREE.MeshStandardMaterial>();

const GLSL_FNS = /* glsl */ `
float h31(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y), f.z); }
vec3 triBump(vec3 sp, vec3 sn, vec2 dH, float fd){
  vec3 sx = normalize(dFdx(sp)), sy = normalize(dFdy(sp));
  vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * sn - grad);
}`;

export interface PaintOpts {
  rough?: number; metal?: number; scale?: number; wear?: number; bump?: number; dirt?: number;
  camo?: [string, string, string]; camoScale?: number;
}

/** Standard material with the triplanar panel/camo/grime shader. */
export function paint(color: string, o: PaintOpts = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([color, o]);
  let m = cache.get(key);
  if (m) return m;
  panelTex ??= makePanelTexture();
  const tex = panelTex;
  m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0.2, envMapIntensity: 1 });
  const col = (s: string) => new THREE.Color(s);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.triMap = { value: tex };
    sh.uniforms.triScale = { value: o.scale ?? 0.8 };
    sh.uniforms.camoA = { value: col(o.camo?.[0] ?? '#000') };
    sh.uniforms.camoB = { value: col(o.camo?.[1] ?? '#000') };
    sh.uniforms.camoC = { value: col(o.camo?.[2] ?? '#000') };
    sh.uniforms.camoOn = { value: o.camo ? 1 : 0 };
    sh.uniforms.camoScale = { value: o.camoScale ?? 1.1 };
    sh.uniforms.wearAmt = { value: o.wear ?? 0.7 };
    sh.uniforms.bumpK = { value: o.bump ?? 2.2 };
    sh.uniforms.dirtAmt = { value: o.dirt ?? 1 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTP; varying vec3 vTN; varying float vWY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTP = position; vTN = normal; vWY = (modelMatrix * vec4(position, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTP; varying vec3 vTN; varying float vWY; uniform sampler2D triMap; uniform float triScale; uniform vec3 camoA; uniform vec3 camoB; uniform vec3 camoC; uniform float camoOn; uniform float camoScale; uniform float wearAmt; uniform float bumpK; uniform float dirtAmt;\n' + GLSL_FNS)
      .replace('#include <map_fragment>', /* glsl */ `
        vec3 tb = pow(abs(normalize(vTN)), vec3(8.0)); tb /= (tb.x + tb.y + tb.z);
        vec3 tp = vTP * triScale;
        vec3 tc = texture2D(triMap, tp.zy).rgb * tb.x + texture2D(triMap, tp.xz + vec2(.37, .11)).rgb * tb.y + texture2D(triMap, tp.xy + vec2(.71, .53)).rgb * tb.z;
        float tH = tc.g; float tWear = tc.b;
        if (camoOn > 0.5) {
          vec3 cp = vTP * camoScale;
          float n1 = vn(cp * 1.0 + 3.1) * 0.65 + vn(cp * 2.3 + 11.0) * 0.35;
          float n2 = vn(cp * 1.7 + 41.0) * 0.6 + vn(cp * 3.9 + 7.0) * 0.4;
          vec3 cc = camoA;
          cc = mix(cc, camoB, smoothstep(0.48, 0.51, n1));
          cc = mix(cc, camoC, smoothstep(0.56, 0.59, n2) * (1.0 - smoothstep(0.48, 0.51, n1) * 0.5));
          diffuseColor.rgb = cc;
        }
        diffuseColor.rgb *= clamp(tc.r * 1.22, 0.0, 1.2);
        diffuseColor.rgb *= 0.86 + 0.14 * vn(vTP * 1.7);
        float dirt = smoothstep(0.5, 0.0, vWY) * (0.3 + 0.7 * vn(vTP * 7.0)) * dirtAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.17, 0.12) * (0.6 + 0.8 * tc.r), dirt * 0.62);
        float wearM = tWear * wearAmt * smoothstep(0.25, 0.7, vn(vTP * 8.0 + 5.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.43, 0.43, 0.42), wearM * 0.8);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (1.12 - wearM * 0.55) + dirt * 0.18, 0.05, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.85, clamp(wearM * 1.4, 0.0, 1.0));')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = triBump(-vViewPosition, normal, vec2(dFdx(tH), dFdy(tH)) * bumpK, faceDirection);');
  };
  m.customProgramCacheKey = () => 'tri2';
  cache.set(key, m);
  return m;
}

// ---- uber material: every static part of a unit shares one program/material; the part type is a per-vertex id ----
// Painted-metal PBR (MeshStandardMaterial): each row (part role) has its own colour, roughness and metalness, so glossy
// team paint, satin off-white shells, dark gunmetal mechanics and bare steel all catch the sun / sky environment
// differently. A gentle painted top-light, bevel brightening on chamfer faces (geometry is flat-shaded), soft
// ground-contact darkening and a faint cool rim stay on top. Crisp lit edges come from the screen-space edge pass
// (render3d/outline3d.ts). Surface detail (surface3d.ts: triplanar plate seams, rivets, hatches, stencils, chipped
// edges, grime streaks) modulates each row's colour / roughness / normal by the row's det / wear / grime weights.
interface Row {
  color: string; bev?: number; rim?: number; ao?: number; em?: string; emI?: number;
  /** panel seams / rivets / stencils (cavity + bump) weight, default 1 */
  det?: number;
  /** chipped paint / scratches weight, default 1 */
  wear?: number;
  /** grime / streaks / mottling weight, default 1 */
  grime?: number;
  /** PBR roughness / metalness (defaults: satin paint) */
  rough?: number; metal?: number;
}

const N_ROWS = 21; // 16 paint roles + 5 metal finishes (METAL_FINISH)

function makeUber(rows: Row[]): THREE.MeshStandardMaterial {
  const A: THREE.Vector4[] = [], B: THREE.Vector4[] = [], E: THREE.Vector4[] = [], M: THREE.Vector4[] = [];
  for (let i = 0; i < N_ROWS; i++) {
    const r = rows[i] ?? rows[0];
    const c = new THREE.Color(r.color);
    const lit = (r.emI ?? 0) > 0 && r.color === '#000000';
    A.push(new THREE.Vector4(c.r, c.g, c.b, lit ? 0 : r.det ?? 1));
    B.push(new THREE.Vector4(r.bev ?? 1, r.rim ?? 1, lit ? 0 : r.wear ?? 1, r.ao ?? 1));
    const e = new THREE.Color(r.em ?? '#000');
    E.push(new THREE.Vector4(e.r * (r.emI ?? 0), e.g * (r.emI ?? 0), e.b * (r.emI ?? 0), lit ? 0 : r.grime ?? 1));
    M.push(new THREE.Vector4(lit ? 1 : r.rough ?? 0.5, lit ? 0 : r.metal ?? 0.1, 0, 0));
  }
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.1, envMapIntensity: 1 });
  loadSurfaceTextures();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uA = { value: A }; sh.uniforms.uB = { value: B }; sh.uniforms.uE = { value: E }; sh.uniforms.uM = { value: M };
    Object.assign(sh.uniforms, surfaceUniforms);
    sh.uniforms.rimCol = { value: new THREE.Color('#a9c8ff') };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float mid; varying float vMid; varying vec3 vWN; varying float vWY;' + SD_VERT_DECL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vMid = mid;${SD_VERT_MAIN}
        vec4 wpS = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpS = instanceMatrix * wpS;
        #endif
        vWY = (modelMatrix * wpS).y;`)
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN = inverseTransformDirection(transformedNormal, viewMatrix);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vMid; varying vec3 vWN; varying float vWY;
uniform vec4 uA[${N_ROWS}]; uniform vec4 uB[${N_ROWS}]; uniform vec4 uE[${N_ROWS}]; uniform vec4 uM[${N_ROWS}]; uniform vec3 rimCol;${SD_FRAG_DECL}`)
      .replace('#include <map_fragment>', /* glsl */ `
        int mi = int(floor(vMid + 0.5));
        vec4 rA = uA[mi], rB = uB[mi], rM = uM[mi];
        vec3 wn = normalize(vWN);
        vec3 base = rA.rgb;
        // per-part value / hue jitter: Bld.g() writes a small per-call offset into the fraction of the row id, so
        // neighbouring plates of the same role are not cast from one piece (+-6% value, a touch warmer / cooler)
        float pj = clamp((vMid - float(mi)) * 5.0, -1.0, 1.0);
        base *= 1.0 + pj * 0.06 * rB.w;
        base += vec3(0.006, 0.0, -0.006) * pj * rB.w;
        // armour plating: the team-armour row is broken into plates of different paint -- team colour, light shell,
        // near-black team shade -- with dark seams, laid out in object space on the face's dominant plane (so every
        // chassis, flat or sloped, reads as an assembly of distinct plates instead of one moulded colour). Each plate
        // is a cell of a grid sized to the unit (its skin's texel density), split once across at a random point.
        // Creature and stealth skins keep their own look.
        float plateSeam = 0.0;
        float skinL = floor(vSdV.x + 0.5);
        if (mi == 0 && skinL != 8.0 && skinL != 11.0) {
          vec3 n = normalize(vNormal);
          vec3 on = abs(vec3(dot(n, vSdAX), dot(n, vSdAY), dot(n, vSdAZ)));
          float ax = on.y >= max(on.x, on.z) ? 0.0 : (on.x > on.z ? 1.0 : 2.0);
          vec2 q = ax == 0.0 ? vSdP.xz : (ax == 1.0 ? vSdP.zy : vSdP.xy);
          float S = 0.62 / max(0.3, vSdV.y > 0.001 ? vSdV.y : 0.8);
          vec2 gq = q / S + vec2(0.31, 0.17) + ax * vec2(0.37, 0.71);
          vec2 c = floor(gq), f = fract(gq);
          float h1 = fract(sin(dot(c + ax * 7.0, vec2(127.1, 311.7))) * 43758.5453);
          float cut = 0.3 + 0.4 * fract(h1 * 13.7);
          bool cx = fract(h1 * 7.13) < 0.5;
          float side = step(cut, cx ? f.x : f.y);
          float id = fract(sin(dot(c + ax * 7.0 + side * vec2(17.0, 31.0), vec2(269.5, 183.3))) * 43758.5453);
          float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          e = min(e, abs((cx ? f.x : f.y) - cut)) * S; // distance to the plate edge, object units
          float px = max(fwidth(gq.x), fwidth(gq.y)) * S;
          plateSeam = 1.0 - smoothstep(0.012 + px * 0.5, 0.024 + px, e);
          vec3 shell = uA[2].rgb * (0.97 + 0.06 * fract(id * 31.0)), dark = uA[15].rgb;
          base = id < 0.5 ? base : id < 0.76 ? shell : dark;
          // a bright worn bevel just inside each plate edge
          base *= 1.0 + 0.1 * (1.0 - smoothstep(0.024 + px, 0.05 + px, e)) * (1.0 - plateSeam);
          base *= 1.0 - 0.6 * plateSeam;
        }
        // painted top-light (subtle: the lighting does the form) + darker undersides (fake AO for faces looking down)
        base *= mix(0.86, 1.02, smoothstep(-0.7, 0.85, wn.y));
        base *= mix(1.0, mix(0.72, 1.0, smoothstep(-0.75, -0.05, wn.y)), rB.w);
        // bevel brightening on chamfers (normals between side and up): barely there, real plates have sharp edges
        float bev = smoothstep(0.22, 0.42, wn.y) * (1.0 - smoothstep(0.8, 0.93, wn.y));
        base = mix(base, base * 1.04 + vec3(0.004), bev * rB.x);
        // grounded: dust on the running gear right at the ground (wheels, track bottoms, feet), a little ground-contact
        // darkening; a fixed band, so it must stay thin: a 0.5-cell band covered whole low hulls (wheeled / half-track
        // scouts and raiders came out sand-washed head to toe while walkers above it stayed clean)
        float dustK = (1.0 - smoothstep(0.0, 0.14, vWY)) * rB.w * 0.6;
        base *= mix(1.0, mix(0.8, 1.0, smoothstep(0.0, 0.18, vWY)), rB.w);
        base = mix(base, vec3(0.43, 0.37, 0.28) * (0.75 + 0.5 * dot(base, vec3(0.33))), dustK * (0.28 + 0.2 * smoothstep(0.3, -0.3, wn.y)));
        // ---- surface detail (surface3d.ts): per-mesh skin layer, per-row weights ----
        float sdRowDet = rA.w, sdRowWear = rB.z, sdRowGrime = uE[mi].w; vec3 sdAccent = uA[9].rgb;
        ${SD_APPLY}
        diffuseColor.rgb = base;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // row roughness, scaled by the skin (grime roughens, chipped edges are bare satin metal)
        roughnessFactor = clamp(mix(rM.x * sdRough, 0.45, sdMetal * 0.5) + pj * 0.05 * rB.w + dustK * 0.15, 0.08, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(rM.y, 0.8, sdMetal * 0.8);`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + sdBumpGLSL('sdGradR'))
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance = uE[mi].rgb + uE[10].rgb * sdGlow * 0.5;
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += rimCol * fres * 0.08 * rB.y * (0.6 + 0.4 * smoothstep(-0.2, 0.8, wn.y));`);
  };
  m.customProgramCacheKey = () => 'uberPBR2';
  return m;
}

export interface Kit {
  /** primary hull paint: muted military TEAM tint (matte) on the big armour plates */
  hull: MatLike;
  /** near-black mechanical parts: joints, track frames, recesses, barrels, vents, hatches */
  trim: MatLike;
  /** mid-grey shell parts (faintly team-tinted): caps, skirts, cheek plates, leg covers */
  panel: MatLike;
  metal: MatLike; steel: MatLike; rubber: MatLike; glass: MatLike;
  canvas: MatLike; hazard: MatLike;
  accent: MatLike; glow: MatLike; lamp: MatLike; hot: MatLike; plasma: MatLike; rail: MatLike;
  /** darker shade of the team colour (secondary armour plates, inner faces of big plates) */
  hull2: MatLike;
  // ---- paint-plan role aliases (same materials, named by what the part is; see PAINT_PLAN) ----
  /** big armour plates (muted team tint) = hull */
  armor: MatLike;
  /** secondary team plates = hull2 */
  armor2: MatLike;
  /** light shell parts = panel */
  shell: MatLike;
  /** dark mechanics = trim */
  mech: MatLike;
  /** gunmetal joints, pistons, barrels = metal */
  joint: MatLike;
  /** small machined fittings on barrels (breech rings, fume extractors) = metal unless the finish sets one */
  fitting: MatLike;
  /** this kit's metal finish (see METAL_FINISH) */
  finish: { joint: MetalFinish; fitting: MetalFinish };
  /** textured decals (separate alpha-tested material) */
  decal: THREE.Material;
  uber: THREE.Material;
  pal: (typeof TEAM_PAL)[0];
}

/**
 * Paint plan ("stylized realistic": Phantom Brigade / Iron Harvest / BattleTech value structure). Every chassis builder
 * assigns parts by role:
 *   armor  (kit.hull)   muted military team tint, matte paint   the biggest plates (slate blue-grey / oxide red-brown)
 *   armor2 (kit.hull2)  near-black team shade                   inner / lower faces of big plates, secondary plates
 *   shell  (kit.panel)  light bone (faint team cast), matte     caps, skirts, cheek plates, leg covers, turret tops
 *   mech   (kit.trim)   near-black                              joints, track frames, recesses, vents, belly
 *   joint  (kit.metal)  bare-metal FINISH, metallic             pistons, barrels, axles, hinges (default dark gunmetal;
 *                       per unit / per weapon: dark chrome, blued steel, oiled bronze, copper, brass; see METAL_FINISH)
 *   fitting             finish of small barrel fittings          breech rings, fume extractors (= joint by default)
 *   steel / rubber / glass / hazard                             bare steel, tyres, canopies, warning stripes
 *   accent                                                      FULL-CHROMA team colour: stripes, chevrons, roundels
 *   glow / lamp / hot / plasma / rail                           small bright emissive accents (eyes, cores, lights)
 * Neutral mid-to-dark mechanics dominate (55-70% of what is visible: trim, metal, shell, rubber), the team tint is a
 * low-chroma layer on top, and pure team chroma lives only on small markings and lights (<= ~15%). The bare-metal finish
 * stays low-chroma and dark-to-mid value (a satin glint, not a colour), so it varies the mechanics without competing
 * with team identity. Team identity =
 * the hue / temperature of armor (cool blue-grey vs warm red-brown) + accent markings + glow colour. Per-part value
 * jitter, a ground-up dust gradient and darker undersides (uber shader) keep plates from reading as moulded plastic.
 */
export const PAINT_PLAN = {
  armor: 'hull', armor2: 'hull2', shell: 'panel', mech: 'trim', joint: 'metal',
} as const;

/** team paint: [armor, armor2, shell, canvas]; matches render/palette.ts TEAM_PAL body / dark */
// Parts must separate by VALUE, not just hue (Mechabellum-style): clean team armour, near-black team-tinted secondary
// plates, light bone shells, near-black mechanics and metal joints, so a hull reads as an assembly of distinct pieces.
export const TEAM_PAINT: [string, string, string, string][] = [
  ['#3b5d9c', '#1a2338', '#b4b6b0', '#4a5258'],
  ['#9b3a27', '#36170f', '#bab0a3', '#5c5248'],
];
/**
 * Bare-metal finishes for the joint / metal role (pistons, axles, hinges, barrels) as extra uber rows: every finish of
 * a team lives in the same shared material (only the per-vertex row id differs), so a finish costs no draw calls or
 * programs and instancing is untouched. Kept dark-to-mid and low-chroma so they read as machined metal, not paint:
 *   gunmetal  dark grey-blue, semi-gloss (the default, most units)
 *   chrome    dark chrome: cool, polished, mirror-ish (precision guns, energy emitters, aircraft oleos, support)
 *   blued     blued steel: blue-black, satin (light scouts, artillery tubes)
 *   bronze    oiled bronze: warm brown, satin (heavy industrial hydraulics, titans, creatures, flamers)
 *   copper    dark copper: warm red-brown, glossy (coils on tesla / EMP / heat-ray weapons)
 *   brass     dull brass: warm yellow, satin (artillery breech rings, sonic emitters)
 * The finish of a unit / weapon is picked in finish3d.ts.
 */
export type MetalFinish = 'gunmetal' | 'chrome' | 'blued' | 'bronze' | 'copper' | 'brass';
export const METAL_FINISH: Record<MetalFinish, number> = { gunmetal: 3, chrome: 16, blued: 17, bronze: 18, copper: 19, brass: 20 };
const FINISH_ROWS: Row[] = [
  /* chrome */ { color: '#646b74', rough: 0.2, metal: 1, bev: 0.7, det: 0.22, wear: 0.1, grime: 0.45 },
  /* blued  */ { color: '#2f3a4c', rough: 0.3, metal: 0.88, bev: 0.6, det: 0.35, wear: 0.3, grime: 0.6 },
  /* bronze */ { color: '#6a5234', rough: 0.36, metal: 0.9, bev: 0.6, det: 0.4, wear: 0.25, grime: 0.75 },
  /* copper */ { color: '#93553a', rough: 0.28, metal: 0.92, bev: 0.6, det: 0.3, wear: 0.15, grime: 0.6 },
  /* brass  */ { color: '#9b7f42', rough: 0.32, metal: 0.92, bev: 0.6, det: 0.3, wear: 0.2, grime: 0.6 },
];

export interface FinishSpec { joint?: MetalFinish; fitting?: MetalFinish }
const kits: (Kit | null)[] = [null, null];
const finKits = new Map<string, Kit>();

/** Team kit; `fin` swaps the bare-metal finish of the joint / metal role (and barrel fittings). Variants share the
 *  team's one uber material and decal material (cached per team + finish). */
export function makeKit(team: 0 | 1, fin: FinishSpec = {}): Kit {
  const base = baseKit(team);
  const j = fin.joint ?? 'gunmetal', f = fin.fitting ?? j;
  if (j === 'gunmetal' && f === 'gunmetal') return base;
  const key = `${team}|${j}|${f}`;
  let k = finKits.get(key);
  if (!k) {
    const rowMat = (fi: MetalFinish): UMat => ({ uid: METAL_FINISH[fi], base: base.uber });
    const jm = j === 'gunmetal' ? base.metal : rowMat(j);
    const fm = f === j ? jm : f === 'gunmetal' ? base.metal : rowMat(f);
    k = { ...base, metal: jm, joint: jm, fitting: fm, finish: { joint: j, fitting: f } };
    finKits.set(key, k);
  }
  return k;
}

function baseKit(team: 0 | 1): Kit {
  const hit = kits[team];
  if (hit) return hit;
  const p = TEAM_PAL[team];
  const names = ['hull', 'trim', 'panel', 'metal', 'steel', 'rubber', 'glass', 'canvas', 'hazard', 'accent', 'glow', 'lamp', 'hot', 'plasma', 'rail', 'hull2'] as const;
  const tp = TEAM_PAINT[team];
  const rows: Row[] = [
    /* hull   */ { color: tp[0], rough: 0.58, metal: 0.06, det: 0.85, grime: 0.8, wear: 0.85 },
    /* trim   */ { color: '#1d2023', rough: 0.62, metal: 0.35, bev: 0.5, det: 0.7, grime: 0.9, wear: 0.5 },
    /* panel  */ { color: tp[2], rough: 0.6, metal: 0.03, det: 0.75, grime: 0.6, wear: 0.9 },
    /* metal  */ { color: '#474e55', rough: 0.45, metal: 0.75, bev: 0.6, det: 0.45, wear: 0.4, grime: 0.7 },
    /* steel  */ { color: '#b3bac0', rough: 0.26, metal: 0.95, bev: 0.6, det: 0.2, wear: 0, grime: 0.4 },
    /* rubber */ { color: '#1b1c1e', rough: 0.88, metal: 0, bev: 0.3, rim: 0.4, det: 0.15, wear: 0, grime: 1.1 },
    /* glass  */ { color: '#14262f', rough: 0.08, metal: 0.3, bev: 0.4, rim: 2.2, em: p.glow, emI: 0.12, det: 0, wear: 0, grime: 0.2 },
    /* canvas */ { color: tp[3], rough: 0.85, metal: 0, det: 0.12, wear: 0.2 },
    /* hazard */ { color: '#c99a32', rough: 0.45, metal: 0.05, det: 0.5, wear: 1.2, grime: 0.6 },
    /* accent */ { color: p.accent, rough: 0.55, metal: 0.05, bev: 0.3, det: 0.35, wear: 0.6, grime: 0.4 },
    /* glow   */ { color: '#000000', bev: 0, rim: 0, ao: 0, em: p.glow, emI: 1.6 },
    /* lamp   */ { color: '#000000', bev: 0, rim: 0, ao: 0, em: '#ffe8c4', emI: 1.45 },
    /* hot    */ { color: '#000000', bev: 0, rim: 0, ao: 0, em: '#ff7a2a', emI: 2.6 },
    /* plasma */ { color: '#000000', bev: 0, rim: 0, ao: 0, em: '#79f0d6', emI: 2.0 },
    /* rail   */ { color: '#000000', bev: 0, rim: 0, ao: 0, em: '#86adff', emI: 2.4 },
    /* hull2  */ { color: tp[1], rough: 0.7, metal: 0.04, det: 0.85, grime: 0.85, wear: 0.75 },
    ...FINISH_ROWS, // 16..20: METAL_FINISH
  ];
  const uber = makeUber(rows);
  const decalTex = makeDecalAtlas(p.accent);
  const kit: Record<string, unknown> = {
    decal: new THREE.MeshStandardMaterial({ map: decalTex, roughness: 0.68, metalness: 0.02, transparent: false, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    uber, pal: p,
  };
  names.forEach((n, i) => { kit[n] = { uid: i, base: uber } as UMat; });
  for (const [role, slot] of Object.entries(PAINT_PLAN)) kit[role] = kit[slot];
  kit.fitting = kit.metal;
  kit.finish = { joint: 'gunmetal', fitting: 'gunmetal' };
  kits[team] = kit as unknown as Kit;
  return kits[team]!;
}
