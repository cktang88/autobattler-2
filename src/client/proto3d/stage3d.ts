// Renderer / lighting / post-processing setup, independent of any scene globals so other views can reuse it.
// createRenderer -> setupStage (sun, sky hemisphere, procedural PMREM sky environment, fog) -> setupPost (GTAO, bloom, grade).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer;
}

export interface Stage {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** re-centre the sun shadow frustum on a world area (keeps texel density high) */
  fitShadow(cx: number, cz: number, radius: number): void;
}

/** Procedural sky dome rendered once into a PMREM environment: warm horizon haze, cool zenith, dark ground, hot sun disc. */
function skyEnvironment(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3): THREE.Texture {
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { sunDir: { value: sunDir.clone().normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      varying vec3 vD; uniform vec3 sunDir;
      void main(){
        vec3 d = normalize(vD);
        float h = d.y;
        vec3 zenith = vec3(0.20, 0.36, 0.62), mid = vec3(0.52, 0.66, 0.80), hor = vec3(0.95, 0.80, 0.62), gnd = vec3(0.20, 0.17, 0.13);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h));
        c = mix(c, zenith, smoothstep(0.2, 0.9, h));
        c = mix(c, gnd, smoothstep(0.0, -0.18, h));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        c += vec3(1.0, 0.82, 0.55) * (pow(sd, 6.0) * 0.35 + pow(sd, 400.0) * 40.0);
        // soft cloud-ish streaks so reflections on metal are not a perfect gradient
        c *= 0.92 + 0.12 * sin(d.x * 9.0 + sin(d.z * 7.0) * 2.0) * smoothstep(0.0, 0.5, h);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.02, 0.1, 100).texture;
  pm.dispose();
  return tex;
}

/** o.sun: sun position relative to the view target (direction + height; default up-left-front). A sun from the side and
 *  a little behind the subject (as seen by the camera) gives form and visible glints on painted plates. */
export function setupStage(renderer: THREE.WebGLRenderer, scene: THREE.Scene, o: { shadowRes?: number; fog?: boolean; sun?: [number, number, number] } = {}): Stage {
  const fogCol = new THREE.Color('#6f6a58');
  scene.background = fogCol;
  if (o.fog !== false) scene.fog = new THREE.Fog(fogCol, 110, 300);
  const sunPos = new THREE.Vector3(...(o.sun ?? [-30, 40, 20]));
  scene.environment = skyEnvironment(renderer, sunPos);
  scene.environmentIntensity = 0.6;
  // strong warm key + low sky fill (the PMREM sky environment does most of the fill and all the reflections on the
  // painted-metal unit materials) + a faint cool back light: forms get a clear lit side and shadow side
  const sun = new THREE.DirectionalLight('#fff0d8', 3.4);
  sun.position.copy(sunPos);
  sun.castShadow = true;
  const res = o.shadowRes ?? 4096;
  sun.shadow.mapSize.set(res, res);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#d6e2f0', '#6e624e', 0.3);
  scene.add(hemi);
  const back = new THREE.DirectionalLight('#9ab8ff', 0.35);
  // opposite the sun, low: a cool kicker on the shadow side
  back.position.set(-sunPos.x, 18, -sunPos.z);
  scene.add(back);
  const dir = sunPos.clone();
  const fitShadow = (cx: number, cz: number, radius: number) => {
    const c = sun.shadow.camera;
    c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius; c.near = 1; c.far = 160;
    c.updateProjectionMatrix();
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + dir.x, dir.y, cz + dir.z);
    sun.target.updateMatrixWorld();
  };
  fitShadow(-3, 0, 46);
  return { sun, hemi, fitShadow };
}

export interface Post {
  composer: EffectComposer;
  gtao: GTAOPass | null;
  bloom: UnrealBloomPass | null;
  setSize(w: number, h: number): void;
  render(): void;
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, vig: { value: 0.14 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float vig; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // contrast S-curve + saturation boost (ACES eats saturation in the brights) + split tone (cool shadows, warm
      // highlights): clean, saturated team paint
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.2);
      c = max(mix(vec3(l), c, 1.1), 0.0);
      c += vec3(-0.008, 0.0, 0.012) * (1.0 - l) + vec3(0.016, 0.008, -0.006) * l;
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.85);
      c *= 1.0 - vig * smoothstep(0.25, 0.85, length(d));
      
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function setupPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, o: { ao?: boolean; bloom?: boolean; grade?: boolean } = {}): Post {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let gtao: GTAOPass | null = null, bloom: UnrealBloomPass | null = null;
  if (o.ao !== false) {
    gtao = new GTAOPass(scene, camera, w, h);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.5;
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12 });
    composer.addPass(gtao);
  }
  if (o.bloom !== false) {
    bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.45, 1.25); // high threshold: only true emissives bloom
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());
  if (o.grade !== false) composer.addPass(new ShaderPass(GradeShader));
  return {
    composer, gtao, bloom,
    setSize(nw, nh) { composer.setSize(nw, nh); },
    render() { composer.render(); },
  };
}
