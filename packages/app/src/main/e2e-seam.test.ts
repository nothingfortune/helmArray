import { describe, expect, it, vi } from 'vitest';
import type { Backends } from './e2e-seam';
import { chooseBackends, e2eConfig, isInside, refuseRealHid } from './e2e-seam';

const backends = (name: string): Backends => ({
  hid: { enumerate: () => Promise.resolve([]), open: () => Promise.reject(new Error(name)) },
  listProcesses: () => Promise.resolve([name]),
  steam: {
    readRegistrySteamPath: () => Promise.resolve(undefined),
    readFile: () => Promise.resolve(undefined),
    listDir: () => Promise.resolve(undefined),
  },
});

describe('e2eConfig', () => {
  it('is off when the switch is unset, empty or 0', () => {
    expect(e2eConfig({})).toBeNull();
    expect(e2eConfig({ HELM_E2E: '' })).toBeNull();
    expect(e2eConfig({ HELM_E2E: '0', HELM_E2E_DIR: 'C:\\Temp\\x' })).toBeNull();
  });

  it('is on with 1 and an absolute folder, and puts the fake Steam inside it', () => {
    expect(e2eConfig({ HELM_E2E: '1', HELM_E2E_DIR: 'C:\\Temp\\helm-e2e\\' })).toEqual({
      dataDir: 'C:/Temp/helm-e2e',
      steamDir: 'C:/Temp/helm-e2e/steam',
    });
  });

  it('stops the app rather than fall back to the real thing when it is set up wrong', () => {
    expect(() => e2eConfig({ HELM_E2E: '1' })).toThrow(/HELM_E2E_DIR/);
    expect(() => e2eConfig({ HELM_E2E: '1', HELM_E2E_DIR: '  ' })).toThrow(/HELM_E2E_DIR/);
    expect(() => e2eConfig({ HELM_E2E: '1', HELM_E2E_DIR: 'data' })).toThrow(/absolute/);
    expect(() => e2eConfig({ HELM_E2E: 'true', HELM_E2E_DIR: 'C:\\Temp\\x' })).toThrow(/must be 1/);
  });

  it("refuses the player's own data folder, in any case and either slash", () => {
    const env = { HELM_E2E: '1', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
    for (const dir of [
      'C:\\Users\\me\\AppData\\Roaming\\@helmarray\\app',
      'c:/users/ME/appdata/roaming/@helmarray',
    ]) {
      expect(() => e2eConfig({ ...env, HELM_E2E_DIR: dir })).toThrow(/your helmArray data/);
    }
    expect(
      e2eConfig({ ...env, HELM_E2E_DIR: 'C:\\Users\\me\\AppData\\Roaming\\other' }),
    ).not.toBeNull();
  });
});

describe('isInside', () => {
  it('is the folder itself or something below it, not a sibling with the same start', () => {
    expect(isInside('C:/a/b', 'C:/a/b')).toBe(true);
    expect(isInside('C:/a/b/c', 'C:/a/b/')).toBe(true);
    expect(isInside('C:/a/bc', 'C:/a/b')).toBe(false);
  });
});

describe('refuseRealHid', () => {
  it('throws under a test run and does nothing otherwise', () => {
    expect(() => refuseRealHid({ HELM_E2E: '1', HELM_E2E_DIR: 'C:/t' })).toThrow(
      /never opens real/,
    );
    expect(() => refuseRealHid({ HELM_E2E: 'maybe' })).toThrow();
    expect(() => refuseRealHid({})).not.toThrow();
  });
});

describe('chooseBackends', () => {
  it('never so much as builds the real backends under a test run', async () => {
    const real = vi.fn(() => {
      throw new Error('real backends were built');
    });
    const fake = vi.fn(() => backends('fake'));
    const config = { dataDir: 'C:/t', steamDir: 'C:/t/steam' };
    const chosen = await chooseBackends(config, { real, fake });
    expect(await chosen.listProcesses()).toEqual(['fake']);
    expect(real).not.toHaveBeenCalled();
    expect(fake).toHaveBeenCalledWith(config);
  });

  it('builds only the real ones in a normal run', async () => {
    const real = vi.fn(() => backends('real'));
    const fake = vi.fn(() => backends('fake'));
    const chosen = await chooseBackends(null, { real, fake });
    expect(await chosen.listProcesses()).toEqual(['real']);
    expect(fake).not.toHaveBeenCalled();
  });
});
