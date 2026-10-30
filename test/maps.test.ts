import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { defaultMap, mapForRound } from '../src/client/render/ground.ts';
import { STANDARD_FIELD, setField } from '../src/shared/grid.ts';
import { TUG } from '../src/shared/tug.ts';

afterEach(() => setField(STANDARD_FIELD));

test('views open on Sea Bastion on the standard field', () => {
  assert.equal(defaultMap().id, 'bastion');
});

test('Classic plays Sea Bastion in round 1', () => {
  assert.equal(mapForRound(1).id, 'bastion');
});

test('tug of war opens on a map that can play on its field', () => {
  setField(TUG.field);
  assert.equal(defaultMap().id, 'basin');
});
