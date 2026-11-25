import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backends, Env, SeamHost } from './e2e-seam';
import { chooseBackends, e2eConfig, e2eRequested, isInside, refuseRealHid } from './e2e-seam';

const backends = (name: string): Backends => ({
  hid: { enumerate: () => Promise.resolve([]), open: () => Promise.reject(new Error(name)) },
  listProcesses: () => Promise.resolve([name]),
  gameFiles: { localAppData: [] },
  steam: {
    readRegistrySteamPath: () => Promise.resolve(undefined),
    readFile: () => Promise.resolve(undefined),
    listDir: () => Promise.resolve(undefined),
  },
});

/**
 * A machine as the seam sees it: its platform and how its paths are written. The same checks run
 * on both, whatever machine the tests run on, so a path rule that only holds on one fails here.
 */
interface Flavour {
  name: string;
  platform: NodeJS.Platform;
  /** The separator the machine writes. */
  sep: string;
  /** An absolute path, written the machine's way. */
  p(...parts: string[]): string;
  /** The same, written with forward slashes (which Windows takes too). */
  fwd(...parts: string[]): string;
}
const WINDOWS: Flavour = {
  name: 'Windows',
  platform: 'win32',
  sep: '\\',
  p: (...parts) => ['C:', ...parts].join('\\'),
  fwd: (...parts) => ['C:', ...parts].join('/'),
};
const LINUX: Flavour = {
  name: 'Linux',
  platform: 'linux',
  sep: '/',
  p: (...parts) => `/${parts.join('/')}`,
  fwd: (...parts) => `/${parts.join('/')}`,
};

const on = (f: Flavour): Env => ({ HELM_E2E: '1', HELM_E2E_DIR: f.p('Temp', 'helm-e2e') + f.sep });

describe('e2eRequested', () => {
  it.each([{ HELM_E2E: undefined }, { HELM_E2E: '' }, { HELM_E2E: '0' }])(
    'is off for %o',
    (env) => {
      expect(e2eRequested(env)).toBe(false);
    },
  );

  it('is on for 1', () => {
    expect(e2eRequested({ HELM_E2E: '1' })).toBe(true);
  });

  it('stops the app for any other value, rather than guess', () => {
    expect(() => e2eRequested({ HELM_E2E: 'true' })).toThrow('HELM_E2E must be 1');
  });
});

describe.each([WINDOWS, LINUX])('e2eConfig on $name', (f) => {
  const plain: SeamHost = { realpath: (path) => path, platform: f.platform };

  it('is null for a normal run, even with a folder set', () => {
    const env = { HELM_E2E: '0', HELM_E2E_DIR: f.p('Temp', 'x') };
    expect(e2eConfig(env, plain)).toBeNull();
  });

  it("is on with 1 and an absolute folder, and puts the fake Steam and the games' folders inside it", () => {
    expect(e2eConfig(on(f), plain)).toEqual({
      dataDir: f.fwd('Temp', 'helm-e2e'),
      steamDir: f.fwd('Temp', 'helm-e2e', 'steam'),
      localAppData: f.fwd('Temp', 'helm-e2e', 'local'),
    });
  });

  it("never looks for a game's file in the real local app data folder", () => {
    const env = { ...on(f), LOCALAPPDATA: f.p('Users', 'me', 'AppData', 'Local') };
    const config = e2eConfig(env, plain);
    expect(config !== null && isInside(config.localAppData, config.dataDir, f.platform)).toBe(true);
  });

  it('refuses to run without the folder', () => {
    expect(() => e2eConfig({ HELM_E2E: '1' }, plain)).toThrow('needs HELM_E2E_DIR');
  });

  it('refuses a blank folder', () => {
    expect(() => e2eConfig({ HELM_E2E: '1', HELM_E2E_DIR: '  ' }, plain)).toThrow(
      'needs HELM_E2E_DIR',
    );
  });

  it('refuses a folder that is not absolute', () => {
    expect(() => e2eConfig({ HELM_E2E: '1', HELM_E2E_DIR: 'data' }, plain)).toThrow(
      'absolute folder',
    );
  });
});

