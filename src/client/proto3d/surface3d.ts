// Surface detail for unit materials: a family of 14 tileable greyscale "skins" (public/assets/tex/, see README.md there
// and scripts/gen-surface-textures.py) in one texture ARRAY, projected TRIPLANAR in object space, so procedural geometry
// needs no UVs and the detail sticks to a moving / turning / instanced unit. Which skin a mesh wears, its texel density
// (per size class: a scout gets fine panels, a titan titan-scale plates) and its region (hull / turret / running gear)
// travel as a per-vertex attribute `sdv` written by skins.ts at build time, so the shared per-team material stays one
// program and units keep instancing. The maps only modulate the part colours (team paint, trims, accents keep their hue).
//
//   surf_detail.png  14 layers: R,G = height slope (0.5 = flat), B = cavity / paint tone (0.75 = neutral)
//   surf_mask.png    14 layers: per-skin special mask (camo, pits, scorch, role paint, circuit glow, gouges, dust, ...)
//   hull_wear.jpg    shared: R = chipped paint / scratches, G = grime + drip streaks, B = mottling (0.5 = neutral)
//   surf_marks.png   glyph atlas for intentional big-unit markings (digits, kill tally, insignia)
//
//   sdv = (layer of this mesh, tiles per object unit, primary layer of the unit, giantSecondary+1 + 32 * region)
//   sdb = giant hull only: (marking centre x, centre y, glyph height, hull number)
//
// Giants (size >= 4) mix skins strictly by PART, never by noise: hull rows wear the primary armour, the panel row the
// secondary skin, up-facing trim (decks) grating, metal / steel machinery (joints, legs), turrets their own skin with
// hazard bands on the turret collar; numerals + insignia + kill tally on the hull flanks.
//
// Every material that injects these chunks shares the same uniform objects, so the async texture load (and the quality
// toggle) flips all of them at once without recompiling. Until the images arrive sdOn = 0 and the plain look shows.

import * as THREE from 'three';

let base = 'assets/tex/';
/** Override the texture folder (relative to the page). */
export function setSurfaceTextureBase(path: string): void { base = path.endsWith('/') ? path : path + '/'; }

/** skin layers (index into the texture array; order = scripts/gen-surface-textures.py LAYERS) */
export const LAYER = {
  scout: 0, cast: 1, slab: 2, titan: 3, air: 4, rotor: 5, arty: 6, support: 7, carapace: 8, ceramic: 9, brawler: 10,
  stealth: 11, grating: 12, machinery: 13,
} as const;
export type LayerName = keyof typeof LAYER;
const N_LAYERS = 14, TEX = 512;

// per layer: what the skin's mask does and how strong its bump is
//   L0 = (bump, mask darkens, mask = bare metal, mask = team accent paint)   L1 = (glow, dust, sheen, grime)
const L0: Record<LayerName, [number, number, number, number]> = {
  scout: [1.0, 0.14, 0, 0], cast: [1.2, 0.16, 0, 0], slab: [1.4, 0.14, 0, 0], titan: [1.1, 0.22, 0.3, 0],
  air: [0.8, 0, 0, 0], rotor: [1.0, 0, 0, 0], arty: [1.0, 0, 0, 0], support: [0.7, 0, 0, 0.7],
  carapace: [0.9, 0, 0, 0], ceramic: [0.7, 0, 0, 0], brawler: [1.3, 0, 0.9, 0], stealth: [0.6, 0, 0, 0],
  grating: [1.3, 0, 0, 0], machinery: [1.2, 0, 0, 0],
};
const L1: Record<LayerName, [number, number, number, number]> = {
  scout: [0, 0, 0, 0], cast: [0, 0, 0, 0], slab: [0, 0, 0, 0.7], titan: [0, 0, 0, 0],
  air: [0, 0, 0, 0], rotor: [0, 0, 0, 0.6], arty: [0, 0.55, 0, 0], support: [0, 0, 0, 0],
  carapace: [0, 0, 0.35, 0], ceramic: [0.6, 0, 0.08, 0], brawler: [0, 0, 0, 0], stealth: [0, 0, 0, 0],
  grating: [0, 0, 0, 0], machinery: [0, 0, 0, 0.6],
};
// per PRIMARY skin (the whole unit shares it, so one machine has one wear / grime level): (wear, grime, mottle, -)
const UNIT: Record<LayerName, [number, number, number, number]> = {
  scout: [0.8, 0.8, 1.0, 0], cast: [0.7, 1.0, 1.0, 0], slab: [0.75, 1.35, 1.0, 0], titan: [1.1, 1.2, 0.9, 0],
  air: [0.45, 0.3, 0.6, 0], rotor: [0.7, 0.8, 0.8, 0], arty: [0.8, 1.2, 1.0, 0], support: [0.35, 0.45, 0.5, 0],
  carapace: [0.1, 0.6, 0.7, 0], ceramic: [0.25, 0.35, 0.4, 0], brawler: [1.8, 1.1, 1.0, 0], stealth: [0.2, 0.4, 0.4, 0],
  grating: [1, 1, 1, 0], machinery: [1, 1, 1, 0],
};
const vec4s = (t: Record<LayerName, [number, number, number, number]>) => {
  const out: THREE.Vector4[] = [];
  for (let i = 0; i < 16; i++) {
    const k = (Object.keys(LAYER) as LayerName[]).find((n) => LAYER[n] === i);
    out.push(new THREE.Vector4(...(k ? t[k] : [1, 0, 0, 0])));
  }
  return out;
};

