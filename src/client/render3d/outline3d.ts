// Unit contact outline + inner edge light for the 3D view.
//
//  * Outline: the same separation edge the 2D sprites get (render/unitart.ts buildHalo), a thin dark line just OUTSIDE
//    every unit silhouette, so units stay readable on ground of a similar tone and tiny units / aircraft don't
//    dissolve into the terrain. Unit-over-unit edges get no line (both sides covered).
//  * Edge light: a subtle sun catch on creases. The mask pass also stores view-space normals and view depth; inside a
//    silhouette, a CONVEX normal discontinuity with a neighbour (the neighbour's normal leans toward it, at about the
//    same depth) brightens the pixel, but only where that face looks toward the sun (equal bright lines on every edge
//    read as a CG / toy outline); a concave one darkens it (crevice / shadow gap).
//
//  * Unit meshes that should get both are put on OUTLINE_LAYER (units-adapter: normal look, opaque parts only).
//  * Each frame the layer is drawn into the mask (one cheap geometry pass, no lighting / shadows): rgb = view normal,
//    a = view depth (0 = empty).
//  * A post pass (before the grade) applies both.

import * as THREE from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const OUTLINE_LAYER = 5;

const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tMask: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    col: { value: new THREE.Color(14 / 255, 15 / 255, 17 / 255) },
    /** opacity of the inner (1 px) ring and of the soft outer (2 px) ring */
    a1: { value: 0.5 },
    a2: { value: 0.22 },
    /** edge light strength (0 = off) and crevice darkening */
    edge: { value: 0.36 },
    crease: { value: 0.3 },
    /** sun direction in view space (set each frame from UnitOutline.sun) */
    sunV: { value: new THREE.Vector3(0, 1, 0) },
    /** depth step (cells) above which two neighbouring pixels are different surfaces (no edge light between them) */
    dThr: { value: 0.3 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tMask; uniform vec2 texel; uniform vec3 col; uniform float a1; uniform float a2;
    uniform float edge; uniform float crease; uniform float dThr; uniform vec3 sunV;
    varying vec2 vUv;
    vec4 S(vec2 o){ return texture2D(tMask, vUv + o * texel); }
    float m(vec2 o){ return step(1e-4, S(o).a); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec4 s0 = S(vec2(0.0));
      if (s0.a > 1e-4) {
        // inside a unit: edge light from convex creases with same-surface neighbours
        float cv = 0.0, cc = 0.0;
        vec2 dirs[4]; dirs[0] = vec2(1.0, 0.0); dirs[1] = vec2(-1.0, 0.0); dirs[2] = vec2(0.0, 1.0); dirs[3] = vec2(0.0, -1.0);
        for (int i = 0; i < 4; i++) {
          vec4 sn = S(dirs[i]);
          if (sn.a > 1e-4 && abs(sn.a - s0.a) < dThr) {
            float d = dot(sn.xy - s0.xy, dirs[i]);
            cv = max(cv, d); cc = max(cc, -d);
          }
        }
        float sunF = smoothstep(0.1, 0.75, dot(normalize(s0.xyz), sunV));
        float k = smoothstep(0.35, 0.85, cv) * edge * sunF;
        vec3 lit = c.rgb + k * (c.rgb * 0.6 + vec3(0.03));
        lit *= 1.0 - smoothstep(0.4, 1.0, cc) * crease;
        gl_FragColor = vec4(lit, c.a);
        return;
      }
      float n1 = max(max(m(vec2(1.0, 0.0)), m(vec2(-1.0, 0.0))), max(m(vec2(0.0, 1.0)), m(vec2(0.0, -1.0))));
      n1 = max(n1, 0.8 * max(max(m(vec2(0.7, 0.7)), m(vec2(-0.7, 0.7))), max(m(vec2(0.7, -0.7)), m(vec2(-0.7, -0.7)))));
      float n2 = max(max(m(vec2(2.0, 0.0)), m(vec2(-2.0, 0.0))), max(m(vec2(0.0, 2.0)), m(vec2(0.0, -2.0))));
      n2 = max(n2, max(max(m(vec2(1.4, 1.4)), m(vec2(-1.4, 1.4))), max(m(vec2(1.4, -1.4)), m(vec2(-1.4, -1.4)))));
      float k = max(n1 * a1, n2 * a2);
      gl_FragColor = vec4(mix(c.rgb, col, k), c.a);
    }`,
};

/** mask material: view-space normal in rgb, view depth in alpha (the mask is cleared to 0 = no unit) */
function maskMaterial(): THREE.MeshNormalMaterial {
  const m = new THREE.MeshNormalMaterial();
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n\tgl_FragColor = vec4(normalize(normal), 1.0 / gl_FragCoord.w);\n\treturn;');
  };
  m.customProgramCacheKey = () => 'unitEdgeMask1';
  return m;
}

export class UnitOutline {
  readonly pass: ShaderPass;
  private rt: THREE.WebGLRenderTarget;
  private mat = maskMaterial();
  private size = new THREE.Vector2();
  private black = new THREE.Color(0, 0, 0);
  private prevClear = new THREE.Color();
  /** the key light: edge catches only on faces turned toward it */
  sun: THREE.DirectionalLight | null = null;

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, samples: 0, type: THREE.HalfFloatType });
    this.rt.texture.generateMipmaps = false;
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.NearestFilter;
    this.pass = new ShaderPass(OutlineShader);
    this.pass.uniforms.tMask.value = this.rt.texture;
  }

  /** put the pass in the composer just before the final grade pass (outline colours go through the same grade) */
  install(passes: Pass[], insert: (p: Pass, i: number) => void): void {
    insert(this.pass, Math.max(0, passes.length - 1));
  }

  set enabled(on: boolean) { this.pass.enabled = on; }
  get enabled(): boolean { return this.pass.enabled; }

  /** draw the coverage mask for this frame (same camera as the main pass); call before the composer renders */
  renderMask(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    (this.pass.uniforms.texel.value as THREE.Vector2).set(1 / w, 1 / h);
    const bg = scene.background, ov = scene.overrideMaterial, layers = camera.layers.mask;
    const au = renderer.shadowMap.autoUpdate, tm = renderer.toneMapping;
    const prevA = renderer.getClearAlpha();
    renderer.getClearColor(this.prevClear);
    const prevRT = renderer.getRenderTarget();
    scene.background = null;
    scene.overrideMaterial = this.mat;
    camera.layers.set(OUTLINE_LAYER);
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(this.black, 0);
    renderer.setRenderTarget(this.rt);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(this.prevClear, prevA);
    renderer.toneMapping = tm;
    renderer.shadowMap.autoUpdate = au;
    camera.layers.mask = layers;
    scene.overrideMaterial = ov;
    scene.background = bg;
    // (after the render: the camera's view matrix is current now)
    const sv = this.pass.uniforms.sunV.value as THREE.Vector3;
    if (this.sun) sv.copy(this.sun.position).sub(this.sun.target.position);
    else sv.set(-30, 40, 20);
    sv.normalize().transformDirection(camera.matrixWorldInverse);
  }

  dispose(): void {
    this.rt.dispose();
    this.mat.dispose();
    this.pass.dispose();
  }
}
