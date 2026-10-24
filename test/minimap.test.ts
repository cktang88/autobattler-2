import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipRect } from '../src/client/ui/minimap.ts';

const area = (p: { x: number; y: number }[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return Math.abs(a) / 2;
};

test('minimap footprint: a quad inside the field is unchanged', () => {
  const q = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 6 }, { x: 2, y: 6 }];
  assert.deepEqual(clipRect(q, 0, 0, 10, 10), q);
});

test('minimap footprint: a turned view is clipped to the field, not bent by clamping its corners', () => {
  // a diamond (a 45 deg turned view) centred on the field's left edge: the true visible part is the right half
  const q = [{ x: 0, y: -4 }, { x: 4, y: 0 }, { x: 0, y: 4 }, { x: -4, y: 0 }];
  const c = clipRect(q, 0, -10, 10, 10);
  assert.ok(Math.abs(area(c) - 16) < 1e-9, `area ${area(c)}`);
  for (const p of c) assert.ok(p.x >= -1e-9);
  // clamping each corner instead moved (-4, 0) to (0, 0): a third vertex on the edge, a dent in the outline
  assert.ok(c.some((p) => p.x === 4 && p.y === 0));
  assert.equal(new Set(c.filter((p) => Math.abs(p.x) < 1e-9).map((p) => p.y)).size, 2);
});

test('minimap footprint: a view entirely off the field clips to nothing', () => {
  assert.equal(clipRect([{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }], 0, 0, 10, 10).length, 0);
});