function flatArray(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint8Array([128, 128, 191, 0]), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}
function flat(r: number, g: number, b: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** shared uniforms (the same objects are handed to every program) */
export const surfaceUniforms = {
  sdA: { value: flatArray() as THREE.Texture },
  sdB: { value: flat(0, 0, 128) as THREE.Texture },
  sdM: { value: flat(0, 0, 0) as THREE.Texture },
  /** 1 when the maps are loaded and detail is enabled */
  sdOn: { value: 0 },
  /** global bump strength */
  sdBump: { value: 0.9 },
  sdL0: { value: vec4s(L0) },
  sdL1: { value: vec4s(L1) },
  sdU: { value: vec4s(UNIT) },
};

let loaded = 0, started = false, wanted = true;
const NEED = 3;
const sync = () => { surfaceUniforms.sdOn.value = loaded === NEED && wanted ? 1 : 0; };

/** Enable / disable the detail (quality setting). Cheap: a uniform branch, no recompile. */
export function setSurfaceDetail(on: boolean): void { wanted = on; sync(); }
export const surfaceDetailReady = () => loaded === NEED;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}
function pixels(im: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(im, 0, 0);
  return g.getImageData(0, 0, im.width, im.height).data;
}

/** Start loading the maps (idempotent, non-blocking; browser only). */
export function loadSurfaceTextures(): void {
  if (started || typeof document === 'undefined' || typeof Image === 'undefined') return;
  started = true;
  const done = () => { loaded++; sync(); };
  // skins: RGB strip + mask strip -> one RGBA texture array (rows flipped so v points up the image, like the 2D maps)
  Promise.all([loadImage(base + 'surf_detail.png'), loadImage(base + 'surf_mask.png')]).then(([rgb, msk]) => {
    const a = pixels(rgb), m = pixels(msk);
    const layers = Math.min(N_LAYERS, Math.floor(rgb.height / TEX));
    const data = new Uint8Array(TEX * TEX * 4 * layers);
    for (let l = 0; l < layers; l++) for (let y = 0; y < TEX; y++) {
      const src = ((l * TEX + (TEX - 1 - y)) * TEX) * 4, dst = ((l * TEX + y) * TEX) * 4;
      for (let x = 0; x < TEX * 4; x += 4) {
        data[dst + x] = a[src + x]; data[dst + x + 1] = a[src + x + 1]; data[dst + x + 2] = a[src + x + 2]; data[dst + x + 3] = m[src + x];
      }
    }
    const t = new THREE.DataArrayTexture(data, TEX, TEX, layers);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    surfaceUniforms.sdA.value = t;
    done();
  }).catch(() => { /* missing maps: keep the plain look */ });
  const ld = new THREE.TextureLoader();
  ld.load(base + 'hull_wear.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
    surfaceUniforms.sdB.value = t; done();
  }, undefined, () => {});
  ld.load(base + 'surf_marks.png', (t) => {
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    surfaceUniforms.sdM.value = t; done();
  }, undefined, () => {});
}

