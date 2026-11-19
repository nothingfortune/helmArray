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

    const result = await session.write(1, 'Skiff', records);
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
    expect(sent.indexOf(Command.CHECK_PROFILE)).toBeLessThan(sent.indexOf(Command.PROFILE_NAME));
  });

  it('writes over a slot it has without adding one', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'Default' }, 1: { name: 'Skiff' } } });
    const { session } = await ready(unit);
    expect((await session.write(1, 'Skiff', records)).differences).toEqual([]);
    expect(commands(unit)).not.toContain(Command.CHECK_PROFILE);
  });

  it('puts a new slot only at the lowest free number, and sends nothing otherwise', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' }, 2: { name: 'B' } } });
    const { session } = await ready(unit);
    const before = unit.received.length;
    await expect(session.write(3, 'Skiff', records)).rejects.toThrow('A new slot goes at 1');
    await expect(session.write(1, 'x'.repeat(20), records)).rejects.toThrow(ProtocolError);
    expect(unit.received.length).toBe(before);
  });

  it('says how far a write got when the unit stops answering, after one more try', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } }, silentOn: [Command.OBM_COPY] });
    const { session } = await ready(unit);
    const failure = await session.write(0, 'Skiff', records).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnitError);
    expect(failure).toMatchObject({ kind: 'no-answer', written: 0 });
    expect(commands(unit).filter((c) => c === Command.OBM_COPY)).toHaveLength(2);
  });

  it('sends a record again whole when an answer is lost, and it lands intact', async () => {
    const unit = new FakeUnit({
      slots: { 0: { name: 'A' } },
      loseFirstAnswerTo: [Command.OBM_COPY],
    });
    const { session } = await ready(unit);
    const result = await session.write(0, 'Skiff', records);
    expect(result.differences).toEqual([]);
    expect(result.written).toBe(records.length);
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
    const failure = await session.write(0, 'Skiff', records).catch((e: unknown) => e);
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
    const result = await session.write(1, 'Skiff', records);
    expect(result.differences).toEqual([]);
    expect(commands(unit).filter((c) => c === Command.CHECK_PROFILE)).toHaveLength(1);
  });

  it('stops when the unit didn’t add the slot, sending nothing else', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } }, silentOn: [Command.CHECK_PROFILE] });
    const { session } = await ready(unit);
    await expect(session.write(1, 'Skiff', records)).rejects.toThrow('nothing else was sent');
    expect(commands(unit)).not.toContain(Command.PROFILE_NAME);
  });

  it('reads the slots afresh after a failed write before doing anything else', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } }, silentOn: [Command.OBM_COPY] });
    const { session } = await ready(unit);
    await expect(session.write(0, 'Skiff', records)).rejects.toThrow(UnitError);
    await expect(session.deleteSlot(0)).rejects.toThrow('Read the unit');
  });

  it('does nothing to a unit it refused, whatever is asked after', async () => {
    const unit = new FakeUnit({ firmware: 113, slots: { 0: { name: 'A' }, 1: { name: 'B' } } });
    const session = new UnitSession(unit);
    await expect(session.identify()).rejects.toThrow(UnitError);
    await expect(session.readSlots()).rejects.toThrow('Identify the unit first');
    await expect(session.deleteSlot(1)).rejects.toThrow('Identify the unit first');
    await expect(session.switchTo(1)).rejects.toThrow('Identify the unit first');
    await expect(session.write(1, 'Skiff', records)).rejects.toThrow('Identify the unit first');
    expect(commands(unit).every((c) => c === Command.FIRMWARE_VERSION)).toBe(true);
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
    await expect(session.write(0, 'Skiff', records)).rejects.toThrow('Read the unit');
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
