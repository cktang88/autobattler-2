// Battlefields authored in Blender (scripts/gen-map-bastion.py): a GLB of ground, land and structures centred on the
// origin, plus a shore-distance mask driving the animated water drawn around it here. Purely visual, like every map.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface BakedTerrain { group: THREE.Group; ground: THREE.Mesh; tint: THREE.Color }

/** half the size of the world square the shore mask covers (LAND_EXT in the generator) */
const SHORE_EXT = 110;
const WATER_Y = -0.8;
const WATER_SIZE = 1400;

function waterMaterial(shore: THREE.Texture, surface: THREE.Texture): THREE.MeshStandardMaterial {
  const time = { value: 0 };
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0, envMapIntensity: 0.05 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.shoreMap = { value: shore };
    sh.uniforms.surfaceMap = { value: surface };
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGP; uniform sampler2D shoreMap; uniform sampler2D surfaceMap; uniform float uTime; float wFoam; vec2 wWave;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 suv = vec2(vGP.x, -vGP.y) / ${(SHORE_EXT * 2).toFixed(1)} + 0.5;
        float wD = texture2D(shoreMap, clamp(suv, 0.0, 1.0)).r;
        // two drifting layers of the wave texture; a third, huge one keeps the open sea from reading as a repeat
        vec4 s1 = texture2D(surfaceMap, vGP * 0.019 + uTime * vec2(0.0035, 0.0022));
        vec4 s2 = texture2D(surfaceMap, vGP * 0.051 + uTime * vec2(-0.0062, 0.0031));
        vec4 s3 = texture2D(surfaceMap, vGP * 0.0043 + 0.3 + uTime * vec2(0.0006, -0.0004));
        wWave = (s1.rg + s2.rg - 1.0) * 1.1;
        float wNear = 1.0 - smoothstep(0.0, 0.1, wD);
        // foam only where water meets rock: its bubble lace thins out with distance from the shore and drifts in layers
        vec4 f1 = texture2D(surfaceMap, vGP * 0.037 + uTime * vec2(0.004, -0.003));
        vec4 f2 = texture2D(surfaceMap, vGP * 0.088 + uTime * vec2(-0.005, 0.004));
        float wLace = f1.b * 0.6 + f2.b * 0.55;
        wFoam = smoothstep(1.05 - wNear * 0.62, 1.32 - wNear * 0.52, wLace + wNear * 0.1) * smoothstep(0.0, 0.25, wNear);
        // water colour: navy offshore through green-blue to pale teal over the shallows, broken up by the slow swell
        vec3 wDeep = vec3(0.004, 0.026, 0.056), wMid = vec3(0.01, 0.08, 0.125), wShal = vec3(0.025, 0.22, 0.25);
        float wDepth = wD + (s3.r - 0.5) * 0.1;
        vec3 wCol = mix(wShal, wMid, smoothstep(0.0, 0.16, wDepth));
        wCol = mix(wCol, wDeep, smoothstep(0.12, 0.62, wD + (s3.g - 0.5) * 0.34));
        // light gathering on the sea bed in the shallows, and the sun picking out wave faces everywhere
        float wCaustic = pow(texture2D(surfaceMap, vGP * 0.14 + wWave * 0.03 + uTime * 0.006).b, 2.0);
        wCol += vec3(0.02, 0.1, 0.1) * wCaustic * (1.0 - smoothstep(0.02, 0.2, wD));
        wCol *= 0.66 + 0.7 * s1.g * (0.6 + 0.8 * s2.r);
        // cloud shadow drifting over the water (swell channels only: the foam channel's cells would show as blobs)
        wCol *= 0.8 + 0.3 * smoothstep(0.35, 0.65, s3.g);
        diffuseColor.rgb = mix(wCol, vec3(0.8, 0.85, 0.88), wFoam * 0.85);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, wFoam);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(wWave.x, 0.0, wWave.y, 0.0)).xyz * (1.0 - wFoam) * 0.5);`)
      // sun glitter: a tight highlight on the wave faces only, because a broad specular lobe greys out the whole sea
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #if NUM_DIR_LIGHTS > 0
          vec3 gN = normalize(normal + (viewMatrix * vec4(wWave.x, 0.0, wWave.y, 0.0)).xyz * 0.9);
          vec3 gH = normalize(directionalLights[0].direction + normalize(vViewPosition));
          totalEmissiveRadiance += directionalLights[0].color * pow(max(dot(gN, gH), 0.0), 420.0) * 0.5 * (1.0 - wFoam);
        #endif`);
  };
  m.customProgramCacheKey = () => 'bakedwater10';
  m.onBeforeRender = () => { time.value = performance.now() / 1000; };
  return m;
}

