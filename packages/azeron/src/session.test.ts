import { describe, expect, it } from 'vitest';
import type { Game, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, CYBORG2_LEFT, gameKeysPreset, resolve } from '@helmarray/core';
import { FakeUnit, storedFromWritten } from './fake';
import { unitRecords } from './profile';
import type { ButtonRecord, UnitRecord } from './records';
import { encodeRecord } from './records';
import { Command, ProtocolError, SENDABLE, parseHostReport } from './report';
import { UnitError, UnitSession } from './session';
import { decodeStoredRecord } from './stored';
import { verify } from './verify';

// A plan for the left unit: keys from the pool, a long press, a latch, a turbo and a scroll.
const game: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    { id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true },
    { id: 'fire', name: 'Fire', mode: 'ship', role: 'combat', required: true },
    { id: 'map', name: 'Map', mode: 'ship', role: 'menu', required: false },
    {
      id: 'zoom',
      name: 'Zoom',
      mode: 'ship',
      role: 'ability',
      required: false,
      native: { key: { kind: 'scroll', dir: 'up', speed: 33 } },
    },
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
      'L.ring_1': { tap: 'zoom' },
    },
  },
  behaviour: { 'L.index_1': { latch: true }, 'L.middle_1': { turbo: { interval: 40 } } },
};
const records = unitRecords(resolve(scheme, game, BUILT_IN_DEVICES).units.left, CYBORG2_LEFT);

// This package's tests get no DOM or Node types; the timer is the platform's own.
const later = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown })
  .setTimeout;

async function ready(unit: FakeUnit) {
  const session = new UnitSession(unit);
  const identity = await session.identify();
  await session.readSlots();
  return { session, identity };
}
const UNIT_ID = 49229; // what a FakeUnit says unless told otherwise
const commands = (unit: FakeUnit) => unit.received.map((r) => parseHostReport(r).command);

