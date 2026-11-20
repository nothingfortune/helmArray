import { describe, expect, it } from 'vitest';
import type { Game, Hand, Plan, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, gameKeysPreset, resolve } from '@helmarray/core';
import {
  Command,
  FakeUnit,
  UnitSession,
  encodeRecord,
  parseHostReport,
  storedFromWritten,
  unitRecords,
  verify,
} from '@helmarray/azeron';
import type { UnitRecord } from '@helmarray/azeron';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from '@helmarray/core';
import type { HeldUnit, HeldUnits, UnitsDeps } from './apply-units';
import { applyUnits, chooseSlot, previewUnits, unitSlotName, verifyUnits } from './apply-units';

// Both units are written from one plan: keys from the pool, a long press, a latch, a turbo.
const game: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    { id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true },
    { id: 'fire', name: 'Fire', mode: 'ship', role: 'combat', required: true },
    { id: 'map', name: 'Map', mode: 'ship', role: 'menu', required: false },
    { id: 'brake', name: 'Brake', mode: 'ship', role: 'movement', required: false },
  ],
  file: { format: 'elite-binds' },
};
const scheme: Scheme = {
  ...gameKeysPreset(game),
  writeGameFile: false,
  map: {
    ship: {
      'L.index_1': { tap: 'boost' },
      'L.middle_1': { tap: 'fire', long: 'map' },
      'R.index_1': { tap: 'brake' },
      'R.middle_1': { tap: 'fire', long: 'map' },
    },
  },
  behaviour: { 'L.index_1': { latch: true }, 'R.middle_1': { turbo: { interval: 40 } } },
};
const plan: Plan = resolve(scheme, game, BUILT_IN_DEVICES);
const records: Record<Hand, UnitRecord[]> = {
  left: unitRecords(plan.units.left, CYBORG2_LEFT),
  right: unitRecords(plan.units.right, CYBORG2_RIGHT),
};

const LEFT_ID = 49229; // what a FakeUnit says unless told otherwise
const RIGHT_ID = 29993;
const NAME = 'Skiff';

const WRITES: number[] = [
  Command.CHECK_PROFILE,
  Command.PROFILE_NAME,
  Command.OBM_COPY,
  Command.SWITCH_PROFILE,
  Command.DELETE_PROFILE,
];
const sent = (unit: FakeUnit) => unit.received.map((r) => parseHostReport(r).command);
const writesTo = (unit: FakeUnit) => sent(unit).filter((c) => WRITES.includes(c));
const slotsOf = (unit: FakeUnit) => [...unit.slots.keys()].sort((a, b) => a - b);
/** A slot as a unit holds it once the layout is in: every record, in the unit's own layout. */
const holding = (slot: number, hand: Hand) =>
  records[hand].map((r) => storedFromWritten(encodeRecord(slot, r)));

const STICKS = [4, 0x15, 0x28];
const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};
/** Takes the first button record's tap key off by one, as a unit that stored wrong. */
function flipOneKey(stored: Uint8Array[]) {
  const record = must(stored.find((r) => !STICKS.includes(r[4] ?? 0)));
  record[7] = (record[7] ?? 0) ^ 1;
}

/** Takes the first button record's tap key off by one in the slot, as a unit that stored wrong. */
class CorruptingUnit extends FakeUnit {
  corruptSlot: number | undefined;
  override async send(report: Uint8Array): Promise<void> {
    if (parseHostReport(report).command === Command.PROFILE_PAYLOAD_V2) this.corrupt();
    return super.send(report);
  }
  private corrupt() {
    const slot = this.corruptSlot === undefined ? undefined : this.slots.get(this.corruptSlot);
    if (!slot || slot.records.size === 0) return;
    for (const record of slot.records.values()) {
      if (STICKS.includes(record[4] ?? 0)) continue;
      record[7] = (record[7] ?? 0) ^ 1;
      return;
    }
  }
}

interface Rig {
  left: FakeUnit;
  right: FakeUnit;
  deps: UnitsDeps;
  held(): Promise<HeldUnits>;
  azeronCalls: number;
}