describe.each([WINDOWS, LINUX])('the folders a test run may not use, on $name', (f) => {
  const env = (dir: string): Env => ({
    HELM_E2E: '1',
    HELM_E2E_DIR: dir,
    APPDATA: f.p('Users', 'me', 'AppData', 'Roaming'),
    LOCALAPPDATA: f.p('Users', 'me', 'AppData', 'Local'),
    USERPROFILE: f.p('Users', 'me'),
  });
  const plain: SeamHost = { realpath: (path) => path, platform: f.platform };
  const asked =
    (dir: string, host: SeamHost = plain) =>
    () =>
      e2eConfig(env(dir), host);
  const OWN = 'helmArray data';
  const DATA = ['Users', 'me', 'AppData', 'Roaming', '@helmarray'];

  it('refuses the data folder itself', () => {
    expect(asked(f.p(...DATA))).toThrow(OWN);
  });

  it('refuses a folder inside it', () => {
    expect(asked(f.p(...DATA, 'app'))).toThrow(OWN);
  });

  it('refuses a dot segment in the way', () => {
    expect(asked(f.fwd('Users', 'me', 'AppData', 'Roaming', '.', '@helmarray', 'app'))).toThrow(
      OWN,
    );
  });

  it('refuses a .. segment that comes back into it', () => {
    expect(
      asked(f.fwd('Users', 'me', 'AppData', 'Roaming', 'other', '..', '@helmarray', 'app')),
    ).toThrow(OWN);
  });

  it('refuses a trailing separator, and a doubled one', () => {
    expect(asked(f.p(...DATA) + f.sep + f.sep)).toThrow(OWN);
  });

  it('refuses the folder that holds it', () => {
    expect(asked(f.p('Users', 'me', 'AppData', 'Roaming'))).toThrow(OWN);
  });

  it('refuses a folder further up that holds it', () => {
    expect(asked(f.p('Users'))).toThrow(OWN);
  });

  it('refuses the root, which holds everything', () => {
    expect(asked(f.platform === 'win32' ? 'C:\\' : '/')).toThrow("can't be a drive root");
  });

  it('refuses a path that .. climbs to the root', () => {
    expect(asked(f.fwd('Users', '..'))).toThrow("can't be a drive root");
  });

  it('refuses the same folder under LOCALAPPDATA', () => {
    expect(asked(f.p('Users', 'me', 'AppData', 'Local', '@helmarray', 'cache'))).toThrow(OWN);
  });

  it("refuses Electron's own default folder for the app when that is somewhere else", () => {
    const host = { ...plain, userData: f.p('Roaming', 'Helm Array') };
    expect(asked(f.p('Roaming', 'Helm Array', 'session'), host)).toThrow(OWN);
  });

  it("refuses the folder that holds Electron's default folder when it is named for the app", () => {
    const host = { ...plain, userData: f.p('config', '@helmarray', 'app') };
    expect(asked(f.p('config', '@helmarray'), host)).toThrow(OWN);
  });

  it("refuses the user's home folder itself", () => {
    expect(asked(f.p('Users', 'me') + f.sep)).toThrow("can't be your home folder");
  });

  it('refuses a home folder given by the host, not the environment', () => {
    const host = { ...plain, home: f.p('Profiles', 'me') };
    expect(asked(f.fwd('Profiles', '.', 'me'), host)).toThrow("can't be your home folder");
  });

  it('accepts a temp folder inside the home folder', () => {
    const dir = f.p('Users', 'me', 'AppData', 'Local', 'Temp', 'helm-e2e-1');
    expect(asked(dir)()).toEqual({
      dataDir: f.fwd('Users', 'me', 'AppData', 'Local', 'Temp', 'helm-e2e-1'),
      steamDir: f.fwd('Users', 'me', 'AppData', 'Local', 'Temp', 'helm-e2e-1', 'steam'),
      localAppData: f.fwd('Users', 'me', 'AppData', 'Local', 'Temp', 'helm-e2e-1', 'local'),
    });
  });

  it('accepts a folder beside the data folder whose name only starts the same', () => {
    const dir = f.p('Users', 'me', 'AppData', 'Roaming', '@helmarray-test');
    expect(asked(dir)()?.dataDir).toBe(
      f.fwd('Users', 'me', 'AppData', 'Roaming', '@helmarray-test'),
    );
  });

  it('refuses a link that leads into it, by what the link really is', () => {
    // The link is a junction or symlink to the data folder; the folder asked for is below it and
    // doesn't exist yet, so only the part that does is resolved.
    const link = f.p('Temp', 'link');
    const host: SeamHost = {
      platform: f.platform,
      realpath: (path) => {
        if (path === link) return f.p(...DATA);
        if (path === f.p('Temp')) return path;
        throw new Error(`ENOENT ${path}`);
      },
    };
    expect(asked(f.p('Temp', 'link', 'app'), host)).toThrow(OWN);
  });

  it('refuses a link to the folder that holds it', () => {
    const link = f.p('Temp', 'link');
    const host: SeamHost = {
      platform: f.platform,
      realpath: (path) => {
        if (path === link) return f.p('Users', 'me', 'AppData', 'Roaming');
        throw new Error(`ENOENT ${path}`);
      },
    };
    expect(asked(link, host)).toThrow(OWN);
  });
});

