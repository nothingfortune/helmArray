import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnitSession, unitRecords } from '@helmarray/azeron';
import type { Game, Plan, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, CYBORG2_LEFT, blankKeysScheme, resolve, unitOf } from '@helmarray/core';
import type { E2eControl } from './e2e-fakes';
import { fakeBackends } from './e2e-fakes';
import { E2E_UNIT_IDS } from './e2e-seam';
import type { Backends } from './e2e-seam';
import { findUnits, openUnit } from './hid-transport';

// A junction on Windows (it needs no privilege), a symlink everywhere else.
const linkKind = process.platform === 'win32' ? 'junction' : 'dir';

let root: string;
let backends: Backends;
let control: E2eControl;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-e2e-fakes-'));
  backends = fakeBackends({ dataDir: root, steamDir: join(root, 'steam') });
  control = backends.control as E2eControl;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A session over one of the fake units, by way of the same path the app takes: find, then open. */
async function sessionOn(index: number): Promise<UnitSession> {
  const units = await findUnits(backends.hid);
  const found = units[index];
  if (found === undefined) throw new Error('no such fake unit');
  return new UnitSession(await openUnit(backends.hid, found.path));
}

describe('the fake units behind the fake HID backend', () => {
  it('lists the two units and not the keyboard interface listed beside them', async () => {
    expect(await findUnits(backends.hid)).toHaveLength(2);
  });

  it('lists nothing for any other vendor and product, as hidapi does', async () => {
    expect(await backends.hid.enumerate(0x06a3, 0x0763)).toEqual([]);
  });

  it('reports each unit as who the e2e run says it is', async () => {
    const left = await (await sessionOn(0)).identify();
    const right = await (await sessionOn(1)).identify();
    expect([left.deviceId, right.deviceId]).toEqual([E2E_UNIT_IDS.left, E2E_UNIT_IDS.right]);
  });

  it('refuses a path nobody listed', async () => {
    await expect(backends.hid.open('nothing-here')).rejects.toThrow('nothing at nothing-here');
  });

  it('refuses a write that is not report id 0 and a whole frame', async () => {
    const [unit] = await findUnits(backends.hid);
    const device = await backends.hid.open(unit?.path ?? '');
    await expect(device.write(Uint8Array.of(1, 2, 3))).rejects.toThrow(
      'A write is report id 0 and then a whole frame.',
    );
  });

  it('keeps a record of every device it was asked to open', async () => {
    await sessionOn(1);
    expect(control.opened()).toHaveLength(1);
  });
});

describe('what the control says the units hold', () => {
  it('starts with the slots the e2e run counts on, and nothing on a button', () => {
    expect(control.units().map((u) => [u.hand, u.slots.map((s) => [s.name, s.taps])])).toEqual([
      ['left', [['Default', []]]],
      [
        'right',
        [
          ['Default', []],
          ['Old layout', []],
        ],
      ],
    ]);
  });

  it('counts the reports a unit was sent, and then the ones a session sent', async () => {
    const before = control.units()[0]?.reportsReceived;
    await (await sessionOn(0)).identify();
    expect(control.units()[0]?.reportsReceived).toBeGreaterThan(before ?? 0);
  });

  const game: Game = {
    id: 'skiff',
    name: 'Skiff',
    modes: [{ id: 'ship', name: 'Ship' }],
    actions: [{ id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true }],
    file: { format: 'elite-binds' },
  };
  const scheme: Scheme = {
    ...blankKeysScheme(game),
    writeGameFile: false,
    map: { ship: { 'L.index_1': { tap: 'boost' } } },
  };
  const plan: Plan = resolve(scheme, game, BUILT_IN_DEVICES);

  it('counts no write while a unit is only read', async () => {
    const session = await sessionOn(0);
    await session.identify();
    await session.readSlots();
    const unit = control.units()[0];
    expect([(unit?.reportsReceived ?? 0) > 0, unit?.writesReceived]).toEqual([true, 0]);
  });

  it('shows a key written to a button as the unit stores it, in the slot it runs', async () => {
    const session = await sessionOn(0);
    const identity = await session.identify();
    await session.readSlots();
    await session.write(
      1,
      'Skiff',
      unitRecords(unitOf(plan, 'left'), CYBORG2_LEFT),
      identity.deviceId,
    );
    await session.switchTo(1);
    const unit = control.units()[0];
    expect([
      unit?.running,
      unit?.slots.find((s) => s.slot === 1)?.taps.length,
      (unit?.writesReceived ?? 0) > 0,
    ]).toEqual([1, 1, true]);
  });
});