describe('a session with a unit', () => {
  it('identifies it: firmware, its id, how many slots it holds and which it runs', async () => {
    const { identity } = await ready(new FakeUnit({ deviceId: 29993, running: 0 }));
    expect(identity).toEqual({ firmware: 112, deviceId: 29993, slotLimit: 6, runningSlot: 0 });
  });

  it.each([
    ['firmware it was never checked against', { firmware: 113 }],
    ['a keypad that is not a Cyborg II', { keypadType: 7 }],
  ])('refuses %s', async (_, options) => {
    await expect(new UnitSession(new FakeUnit(options)).identify()).rejects.toThrow(UnitError);
  });

  it('writes, reads back with no differences, switches, and clears the other slots', async () => {
    const unit = new FakeUnit({
      slots: { 0: { name: 'Default' }, 2: { name: 'Old' } },
      running: 0,
      chatterEvery: 3,
    });
    const { session } = await ready(unit);

    const result = await session.write(1, 'Skiff', records, UNIT_ID);
    expect(result.written).toBe(records.length);
    expect(result.differences).toEqual([]);
    expect(result.nameDiffers).toBe(false);
    // Scroll reads back and is compared like any key since the 2026-11-19 captures.
    expect(result.unchecked).toEqual([]);

    await session.switchTo(1);
    expect(unit.running).toBe(1);
    await session.deleteSlot(0);
    const after = await session.deleteSlot(2);
    expect(after.map((s) => [s.slot, s.name])).toEqual([[1, 'Skiff']]);

    // Only commands the app was seen to send went out, and a new slot was added first.
    const sent = commands(unit);
    const names = Object.entries(Command);
    expect(sent.every((c) => SENDABLE.some((n) => names.find(([k]) => k === n)?.[1] === c))).toBe(
      true,
    );
    expect(sent.indexOf(Command.CHECK_PROFILE)).toBeGreaterThanOrEqual(0);
    expect(sent.indexOf(Command.CHECK_PROFILE)).toBeLessThan(sent.indexOf(Command.PROFILE_NAME));
  });

  it('writes over a slot it has without adding one', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'Default' }, 1: { name: 'Skiff' } } });
    const { session } = await ready(unit);
    expect((await session.write(1, 'Skiff', records, UNIT_ID)).differences).toEqual([]);
    expect(commands(unit)).not.toContain(Command.CHECK_PROFILE);
  });

  describe('a layout meant for another unit', () => {
    const writing: number[] = [Command.CHECK_PROFILE, Command.PROFILE_NAME, Command.OBM_COPY];
    const sentWrites = (unit: FakeUnit) => commands(unit).filter((c) => writing.includes(c));

    it('is refused with a plain sentence, and not one report is sent', async () => {
      const unit = new FakeUnit({ deviceId: 29993, slots: { 0: { name: 'A' } } });
      const { session } = await ready(unit);
      const before = unit.received.length;
      const failure = await session.write(0, 'Skiff', records, 49229).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(UnitError);
      expect(failure).toMatchObject({ kind: 'refused', written: 0 });
      expect((failure as UnitError).message).toBe(
        'This layout is for another unit; nothing was written.',
      );
      expect(unit.received).toHaveLength(before);
      expect(sentWrites(unit)).toEqual([]);
      expect(unit.slots.get(0)?.name).toBe('A');
      // The same check would catch a send: the matching write does grow what the unit received.
      await session.write(0, 'Skiff', records, 29993);
      expect(unit.received.length).toBeGreaterThan(before);
      expect(sentWrites(unit).length).toBeGreaterThan(0);
    });

    it('is written when the unit is the one it is for', async () => {
      const unit = new FakeUnit({ deviceId: 29993, slots: { 0: { name: 'A' } } });
      const { session } = await ready(unit);
      const result = await session.write(0, 'Skiff', records, 29993);
      expect(result.differences).toEqual([]);
      expect(unit.slots.get(0)?.name).toBe('Skiff');
    });

    it('is refused after a replug put another unit there, until it is asked for by its own id', async () => {
      let current = new FakeUnit({ deviceId: 49229, slots: { 0: { name: 'Left' } } });
      const session = new UnitSession({
        send: (r) => current.send(r),
        receive: () => current.receive(),
      });
      await session.identify();
      await session.readSlots();
      await session.write(0, 'Skiff', records, 49229);

      const replugged = new FakeUnit({ deviceId: 29993, slots: { 0: { name: 'Right' } } });
      current = replugged;
      await session.identify();
      await session.readSlots();
      const before = replugged.received.length;
      await expect(session.write(0, 'Skiff', records, 49229)).rejects.toMatchObject({
        kind: 'refused',
      });
      expect(replugged.received).toHaveLength(before);
      expect(replugged.slots.get(0)?.name).toBe('Right');

      await session.write(0, 'Skiff', records, 29993);
      expect(replugged.slots.get(0)?.name).toBe('Skiff');
    });

    it('is refused when the unit identified last was refused, whoever the layout is for', async () => {
      const unit = new FakeUnit({ firmware: 113 });
      const session = new UnitSession(unit);
      await expect(session.identify()).rejects.toThrow(UnitError);
      await expect(session.write(0, 'Skiff', records, 49229)).rejects.toThrow(
        'Identify the unit first',
      );
    });
  });

  it('puts a new slot only at the lowest free number, and sends nothing otherwise', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' }, 2: { name: 'B' } } });
    const { session } = await ready(unit);
    const before = unit.received.length;
    await expect(session.write(3, 'Skiff', records, UNIT_ID)).rejects.toThrow(
      'A new slot goes at 1',
    );
    await expect(session.write(1, 'x'.repeat(20), records, UNIT_ID)).rejects.toThrow(ProtocolError);
    expect(unit.received.length).toBe(before);
  });

  it('stops at a lost answer to a record, says how far it got, and never sends it again', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } }, silentOn: [Command.OBM_COPY] });
    const { session } = await ready(unit);
    const failure = await session.write(0, 'Skiff', records, UNIT_ID).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnitError);
    expect(failure).toMatchObject({ kind: 'no-answer', written: 0 });
    expect(String(failure)).toContain('Write it again');
    expect(commands(unit).filter((c) => c === Command.OBM_COPY)).toHaveLength(1);
  });

  it('after a lost answer to a record, writing the layout again lands it intact', async () => {
    const unit = new FakeUnit({
      slots: { 0: { name: 'A' } },
      loseFirstAnswerTo: [Command.OBM_COPY],
    });
    const { session } = await ready(unit);
    await expect(session.write(0, 'Skiff', records, UNIT_ID)).rejects.toThrow(UnitError);
    await session.readSlots();
    const again = await session.write(0, 'Skiff', records, UNIT_ID);
    expect(again.differences).toEqual([]);
    expect(again.written).toBe(records.length);
  });

  it(
    'gives up on an answer at its deadline, however much else the unit says',
    { timeout: 3000 },
    async () => {
      const chatter = new Uint8Array(64);
      chatter.set([2, 0, Command.BUTTON_POSITION, 1, 1, 1, 2, 1, 1]);
      const chattering = {
        send: async () => undefined,
        // A report every millisecond, for as long as anyone listens.
        receive: () => new Promise<Uint8Array>((done) => later(() => done(chatter), 1)),
      };
      const started = Date.now();
      const session = new UnitSession(chattering, undefined, 30);
      await expect(session.identify()).rejects.toMatchObject({ kind: 'no-answer' });
      expect(Date.now() - started).toBeLessThan(1000);
    },
  );

  it('says every input went in when only the read-back fails', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } } });
    const { session } = await ready(unit);
    unit.silence(Command.PROFILE_PAYLOAD_V2);
    const failure = await session.write(0, 'Skiff', records, UNIT_ID).catch((e: unknown) => e);
    expect(failure).toMatchObject({ kind: 'no-answer', written: records.length });
    expect(String(failure)).toContain(`All ${records.length} inputs were written`);
    expect(unit.slots.get(0)?.records.size).toBe(records.length);
  });

  it('carries on when the unit added a slot but its answer was lost', async () => {
    const unit = new FakeUnit({
      slots: { 0: { name: 'A' } },
      loseFirstAnswerTo: [Command.CHECK_PROFILE],
    });
    const { session } = await ready(unit);
    const result = await session.write(1, 'Skiff', records, UNIT_ID);
    expect(result.differences).toEqual([]);
    expect(commands(unit).filter((c) => c === Command.CHECK_PROFILE)).toHaveLength(1);
  });

  it('stops when the unit didn’t add the slot, sending nothing else', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } }, silentOn: [Command.CHECK_PROFILE] });
    const { session } = await ready(unit);
    await expect(session.write(1, 'Skiff', records, UNIT_ID)).rejects.toThrow(
      'nothing else was sent',
    );
    expect(commands(unit)).not.toContain(Command.PROFILE_NAME);
  });

  it('reads the slots afresh after a failed write before doing anything else', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } }, silentOn: [Command.OBM_COPY] });
    const { session } = await ready(unit);
    await expect(session.write(0, 'Skiff', records, UNIT_ID)).rejects.toThrow(UnitError);
    await expect(session.deleteSlot(0)).rejects.toThrow('Read the unit');
  });

  it('does nothing to a unit it refused, whatever is asked after', async () => {
    const unit = new FakeUnit({ firmware: 113, slots: { 0: { name: 'A' }, 1: { name: 'B' } } });
    const session = new UnitSession(unit);
    await expect(session.identify()).rejects.toThrow(UnitError);
    await expect(session.readSlots()).rejects.toThrow('Identify the unit first');
    await expect(session.deleteSlot(1)).rejects.toThrow('Identify the unit first');
    await expect(session.switchTo(1)).rejects.toThrow('Identify the unit first');
    await expect(session.write(1, 'Skiff', records, UNIT_ID)).rejects.toThrow(
      'Identify the unit first',
    );
    expect(commands(unit).every((c) => c === Command.FIRMWARE_VERSION)).toBe(true);
  });

  it('forgets the slots when a read after a delete fails, so nothing is written on them', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' }, 1: { name: 'B' }, 2: { name: 'C' } } });
    const { session } = await ready(unit);
    unit.silence(Command.PROFILE_PAYLOAD_V2);
    await expect(session.deleteSlot(2)).rejects.toThrow(UnitError);
    expect(unit.slots.has(2)).toBe(false);
    const before = unit.received.length;
    await expect(session.write(2, 'Skiff', records, UNIT_ID)).rejects.toThrow('Read the unit');
    expect(unit.received.length).toBe(before);
  });

  it('forgets the slots on identifying again, as after a replug', async () => {
    const { session } = await ready(new FakeUnit({ slots: { 0: { name: 'A' } } }));
    await session.identify();
    await expect(session.write(0, 'Skiff', records, UNIT_ID)).rejects.toThrow('Read the unit');
  });

  it('keeps the written count when the read-back can’t be decoded', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } } });
    let corrupt = false;
    const transport = {
      send: (r: Uint8Array) => unit.send(r),
      receive: async () => {
        const r = await unit.receive();
        if (corrupt && r && r[2] === Command.PROFILE_PAYLOAD_V2) r[10] = (r[10] ?? 0) ^ 0xff;
        return r;
      },
    };
    const session = new UnitSession(transport);
    await session.identify();
    await session.readSlots();
    const write = session.write(0, 'Skiff', records, UNIT_ID);
    corrupt = true;
    const failure = await write.catch((e: unknown) => e);
    expect(failure).toMatchObject({ written: records.length });
    expect(String(failure)).toContain('reading the slot back failed');
  });

  it('passes over a late answer, never taking it for the next one', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' }, 1: { name: 'B' } }, running: 1 });
    const { session } = await ready(unit);
    const stale = new Uint8Array(64);
    stale.set([1, 0, Command.HARDWARE_PROFILE_INDEX, 9, 1, 1, 1, 0]); // an old answer: slot 0
    unit.inject(stale);
    expect(await session.runningSlot()).toBe(1);
  });

  it('says so when the unit doesn’t run the slot it was told to', async () => {
    const { session } = await ready(
      new FakeUnit({
        slots: { 0: { name: 'A' }, 1: { name: 'B' } },
        running: 0,
        ignore: [Command.SWITCH_PROFILE],
      }),
    );
    await expect(session.switchTo(1)).rejects.toThrow('the unit runs 0');
  });

  it('says so when a deleted slot is still there', async () => {
    const { session } = await ready(
      new FakeUnit({
        slots: { 0: { name: 'A' }, 1: { name: 'B' } },
        running: 0,
        ignore: [Command.DELETE_PROFILE],
      }),
    );
    await expect(session.deleteSlot(1)).rejects.toThrow('still there');
  });

  it('reads the slots to see a delete whose answer was lost, and finds it done', async () => {
    const unit = new FakeUnit({
      slots: { 0: { name: 'A' }, 1: { name: 'B' } },
      running: 0,
      loseFirstAnswerTo: [Command.DELETE_PROFILE],
    });
    const { session } = await ready(unit);
    expect((await session.deleteSlot(1)).map((s) => s.slot)).toEqual([0]);
    expect(commands(unit).filter((c) => c === Command.DELETE_PROFILE)).toHaveLength(1);
  });

  it('refuses a new slot when every slot is in use', async () => {
    const slots = Object.fromEntries([0, 1, 2].map((n) => [n, { name: `S${n}` }]));
    const { session } = await ready(new FakeUnit({ slots, limit: 3 }));
    await expect(session.write(3, 'Skiff', records, UNIT_ID)).rejects.toThrow(
      'All 3 slots are in use',
    );
  });

  it('reads the slots again when the stream stops part way', async () => {
    const unit = new FakeUnit({
      slots: { 0: { name: 'A' } },
      loseFirstAnswerTo: [Command.PROFILE_PAYLOAD_V2],
    });
    const session = new UnitSession(unit, undefined, 30);
    await session.identify();
    expect((await session.readSlots()).map((s) => s.name)).toEqual(['A']);
    expect(commands(unit).filter((c) => c === Command.PROFILE_PAYLOAD_V2)).toHaveLength(2);
  });

  it('refuses to delete the slot it runs, or its last', async () => {
    const { session } = await ready(
      new FakeUnit({ slots: { 0: { name: 'A' }, 1: { name: 'B' } }, running: 1 }),
    );
    await expect(session.deleteSlot(1)).rejects.toThrow('switch away from it first');
    await session.deleteSlot(0);
    await expect(session.deleteSlot(1)).rejects.toThrow('only slot');
  });

  it('refuses to write or delete before the slots are read', async () => {
    const session = new UnitSession(new FakeUnit());
    await session.identify();
    await expect(session.write(0, 'Skiff', records, UNIT_ID)).rejects.toThrow('Read the unit');
    await expect(session.deleteSlot(0)).rejects.toThrow('Read the unit');
  });
});

