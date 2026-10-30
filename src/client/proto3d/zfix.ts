// Z-fight fix for a built unit: where faces of two different parts lie in the same plane, facing the same way, and
// overlap (a glow strip laid flush on a plate, two blocks sharing a face, a collar on a deck), the depth test cannot
// decide between them and the pixels flicker between the two as the camera moves. After the unit is assembled this
// pass buckets every triangle by its world plane and lifts the smaller of each overlapping pair a hair off the plane
// along its normal, so the detail always draws on top.

import * as THREE from 'three';

const LIFT = 0.002; // cells (world units): far above depth precision at RTS distances, far below anything visible

interface Tri { mesh: number; f: number; part: number; c: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; d: THREE.Vector3; n: THREE.Vector3; area: number }

const _u = new THREE.Vector3(), _w = new THREE.Vector3();
/** P strictly inside triangle t (P assumed in t's plane) */
function inside(P: THREE.Vector3, t: Tri): boolean {
  const e = (x: THREE.Vector3, y: THREE.Vector3) => _u.subVectors(y, x).cross(_w.subVectors(P, x)).dot(t.n);
  const eps = 1e-8;
  return e(t.a, t.b) > eps && e(t.b, t.d) > eps && e(t.d, t.a) > eps;
}

/** lift coplanar overlapping faces of different parts apart, repeating while anything moved (a lifted face can land
 *  on a third plane, and equal-area chains need a pass per link; at most 4); returns the number of triangles moved */
export function fixZFight(root: THREE.Object3D): number {
  let moved = 0;
  for (let i = 0, n = 1; i < 4 && n; i++) moved += n = pass(root);
  return moved;
}

function pass(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.geometry.index && !(m.material as THREE.MeshBasicMaterial).isMeshBasicMaterial) meshes.push(m);
  });
  const buckets = new Map<string, Tri[]>();
  meshes.forEach((m, mi) => {
    const p = m.geometry.attributes.position as THREE.BufferAttribute, mid = m.geometry.attributes.mid as THREE.BufferAttribute | undefined;
    const W = m.matrixWorld;
    for (let f = 0; f < p.count; f += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, f).applyMatrix4(W);
      const b = new THREE.Vector3().fromBufferAttribute(p, f + 1).applyMatrix4(W);
      const d = new THREE.Vector3().fromBufferAttribute(p, f + 2).applyMatrix4(W);
      const n = _u.subVectors(b, a).cross(_w.subVectors(d, a)).clone();
      const area = n.length() / 2;
      if (area < 1e-7) continue;
      n.normalize();
      const pl = n.dot(a);
      const key = `${Math.round(n.x * 150)},${Math.round(n.y * 150)},${Math.round(n.z * 150)},${Math.round(pl * 1500)}`;
      const t: Tri = { mesh: mi, f, part: mi * 100000 + (mid ? Math.round(mid.getX(f) * 1000) : 0), a, b, d, n, area, c: a.clone().add(b).add(d).divideScalar(3) };
      let l = buckets.get(key);
      if (!l) buckets.set(key, (l = []));
      l.push(t);
    }
  });
  const lift = new Map<Tri, number>();
  for (const l of buckets.values()) {
    if (l.length < 2) continue;
    // several parts can stack in one plane: largest at the bottom, each face one step above the highest face of
    // another part it overlaps that came before it (area order, ties by build order), so every chain gets distinct heights
    l.sort((s, t) => t.area - s.area);
    for (let j = 1; j < l.length; j++) {
      const t = l[j]!;
      let k = 0;
      for (let i = 0; i < j; i++) {
        const s = l[i]!;
        if (s.part === t.part || !(inside(s.c, t) || inside(t.c, s))) continue;
        k = Math.max(k, (lift.get(s) ?? 0) + 1);
      }
      if (k) lift.set(t, k);
    }
  }
  if (!lift.size) return 0;
  const inv = meshes.map((m) => new THREE.Matrix4().copy(m.matrixWorld).invert());
  const dirty = new Set<number>();
  for (const [t, k] of lift) {
    const m = meshes[t.mesh]!, p = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < 3; v++) {
      const w = new THREE.Vector3().fromBufferAttribute(p, t.f + v).applyMatrix4(m.matrixWorld).addScaledVector(t.n, LIFT * Math.min(k, 4));
      w.applyMatrix4(inv[t.mesh]!);
      p.setXYZ(t.f + v, w.x, w.y, w.z);
    }
    dirty.add(t.mesh);
  }
  for (const i of dirty) { meshes[i]!.geometry.attributes.position!.needsUpdate = true; meshes[i]!.geometry.computeBoundingSphere(); }
  return lift.size;
}
