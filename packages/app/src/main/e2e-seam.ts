// The end-to-end test seam: how a test run swaps everything that touches the outside (the
// units, the running programs, Steam, the app's folder) for fakes. Pure: no electron, no disk.
//
// It is switched by two environment variables and nothing else:
//   HELM_E2E=1      the run is a test run
//   HELM_E2E_DIR    an absolute folder to keep the app's data in (a temp folder)
//
// The rules, in order of importance:
//   1. Real HID is impossible under HELM_E2E, not merely unused. `chooseBackends` never calls
//      the real factory, and `refuseRealHid` makes the real node-hid backend throw if anything
//      else ever reached it.
//   2. A value of HELM_E2E that isn't plainly off or plainly `1` stops the app: it never falls
//      back to the real thing when the switch is half-set.
//   3. The test data folder can't be the player's own (`%APPDATA%\@helmarray`, the same under
//      `%LOCALAPPDATA%`, Electron's default folder for the app), a folder that holds those, a
//      link that leads to any of them, or the home folder itself.

import { win32 } from 'node:path';
import type { SteamReaders } from './steam-library';
import type { HidBackend } from './hid-transport';

export const E2E_ENV = 'HELM_E2E';
export const E2E_DIR_ENV = 'HELM_E2E_DIR';

export type Env = Readonly<Record<string, string | undefined>>;

export interface E2eConfig {
  /** Where the app keeps its files for the run (`userData`). */
  dataDir: string;
  /** The fake Steam folder the Steam read is pointed at. */
  steamDir: string;
}

// Every comparison of two paths here goes through `canonical`: resolved (so `.`, `..`, doubled and
// trailing separators and mixed slashes are gone), with a link resolved to what it leads to, and
// compared without regard to case, as Windows reads a path. The app is Windows-only, so the
// Windows rules are used on every machine and a test reads the same everywhere.

const slashes = (path: string): string => path.replaceAll('\\', '/');
const isAbsolute = (path: string): boolean => /^([A-Za-z]:[\\/]|[\\/])/.test(path);

/** What the seam needs from the machine, handed in so this module touches no disk. */
export interface SeamHost {
  /** The real path of a path that exists (links followed); throws for one that does not. */
  realpath(path: string): string;
  /** The user's home folder, when the environment does not say. */
  home?: string;
  /** The folder Electron would use for the app's data by default. */
  userData?: string;
}

/**
 * The path as the disk sees it: resolved, and with every link in the part that exists followed.
 * The part that doesn't exist yet (a folder about to be made) is kept as written, resolved.
 */
export function canonical(path: string, realpath: (path: string) => string): string {
  const resolved = win32.resolve(path);
  const missing: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      return win32.resolve(realpath(current), ...[...missing].reverse());
    } catch {
      const parent = win32.dirname(current);
      if (parent === current) return resolved;
      missing.push(win32.basename(current));
      current = parent;
    }
  }
}

/** How two canonical paths relate: the same, the first inside the second, or the first holds it. */
type Relation = 'same' | 'inside' | 'holds' | 'apart';

function relation(a: string, b: string): Relation {
  const x = a.toLowerCase().replace(/\\+$/, '');
  const y = b.toLowerCase().replace(/\\+$/, '');
  if (x === y) return 'same';
  if (x.startsWith(`${y}\\`)) return 'inside';
  if (y.startsWith(`${x}\\`)) return 'holds';
  return 'apart';
}

/** Whether `path` is `folder` itself or inside it, once both are resolved. Links are not followed. */
export function isInside(path: string, folder: string): boolean {
  const r = relation(win32.resolve(path), win32.resolve(folder));
  return r === 'same' || r === 'inside';
}

/** Whether the run is a test run. Throws on a switch that is neither off nor `1`. */
export function e2eRequested(env: Env): boolean {
  const flag = env[E2E_ENV];
  if (flag === undefined || flag === '' || flag === '0') return false;
  if (flag === '1') return true;
  throw new Error(`${E2E_ENV} must be 1 (a test run) or unset, not "${flag}".`);
}

/**
 * The folders a test run may not use as its own: the player's helmArray data (under APPDATA and
 * LOCALAPPDATA, and wherever Electron would put the app's data), anything inside them, and
 * anything that holds them, since the folders below a parent are its folders too.
 */
function guardedFolders(env: Env, host: SeamHost): string[] {
  const roots = [env['APPDATA'], env['LOCALAPPDATA']].flatMap((root) =>
    root === undefined || root === '' ? [] : [win32.join(root, '@helmarray')],
  );
  if (host.userData !== undefined && host.userData !== '') roots.push(host.userData);
  return roots.map((root) => canonical(root, host.realpath));
}

/** The test run's settings, or null for a normal run. Throws when a test run is set up wrong. */
export function e2eConfig(env: Env, host: SeamHost): E2eConfig | null {
  if (!e2eRequested(env)) return null;
  const dir = env[E2E_DIR_ENV];
  if (dir === undefined || dir.trim() === '' || !isAbsolute(dir.trim())) {
    throw new Error(`${E2E_ENV}=1 needs ${E2E_DIR_ENV} set to an absolute folder.`);
  }
  const real = canonical(dir.trim(), host.realpath);
  // The home folder holds the data folder, so it is told apart first, to say so in its own words.
  const home = host.home ?? env['USERPROFILE'];
  if (
    home !== undefined &&
    home !== '' &&
    relation(real, canonical(home, host.realpath)) === 'same'
  ) {
    throw new Error(`${E2E_DIR_ENV} can't be your home folder: use a temp folder.`);
  }
  for (const folder of guardedFolders(env, host)) {
    if (relation(real, folder) !== 'apart') {
      throw new Error(
        `${E2E_DIR_ENV} can't be, hold or be inside your helmArray data folder (${folder}): use a temp folder.`,
      );
    }
  }
  const dataDir = slashes(real).replace(/\/+$/, '');
  return { dataDir, steamDir: `${dataDir}/steam` };
}

/** Throws under a test run. Called by the real HID backend before it loads anything. */
export function refuseRealHid(env: Env): void {
  if (e2eRequested(env)) {
    throw new Error('A test run never opens real HID devices.');
  }
}

/** Everything the app reaches outside itself through, for the services to be built on. */
export interface Backends {
  hid: HidBackend;
  /** Image names of the running programs. */
  listProcesses(): Promise<string[]>;
  steam: SteamReaders;
  /** What a test drives and looks at from outside (only the fakes have one). */
  control?: unknown;
}

export interface BackendSources {
  /** The real ones. Never called under a test run. */
  real(): Backends | Promise<Backends>;
  /** The fakes. Never called in a normal run. */
  fake(config: E2eConfig): Backends | Promise<Backends>;
}

/** The fakes under a test run, the real ones otherwise; never both, never a mix. */
export async function chooseBackends(
  config: E2eConfig | null,
  sources: BackendSources,
): Promise<Backends> {
  return config === null ? sources.real() : sources.fake(config);
}

/** The ids the two fake units report. A test seeds `hands.json` with these. */
export const E2E_UNIT_IDS = { left: 49229, right: 29993 } as const;
/** The name the global the test run is driven through is kept under (see e2e-fakes.ts). */
export const E2E_CONTROL_GLOBAL = 'helmE2E';