describe('the fake unit misbehaves as the real ones do', () => {
  const host = (command: number, payload: number[]) => {
    const r = new Uint8Array(64);
    r.set([0, payload.length, command, 1, 1, 1, payload.length, ...payload]);
    return r;
  };

  it('answers CHECK_PROFILE only for the lowest free number', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' }, 2: { name: 'B' } } });
    await unit.send(host(Command.CHECK_PROFILE, [3]));
    expect(await unit.receive()).toBeNull();
    await unit.send(host(Command.CHECK_PROFILE, [1]));
    expect((await unit.receive())?.[2]).toBe(Command.CHECK_PROFILE);
  });

  it('answers REQUEST_PROFILE with the slot it runs, whatever is asked', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'Zero' }, 1: { name: 'One' } }, running: 1 });
    await unit.send(host(Command.REQUEST_PROFILE, [0]));
    const first = await unit.receive();
    expect(String.fromCharCode(...(first?.slice(7 + 8, 7 + 8 + 3) ?? []))).toBe('One');
  });
});

describe('reading back', () => {
  const stored = (record: UnitRecord) =>
    decodeStoredRecord(storedFromWritten(encodeRecord(1, record)));
  const button = records.find(
    (r): r is ButtonRecord => r.kind === 'button' && r.tap.type === 'key',
  );

  it('finds nothing when the slot holds what was written', () => {
    expect(verify(records, records.map(stored)).differences).toEqual([]);
  });

  it('names each field that differs, in plain words', () => {
    if (!button) throw new Error('no key button');
    const held = stored(button);
    if (held.kind !== 'button') throw new Error('not a button');
    held.tap.keys[0] = 0xf004;
    held.longDelay = 400;
    expect(verify([button], [held]).differences.map((d) => d.what)).toEqual([
      'tap keys',
      'long press delay',
    ]);
  });

  it('says an input is missing rather than pass it', () => {
    expect(verify(records, []).differences).toHaveLength(records.length);
  });
});
