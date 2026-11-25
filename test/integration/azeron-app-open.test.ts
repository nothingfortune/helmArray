// The Azeron app opens while helmArray is idle, and closes again. The watcher of the running
// programs tells the coordinator, which tells the gate, which pauses the devices service and lets
// every unit go. The units are still plugged in, so their chips stay, paused, and the pill says the
// Azeron app is open; Apply, asked in the meantime, refuses in one sentence. When the Azeron app
// closes the units are found and read again.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import { World } from './support/world';

const SENTENCE = 'Close the Azeron app first: it talks to the units too.';

describe('the Azeron app opens while helmArray is idle', () => {
  let world: World;
  let schemeId: string;
  let result: ApplyResult;
  let framesAtOpen: number;
  let opensBefore: number;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    schemeId = (await world.createKeysScheme()).id;
    opensBefore = world.hid.opened().length;
    expect(opensBefore).toBe(2);
    framesAtOpen = world.left.unit.received.length + world.right.unit.received.length;
    await world.setAzeronApp(true);
    await world.until('the units to be let go', () =>
      world.state.devices.every((chip) => chip.state === 'paused'),
    );
    const preview = await world.helm.previewApply(schemeId);
    result = await world.helm.apply(schemeId, preview.fingerprint);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('tells the windows why writing is blocked, in one sentence', () => {
    expect(world.state.writeBlock).toBe(SENTENCE);
  });

  it('keeps both units as chips, paused, and the pill says the Azeron app is open', () => {
    expect([
      world.state.devices.map((chip) => [chip.hand, chip.state]),
      world.state.sync.label,
    ]).toEqual([
      [
        ['left', 'paused'],
        ['right', 'paused'],
      ],
      'Azeron app is open',
    ]);
  });

  it('lets go of both units: every device opened was closed', () => {
    const closed = world.hid.events.filter((event) => event.op === 'close').length;
    expect(closed).toBe(opensBefore);
  });

  it('refuses Apply with the same sentence, and attempts no unit', () => {
    expect(result).toEqual({ ok: false, message: SENTENCE, units: [] });
  });

  it('sends the units nothing from the moment it opened, the preview and Apply included', () => {
    expect(world.left.unit.received.length + world.right.unit.received.length).toBe(framesAtOpen);
  });

  describe('and closes again', () => {
    beforeAll(async () => {
      await world.setAzeronApp(false);
      await world.waitForBothUnits();
    });

    it('finds and reads both units again', () => {
      expect(world.state.devices.map((chip) => [chip.hand, chip.state, chip.read])).toEqual([
        ['left', 'ready', true],
        ['right', 'ready', true],
      ]);
    });

    it('stops saying writing is blocked', () => {
      expect(world.state.writeBlock).toBeNull();
    });

    it('lets Apply through', async () => {
      const preview = await world.helm.previewApply(schemeId);
      expect((await world.helm.apply(schemeId, preview.fingerprint)).ok).toBe(true);
    });
  });
});

describe('the running programs cannot be listed', () => {
  let world: World;
  let framesBefore: number;
  let preview: ApplyPreview;
  let result: ApplyResult;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    const scheme = await world.createKeysScheme();
    framesBefore = world.left.unit.received.length + world.right.unit.received.length;
    world.processes.failing = true;
    preview = await world.helm.previewApply(scheme.id);
    result = await world.helm.apply(scheme.id, preview.fingerprint);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the drawer says helmArray cannot tell whether the Azeron app is open, and is not ready', () => {
    expect([
      preview.ready,
      preview.checks.filter((check) => !check.ok).map((check) => check.text),
    ]).toEqual([false, ["helmArray couldn't tell whether the Azeron app is open."]]);
  });

  it('Apply refuses with the same sentence', () => {
    expect(result).toEqual({
      ok: false,
      message: "helmArray couldn't tell whether the Azeron app is open.",
      units: [],
    });
  });

  it('the units are sent nothing while that is so', () => {
    expect(world.left.unit.received.length + world.right.unit.received.length).toBe(framesBefore);
  });

  it('the log says the look failed', async () => {
    const lines = await world.logLines();
    expect(lines.some((line) => line.includes("couldn't look for the Azeron app"))).toBe(true);
  });
});
