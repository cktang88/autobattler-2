import type * as THREE from 'three';

/** Mark only the first `n` items of a dynamic attribute for upload. Without a range three re-sends the whole
 *  capacity-sized array every frame (MBs a frame for the particle, overlay and instance pools). The range is reset
 *  each call: an object skipped by the renderer would otherwise pile ranges up. Nothing live, nothing to send. */
export function uploadPrefix(a: THREE.BufferAttribute | THREE.InstancedBufferAttribute, n: number): void {
  a.clearUpdateRanges();
  if (n <= 0) return;
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}