/** Two sessions over fake units, read as the devices service reads them on connect. */
async function rig(
  left: FakeUnit,
  right: FakeUnit,
  over: Partial<UnitsDeps> & { ids?: Partial<Record<Hand, number>> } = {},
): Promise<Rig> {
  const sessions = { left: new UnitSession(left), right: new UnitSession(right) };
  const ids = { left: LEFT_ID, right: RIGHT_ID, ...over.ids };
  for (const session of Object.values(sessions)) {
    await session.identify();
    await session.readSlots();
  }
  const state: Rig = {
    left,
    right,
    azeronCalls: 0,
    held: async () => {
      const one = async (hand: Hand): Promise<HeldUnit> => {
        const session = sessions[hand];
        const identity = await session.identify();
        return {
          deviceId: identity.deviceId,
          slots: await session.readSlots(),
          running: await session.runningSlot(),
          slotLimit: identity.slotLimit,
        };
      };
      return { left: await one('left'), right: await one('right') };
    },
    deps: {
      azeronAppRunning: () => {
        state.azeronCalls++;
        return Promise.resolve(false);
      },
      unit: (hand) => ({ session: sessions[hand], deviceId: ids[hand] }),
      name: NAME,
      ...over,
    },
  };
  // `ids` is only for the rig.
  delete (state.deps as { ids?: unknown }).ids;
  return state;
}

const twoUnits = (
  leftOptions: ConstructorParameters<typeof FakeUnit>[0] = {},
  rightOptions: ConstructorParameters<typeof FakeUnit>[0] = {},
) =>
  [
    new FakeUnit({ deviceId: LEFT_ID, chatterEvery: 3, ...leftOptions }),
    new FakeUnit({ deviceId: RIGHT_ID, chatterEvery: 3, ...rightOptions }),
  ] as const;

async function readBack(unit: FakeUnit, hand: Hand) {
  const session = new UnitSession(unit);
  await session.identify();
  const slots = await session.readSlots();
  const running = await session.runningSlot();
  return {
    slots,
    running,
    verdict: verify(records[hand], slots.find((s) => s.slot === running)?.records ?? []),
  };
}

