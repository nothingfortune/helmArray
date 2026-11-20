import { describe, expect, it, vi } from 'vitest';
import type { Backends, Env } from './e2e-seam';
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
    expect(e2eConfig({ HELM_E2E: '0', HELM_E2E_DIR: 'C:\\Temp\\x' })).toBeNull();
  });

  it('is on with 1 and an absolute folder, and puts the fake Steam inside it', () => {
    expect(e2eConfig(on)).toEqual({
      dataDir: 'C:/Temp/helm-e2e',
      steamDir: 'C:/Temp/helm-e2e/steam',
    });
  });

  it('refuses to run without the folder', () => {
    expect(() => e2eConfig({ HELM_E2E: '1' })).toThrow('needs HELM_E2E_DIR');
  });

  it('refuses a blank folder', () => {
    expect(() => e2eConfig({ HELM_E2E: '1', HELM_E2E_DIR: '  ' })).toThrow('needs HELM_E2E_DIR');
  });

  it('refuses a folder that is not absolute', () => {
    expect(() => e2eConfig({ HELM_E2E: '1', HELM_E2E_DIR: 'data' })).toThrow('absolute folder');
  });

  const appData = 'C:\\Users\\me\\AppData\\Roaming';

  it("refuses the player's own data folder, with backslashes", () => {
    const env = {
      HELM_E2E: '1',
      APPDATA: appData,
      HELM_E2E_DIR: 'C:\\Users\\me\\AppData\\Roaming\\@helmarray\\app',
    };
    expect(() => e2eConfig(env)).toThrow("can't be inside your helmArray data");
  });

  it("refuses the player's own data folder, in any case and with forward slashes", () => {
    const env = {
      HELM_E2E: '1',
      APPDATA: appData,
      HELM_E2E_DIR: 'c:/users/ME/appdata/roaming/@helmarray',
    };
    expect(() => e2eConfig(env)).toThrow("can't be inside your helmArray data");
  });

  it('accepts a folder beside it', () => {
    const env = { HELM_E2E: '1', APPDATA: appData, HELM_E2E_DIR: `${appData}\\other` };
    expect(e2eConfig(env)).toEqual({
      dataDir: 'C:/Users/me/AppData/Roaming/other',
      steamDir: 'C:/Users/me/AppData/Roaming/other/steam',
    });
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
