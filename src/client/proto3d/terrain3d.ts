// Battlefield terrain: fbm-based albedo + height (dirt, sand, gravel, scrub, tire tracks, craters, scorch), a shader
// micro-detail layer for close zoom, instanced rocks / stones / scrub, concrete barriers, and a faint gameplay grid.
// buildTerrain(w, h) is independent of any scene: add the returned group wherever it is needed (centred on the origin).

import * as THREE from 'three';
import { Bld } from './geo.ts';
import { paint, rng } from './materials.ts';

export interface TerrainOpts {
  seed?: number;
  /** pixels per cell for the albedo/height maps */
  ppc?: number;
  grid?: boolean;
  /** fraction of the width used by each deployment zone (0 = none) */
  zoneFrac?: number;
  /** keep-out test for large props (x, z in world cells) */
  keepOut?: (x: number, z: number) => boolean;
  props?: boolean;
}

export interface Terrain { group: THREE.Group; ground: THREE.Mesh }

function makeNoise(seed: number) {
  const N = 256;
  const r = rng(seed);
  const lat = new Float32Array(N * N);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const at = (x: number, y: number) => lat[((y & 255) << 8) | (x & 255)];
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x: number, y: number, oct = 5) => {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); n += amp; amp *= 0.5; f *= 2.03; }
    return s / n;
  };
  return { noise, fbm };
}
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (s: string): [number, number, number] => { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixc = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function makeMaps(w: number, h: number, o: Required<Pick<TerrainOpts, 'seed' | 'ppc' | 'grid' | 'zoneFrac'>>) {
  const PPC = o.ppc;
  const W = Math.round(w * PPC), H = Math.round(h * PPC);
  const { fbm, noise } = makeNoise(o.seed);
  const r = rng(o.seed + 5);
  const albedo = document.createElement('canvas'); albedo.width = W; albedo.height = H;
  const height = document.createElement('canvas'); height.width = W; height.height = H;
  const ga = albedo.getContext('2d')!, gh = height.getContext('2d')!;
  const ia = ga.createImageData(W, H), ih = gh.createImageData(W, H);
  const soil = hex('#7b6b4b'), sand = hex('#a4925f'), dirt = hex('#4d4130'), gravel = hex('#706a5c'), scrub = hex('#585f3c'), dry = hex('#8d7f56');
  const k = 1 / PPC; // cells per pixel
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = x * k, cy = y * k;
      const n1 = fbm(cx * 0.09, cy * 0.09, 4), n2 = fbm(cx * 0.24 + 40, cy * 0.24 + 40, 4), n3 = fbm(cx * 0.55 + 90, cy * 0.55 + 90, 3);
      let c = mixc(soil, sand, sm(0.42, 0.62, n1));
      c = mixc(c, dry, sm(0.5, 0.72, fbm(cx * 0.15 + 7, cy * 0.15 + 7, 3)) * 0.5);
      c = mixc(c, dirt, sm(0.56, 0.72, n2) * 0.8);
      const gv = sm(0.54, 0.68, fbm(cx * 0.35 + 200, cy * 0.35 + 200, 4));
      const grain = noise(x * 0.9, y * 0.9) * 0.6 + noise(x * 2.3 + 11, y * 2.3 + 5) * 0.4;
      c = mixc(c, gravel, gv * (0.45 + 0.4 * grain));
      const sc = sm(0.6, 0.72, fbm(cx * 0.2 + 300, cy * 0.2 + 300, 4));
      c = mixc(c, scrub, sc * (0.35 + 0.5 * noise(x * 0.5, y * 0.5)));
      const m = 0.78 + 0.44 * (n3 * 0.5 + grain * 0.5) + (gv > 0.2 ? (grain - 0.5) * 0.35 * gv : 0);
      const i = (y * W + x) * 4;
      ia.data[i] = c[0] * m; ia.data[i + 1] = c[1] * m; ia.data[i + 2] = c[2] * m; ia.data[i + 3] = 255;
      const hv = 128 + (n1 - 0.5) * 70 + (n2 - 0.5) * 60 + (grain - 0.5) * (40 + gv * 90) - sc * 12;
      ih.data[i] = ih.data[i + 1] = ih.data[i + 2] = hv; ih.data[i + 3] = 255;
    }
  }
  ga.putImageData(ia, 0, 0); gh.putImageData(ih, 0, 0);

  // tire / track marks: pairs of wobbling lines running across the field, plus herringbone ticks
  const track = (x0: number, y0: number, x1: number, y1: number, gap: number, wd: number, a: number) => {
    const steps = 120, ph = r() * 6, amp = 20 + r() * 40;
    for (const sg of [-1, 1]) {
      ga.beginPath(); gh.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const wob = Math.sin(t * 5 + ph) * amp + Math.sin(t * 13 + ph * 2) * amp * 0.25;
        const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t + wob + sg * gap * 0.5;
        if (i === 0) { ga.moveTo(px, py); gh.moveTo(px, py); } else { ga.lineTo(px, py); gh.lineTo(px, py); }
      }
      ga.strokeStyle = `rgba(30,24,16,${a})`; ga.lineWidth = wd; ga.lineCap = 'round'; ga.stroke();
      ga.strokeStyle = `rgba(30,24,16,${a * 0.5})`; ga.lineWidth = wd * 0.4; ga.setLineDash([3, 5]); ga.stroke(); ga.setLineDash([]);
      gh.strokeStyle = 'rgba(40,40,40,0.55)'; gh.lineWidth = wd; gh.stroke();
    }
  };
  for (let i = 0; i < 9; i++) track(-50, r() * H, W + 50, r() * H, PPC * (0.7 + r() * 1.2), PPC * (0.14 + r() * 0.12), 0.1 + r() * 0.12);
  for (let i = 0; i < 4; i++) track(r() * W * 0.3, -40, W * (0.4 + r() * 0.5), H + 40, PPC * 1.4, PPC * 0.22, 0.12);

  // blast craters with scorched rims, scorch blotches
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = r() * H, rad = PPC * (0.25 + r() * r() * 1.5);
    const sc = ga.createRadialGradient(x, y, rad * 0.1, x, y, rad * 1.7);
    sc.addColorStop(0, 'rgba(18,14,10,0.7)'); sc.addColorStop(0.5, 'rgba(28,22,15,0.4)'); sc.addColorStop(1, 'rgba(0,0,0,0)');
    ga.fillStyle = sc; ga.beginPath(); ga.arc(x, y, rad * 1.7, 0, 7); ga.fill();
    // radial blast streaks
    ga.strokeStyle = 'rgba(15,12,9,0.18)'; ga.lineWidth = 1.5;
    for (let s = 0; s < 18; s++) { const a = r() * 7, l = rad * (1.2 + r() * 1.2); ga.beginPath(); ga.moveTo(x + Math.cos(a) * rad * 0.8, y + Math.sin(a) * rad * 0.8); ga.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ga.stroke(); }
    if (rad > PPC * 0.45) {
      const hg = gh.createRadialGradient(x, y, 0, x, y, rad * 1.15);
      hg.addColorStop(0, 'rgba(25,25,25,0.85)'); hg.addColorStop(0.72, 'rgba(70,70,70,0.7)'); hg.addColorStop(0.88, 'rgba(210,210,210,0.8)'); hg.addColorStop(1, 'rgba(128,128,128,0)');
      gh.fillStyle = hg; gh.beginPath(); gh.arc(x, y, rad * 1.15, 0, 7); gh.fill();
    }
  }
  // dark scorch ellipses and scattered debris flecks
  for (let i = 0; i < 40; i++) {
    const x = r() * W, y = r() * H, rad = PPC * (0.15 + r() * 0.4);
    const g2 = ga.createRadialGradient(x, y, 0, x, y, rad);
    g2.addColorStop(0, 'rgba(14,12,9,0.42)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    ga.fillStyle = g2; ga.beginPath(); ga.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, 7); ga.fill();
  }

  // deployment-zone boundaries and a faint cell grid (gameplay readability only)
  const zw = W * o.zoneFrac;
  if (o.zoneFrac > 0) {
    ga.fillStyle = 'rgba(70,150,190,0.05)'; ga.fillRect(0, 0, zw, H);
    ga.fillStyle = 'rgba(210,100,50,0.05)'; ga.fillRect(W - zw, 0, zw, H);
    ga.setLineDash([PPC * 0.3, PPC * 0.2]); ga.lineWidth = 3;
    ga.strokeStyle = 'rgba(130,215,240,0.4)'; ga.beginPath(); ga.moveTo(zw, 0); ga.lineTo(zw, H); ga.stroke();
    ga.strokeStyle = 'rgba(255,150,100,0.4)'; ga.beginPath(); ga.moveTo(W - zw, 0); ga.lineTo(W - zw, H); ga.stroke();
    ga.setLineDash([]);
  }
  if (o.grid) {
    for (let i = 0; i <= w; i++) { ga.strokeStyle = i % 5 === 0 ? 'rgba(235,232,210,0.11)' : 'rgba(235,232,210,0.045)'; ga.lineWidth = i % 5 === 0 ? 2 : 1; ga.beginPath(); ga.moveTo(i * PPC, 0); ga.lineTo(i * PPC, H); ga.stroke(); }
    for (let j = 0; j <= h; j++) { ga.strokeStyle = j % 5 === 0 ? 'rgba(235,232,210,0.11)' : 'rgba(235,232,210,0.045)'; ga.lineWidth = j % 5 === 0 ? 2 : 1; ga.beginPath(); ga.moveTo(0, j * PPC); ga.lineTo(W, j * PPC); ga.stroke(); }
  }
  const map = new THREE.CanvasTexture(albedo); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
  const bump = new THREE.CanvasTexture(height); bump.anisotropy = 8;
  return { map, bump };
}