describe('applying to the units', () => {
  it('writes, reads back, switches and deletes the rest: one slot left, running and verified', async () => {
    const [left, right] = twoUnits(
      { slots: { 0: { name: 'Default' }, 2: { name: 'Old' } }, running: 0 },
      { slots: { 0: { name: 'Default' }, 1: { name: 'Mine' }, 3: { name: 'Other' } }, running: 1 },
    );
    const { deps } = await rig(left, right);
    const result = await applyUnits(plan, deps);

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Both units now run the layout.');
    expect(result.units.map((u) => [u.hand, u.status])).toEqual([
      ['left', 'applied'],
      ['right', 'applied'],
    ]);
    // The lowest free slot, so the running one was never written over.
    expect(result.units[0]).toMatchObject({ slot: 1, wrote: true, switched: true });
    expect(result.units[0]?.deleted).toEqual([
      { slot: 0, name: 'Default' },
      { slot: 2, name: 'Old' },
    ]);
    expect(result.units[1]).toMatchObject({ slot: 2 });
    expect(result.units[1]?.verdict).toEqual({ differences: [], unchecked: [] });

    for (const [unit, hand] of [
      [left, 'left'],
      [right, 'right'],
    ] as const) {
      const after = await readBack(unit, hand);
      expect(after.slots.map((s) => [s.slot, s.name])).toEqual([[unit === left ? 1 : 2, NAME]]);
      expect(after.running).toBe(after.slots[0]?.slot);
      expect(after.verdict).toEqual({ differences: [], unchecked: [] });
    }
  });

  it('does things in the order the unit needs: write, then switch, then delete', async () => {
    const [left, right] = twoUnits({ slots: { 0: { name: 'Default' }, 2: { name: 'Old' } } });
    const { deps } = await rig(left, right);
    await applyUnits(plan, deps);
    const writes = writesTo(left);
    const last = (c: number) => writes.lastIndexOf(c);
    expect(writes.indexOf(Command.CHECK_PROFILE)).toBeLessThan(
      writes.indexOf(Command.PROFILE_NAME),
    );
    expect(last(Command.OBM_COPY)).toBeLessThan(writes.indexOf(Command.SWITCH_PROFILE));
    expect(writes.indexOf(Command.SWITCH_PROFILE)).toBeLessThan(
      writes.indexOf(Command.DELETE_PROFILE),
    );
    // Only the left unit's commands went to the left unit: the right one was done after it.
    expect(sent(left).length).toBeGreaterThan(0);
  });

  it('checks the Azeron app freshly before the write, the switch and each delete', async () => {
    const [left, right] = twoUnits({ slots: { 0: { name: 'Default' }, 2: { name: 'Old' } } });
    const state = await rig(left, right);
    await applyUnits(plan, state.deps);
    // Left: once to start, write, switch, two deletes. Right: once, write, switch, one delete.
    expect(state.azeronCalls).toBe(5 + 4);
  });

  it('leaves the right unit untouched when the Azeron app appears between the units', async () => {
    const [left, right] = twoUnits({ slots: { 0: { name: 'Default' } } });
    const state = await rig(left, right);
    const rightBefore = right.received.length;
    let appRunning = false;
    state.deps.azeronAppRunning = () => {
      // It opens the moment the left unit is done.
      if (slotsOf(left).length === 1 && left.running === slotsOf(left)[0] && left.running !== 0)
        appRunning = true;
      return Promise.resolve(appRunning);
    };
    const result = await applyUnits(plan, state.deps);

    expect(result.ok).toBe(false);
    expect(result.units.map((u) => u.status)).toEqual(['applied', 'failed']);
    expect(result.message).toBe(result.units[1]?.message);
    expect(result.message).toBe(
      'The right unit failed: the Azeron app is open, and it talks to the units too: close it first; nothing on it was changed.',
    );
    expect(right.received).toHaveLength(rightBefore);
    expect(writesTo(right)).toEqual([]);
    expect(slotsOf(right)).toEqual([0]);
  });

  it('touches nothing when the Azeron app is already open, and says so', async () => {
    const [left, right] = twoUnits();
    const state = await rig(left, right, { azeronAppRunning: () => Promise.resolve(true) });
    const before = [left.received.length, right.received.length];
    const result = await applyUnits(plan, state.deps);
    expect(result.ok).toBe(false);
    expect(result.units.map((u) => u.status)).toEqual(['failed', 'not-attempted']);
    expect([left.received.length, right.received.length]).toEqual(before);
  });

  it('treats a failed look at the running programs as a no', async () => {
    const [left, right] = twoUnits();
    const state = await rig(left, right, {
      azeronAppRunning: () => Promise.reject(new Error('tasklist failed')),
    });
    const before = left.received.length;
    const result = await applyUnits(plan, state.deps);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('could not tell whether the Azeron app is running');
    expect(left.received).toHaveLength(before);
  });

  it('refuses a unit whose id is not the one the layout is for, and sends it nothing', async () => {
    const [left, right] = twoUnits();
    // The hands were swapped: the "left" layout meets the unit that reports the right one's id.
    const state = await rig(left, right, { ids: { left: RIGHT_ID } });
    const result = await applyUnits(plan, state.deps);
    expect(result.ok).toBe(false);
    expect(result.units.map((u) => u.status)).toEqual(['failed', 'not-attempted']);
    expect(result.message).toBe(
      'The left unit failed: this is not the unit the left layout is for; nothing on it was changed.',
    );
    expect(writesTo(left)).toEqual([]);
    expect(writesTo(right)).toEqual([]);
  });

  it('does not touch the left unit when it is the right one that is wrong, once it is its turn', async () => {
    const [left, right] = twoUnits();
    const state = await rig(left, right, { ids: { right: 1234 } });
    const result = await applyUnits(plan, state.deps);
    expect(result.units.map((u) => u.status)).toEqual(['applied', 'failed']);
    expect(writesTo(right)).toEqual([]);
    expect(result.message).toContain('The right unit failed');
  });

  it('refuses a unit that is not connected', async () => {
    const [left, right] = twoUnits();
    const state = await rig(left, right);
    state.deps.unit = () => undefined;
    const result = await applyUnits(plan, state.deps);
    expect(result.message).toBe(
      'The left unit failed: it is not connected; nothing on it was changed.',
    );
    expect(result.units[1]?.status).toBe('not-attempted');
  });

  describe('a read-back that is not clean', () => {
    const writesAfterRead = (unit: FakeUnit) =>
      sent(unit).filter((c) => c === Command.SWITCH_PROFILE || c === Command.DELETE_PROFILE);

    it('is never switched to, and nothing is deleted, when the unit stored something else', async () => {
      const left = new CorruptingUnit({
        deviceId: LEFT_ID,
        slots: { 0: { name: 'Default' }, 2: { name: 'Old' } },
        running: 0,
      });
      left.corruptSlot = 1; // the new slot goes in the gap at 1
      const right = new FakeUnit({ deviceId: RIGHT_ID });
      const state = await rig(left, right);
      const result = await applyUnits(plan, state.deps);

      expect(result.ok).toBe(false);
      expect(result.units.map((u) => u.status)).toEqual(['failed', 'not-attempted']);
      expect(result.units[0]?.wrote).toBe(true);
      expect(result.units[0]?.switched).toBe(false);
      expect(result.message).toMatch(
        /^The left unit failed: slot 1 read back differently from the layout \(1 input, first: input \d+ .+\); slot 1 is not in use, the unit still runs slot 0, and nothing was deleted\.$/,
      );
      expect(writesAfterRead(left)).toEqual([]);
      expect(left.running).toBe(0);
      expect(slotsOf(left)).toEqual([0, 1, 2]);
      expect(slotsOf(right)).toEqual([0]);
      expect(writesTo(right)).toEqual([]);
    });

    it('is the same when the unit took the writes and kept none of them', async () => {
      const left = new FakeUnit({
        deviceId: LEFT_ID,
        slots: { 0: { name: 'Default' }, 1: { name: 'Old' } },
        ignore: [Command.OBM_COPY],
      });
      const state = await rig(left, new FakeUnit({ deviceId: RIGHT_ID }));
      const result = await applyUnits(plan, state.deps);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('read back differently');
      expect(writesAfterRead(left)).toEqual([]);
      expect(slotsOf(left)).toEqual([0, 1, 2]);
      expect(left.running).toBe(0);
    });
  });

  it('says what is left when the unit stops answering part way through the write', async () => {
    const left = new FakeUnit({ deviceId: LEFT_ID, slots: { 0: { name: 'Default' } } });
    const state = await rig(left, new FakeUnit({ deviceId: RIGHT_ID }));
    left.silence(Command.OBM_COPY);
    const result = await applyUnits(plan, state.deps);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('The left unit failed:');
    expect(result.message).toContain(
      'a new slot 1 may be part-written, and the unit still runs slot 0 with its other slots as they were.',
    );
    expect(sent(left)).not.toContain(Command.SWITCH_PROFILE);
    expect(sent(left)).not.toContain(Command.DELETE_PROFILE);
    expect(left.running).toBe(0);
  });

  it('stops, and says the layout is running, when a slot will not delete', async () => {
    const left = new FakeUnit({
      deviceId: LEFT_ID,
      slots: { 0: { name: 'Default' }, 2: { name: 'Old' } },
      ignore: [Command.DELETE_PROFILE],
    });
    const right = new FakeUnit({ deviceId: RIGHT_ID });
    const state = await rig(left, right);
    const result = await applyUnits(plan, state.deps);
    expect(result.ok).toBe(false);
    expect(result.units.map((u) => u.status)).toEqual(['failed', 'not-attempted']);
    expect(result.units[0]).toMatchObject({ wrote: true, switched: true, deleted: [] });
    expect(result.message).toBe(
      'The left unit failed: slot 0 ("Default") could not be deleted (Slot 0 is still there after deleting it); the unit runs the layout in slot 1, and slot 0 ("Default") and slot 2 ("Old") are still there.',
    );
    expect(left.running).toBe(1);
    expect(writesTo(right)).toEqual([]);
  });

  it('does not delete anything when the unit will not switch', async () => {
    const left = new FakeUnit({
      deviceId: LEFT_ID,
      slots: { 0: { name: 'Default' } },
      ignore: [Command.SWITCH_PROFILE],
    });
    const state = await rig(left, new FakeUnit({ deviceId: RIGHT_ID }));
    const result = await applyUnits(plan, state.deps);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      'slot 1 holds the layout, the unit still runs slot 0, and nothing was deleted.',
    );
    expect(sent(left)).not.toContain(Command.DELETE_PROFILE);
    expect(slotsOf(left)).toEqual([0, 1]);
  });

  describe('a unit that already holds exactly the plan', () => {
    it('has no changes to preview and is sent no write', async () => {
      const [left, right] = twoUnits(
        { slots: { 0: { name: 'Skiff', records: holding(0, 'left') } } },
        { slots: { 3: { name: 'Skiff', records: holding(3, 'right') } } },
      );
      const state = await rig(left, right);
      const preview = previewUnits(plan, await state.held(), { name: NAME });
      expect(preview.anyChange).toBe(false);
      expect(preview.changes).toEqual([]);
      expect(preview.left).toMatchObject({
        differs: false,
        inputsChanged: 0,
        write: null,
        deletes: [],
      });

      const before = [writesTo(left).length, writesTo(right).length];
      const result = await applyUnits(plan, state.deps);
      expect(result.ok).toBe(true);
      expect(result.message).toBe('Both units already held the layout.');
      expect(result.units.map((u) => u.status)).toEqual(['unchanged', 'unchanged']);
      expect([writesTo(left).length, writesTo(right).length]).toEqual(before);
      expect(writesTo(left)).toEqual([]);
      expect(slotsOf(right)).toEqual([3]);
    });

    it('still clears the other slots, without writing or switching', async () => {
      const [left, right] = twoUnits(
        {
          slots: { 0: { name: 'Old' }, 1: { name: 'Skiff', records: holding(1, 'left') } },
          running: 1,
        },
        { slots: { 0: { name: 'Skiff', records: holding(0, 'right') } } },
      );
      const state = await rig(left, right);
      const preview = previewUnits(plan, await state.held(), { name: NAME });
      expect(preview.anyChange).toBe(true);
      expect(preview.left.write).toBeNull();
      expect(preview.left.deletes).toEqual([{ slot: 0, name: 'Old' }]);
      expect(preview.changes).toEqual(['Delete slot 0 ("Old") from the left unit.']);

      const result = await applyUnits(plan, state.deps);
      expect(result.ok).toBe(true);
      expect(result.units[0]).toMatchObject({ status: 'unchanged', wrote: false, switched: false });
      expect(sent(left)).not.toContain(Command.OBM_COPY);
      expect(sent(left)).not.toContain(Command.SWITCH_PROFILE);
      expect(slotsOf(left)).toEqual([1]);
      expect(left.running).toBe(1);
    });

    it('is written when a single input differs', async () => {
      const stored = holding(0, 'left');
      flipOneKey(stored);
      const [left, right] = twoUnits({ slots: { 0: { name: 'Skiff', records: stored } } });
      const state = await rig(left, right);
      const preview = previewUnits(plan, await state.held(), { name: NAME });
      expect(preview.left).toMatchObject({ differs: true, inputsChanged: 1 });
      expect(preview.left.write).toEqual({ slot: 1, name: NAME, overwrites: null });
      await applyUnits(plan, state.deps);
      expect((await readBack(left, 'left')).verdict).toEqual({ differences: [], unchecked: [] });
      expect(slotsOf(left)).toEqual([1]);
    });
  });

  describe('a unit at its slot limit', () => {
    it('writes over a slot it is not running, preferring one with our name, and never the running one', async () => {
      const [left, right] = twoUnits({
        limit: 3,
        slots: { 0: { name: 'Default' }, 1: { name: NAME }, 2: { name: 'Old' } },
        running: 0,
      });
      const state = await rig(left, right);
      const preview = previewUnits(plan, await state.held(), { name: NAME });
      expect(preview.left.write).toEqual({
        slot: 1,
        name: NAME,
        overwrites: { slot: 1, name: NAME },
      });
      expect(preview.left.deletes).toEqual([
        { slot: 0, name: 'Default' },
        { slot: 2, name: 'Old' },
      ]);
      expect(preview.changes[0]).toBe(
        'Write the layout over slot 1 ("Skiff") on the left unit (it has no free slot) and switch to it.',
      );

      const result = await applyUnits(plan, state.deps);
      expect(result.ok).toBe(true);
      expect(result.units[0]).toMatchObject({ slot: 1, wrote: true, switched: true });
      expect(sent(left)).not.toContain(Command.CHECK_PROFILE); // nothing was added: it was full
      expect(slotsOf(left)).toEqual([1]);
      expect(left.running).toBe(1);
    });

    it('writes over the lowest slot it is not running when none has our name', async () => {
      const [left, right] = twoUnits({
        limit: 3,
        slots: { 0: { name: 'A' }, 1: { name: 'B' }, 2: { name: 'C' } },
        running: 0,
      });
      const state = await rig(left, right);
      const result = await applyUnits(plan, state.deps);
      expect(result.units[0]).toMatchObject({ slot: 1, status: 'applied' });
      expect(slotsOf(left)).toEqual([1]);
    });

    it('does not take the running slot for its own, even when that one has our name', async () => {
      const [left, right] = twoUnits({
        limit: 2,
        slots: { 0: { name: 'Old' }, 1: { name: NAME } },
        running: 1,
      });
      const state = await rig(left, right);
      await applyUnits(plan, state.deps);
      expect(sent(left)).not.toContain(Command.CHECK_PROFILE);
      expect(slotsOf(left)).toEqual([0]);
      expect(left.running).toBe(0);
      expect((await readBack(left, 'left')).verdict).toEqual({ differences: [], unchecked: [] });
    });

    it('refuses to write over the slot it runs when the button moved it since it was read', async () => {
      const [left, right] = twoUnits({
        limit: 2,
        slots: { 0: { name: 'Default' }, 1: { name: 'Old' } },
        running: 0,
      });
      const state = await rig(left, right);
      let calls = 0;
      state.deps.azeronAppRunning = () => {
        // The person presses the profile button just as the write is about to start (the
        // second look: the first is at the start of the unit).
        if (++calls === 2) left.running = 1;
        return Promise.resolve(false);
      };
      const result = await applyUnits(plan, state.deps);
      expect(result.ok).toBe(false);
      expect(result.message).toBe(
        'The left unit failed: it now runs slot 1 ("Old"), which was about to be written over; nothing on it was changed.',
      );
      expect(writesTo(left)).toEqual([]);
      expect(left.slots.get(1)?.name).toBe('Old');
    });

    it('has nowhere to write when its only slot is the one it runs', async () => {
      const [left, right] = twoUnits({ limit: 1, slots: { 0: { name: 'Default' } } });
      const state = await rig(left, right);
      const held = await state.held();
      const preview = previewUnits(plan, held, { name: NAME });
      expect(preview.left.problem).toBe(
        'The unit has room for 1 slot and is running the only one, so there is nowhere to write without overwriting it.',
      );
      expect(preview.problems).toHaveLength(1);
      const result = await applyUnits(plan, state.deps);
      expect(result.ok).toBe(false);
      expect(writesTo(left)).toEqual([]);
    });
  });
});

