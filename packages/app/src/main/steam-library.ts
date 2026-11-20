// The Steam library: which games are installed and where their cover art is. All of it from
// Steam's own local files, no network. This module is pure: the disk and the registry arrive as
// `SteamReaders` (the real ones are in steam-readers.ts, which tests never import).
//
// Paths in and out use forward slashes only ("D:/SteamLibrary/steamapps"): Windows takes them,
// and the same code then behaves the same in tests on any machine.

import type { AppCovers, InstalledGame } from '@helmarray/games';
import {
  VdfError,
  parseAppManifest,
  parseAssetCache,
  parseLibraryFolders,
  pickPortrait,
} from '@helmarray/games';

export interface SteamReaders {
  /** The `SteamPath` value under `HKCU\Software\Valve\Steam`, or undefined if Steam is not installed. */
  readRegistrySteamPath(): Promise<string | undefined>;
  /** A file's bytes, or undefined if it is missing or unreadable. */
  readFile(path: string): Promise<Uint8Array | undefined>;
  /** The names in a folder (files and folders), or undefined if the path is not a readable folder. */
  listDir(path: string): Promise<string[] | undefined>;
}

export interface SteamGame {
  appId: string;
  name: string;
  /** Absolute path of the portrait cover. Missing: the UI draws its placeholder. */
  cover?: string;
  /** Absolute path of the wide header image. */
  header?: string;
}

export interface SteamLibrary {
  /** Sorted by name. Empty when Steam is not installed or has no games. */
  games: SteamGame[];
}

/** Steam tools that have manifests like games but are not games: left out of the library. */
export const HIDDEN_STEAM_APPS: readonly string[] = [
  '228980', // Steamworks Common Redistributables
  '250820', // SteamVR
];

/** How deep the folder scan for a portrait goes below an app's cache folder. */
const SCAN_DEPTH = 4;

const slashes = (path: string): string => path.replaceAll('\\', '/');
const trimEnd = (path: string): string => slashes(path).replace(/\/+$/, '');
const sameFolder = (a: string, b: string): boolean =>
  trimEnd(a).toLowerCase() === trimEnd(b).toLowerCase();

/**
 * The Steam folder from the output of `reg query "HKCU\Software\Valve\Steam" /v SteamPath`:
 * a line like `    SteamPath    REG_SZ    c:/program files (x86)/steam`.
 */
export function parseSteamPathFromReg(output: string): string | undefined {
  const match = /^\s*SteamPath\s+REG_SZ\s+(.+?)\s*$/im.exec(output);
  const path = match?.[1];
  return path ? trimEnd(path) : undefined;
}

const decoder = new TextDecoder('utf-8');

export async function readSteamLibrary(readers: SteamReaders): Promise<SteamLibrary> {
  const registry = await readers.readRegistrySteamPath();
  if (!registry?.trim()) return { games: [] };
  const steam = trimEnd(registry.trim());
  const cacheDir = `${steam}/appcache/librarycache`;

  // Folder listings, asked for once each.
  const listings = new Map<string, Promise<string[] | undefined>>();
  const list = (path: string): Promise<string[] | undefined> => {
    let listing = listings.get(path);
    if (!listing) {
      listing = readers.listDir(path);
      listings.set(path, listing);
    }
    return listing;
  };
  /** Windows file names are not case-sensitive; neither is this. */
  const fileExists = async (path: string): Promise<boolean> => {
    const cut = path.lastIndexOf('/');
    const names = await list(path.slice(0, cut));
    const wanted = path.slice(cut + 1).toLowerCase();
    return names?.some((name) => name.toLowerCase() === wanted) ?? false;
  };

  const games = await installedGames(readers, steam);
  const index = await assetIndex(readers, `${cacheDir}/assetcache.vdf`);

  /** Every file below an app's cache folder, relative to it, down to SCAN_DEPTH folders. */
  const scan = async (dir: string, prefix: string, depth: number): Promise<string[]> => {
    const names = await list(dir);
    if (!names) return [];
    const found: string[] = [];
    for (const name of names) {
      const sub = await list(`${dir}/${name}`);
      if (sub === undefined) found.push(prefix + name);
      else if (depth < SCAN_DEPTH)
        found.push(...(await scan(`${dir}/${name}`, `${prefix}${name}/`, depth + 1)));
    }
    return found;
  };

  const result: SteamGame[] = [];
  for (const game of games) {
    const appDir = `${cacheDir}/${game.appId}`;
    const covers: AppCovers = index.get(game.appId) ?? {};
    const entry: SteamGame = { appId: game.appId, name: game.name };

    let portrait = covers.portrait;
    if (!portrait || !(await fileExists(`${appDir}/${portrait}`))) {
      portrait = pickPortrait(await scan(appDir, '', 1));
    }
    if (portrait) entry.cover = `${appDir}/${portrait}`;
    if (covers.header && (await fileExists(`${appDir}/${covers.header}`))) {
      entry.header = `${appDir}/${covers.header}`;
    }
    result.push(entry);
  }

  const key = (game: SteamGame): string => game.name.toLowerCase();
  result.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.appId < b.appId ? -1 : 1));
  return { games: result };
}

/** Every installed game in every library, once each. A manifest that can't be read is skipped. */
async function installedGames(readers: SteamReaders, steam: string): Promise<InstalledGame[]> {
  const listed = await readers.readFile(`${steam}/steamapps/libraryfolders.vdf`);
  let libraries: string[] = [];
  if (listed) {
    try {
      libraries = parseLibraryFolders(decoder.decode(listed));
    } catch (error) {
      if (!(error instanceof VdfError)) throw error;
    }
  }
  // Steam's own folder is always a library, even when libraryfolders.vdf doesn't say so.
  if (!libraries.some((library) => sameFolder(library, steam))) libraries.unshift(steam);

  const games: InstalledGame[] = [];
  const seen = new Set<string>();
  for (const library of libraries) {
    const steamapps = `${sameFolder(library, steam) ? steam : trimEnd(library)}/steamapps`;
    const names = (await readers.listDir(steamapps)) ?? [];
    for (const name of names.filter((n) => /^appmanifest_\d+\.acf$/i.test(n)).sort()) {
      const bytes = await readers.readFile(`${steamapps}/${name}`);
      if (!bytes) continue;
      let game: InstalledGame | undefined;
      try {
        game = parseAppManifest(decoder.decode(bytes), library);
      } catch (error) {
        if (!(error instanceof VdfError)) throw error;
      }
      if (game && !HIDDEN_STEAM_APPS.includes(game.appId) && !seen.has(game.appId)) {
        seen.add(game.appId);
        games.push(game);
      }
    }
  }
  return games;
}

/** assetcache.vdf, or nothing when it is missing or unreadable: the folder scan covers for it. */
async function assetIndex(readers: SteamReaders, path: string): Promise<Map<string, AppCovers>> {
  const bytes = await readers.readFile(path);
  if (!bytes) return new Map();
  try {
    return parseAssetCache(bytes);
  } catch (error) {
    if (!(error instanceof VdfError)) throw error;
    return new Map();
  }
}