describe('the fake list of running programs', () => {
  it('lists the usual programs, and no Azeron app', async () => {
    expect(await backends.listProcesses()).toEqual(['explorer.exe', 'helmArray.exe']);
  });

  it('lists what a test sets, after the usual ones, and takes it back', async () => {
    control.setProcesses(['Azeron Software.exe']);
    const during = await backends.listProcesses();
    control.setProcesses([]);
    expect([during, await backends.listProcesses()]).toEqual([
      ['explorer.exe', 'helmArray.exe', 'Azeron Software.exe'],
      ['explorer.exe', 'helmArray.exe'],
    ]);
  });
});

describe('the fake Steam', () => {
  it('says Steam is in the temp folder', async () => {
    expect(await backends.steam.readRegistrySteamPath()).toBe(join(root, 'steam'));
  });

  it('reads a file and lists a folder inside it', async () => {
    await mkdir(join(root, 'steam', 'steamapps'), { recursive: true });
    await writeFile(join(root, 'steam', 'steamapps', 'a.acf'), 'text');
    const read = await backends.steam.readFile(join(root, 'steam', 'steamapps', 'a.acf'));
    expect([
      new TextDecoder().decode(read),
      await backends.steam.listDir(join(root, 'steam', 'steamapps')),
    ]).toEqual(['text', ['a.acf']]);
  });

  it('reads nothing outside it, though the file is there', async () => {
    await writeFile(join(root, 'outside.txt'), 'not steam');
    expect(await backends.steam.readFile(join(root, 'outside.txt'))).toBeUndefined();
  });

  it('lists nothing outside it, though the folder is there', async () => {
    expect(await backends.steam.listDir(root)).toBeUndefined();
  });

  it('reads nothing that a .. climbs out to', async () => {
    await writeFile(join(root, 'outside.txt'), 'not steam');
    await mkdir(join(root, 'steam'), { recursive: true });
    expect(await backends.steam.readFile(join(root, 'steam', '..', 'outside.txt'))).toBeUndefined();
  });

  it('reads nothing through a link inside it that leads out', async () => {
    await mkdir(join(root, 'steam'), { recursive: true });
    await mkdir(join(root, 'elsewhere'));
    await writeFile(join(root, 'elsewhere', 'secret.txt'), 'not steam');
    await symlink(join(root, 'elsewhere'), join(root, 'steam', 'link'), linkKind);
    expect(
      await backends.steam.readFile(join(root, 'steam', 'link', 'secret.txt')),
    ).toBeUndefined();
  });

  it('lists nothing through a link inside it that leads out', async () => {
    await mkdir(join(root, 'steam'), { recursive: true });
    await mkdir(join(root, 'elsewhere'));
    await symlink(join(root, 'elsewhere'), join(root, 'steam', 'link'), linkKind);
    expect(await backends.steam.listDir(join(root, 'steam', 'link'))).toBeUndefined();
  });

  it('says a missing file is missing', async () => {
    expect(await backends.steam.readFile(join(root, 'steam', 'nope.txt'))).toBeUndefined();
  });

  it('says a missing folder is missing', async () => {
    expect(await backends.steam.listDir(join(root, 'steam', 'nope'))).toBeUndefined();
  });
});