describe('previewing the units', () => {
  it('names the slot that is written and the slots that go, for each unit', async () => {
    const [left, right] = twoUnits(
      { slots: { 0: { name: 'Default' }, 2: { name: 'Old' } }, running: 2 },
      { slots: { 0: { name: '' } } },
    );
    const held = await (await rig(left, right)).held();
    const preview = previewUnits(plan, held, { name: NAME });
    expect(preview.anyChange).toBe(true);
    expect(preview.left.write).toEqual({ slot: 1, name: NAME, overwrites: null });
    expect(preview.left.deletes).toEqual([
      { slot: 0, name: 'Default' },
      { slot: 2, name: 'Old' },
    ]);
    expect(preview.changes).toEqual([
      'Write the layout into a new slot 1 ("Skiff") on the left unit and switch to it.',
      'Delete slot 0 ("Default"), slot 2 ("Old") from the left unit.',
      'Write the layout into a new slot 1 ("Skiff") on the right unit and switch to it.',
      'Delete slot 0 from the right unit.',
    ]);
    expect(preview.left.inputsChanged).toBeGreaterThan(0);
    expect(preview.problems).toEqual([]);
  });

  it('says so when a unit is not connected, and reads the other', async () => {
    const [left, right] = twoUnits();
    const held = await (await rig(left, right)).held();
    const preview = previewUnits(plan, { right: held.right }, { name: NAME });
    expect(preview.left).toMatchObject({
      connected: false,
      problem: 'The left unit is not connected.',
    });
    expect(preview.right.connected).toBe(true);
    expect(preview.problems).toEqual(['The left unit is not connected.']);
  });

  it('sends nothing to a unit', async () => {
    const [left, right] = twoUnits();
    const state = await rig(left, right);
    const held = await state.held();
    const before = [left.received.length, right.received.length];
    previewUnits(plan, held);
    verifyUnits(plan, held);
    expect([left.received.length, right.received.length]).toEqual(before);
  });
});