/** Land and sea stacks: a rock texture projected along all three axes (no UVs, no seams), snow settling on what faces up. */
function terrainMaterial(rock: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rockMap = { value: rock };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP; varying vec3 vLN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLP; varying vec3 vLN; uniform sampler2D rockMap; float tHeight;
        vec3 tri(vec3 p, vec3 w) { return texture2D(rockMap, p.zy).rgb * w.x + texture2D(rockMap, p.xz).rgb * w.y + texture2D(rockMap, p.xy).rgb * w.z; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tN = normalize(vLN);
        vec3 tW = pow(abs(tN), vec3(4.0)); tW /= tW.x + tW.y + tW.z;
        vec3 tA = tri(vLP * 0.075, tW), tB = tri(vLP * 0.021 + 0.37, tW);
        tHeight = dot(tA, vec3(0.333));
        vec3 tRock = tA * (0.55 + 0.95 * tB);
        // snow on what faces up and above the spray, thinning out across the rock's own pattern
        float tSnow = smoothstep(0.56, 0.74, tN.y + (dot(tB, vec3(0.333)) - 0.34) * 1.2 + (tHeight - 0.3) * 0.7) * smoothstep(0.1, 1.6, vLP.y);
        float tWet = 1.0 - smoothstep(-0.8, 0.3, vLP.y);
        diffuseColor.rgb = mix(tRock * (1.0 - tWet * 0.6), vec3(0.74, 0.78, 0.84), tSnow * 0.92);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 sx = normalize(dFdx(-vViewPosition)), sy = normalize(dFdy(-vViewPosition));
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec2 dh = vec2(dFdx(tHeight), dFdy(tHeight)) * 4.0;
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`);
  };
  m.customProgramCacheKey = () => 'bakedterrain5';
  return m;
}

/** Load a baked map from public/assets/maps/<dir>/. Rejects if a file is missing or broken. */
export async function loadBakedMap(dir: string): Promise<BakedTerrain> {
  const base = `assets/maps/${dir}/`;
  const textures = new THREE.TextureLoader();
  const [gltf, shore, surface, rock] = await Promise.all([new GLTFLoader().loadAsync(`${base}map.glb`), textures.loadAsync(`${base}shore.png`), textures.loadAsync(`${base}water.webp`), textures.loadAsync(`${base}rock.webp`)]);
  for (const t of [surface, rock]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  rock.colorSpace = THREE.SRGBColorSpace;
  const terrain = terrainMaterial(rock);
  const group = new THREE.Group();
  group.name = 'terrain';
  group.add(gltf.scene);
  let ground: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const cloud = mesh.name.startsWith('cloud');
    mesh.receiveShadow = !cloud;
    // the structures' shadows are baked softly into the field; live ones would lie across it as hard flat polygons
    mesh.castShadow = mesh.name === 'rocks';
    if (mesh.name === 'field') ground = mesh;
    if (mesh.name === 'land' || mesh.name === 'rocks') mesh.material = terrain;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    for (const t of [mat.map, mat.normalMap, mat.emissiveMap]) if (t) t.anisotropy = 4;
  });
  if (!ground) throw new Error(`baked map ${dir} has no field mesh`);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE).rotateX(-Math.PI / 2), waterMaterial(shore, surface));
  water.position.y = WATER_Y;
  water.receiveShadow = false;
  group.add(water);
  return { group, ground, tint: new THREE.Color(1, 1, 1) };
}
