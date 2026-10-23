// Surface detail for unit materials: two shared, tileable greyscale maps (public/assets/tex/, see README.md there and
// scripts/gen-surface-textures.py) projected TRIPLANAR in object space, so procedural geometry needs no UVs and the
// detail sticks to a moving / turning / instanced unit. The maps only modulate the part colours (team paint, trims,
// accents keep their hue): plate seams + rivets + hatches + vents as cavity darkening and a bump (surface-gradient
// perturbation of the normal), stencil marks, chipped paint / scratches (bare metal, strongest on chamfer edges), grime,
// drip streaks and fine mottling.
//
//   hull_detail.png  R,G = height slope d(h)/du, d(h)/dv (0.5 = flat)   B = cavity / paint tone (0.75 = neutral)
//   hull_wear.jpg    R = wear (bare metal)   G = grime / streaks   B = mottling (0.5 = neutral)
//
// Every material that injects these chunks shares the same uniform objects, so the async texture load (and the quality
// toggle) flips all of them at once without recompiling. Until the images arrive sdOn = 0 and the plain look shows.

import * as THREE from 'three';

let base = 'assets/tex/';
/** Override the texture folder (relative to the page). */
export function setSurfaceTextureBase(path: string): void { base = path.endsWith('/') ? path : path + '/'; }

function flat(r: number, g: number, b: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** shared uniforms (the same objects are handed to every program) */
export const surfaceUniforms = {
  sdA: { value: flat(128, 128, 191) as THREE.Texture },
  sdB: { value: flat(0, 0, 128) as THREE.Texture },
  /** 1 when the maps are loaded and detail is enabled */
  sdOn: { value: 0 },
  /** texture tiles per object-space unit (1 unit = 1 cell = 5 m): one 1024 px tile spans ~1.6 cells */
  sdScale: { value: 0.62 },
  /** bump strength */
  sdBump: { value: 0.9 },
};

let loaded = 0, started = false, wanted = true;
const sync = () => { surfaceUniforms.sdOn.value = loaded === 2 && wanted ? 1 : 0; };

/** Enable / disable the detail (quality setting). Cheap: a uniform branch, no recompile. */
export function setSurfaceDetail(on: boolean): void { wanted = on; sync(); }
export const surfaceDetailReady = () => loaded === 2;

/** Start loading the maps (idempotent, non-blocking; browser only). */
export function loadSurfaceTextures(): void {
  if (started || typeof document === 'undefined' || typeof Image === 'undefined') return;
  started = true;
  const ld = new THREE.TextureLoader();
  const get = (file: string, key: 'sdA' | 'sdB') => ld.load(base + file, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace; // data, not colour
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8;
    t.needsUpdate = true;
    surfaceUniforms[key].value = t;
    loaded++;
    sync();
  }, undefined, () => { /* missing maps: keep the plain look */ });
  get('hull_detail.png', 'sdA');
  get('hull_wear.jpg', 'sdB');
}

// ---- GLSL -------------------------------------------------------------------------------------------------------
/** vertex: declarations (after #include <common>) */
export const SD_VERT_DECL = /* glsl */ `
varying vec3 vSdP; varying vec3 vSdN; varying vec3 vSdAX; varying vec3 vSdAY; varying vec3 vSdAZ;`;
/** vertex: body (after #include <begin_vertex>); object-space position/normal + the object axes in view space */
export const SD_VERT_MAIN = /* glsl */ `
  vSdP = position; vSdN = normal;
  {
    mat3 sdM = mat3(modelViewMatrix);
    #ifdef USE_INSTANCING
      sdM = sdM * mat3(instanceMatrix);
    #endif
    vSdAX = sdM[0]; vSdAY = sdM[1]; vSdAZ = sdM[2];
  }`;
/** fragment: declarations (after #include <common>) */
export const SD_FRAG_DECL = /* glsl */ `
varying vec3 vSdP; varying vec3 vSdN; varying vec3 vSdAX; varying vec3 vSdAY; varying vec3 vSdAZ;
uniform sampler2D sdA; uniform sampler2D sdB; uniform float sdOn; uniform float sdScale; uniform float sdBump;`;
/** fragment: sample both maps triplanar. Defines sdCav (cavity multiplier, 1 = neutral), sdWear, sdGrime, sdMot
 *  (mottle, 0 = neutral) and sdGrad (object-space height gradient). All neutral when sdOn = 0. */
export const SD_FRAG_SAMPLE = /* glsl */ `
  float sdCav = 1.0, sdWear = 0.0, sdGrime = 0.0, sdMot = 0.0;
  vec3 sdGrad = vec3(0.0);
  if (sdOn > 0.5) {
    vec3 tw = pow(abs(normalize(vSdN)), vec3(6.0)); tw /= (tw.x + tw.y + tw.z);
    vec3 p = vSdP * sdScale;
    vec2 uX = p.zy + vec2(0.37, 0.11), uY = p.xz + vec2(0.71, 0.29), uZ = p.xy + vec2(0.13, 0.57);
    vec3 aX = texture2D(sdA, uX).rgb, aY = texture2D(sdA, uY).rgb, aZ = texture2D(sdA, uZ).rgb;
    vec3 bX = texture2D(sdB, uX).rgb, bY = texture2D(sdB, uY).rgb, bZ = texture2D(sdB, uZ).rgb;
    vec3 a = aX * tw.x + aY * tw.y + aZ * tw.z;
    vec3 b = bX * tw.x + bY * tw.y + bZ * tw.z;
    sdCav = a.b / 0.75;
    // one coarse, skewed planar fetch for large-scale weathering (patchy grime, uneven paint) that breaks up tiling
    float macro = texture2D(sdB, (vSdP.xz + vSdP.yy * vec2(0.6, -0.4)) * 0.17 + vec2(0.5, 0.2)).g;
    sdWear = b.r; sdGrime = b.g * (0.45 + 0.9 * macro); sdMot = b.b - 0.5 + (0.35 - macro) * 0.35;
    vec2 sX = aX.rg - 0.5, sY = aY.rg - 0.5, sZ = aZ.rg - 0.5;
    sdGrad = tw.x * vec3(0.0, sX.y, sX.x) + tw.y * vec3(sY.x, 0.0, sY.y) + tw.z * vec3(sZ.x, sZ.y, 0.0);
  }`;
/** fragment: perturb the view-space \`normal\` by an object-space height gradient g (after normal_fragment_maps) */
export const sdBumpGLSL = (g: string) => /* glsl */ `
  if (sdOn > 0.5) {
    vec3 sdG = (normalize(vSdAX) * (${g}).x + normalize(vSdAY) * (${g}).y + normalize(vSdAZ) * (${g}).z) * sdBump;
    normal = normalize(normal - (sdG - normal * dot(normal, sdG)));
  }`;

/** Add the triplanar detail to a plain lit material (wrecks, props): cavity, bump, grime and mottling at fixed weights.
 *  Chains any existing onBeforeCompile. */
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
        ${SD_FRAG_SAMPLE}
        diffuseColor.rgb *= mix(1.0, sdCav, ${det}) * (1.0 + sdMot * 0.4 * ${grime});
        diffuseColor.rgb *= 1.0 - clamp(sdGrime, 0.0, 1.0) * 0.45 * ${grime};
        vec3 sdGradR = sdGrad * ${det};`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + sdBumpGLSL('sdGradR'));
  };
  const k = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => k() + `|sd${det},${grime}`;
  return m;
}