describe('Windows reads a path its own way', () => {
  const f = WINDOWS;
  const asked = (dir: string) => () =>
    e2eConfig(
      {
        HELM_E2E: '1',
        HELM_E2E_DIR: dir,
        APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      },
      { realpath: (path) => path, platform: f.platform },
    );
  const OWN = 'helmArray data';

  it('refuses mixed slashes', () => {
    expect(asked('C:\\Users/me\\AppData/Roaming\\@helmarray/app')).toThrow(OWN);
  });

  it('refuses a different case', () => {
    expect(asked('c:\\USERS\\Me\\appdata\\ROAMING\\@HelmArray\\app')).toThrow(OWN);
  });
});

describe('Linux reads a path its own way', () => {
  const host: SeamHost = { realpath: (path) => path, platform: 'linux' };
  const env = (dir: string): Env => ({
    HELM_E2E: '1',
    HELM_E2E_DIR: dir,
    APPDATA: '/home/me/AppData/Roaming',
  });

  it('keeps case: a differently cased folder is another folder', () => {
    const config = e2eConfig(env('/home/me/appdata/roaming/@HELMARRAY/app'), host);
    expect(config?.dataDir).toBe('/home/me/appdata/roaming/@HELMARRAY/app');
  });

  it('keeps a backslash as part of a name, not a separator', () => {
    const config = e2eConfig(env('/home/me/AppData/Roaming\\@helmarray'), host);
    expect(config?.dataDir).toBe('/home/me/AppData/Roaming\\@helmarray');
  });
});

describe('a real link, on this machine', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });
  // A junction on Windows (it needs no privilege), a symlink everywhere else.
  const kind = process.platform === 'win32' ? 'junction' : 'dir';
  const here = (): SeamHost => ({ realpath: realpathSync.native, platform: process.platform });

  it('into the data folder is refused, though its own path looks harmless', () => {
    root = mkdtempSync(join(tmpdir(), 'helm-seam-'));
    const appData = join(root, 'appdata');
    mkdirSync(join(appData, '@helmarray'), { recursive: true });
    symlinkSync(join(appData, '@helmarray'), join(root, 'link'), kind);
    const env = { HELM_E2E: '1', HELM_E2E_DIR: join(root, 'link', 'app'), APPDATA: appData };
    expect(() => e2eConfig(env, here())).toThrow('helmArray data');
  });

  it('into a folder that is not the data folder is accepted, as what it leads to', () => {
    root = mkdtempSync(join(tmpdir(), 'helm-seam-'));
    mkdirSync(join(root, 'elsewhere'));
    symlinkSync(join(root, 'elsewhere'), join(root, 'link'), kind);
    const env = {
      HELM_E2E: '1',
      HELM_E2E_DIR: join(root, 'link', 'app'),
      APPDATA: join(root, 'a'),
    };
    const dataDir = e2eConfig(env, here())?.dataDir ?? '';
    expect(dataDir.endsWith('/elsewhere/app')).toBe(true);
  });
});