describe('the verdict for the sync pill', () => {
  it('is clean for a unit running the plan, a difference for one that is not, null for none', async () => {
    const stored = holding(0, 'left');
    const wrong = holding(0, 'right');
    flipOneKey(wrong);
    const [left, right] = twoUnits(
      { slots: { 0: { name: 'Skiff', records: stored } } },
      { slots: { 0: { name: 'Skiff', records: wrong } } },
    );
    const held = await (await rig(left, right)).held();
    expect(verifyUnits(plan, held).left).toEqual({ differences: [], unchecked: [] });
    expect(verifyUnits(plan, held).right?.differences).toHaveLength(1);
    expect(verifyUnits(plan, { left: held.left })).toMatchObject({ right: null });
  });

  it('compares the slot the unit runs, not the one that holds the layout', async () => {
    const [left, right] = twoUnits(
      {
        slots: { 0: { name: 'Other' }, 1: { name: 'Skiff', records: holding(1, 'left') } },
        running: 0,
      },
      { slots: { 0: { name: 'Skiff', records: holding(0, 'right') } } },
    );
    const held = await (await rig(left, right)).held();
    expect(verifyUnits(plan, held).left?.differences.length).toBeGreaterThan(0);
  });

  it('shows every input as missing when the running slot is not listed', async () => {
    const [left, right] = twoUnits();
    const held = await (await rig(left, right)).held();
    const verdict = verifyUnits(plan, { left: { ...must(held.left), running: 5 } }).left;
    expect(verdict?.differences.length).toBe(records.left.length);
  });
});