// ---- GLSL -------------------------------------------------------------------------------------------------------
/** vertex: declarations (after #include <common>) */
export const SD_VERT_DECL = /* glsl */ `
attribute vec4 sdv; attribute vec4 sdb;
varying vec3 vSdP; varying vec4 vSdV; varying vec4 vSdB; varying vec3 vSdAX; varying vec3 vSdAY; varying vec3 vSdAZ;`;
/** vertex: body (after #include <begin_vertex>); object-space position + the object axes in view space */
export const SD_VERT_MAIN = /* glsl */ `
  vSdP = position; vSdV = sdv; vSdB = sdb;
  {
    mat3 sdMv = mat3(modelViewMatrix);
    #ifdef USE_INSTANCING
      sdMv = sdMv * mat3(instanceMatrix);
    #endif
    vSdAX = normalize(sdMv[0]); vSdAY = normalize(sdMv[1]); vSdAZ = normalize(sdMv[2]);
  }`;
/** fragment: declarations (after #include <common>) + sdRun(): picks the skin layer for this fragment and samples it */
export const SD_FRAG_DECL = /* glsl */ `
varying vec3 vSdP; varying vec4 vSdV; varying vec4 vSdB; varying vec3 vSdAX; varying vec3 vSdAY; varying vec3 vSdAZ;
uniform highp sampler2DArray sdA; uniform sampler2D sdB; uniform sampler2D sdM; uniform float sdOn; uniform float sdBump;
uniform vec4 sdL0[16]; uniform vec4 sdL1[16]; uniform vec4 sdU[16];
float sdCav, sdWear, sdGrime, sdMot, sdMask, sdLayer, sdRegion, sdGiant; vec3 sdGrad; vec3 sdON;
float sdLayerFor(int mi, float wny) {
  float w = floor(vSdV.w + 0.5);
  sdRegion = floor(w / 32.0);
  float sec = mod(w, 32.0) - 1.0;
  sdGiant = sec >= 0.0 ? 1.0 : 0.0;
  bool mech = mi == 3 || mi == 4 || mi >= 16;              // gunmetal, steel, metal finishes (materials.ts METAL_FINISH)
  if (sdRegion > 1.5 && mech) return 13.0;               // running gear joints / hubs: machinery
  if (sec >= 0.0 && sdRegion < 0.5) {                     // giant hull: skin by part
    if (mi == 2) return sec;                              // superstructure panels
    if (mi == 1 && wny > 0.8) return 12.0;                // decks: grating
    if (mech) return 13.0;                                // exposed machinery
  }
  return floor(vSdV.x + 0.5);
}
void sdRun(int mi, vec3 nView) {
  sdCav = 1.0; sdWear = 0.0; sdGrime = 0.0; sdMot = 0.0; sdMask = 0.0; sdGrad = vec3(0.0); sdLayer = 0.0;
  sdON = normalize(vec3(dot(nView, vSdAX), dot(nView, vSdAY), dot(nView, vSdAZ)));
  sdLayer = sdLayerFor(mi, sdON.y);
  if (sdOn < 0.5) return;
  float dens = vSdV.y > 0.001 ? vSdV.y : 0.8;
  vec3 tw = pow(abs(sdON), vec3(6.0)); tw /= (tw.x + tw.y + tw.z);
  vec3 p = vSdP * dens;
  vec2 uX = p.zy + vec2(0.37, 0.11), uY = p.xz + vec2(0.71, 0.29), uZ = p.xy + vec2(0.13, 0.57);
  vec4 aX = texture(sdA, vec3(uX, sdLayer)), aY = texture(sdA, vec3(uY, sdLayer)), aZ = texture(sdA, vec3(uZ, sdLayer));
  vec3 bX = texture2D(sdB, uX * 0.5).rgb, bY = texture2D(sdB, uY * 0.5).rgb, bZ = texture2D(sdB, uZ * 0.5).rgb;
  vec4 a = aX * tw.x + aY * tw.y + aZ * tw.z;
  vec3 b = bX * tw.x + bY * tw.y + bZ * tw.z;
  sdCav = a.b / 0.75; sdMask = a.a;
  float macro = texture2D(sdB, (vSdP.xz + vSdP.yy * vec2(0.6, -0.4)) * 0.17 + vec2(0.5, 0.2)).g;
  sdWear = b.r; sdGrime = b.g * (0.45 + 0.9 * macro); sdMot = b.b - 0.5 + (0.35 - macro) * 0.35;
  vec2 sX = aX.rg - 0.5, sY = aY.rg - 0.5, sZ = aZ.rg - 0.5;
  sdGrad = tw.x * vec3(0.0, sX.y, sX.x) + tw.y * vec3(sY.x, 0.0, sY.y) + tw.z * vec3(sZ.x, sZ.y, 0.0);
  sdGrad *= sdL0[int(sdLayer)].x;
}
/** one glyph of the marks atlas painted on the flank (object x/y), read from the side the fragment faces */
float sdGlyph(float cell, vec2 c, float h, float sgn) {
  float u = (vSdP.x - c.x) * sgn / (0.75 * h) + 0.5, v = (vSdP.y - c.y) / h + 0.5;
  float inb = step(0.0, u) * step(u, 1.0) * step(0.0, v) * step(v, 1.0);
  return texture2D(sdM, vec2((cell + clamp(u, 0.01, 0.99)) / 12.0, clamp(v, 0.01, 0.99))).r * inb;
}
/** the same on the top deck, upright when seen from behind (object z across, x up the glyph) */
float sdGlyphTop(float cell, vec2 c, float h) {
  float u = (vSdP.z - c.y) / (0.75 * h) + 0.5, v = (vSdP.x - c.x) / h + 0.5;
  float inb = step(0.0, u) * step(u, 1.0) * step(0.0, v) * step(v, 1.0);
  return texture2D(sdM, vec2((cell + clamp(u, 0.01, 0.99)) / 12.0, clamp(v, 0.01, 0.99))).r * inb;
}`;
/** fragment: the whole surface treatment on an albedo. Drop into map_fragment after the base colour is known.
 *  Inputs: vec3 base (albedo, modified in place), int mi (part row, -1 if none), vec3 wn (world normal), float bev
 *  (chamfer mask 0..1), float vWY (world height), float sdRowDet / sdRowWear / sdRowGrime (part weights), vec3 sdAccent
 *  (team accent). Outputs: sdGlow (emissive mask, team glow), sdGradR (object-space bump gradient for sdBumpGLSL),
 *  sdRough (roughness multiplier) and sdMetal (bare-metal mask) for PBR materials. Material-agnostic: works on toon,
 *  standard or physical shaders as long as those inputs exist. */
