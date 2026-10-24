import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { lathe, slabGeo, withDetail } from '../src/client/proto3d/geo.ts';
import { lodGeometries } from '../src/client/render3d/units-adapter.ts';

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

test('low detail: round sections lose segments (not below 6), chamfers go, hex profiles stay', () => {
  const prof: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.ok(tris(withDetail(0.5, () => lathe(prof, 16))) < tris(lathe(prof, 16)));
  assert.equal(tris(withDetail(0.5, () => lathe(prof, 6))), tris(lathe(prof, 6)));
  assert.equal(tris(withDetail(0.2, () => lathe(prof, 20))), tris(lathe(prof, 6)));
  const sq: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  assert.ok(tris(withDetail(0.5, () => slabGeo(sq, 1, 0.1))) < tris(slabGeo(sq, 1, 0.1)));
  // detail is restored after the build, even if it throws
  assert.throws(() => withDetail(0.5, () => { throw new Error('x'); }));
  assert.equal(tris(lathe(prof, 16)), tris(lathe(prof, 16)));
});

test('far-view geometry pairs up mesh by mesh and refuses a differently built model', () => {
  const m1 = new THREE.MeshStandardMaterial(), m2 = new THREE.MeshStandardMaterial();
  const build = (seg: number, mats: THREE.Material[]) => {
    const root = new THREE.Group(), child = new THREE.Group();
    root.add(new THREE.Mesh(lathe([[0, 0], [1, 0], [1, 1], [0, 1]], seg), mats[0]));
    root.add(child);
    child.add(new THREE.Mesh(lathe([[0, 0], [0.5, 0], [0.5, 2], [0, 2]], seg), mats[1]));
    return root;
  };
  const meshes: THREE.Mesh[] = [];
  build(16, [m1, m2]).traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  // an extra template-only mesh at the end (the flyer's contact blob) keeps its own geometry
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  const hi = [...meshes, blob];
  const lo = lodGeometries(hi, build(8, [m1, m2]));
  assert.ok(lo);
  assert.equal(lo!.length, 3);
  assert.ok(tris(lo![0]) < tris(hi[0].geometry) && tris(lo![1]) < tris(hi[1].geometry));
  assert.equal(lo![2], blob.geometry);
  // swapped materials: structure differs, no far-view geometry
  assert.equal(lodGeometries(hi, build(8, [m2, m1])), null);
});