describe('choosing a slot', () => {
  const slot = (n: number, name = '') => ({ slot: n, name, settings: null, records: [] });
  it('takes the lowest free slot, which after a deletion is the gap', () => {
    expect(chooseSlot([slot(0), slot(2)], 0, 6, NAME)).toEqual({
      ok: true,
      slot: 1,
      overwrites: null,
    });
    expect(chooseSlot([slot(0), slot(1)], 1, 6, NAME)).toEqual({
      ok: true,
      slot: 2,
      overwrites: null,
    });
  });
  it('never offers the slot being run', () => {
    for (const running of [0, 1, 2]) {
      const choice = chooseSlot([slot(0, NAME), slot(1, NAME), slot(2, NAME)], running, 3, NAME);
      expect(choice).toMatchObject({ ok: true });
      expect(choice.ok && choice.slot).not.toBe(running);
    }
  });
});

describe('the slot name', () => {
  it('is plain ASCII of at most 19 characters, and never empty', () => {
    expect(unitSlotName('Elite Dangerous')).toBe('Elite Dangerous');
    expect(unitSlotName('Everspace 2: Zerstörer der Welten')).toBe('Everspace 2: Zerstr');
    expect(unitSlotName('x'.repeat(40))).toHaveLength(19);
    expect(unitSlotName('日本語')).toBe('helmArray');
    expect(unitSlotName(undefined)).toBe('helmArray');
  });
});