export const SD_APPLY = /* glsl */ `
  float sdGlow = 0.0, sdRough = 1.0, sdMetal = 0.0; vec3 sdGradR = vec3(0.0);
  sdRun(mi, normalize(vNormal));
  {
    int sl = int(sdLayer + 0.5);
    vec4 l0 = sdL0[sl], l1 = sdL1[sl], up = sdU[int(vSdV.z + 0.5)];
    // fine detail (seams, rivets, small stencils, pits) fades out once a texel is well under a pixel, so a zoomed-out
    // battle shows clean paint instead of averaged-down grey mud; big features (masks, markings, wear on edges) stay
    float dens = vSdV.y > 0.001 ? vSdV.y : 0.8;
    float lod = log2(max(length(fwidth(vSdP)) * dens * 512.0, 1e-4));
    float fine = 1.0 - smoothstep(2.2, 4.0, lod);
    float det = sdRowDet * fine;
    float sdW = sdRowWear * up.x, sdGr = sdRowGrime * up.y;
    base *= mix(1.0, pow(sdCav, 1.5), det);
    // the skin's special mask: camo / pits / scorch darken, gouges = bare metal, role paint in the team accent,
    // dust, chitin sheen, soot / oil = grime, circuit glow
    float mk = sdMask * sdRowDet;
    // (camo / pits / scorch: kept subtle -- strong blotches read from above as shadow patches lying on the unit)
    base *= 1.0 - mk * l0.y;
    float wearSrc = max(sdWear * up.x, sdMask * l0.z);
    base = mix(base, sdAccent * (0.85 + 0.2 * sdCav), mk * l0.w);
    // dust (artillery skins): settles low on the hull and in crevices, faint up top -- big pale blotches across the
    // deck read from the game camera as patches of light and shadow lying on the unit
    base = mix(base, vec3(0.6, 0.53, 0.42), mk * l1.y * 0.3 * (1.0 - 0.8 * smoothstep(0.1, 0.6, vWY)));
    base *= 1.0 + mk * l1.z * 0.35;
    float grimeSrc = max(sdGrime, sdMask * l1.w);
    sdGlow = mk * l1.x;
    // mottling and grime: low on the hull, underneath and in streaks down the sides; top faces stay clean
    // (darkening only, and gentle: big pale blotches across a hull read from the game camera as cloud shadows
    // lying on the unit)
    base *= 1.0 + min(sdMot, 0.0) * 0.22 * sdRowGrime * up.z * (0.4 + 0.6 * fine);
    float low = 1.0 - smoothstep(0.02, 0.22, vWY); // (thin band: low hulls must not be grimed all over)
    float topClean = mix(1.0, 0.3, smoothstep(0.5, 0.9, wn.y));
    float gr = clamp(grimeSrc * (0.6 + 0.6 * low) * topClean + sdGiant * 0.5 * smoothstep(-0.2, -0.7, wn.y), 0.0, 1.0) * sdGr;
    base = mix(base, base * vec3(0.55, 0.49, 0.40), gr * 0.65);
    // chipped paint: bare metal, concentrated on chamfer edges
    // (edges only: chips spreading over flat faces made large grey patches that looked like shadows on the unit)
    float wm = wearSrc * sdRowWear * (0.05 + 1.6 * bev);
    wm = smoothstep(0.55, 0.8, wm);
    base = mix(base, vec3(0.36, 0.37, 0.38) * (0.8 + 0.3 * sdCav), wm * 0.6);
    sdMetal = wm; sdRough = mix(1.0 + gr * 0.3, 0.55, wm);
    if (sdOn > 0.5) {
      // giants: hazard bands on turret collars (the trim row of a turret)
      if (sdGiant > 0.5 && sdRegion > 0.5 && sdRegion < 1.5 && mi == 1 && abs(sdON.y) < 0.5) {
        float hz = step(0.5, fract((vSdP.x + vSdP.y + vSdP.z) * 5.0));
        base = mix(base, mix(vec3(0.08), vec3(0.85, 0.64, 0.16), hz), 0.85 * (1.0 - wm * 0.7));
      }
      // heavy and bigger units: a hull number + insignia + kill tally on the flanks, the number again on the rear deck
      if (vSdB.z > 0.0 && (mi == 0 || mi == 2)) {
        float sgn = sign(sdON.z), side = smoothstep(0.6, 0.8, abs(sdON.z));
        float h = vSdB.z; vec2 c = vSdB.xy;
        float num = floor(vSdB.w + 0.5);
        float gNum = max(sdGlyph(floor(num / 10.0), c - vec2(0.4 * h * sgn, 0.0), h, sgn), sdGlyph(mod(num, 10.0), c + vec2(0.4 * h * sgn, 0.0), h, sgn));
        float gTally = sdGlyph(10.0, c - vec2(0.0, 0.82 * h), 0.5 * h, sgn) * side;
        float gIns = sdGlyph(11.0, c - vec2(2.1 * h, 0.0), 1.15 * h, sgn) * side;
        float th = 1.25 * h, tx = c.x - 3.2 * h, top = smoothstep(0.8, 0.92, sdON.y) * (mi == 0 ? 1.0 : 0.0);
        gNum = max(gNum * side, top * max(sdGlyphTop(floor(num / 10.0), vec2(tx, -0.4 * th), th), sdGlyphTop(mod(num, 10.0), vec2(tx, 0.4 * th), th)));
        float keep = 1.0 - 0.75 * smoothstep(0.3, 0.6, wearSrc);
        base = mix(base, vec3(0.88, 0.87, 0.82), max(gNum, gTally) * keep * 0.92);
        base = mix(base, sdAccent, gIns * keep * 0.9);
      }
    }
    sdGradR = sdGrad * det;
  }`;