/** tiled micro-detail (grain + pebbles): R = albedo variation, G = height */
function makeDetail(): THREE.CanvasTexture {
  const N = 512;
  const { noise } = makeNoise(31);
  const r = rng(77);
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!;
  const im = g.createImageData(N, N);
  // wrap-safe noise: sample on a torus by blending 4 shifted lookups is overkill; the lattice has period 256 so use period-aligned frequencies
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const n = (f: number, o2: number) => noise(((u * f) % 1) * 256 * 0 + (u * f * 256) % 256, (v * f * 256) % 256) + o2 * 0;
    const a = n(1, 0) * 0.5 + n(2, 0) * 0.3 + n(4, 0) * 0.2;
    const i = (y * N + x) * 4;
    im.data[i] = 90 + a * 130; im.data[i + 1] = 90 + a * 130; im.data[i + 2] = 128; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  // pebbles
  for (let i = 0; i < 700; i++) {
    const x = r() * N, y = r() * N, rad = 1.2 + r() * r() * 5;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const gr = g.createRadialGradient(x + ox - rad * 0.3, y + oy - rad * 0.3, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, 'rgba(255,240,220,0.5)'); gr.addColorStop(0.7, 'rgba(150,140,125,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0.0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rad, 0, 7); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function groundMaterial(map: THREE.Texture, bump: THREE.Texture): THREE.MeshStandardMaterial {
  const detail = makeDetail();
  const m = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.2, roughness: 0.97, metalness: 0, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGP; uniform sampler2D detailMap;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 dt1 = texture2D(detailMap, vGP * 0.9); vec4 dt2 = texture2D(detailMap, vGP * 0.23 + 0.37);
        float dtl = dt1.r * 0.65 + dt2.r * 0.35;
        diffuseColor.rgb *= 0.55 + 0.9 * dtl;
        float dH = dt1.g * 0.7 + dt2.g * 0.3;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 sx = normalize(dFdx(-vViewPosition)), sy = normalize(dFdy(-vViewPosition));
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec2 dh = vec2(dFdx(dH), dFdy(dH)) * 5.0;
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`);
  };
  m.customProgramCacheKey = () => 'ground2';
  return m;
}

function rockGeometry(seed: number, flat: number): THREE.BufferGeometry {
  const { fbm } = makeNoise(seed);
  const g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const r = rng(seed);
  const ax = 0.8 + r() * 0.5, az = 0.8 + r() * 0.5;
  // displace along the normal with fbm; quantise slightly so facets read as fractured stone
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 1.7 + 5, v.z * 1.7 + v.y * 1.3 + 9, 3);
    const d = 0.7 + n * 0.75;
    pos.setXYZ(i, v.x * d * ax, Math.max(-0.2, v.y * d * flat), v.z * d * az);
  }
  g.computeVertexNormals();
  return g;
}

export function buildTerrain(w: number, h: number, opts: TerrainOpts = {}): Terrain {
  const seed = opts.seed ?? 99;
  const group = new THREE.Group();
  group.name = 'terrain';
  const { map, bump } = makeMaps(w, h, { seed, ppc: opts.ppc ?? 36, grid: opts.grid ?? true, zoneFrac: opts.zoneFrac ?? 0.22 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), groundMaterial(map, bump));
  ground.receiveShadow = true;
  group.add(ground);
  // apron: dark tiled dirt around the slice so it does not float
  {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const { fbm } = makeNoise(seed + 3);
    const im = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const n = fbm((x % 256) / 256 * 8, (y % 256) / 256 * 8, 4); const i = (y * 256 + x) * 4; im.data[i] = 70 + n * 50; im.data[i + 1] = 62 + n * 44; im.data[i + 2] = 46 + n * 32; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(70, 70); t.colorSpace = THREE.SRGBColorSpace;
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
    apron.position.y = -0.02; apron.receiveShadow = true;
    group.add(apron);
  }
  if (opts.props === false) return { group, ground };

  const r = rng(seed + 11);
  const keep = opts.keepOut ?? (() => false);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, place: (i: number, m: THREE.Matrix4, col: THREE.Color) => boolean, cast = true) => {
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n; i++) if (place(i, m, col)) { im.setMatrixAt(k, m); im.setColorAt(k, col); k++; }
    im.count = k;
    im.castShadow = cast; im.receiveShadow = true;
    group.add(im);
    return im;
  };
  const q = new THREE.Quaternion(), e = new THREE.Euler(), vv = new THREE.Vector3(), sc = new THREE.Vector3();
  const rockMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.93, metalness: 0, flatShading: false, envMapIntensity: 0.7 });
  const tones = ['#857d6b', '#6f6a5e', '#968a6e', '#5f5c52', '#7a7058'].map((s) => new THREE.Color(s));
  // large rocks: 3 shape variants, scattered, denser toward the edges
  for (let v = 0; v < 3; v++) {
    const geo = rockGeometry(40 + v * 13, 0.55 + v * 0.1);
    mk(geo, rockMat, 22, (_i, m, col) => {
      let x = (r() - 0.5) * w * 0.99, z = (r() - 0.5) * h * 0.99;
      if (Math.abs(z) < h * 0.3 && Math.abs(x) < w * 0.42 && r() < 0.85) z = (z < 0 ? -1 : 1) * (h * 0.3 + r() * h * 0.2);
      const s = 0.14 + r() * r() * 0.7;
      if (keep(x, z) && s > 0.2) return false;
      e.set((r() - 0.5) * 0.3, r() * 7, (r() - 0.5) * 0.3); q.setFromEuler(e);
      m.compose(vv.set(x, s * 0.12, z), q, sc.set(s * (1 + r() * 0.5), s * (0.8 + r() * 0.5), s * (1 + r() * 0.5)));
      col.copy(tones[Math.floor(r() * tones.length)]).multiplyScalar(0.85 + r() * 0.3);
      return true;
    });
  }
  // small stones (clutter)
  mk(rockGeometry(7, 0.6), rockMat, 420, (_i, m, col) => {
    const x = (r() - 0.5) * w, z = (r() - 0.5) * h, s = 0.03 + r() * 0.07;
    e.set(0, r() * 7, 0); q.setFromEuler(e);
    m.compose(vv.set(x, s * 0.1, z), q, sc.set(s * (1 + r()), s, s * (1 + r())));
    col.copy(tones[Math.floor(r() * tones.length)]).multiplyScalar(0.8 + r() * 0.3);
    return true;
  }, false);
  // dry scrub clumps: flat dark-olive lumps with a tan under-tone
  const scrubGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0, p.getY(i)) * 0.55 + (p.getY(i) < 0 ? 0 : 0)); g.computeVertexNormals(); return g; })();
  const scrubMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
  const sTones = ['#4b5233', '#5d5b36', '#6b6840', '#3f4a2f'].map((s) => new THREE.Color(s));
  mk(scrubGeo, scrubMat, 150, (_i, m, col) => {
    const x = (r() - 0.5) * w, z = (r() - 0.5) * h;
    for (let k = 0; k < 1; k++) {
      const s = 0.12 + r() * 0.22;
      e.set(0, r() * 7, 0); q.setFromEuler(e);
      m.compose(vv.set(x, 0, z), q, sc.set(s * (1 + r() * 0.8), s * (0.5 + r() * 0.6), s * (1 + r() * 0.8)));
      col.copy(sTones[Math.floor(r() * sTones.length)]).multiplyScalar(0.8 + r() * 0.4);
    }
    return !keep(x, z) || r() < 0.2;
  });
  // concrete barriers: short chamfered slabs in a few staggered lines, and czech hedgehogs
  const b = new Bld();
  const conc = paint('#8e8b80', { rough: 0.9, metal: 0, scale: 0.7, wear: 0.2, bump: 1.6 });
  const rust = paint('#5b4a3a', { rough: 0.85, metal: 0.4, scale: 1.5, wear: 0.8 });
  const lines: [number, number, number, number][] = [[-8, -15, 5, 0.1], [11, 15.5, 4, -0.08], [-1, 16, 3, 0.05], [3, -16, 4, 0.0]];
  for (const [lx, lz, n, a] of lines) for (let i = 0; i < n; i++) {
    const x = lx + i * 1.05 * Math.cos(a), z = lz + i * 1.05 * Math.sin(a);
    b.slab(conc, [[-0.5, -0.2], [0.5, -0.2], [0.5, 0.2], [-0.5, 0.2]], 0.34, 0.03, x, 0, z, [0, -a + (r() - 0.5) * 0.06, 0]);
    b.slab(conc, [[-0.5, -0.12], [0.5, -0.12], [0.5, 0.12], [-0.5, 0.12]], 0.12, 0.02, x, 0.34, z, [0, -a, 0]);
  }
  for (const [hx, hz] of [[-12, 17], [6, -17], [14, 17.5], [-17, -17], [20, -15]] as [number, number][]) {
    for (let k = 0; k < 3; k++) {
      const rot: [number, number, number] = [k === 0 ? Math.PI / 4 : 0, k * 1.0, k === 1 ? Math.PI / 4 : k === 2 ? -Math.PI / 4 : 0];
      b.box(rust, 0.09, 0.09, 0.9, hx, 0.3, hz, 0.01, rot);
    }
  }
  b.mount(group, undefined);
  return { group, ground };
}
