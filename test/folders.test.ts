// Garage roster folders (src/client/folders.ts): sanitising corrupt storage and the folder operations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addFolder, designsIn, emptyFolders, folderOf, loadFolders, moveToFolder, removeFolder, renameFolder, sanitizeFolders, saveFolders, uniqueFolderName, KEY_FOLDERS } from '../src/client/folders.ts';

test('sanitizeFolders drops corrupt entries and dangling assignments', () => {
  for (const raw of [null, 7, 'x', [], { folders: 'no' }]) assert.deepEqual(sanitizeFolders(raw), emptyFolders());
  const f = sanitizeFolders({
    folders: [{ id: 'a', name: '  Tanks  ' }, { id: 'a', name: 'dup' }, { id: 5, name: 'bad' }, { id: 'b', name: '', collapsed: true }, null],
    assign: { d1: 'a', d2: 'zzz', d3: 'b', d4: 3 },
    collapsed: ['domain:jet', 4, 'domain:jet'],
  });
  assert.deepEqual(f.folders, [{ id: 'a', name: 'Tanks', collapsed: false }, { id: 'b', name: 'Folder', collapsed: true }]);
  assert.deepEqual(f.assign, { d1: 'a', d3: 'b' });
  assert.deepEqual(f.collapsed, ['domain:jet']);
  // known design ids prune assignments of deleted designs
  assert.deepEqual(sanitizeFolders({ folders: [{ id: 'a', name: 'A' }], assign: { d1: 'a', gone: 'a' } }, ['d1']).assign, { d1: 'a' });
});

test('folder operations', () => {
  const f = emptyFolders();
  const a = addFolder(f)!;
  const b = addFolder(f)!;
  assert.equal(a.name, 'New folder');
  assert.equal(b.name, 'New folder 2');
  assert.equal(uniqueFolderName(f), 'New folder 3');
  moveToFolder(f, 'd1', a.id);
  moveToFolder(f, 'd2', a.id);
  moveToFolder(f, 'd3', 'nope'); // unknown folder = unfiled
  assert.equal(folderOf(f, 'd3'), null);
  assert.deepEqual(designsIn(f, a.id).sort(), ['d1', 'd2']);
  moveToFolder(f, 'd2', null);
  assert.equal(folderOf(f, 'd2'), null);
  assert.equal(renameFolder(f, a.id, '   '), false);
  assert.equal(renameFolder(f, a.id, 'A very long folder name that goes on'), true);
  assert.equal(a.name.length <= 24, true);
  removeFolder(f, a.id);
  assert.equal(folderOf(f, 'd1'), null);
  assert.deepEqual(f.folders.map((x) => x.id), [b.id]);
});

test('loadFolders / saveFolders round-trip and survive garbage', () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)) };
  try {
    assert.deepEqual(loadFolders(), emptyFolders());
    const f = emptyFolders();
    const a = addFolder(f, 'Air')!;
    moveToFolder(f, 'd1', a.id);
    f.collapsed.push('unfiled');
    saveFolders(f);
    assert.deepEqual(loadFolders(), f);
    store.set(KEY_FOLDERS, '{not json');
    assert.deepEqual(loadFolders(), emptyFolders());
  } finally { g.localStorage = prev; }
});