/** fragment: perturb the view-space \`normal\` by an object-space height gradient g (after normal_fragment_maps) */
export const sdBumpGLSL = (g: string) => /* glsl */ `
  if (sdOn > 0.5) {
    vec3 sdG = (vSdAX * (${g}).x + vSdAY * (${g}).y + vSdAZ * (${g}).z) * sdBump;
    normal = normalize(normal - (sdG - normal * dot(normal, sdG)));
  }`;

/** Add the detail to a plain lit material (wrecks): the unit's own skin layer, cavity, bump, grime, mottling. */
export function withSurfaceDetail<M extends THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshToonMaterial>(
  m: M, o: { det?: number; grime?: number } = {},
): M {
  loadSurfaceTextures();
  const prev = m.onBeforeCompile.bind(m);
  const det = (o.det ?? 1).toFixed(3), grime = (o.grime ?? 1).toFixed(3);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, surfaceUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + SD_VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + SD_VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + SD_FRAG_DECL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        sdRun(0, normalize(vNormal));
        diffuseColor.rgb *= mix(1.0, sdCav, ${det}) * (1.0 + sdMot * 0.4 * ${grime});
        diffuseColor.rgb *= 1.0 - clamp(sdGrime, 0.0, 1.0) * 0.45 * ${grime};
        vec3 sdGradR = sdGrad * ${det};`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + sdBumpGLSL('sdGradR'));
  };
  const k = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => k() + `|sd2${det},${grime}`;
  return m;
}
