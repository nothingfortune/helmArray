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
//   3. The test data folder can't be the player's own (`%APPDATA%\@helmarray`).

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

const slashes = (path: string): string => path.replaceAll('\\', '/');
const trimEnd = (path: string): string => slashes(path).replace(/\/+$/, '');
const isAbsolute = (path: string): boolean => /^([A-Za-z]:\/|\/)/.test(slashes(path));

/** Whether `path` is `folder` itself or inside it, as Windows compares: not by case. */
export function isInside(path: string, folder: string): boolean {
  const p = trimEnd(path).toLowerCase();
  const f = trimEnd(folder).toLowerCase();
  return p === f || p.startsWith(`${f}/`);
}

/** Whether the run is a test run. Throws on a switch that is neither off nor `1`. */
export function e2eRequested(env: Env): boolean {
  const flag = env[E2E_ENV];
  if (flag === undefined || flag === '' || flag === '0') return false;
  if (flag === '1') return true;
  throw new Error(`${E2E_ENV} must be 1 (a test run) or unset, not "${flag}".`);
}

/** The test run's settings, or null for a normal run. Throws when a test run is set up wrong. */
export function e2eConfig(env: Env): E2eConfig | null {
  if (!e2eRequested(env)) return null;
  const dir = env[E2E_DIR_ENV];
  if (dir === undefined || dir.trim() === '' || !isAbsolute(dir)) {
    throw new Error(`${E2E_ENV}=1 needs ${E2E_DIR_ENV} set to an absolute folder.`);
  }
  const dataDir = trimEnd(dir.trim());
  const appData = env['APPDATA'];
  if (
    appData !== undefined &&
    appData !== '' &&
    isInside(dataDir, `${trimEnd(appData)}/@helmarray`)
  ) {
    throw new Error(`${E2E_DIR_ENV} can't be inside your helmArray data: use a temp folder.`);
  }
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
