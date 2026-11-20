// What Steam's local files say, from their parsed text. No I/O: the app reads the files and
// hands the contents here. docs/spikes/02-steam-covers.md has the survey behind these shapes.

import type { KvSection } from './kv';
import { findSection, findString, isSection } from './kv';
import { parseVdfBinary } from './vdf-binary';
import { parseVdfText } from './vdf-text';

export interface InstalledGame {
  /** Steam's app id, as text. Portal 2's is "620"; never assume a length. */
  appId: string;
  name: string;
  /** The folder under `<library>/steamapps/common/`. */
  installDir: string;
  /** The library's root exactly as libraryfolders.vdf gives it (Windows path, backslashes). */
  libraryPath: string;
}

/** Library roots from libraryfolders.vdf, in file order, each once. Handles both file layouts. */
export function parseLibraryFolders(text: string): string[] {
  const folders = findSection(parseVdfText(text), 'libraryfolders');
  if (!folders) return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(folders)) {
    // Current: "0" { "path" "C:\Steam" ... }. Before 2021: "1" "D:\Games", beside other
    // plain settings such as "TimeNextStatsReport".
    const path = isSection(value)
      ? findString(value, 'path')
      : /^\d+$/.test(key) && typeof value === 'string'
        ? value
        : undefined;
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/**
 * One appmanifest_<appid>.acf. Undefined when it lacks an app id or install folder (a manifest
 * Steam is still writing). A missing name falls back to the install folder's.
 */
export function parseAppManifest(text: string, libraryPath: string): InstalledGame | undefined {
  const state = findSection(parseVdfText(text), 'AppState');
  if (!state) return undefined;
  const appId = findString(state, 'appid')?.trim();
  const installDir = findString(state, 'installdir');
  if (!appId || !/^\d+$/.test(appId) || !installDir) return undefined;
  return { appId, name: findString(state, 'name') || installDir, installDir, libraryPath };
}

/** Cover files of one app, relative to its folder `appcache/librarycache/<appId>/`. */
export interface AppCovers {
  /** Portrait capsule, slot `0f`. */
  portrait?: string;
  /** Header, slot `3f`. */
  header?: string;
  /** Icon, slot `4f`. */
  icon?: string;
}

const SLOTS = { portrait: '0f', header: '3f', icon: '4f' } as const;

/**
 * A path from the index, made safe to join onto an app's folder: forward slashes, no `..`, no
 * drive. Undefined for anything that would leave the folder.
 */
function relativePath(raw: string): string | undefined {
  const parts = raw.replaceAll('\\', '/').split('/');
  const kept: string[] = [];
  for (const part of parts) {
    if (part === '..' || part.includes(':')) return undefined;
    if (part !== '' && part !== '.') kept.push(part);
  }
  return kept.length > 0 && !raw.startsWith('/') && !raw.startsWith('\\')
    ? kept.join('/')
    : undefined;
}

/**
 * Reads assetcache.vdf (binary KeyValues). An app is any numbered section holding slot keys
 * (`0f`, `1f` ...), at whatever depth: wrapping sections hold apps, not slots. Apps with none
 * of the three slots we use are left out. Throws `VdfError` when the file is not readable.
 */
export function parseAssetCache(bytes: Uint8Array): Map<string, AppCovers> {
  const apps = new Map<string, AppCovers>();

  const walk = (node: KvSection): void => {
    for (const [key, value] of Object.entries(node)) {
      if (!isSection(value)) continue;
      if (/^\d+$/.test(key) && Object.keys(value).some((k) => /^\d+f$/.test(k))) {
        const covers: { -readonly [K in keyof AppCovers]: AppCovers[K] } = {};
        for (const [name, slot] of Object.entries(SLOTS)) {
          const file = value[slot];
          const rel = typeof file === 'string' ? relativePath(file) : undefined;
          if (rel) covers[name as keyof AppCovers] = rel;
        }
        if (Object.keys(covers).length > 0 && !apps.has(key)) apps.set(key, covers);
      } else {
        walk(value);
      }
    }
  };

  walk(parseVdfBinary(bytes));
  return apps;
}

/** The names Steam gives a portrait, best first. */
const PORTRAIT_NAMES = ['library_600x900.jpg', 'library_capsule.jpg'];

/**
 * The portrait among an app folder's files (paths relative to it, any depth): the folder scan
 * for a game the index lacks. `library_600x900.jpg` beats `library_capsule.jpg`, then the
 * shallower, then the first alphabetically, so the answer never depends on listing order.
 */
export function pickPortrait(files: readonly string[]): string | undefined {
  let best: { path: string; rank: number; depth: number } | undefined;
  for (const raw of files) {
    const path = relativePath(raw);
    if (!path) continue;
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const rank = PORTRAIT_NAMES.indexOf(name);
    if (rank < 0) continue;
    const depth = path.split('/').length;
    if (
      !best ||
      rank < best.rank ||
      (rank === best.rank && (depth < best.depth || (depth === best.depth && path < best.path)))
    )
      best = { path, rank, depth };
  }
  return best?.path;
}
