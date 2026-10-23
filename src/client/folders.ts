// Roster folders: the player's own grouping of saved designs in the garage, kept in localStorage ('ab2.folders').
// Client-side only (not part of the synced garage): a folder only refers to designs by id, so designs that are
// renamed, edited or synced from another device keep their folder, and ids that no longer exist are simply dropped.
// Every read is sanitised, so corrupt or hand-edited storage degrades to "no folders" instead of breaking the garage.

export const KEY_FOLDERS = 'ab2.folders';
export const FOLDER_NAME_MAX = 24;
const MAX_FOLDERS = 60;

export interface Folder { id: string; name: string; collapsed: boolean }
export interface FolderData {
  /** in display order */
  folders: Folder[];
  /** designId -> folderId (designs not listed are unfiled) */
  assign: Record<string, string>;
  /** collapsed group keys of the automatic groupings and the "Unfiled" group (e.g. 'domain:jet', 'unfiled') */
  collapsed: string[];
}

export const emptyFolders = (): FolderData => ({ folders: [], assign: {}, collapsed: [] });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX);

/** Shape-check raw storage. `designIds` (when given) drops assignments of designs that no longer exist. */
export function sanitizeFolders(raw: unknown, designIds?: Iterable<string>): FolderData {
  const out = emptyFolders();
  if (!isObj(raw)) return out;
  const ids = new Set<string>();
  if (Array.isArray(raw.folders)) {
    for (const f of raw.folders) {
      if (!isObj(f) || typeof f.id !== 'string' || !f.id || f.id.length > 40 || ids.has(f.id) || typeof f.name !== 'string') continue;
      if (out.folders.length >= MAX_FOLDERS) break;
      ids.add(f.id);
      out.folders.push({ id: f.id, name: cleanName(f.name) || 'Folder', collapsed: f.collapsed === true });
    }
  }
  const known = designIds ? new Set(designIds) : null;
  if (isObj(raw.assign)) {
    for (const [d, f] of Object.entries(raw.assign)) {
      if (typeof f === 'string' && ids.has(f) && (!known || known.has(d))) out.assign[d] = f;
    }
  }
  if (Array.isArray(raw.collapsed)) {
    out.collapsed = [...new Set(raw.collapsed.filter((k): k is string => typeof k === 'string' && k.length <= 64))].slice(0, 200);
  }
  return out;
}

export function loadFolders(designIds?: Iterable<string>): FolderData {
  try {
    const raw = localStorage.getItem(KEY_FOLDERS);
    return sanitizeFolders(raw ? JSON.parse(raw) : null, designIds);
  } catch {
    return emptyFolders();
  }
}
export function saveFolders(f: FolderData): void {
  try { localStorage.setItem(KEY_FOLDERS, JSON.stringify(f)); } catch { /* storage unavailable */ }
}

/** A folder name not yet taken ("New folder", "New folder 2", ...). */
export function uniqueFolderName(f: FolderData, base = 'New folder'): string {
  const taken = new Set(f.folders.map((x) => x.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base.slice(0, FOLDER_NAME_MAX - String(n).length - 1)} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Add a folder (at the end). Returns the new folder, or null when the folder limit is reached. */
export function addFolder(f: FolderData, name?: string): Folder | null {
  if (f.folders.length >= MAX_FOLDERS) return null;
  let id: string;
  do id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  while (f.folders.some((x) => x.id === id));
  const folder: Folder = { id, name: cleanName(name ?? '') || uniqueFolderName(f), collapsed: false };
  f.folders.push(folder);
  return folder;
}

/** Rename; an empty name leaves the folder as it was. Returns whether anything changed. */
export function renameFolder(f: FolderData, id: string, name: string): boolean {
  const folder = f.folders.find((x) => x.id === id);
  const n = cleanName(name);
  if (!folder || !n || n === folder.name) return false;
  folder.name = n;
  return true;
}

/** Remove a folder; its designs become unfiled (designs themselves are never deleted here). */
export function removeFolder(f: FolderData, id: string): void {
  f.folders = f.folders.filter((x) => x.id !== id);
  for (const [d, fid] of Object.entries(f.assign)) if (fid === id) delete f.assign[d];
}

/** File a design into a folder (null / unknown folder = unfiled). */
export function moveToFolder(f: FolderData, designId: string, folderId: string | null): void {
  if (folderId && f.folders.some((x) => x.id === folderId)) f.assign[designId] = folderId;
  else delete f.assign[designId];
}

export const folderOf = (f: FolderData, designId: string): string | null => f.assign[designId] ?? null;
export const designsIn = (f: FolderData, folderId: string): string[] => Object.keys(f.assign).filter((d) => f.assign[d] === folderId);