describe.each([WINDOWS, LINUX])('isInside on $name', (f) => {
  const inside = (path: string, folder: string) => isInside(path, folder, f.platform);

  it('holds for the folder itself', () => {
    expect(inside(f.p('a', 'b'), f.p('a', 'b'))).toBe(true);
  });

  it('holds for something below it, whatever the trailing slash', () => {
    expect(inside(f.p('a', 'b', 'c'), f.p('a', 'b') + f.sep)).toBe(true);
  });

  it('does not hold for a sibling that starts the same', () => {
    expect(inside(f.p('a', 'bc'), f.p('a', 'b'))).toBe(false);
  });

  it('does not hold for a path that climbs out with ..', () => {
    expect(inside(f.fwd('a', 'b', '..', 'c'), f.p('a', 'b'))).toBe(false);
  });

  it('holds for a path that climbs and comes back', () => {
    expect(inside(f.fwd('a', 'b', 'c', '..', 'd'), f.p('a', 'b'))).toBe(true);
  });

  it('does not hold for the folder that holds it', () => {
    expect(inside(f.p('a'), f.p('a', 'b'))).toBe(false);
  });
});

describe('isInside, where the platforms differ', () => {
  it('holds across mixed slashes, dot segments and case on Windows', () => {
    expect(isInside('c:\\A\\.\\B/c', 'C:/a/b', 'win32')).toBe(true);
  });

  it('does not hold across case on Linux', () => {
    expect(isInside('/a/B/c', '/a/b', 'linux')).toBe(false);
  });
});

describe('refuseRealHid', () => {
  it('throws under a test run', () => {
    expect(() => refuseRealHid(on(WINDOWS))).toThrow('A test run never opens real HID devices.');
  });

  it('throws for a half-set switch too', () => {
    expect(() => refuseRealHid({ HELM_E2E: 'maybe' })).toThrow('HELM_E2E must be 1');
  });

  it('does nothing in a normal run', () => {
    expect(refuseRealHid({})).toBeUndefined();
  });
});

describe('chooseBackends', () => {
  const config = { dataDir: 'C:/t', steamDir: 'C:/t/steam', localAppData: 'C:/t/local' };

  it('hands back the fakes under a test run', async () => {
    const real = vi.fn(() => backends('real'));
    const chosen = await chooseBackends(config, { real, fake: () => backends('fake') });
    expect(await chosen.listProcesses()).toEqual(['fake']);
  });

  it('never so much as builds the real backends under a test run', async () => {
    const real = vi.fn(() => backends('real'));
    await chooseBackends(config, { real, fake: () => backends('fake') });
    expect(real).not.toHaveBeenCalled();
  });

  it('tells the fakes where the run keeps its files', async () => {
    const fake = vi.fn(() => backends('fake'));
    await chooseBackends(config, { real: () => backends('real'), fake });
    expect(fake).toHaveBeenCalledWith(config);
  });

  it('hands back the real ones in a normal run', async () => {
    const chosen = await chooseBackends(null, {
      real: () => backends('real'),
      fake: () => backends('fake'),
    });
    expect(await chosen.listProcesses()).toEqual(['real']);
  });

  it('never builds the fakes in a normal run', async () => {
    const fake = vi.fn(() => backends('fake'));
    await chooseBackends(null, { real: () => backends('real'), fake });
    expect(fake).not.toHaveBeenCalled();
  });
});
