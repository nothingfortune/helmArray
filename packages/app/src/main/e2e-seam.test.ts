import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backends, Env, SeamHost } from './e2e-seam';
import { chooseBackends, e2eConfig, e2eRequested, isInside, refuseRealHid } from './e2e-seam';

const backends = (name: string): Backends => ({
  hid: { enumerate: () => Promise.resolve([]), open: () => Promise.reject(new Error(name)) },
  listProcesses: () => Promise.resolve([name]),
  steam: {
    readRegistrySteamPath: () => Promise.resolve(undefined),
    readFile: () => Promise.resolve(undefined),
    listDir: () => Promise.resolve(undefined),
  },
});

/** No link anywhere: a path is its own real path. */
const plain: SeamHost = { realpath: (path) => path };
const on: Env = { HELM_E2E: '1', HELM_E2E_DIR: 'C:\\Temp\\helm-e2e\\' };

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

describe('e2eConfig', () => {
  it('is null for a normal run, even with a folder set', () => {
    expect(e2eConfig({ HELM_E2E: '0', HELM_E2E_DIR: 'C:\\Temp\\x' }, plain)).toBeNull();
  });

  it('is on with 1 and an absolute folder, and puts the fake Steam inside it', () => {
    expect(e2eConfig(on, plain)).toEqual({
      dataDir: 'C:/Temp/helm-e2e',
      steamDir: 'C:/Temp/helm-e2e/steam',
    });
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

describe('the folders a test run may not use', () => {
  const appData = 'C:\\Users\\me\\AppData\\Roaming';
  const localAppData = 'C:\\Users\\me\\AppData\\Local';
  const home = 'C:\\Users\\me';
  const env = (dir: string): Env => ({
    HELM_E2E: '1',
    HELM_E2E_DIR: dir,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    USERPROFILE: home,
  });
  const asked =
    (dir: string, host: SeamHost = plain) =>
    () =>
      e2eConfig(env(dir), host);
  const OWN = 'helmArray data';

  it('refuses the data folder itself', () => {
    expect(asked('C:\\Users\\me\\AppData\\Roaming\\@helmarray')).toThrow(OWN);
  });

  it('refuses a folder inside it', () => {
    expect(asked('C:\\Users\\me\\AppData\\Roaming\\@helmarray\\app')).toThrow(OWN);
  });

  it('refuses a dot segment in the way', () => {
    expect(asked('C:/Users/me/AppData/Roaming/./@helmarray/app')).toThrow(OWN);
  });

  it('refuses a .. segment that comes back into it', () => {
    expect(asked('C:/Users/me/AppData/Roaming/other/../@helmarray/app')).toThrow(OWN);
  });

  it('refuses mixed slashes', () => {
    expect(asked('C:\\Users/me\\AppData/Roaming\\@helmarray/app')).toThrow(OWN);
  });

  it('refuses a different case, as Windows reads it', () => {
    expect(asked('c:\\USERS\\Me\\appdata\\ROAMING\\@HelmArray\\app')).toThrow(OWN);
  });

  it('refuses a trailing separator, and a doubled one', () => {
    expect(asked('C:\\Users\\me\\AppData\\Roaming\\@helmarray\\\\')).toThrow(OWN);
  });

  it('refuses the folder that holds it', () => {
    expect(asked('C:\\Users\\me\\AppData\\Roaming')).toThrow(OWN);
  });

  it('refuses a folder further up that holds it', () => {
    expect(asked('C:\\Users')).toThrow(OWN);
  });

  it('refuses the drive root, which holds everything', () => {
    expect(asked('C:\\')).toThrow(OWN);
  });

  it('refuses the same folder under LOCALAPPDATA', () => {
    expect(asked('C:\\Users\\me\\AppData\\Local\\@helmarray\\cache')).toThrow(OWN);
  });

  it("refuses Electron's own default folder for the app when that is somewhere else", () => {
    const host = { ...plain, userData: 'D:\\Roaming\\Helm Array' };
    expect(asked('D:\\Roaming\\Helm Array\\session', host)).toThrow(OWN);
  });

  it("refuses the user's home folder itself", () => {
    expect(asked('C:\\Users\\me\\')).toThrow("can't be your home folder");
  });

  it('refuses a home folder given by the host, not the environment', () => {
    const host = { ...plain, home: 'E:\\Profiles\\me' };
    expect(asked('E:/Profiles/./me', host)).toThrow("can't be your home folder");
  });

  it('accepts a temp folder inside the home folder', () => {
    expect(asked('C:\\Users\\me\\AppData\\Local\\Temp\\helm-e2e-1')()).toEqual({
      dataDir: 'C:/Users/me/AppData/Local/Temp/helm-e2e-1',
      steamDir: 'C:/Users/me/AppData/Local/Temp/helm-e2e-1/steam',
    });
  });

  it('accepts a folder beside the data folder whose name only starts the same', () => {
    expect(asked('C:\\Users\\me\\AppData\\Roaming\\@helmarray-test')()).toEqual({
      dataDir: 'C:/Users/me/AppData/Roaming/@helmarray-test',
      steamDir: 'C:/Users/me/AppData/Roaming/@helmarray-test/steam',
    });
  });

  it('refuses a link that leads into it, by what the link really is', () => {
    // C:\Temp\link is a junction to the data folder; the folder asked for is below it and
    // doesn't exist yet, so only the part that does is resolved.
    const links: Record<string, string> = {
      'C:\\Temp\\link': 'C:\\Users\\me\\AppData\\Roaming\\@helmarray',
    };
    const host: SeamHost = {
      realpath: (path) => {
        const real = links[path] ?? (path === 'C:\\Temp' ? path : undefined);
        if (real === undefined) throw new Error(`ENOENT ${path}`);
        return real;
      },
    };
    expect(asked('C:\\Temp\\link\\app', host)).toThrow(OWN);
  });

  it('refuses a link to the folder that holds it', () => {
    const host: SeamHost = {
      realpath: (path) => {
        if (path === 'C:\\Temp\\link') return 'C:\\Users\\me\\AppData\\Roaming';
        throw new Error(`ENOENT ${path}`);
      },
    };
    expect(asked('C:\\Temp\\link', host)).toThrow(OWN);
  });
});

describe('a real link', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('into the data folder is refused, though its own path looks harmless', () => {
    root = mkdtempSync(join(tmpdir(), 'helm-seam-'));
    const appData = join(root, 'appdata');
    mkdirSync(join(appData, '@helmarray'), { recursive: true });
    // A junction on Windows (needs no privilege); a plain link elsewhere.
    symlinkSync(join(appData, '@helmarray'), join(root, 'link'), 'junction');
    const env = { HELM_E2E: '1', HELM_E2E_DIR: join(root, 'link', 'app'), APPDATA: appData };
    expect(() => e2eConfig(env, { realpath: realpathSync })).toThrow('helmArray data');
  });

  it('into a folder that is not the data folder is accepted, as what it leads to', () => {
    root = mkdtempSync(join(tmpdir(), 'helm-seam-'));
    mkdirSync(join(root, 'elsewhere'));
    symlinkSync(join(root, 'elsewhere'), join(root, 'link'), 'junction');
    const env = {
      HELM_E2E: '1',
      HELM_E2E_DIR: join(root, 'link', 'app'),
      APPDATA: join(root, 'a'),
    };
    const dataDir = e2eConfig(env, { realpath: realpathSync })?.dataDir ?? '';
    expect(dataDir.endsWith('/elsewhere/app')).toBe(true);
  });
});

describe('isInside', () => {
  it('holds for the folder itself', () => {
    expect(isInside('C:/a/b', 'C:/a/b')).toBe(true);
  });

  it('holds for something below it, whatever the trailing slash', () => {
    expect(isInside('C:/a/b/c', 'C:/a/b/')).toBe(true);
  });

  it('does not hold for a sibling that starts the same', () => {
    expect(isInside('C:/a/bc', 'C:/a/b')).toBe(false);
  });

  it('does not hold for a path that climbs out with ..', () => {
    expect(isInside('C:/a/b/../c', 'C:/a/b')).toBe(false);
  });

  it('holds for a path that climbs and comes back', () => {
    expect(isInside('C:/a/b/c/../d', 'C:/a/b')).toBe(true);
  });

  it('holds across mixed slashes, dot segments and case', () => {
    expect(isInside('c:\\A\\.\\B/c', 'C:/a/b')).toBe(true);
  });

  it('does not hold for the folder that holds it', () => {
    expect(isInside('C:/a', 'C:/a/b')).toBe(false);
  });
});

describe('refuseRealHid', () => {
  it('throws under a test run', () => {
    expect(() => refuseRealHid(on)).toThrow('A test run never opens real HID devices.');
  });

  it('throws for a half-set switch too', () => {
    expect(() => refuseRealHid({ HELM_E2E: 'maybe' })).toThrow('HELM_E2E must be 1');
  });

  it('does nothing in a normal run', () => {
    expect(refuseRealHid({})).toBeUndefined();
  });
});

describe('chooseBackends', () => {
  const config = { dataDir: 'C:/t', steamDir: 'C:/t/steam' };

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
