// The edges of a session: what it refuses before it has identified a unit, which failures it
// repeats and which it lets through, how it treats a clock and a chatty unit, what it traces and
// what it says. Found by mutation testing: these are the changes no other test noticed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeUnit } from './fake';
import type { ButtonRecord, UnitRecord } from './records';
import { Command, parseHostReport } from './report';
import type { Transport } from './session';
import { UnitError, UnitSession } from './session';

const none = { keys: [], mods: [], hold: false, holdTime: 0, turbo: false, turboInterval: 0 };
const button = (id: number, pin: number): ButtonRecord => ({
  kind: 'button',
  id,
  pinOne: pin,
  pinTwo: 255,
  tap: { type: 'key', ...none, keys: [0xf014] },
  long: { type: 'none', ...none },
  double: { type: 'none', ...none },
  longDelay: 500,
  doubleDelay: 150,
});
const layout: UnitRecord[] = [button(1, 2), button(2, 3)];
const UNIT_ID = 49229; // what a FakeUnit says unless told otherwise
const SHORT = 30; // how long a test waits for an answer that is not coming

interface Hooks {
  /** Called with every report sent, before the unit sees it; may throw to fail the send. */
  beforeSend?: (report: Uint8Array) => void;
  /** Sees every report the unit gives back, and may change or replace it. */
  onReceive?: (report: Uint8Array | null, timeoutMs: number) => Uint8Array | null;
}
const through = (unit: FakeUnit, hooks: Hooks): Transport => ({
  send: async (report) => {
    hooks.beforeSend?.(report);
    await unit.send(report);
  },
  receive: async (timeoutMs) => {
    const report = await unit.receive();
    return hooks.onReceive ? hooks.onReceive(report, timeoutMs) : report;
  },
});
const failing = (command: number, error: Error): Hooks => ({
  beforeSend: (report) => {
    if (parseHostReport(report).command === command) throw error;
  },
});
const sentOf = (unit: FakeUnit, command: number) =>
  unit.received.filter((r) => parseHostReport(r).command === command).length;
const changed = (report: Uint8Array, edit: (copy: Uint8Array) => void) => {
  const copy = Uint8Array.from(report);
  edit(copy);
  return copy;
};

async function ready(unit: FakeUnit, trace: (line: string) => void = () => undefined) {
  const session = new UnitSession(unit, trace, SHORT);
  await session.identify();
  await session.readSlots();
  return session;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('an error from a unit', () => {
  it('is named a UnitError, and carries its kind and how far a write got', () => {
    const error = new UnitError('refused', 'No.', 2);
    expect([error.name, String(error), error.kind, error.written]).toEqual([
      'UnitError',
      'UnitError: No.',
      'refused',
      2,
    ]);
  });
});

describe('before a unit is identified', () => {
  it.each<[string, (s: UnitSession) => Promise<unknown>]>([
    ['reading its slots', (s) => s.readSlots()],
    ['writing a layout', (s) => s.write(0, 'Skiff', layout, UNIT_ID)],
    ['switching slot', (s) => s.switchTo(0)],
    ['deleting a slot', (s) => s.deleteSlot(0)],
  ])('%s is refused', async (_, act) => {
    const unit = new FakeUnit();
    await expect(act(new UnitSession(unit))).rejects.toThrow('Identify the unit first.');
    expect(unit.received).toEqual([]);
  });
});

describe('what a unit says about itself', () => {
  it('too little in its details to hold an id is refused as unsupported', async () => {
    const unit = new FakeUnit();
    const short = through(unit, {
      onReceive: (r) => (r?.[2] === Command.KEYPAD_DETAILS ? changed(r, (c) => (c[6] = 18)) : r),
    });
    await expect(new UnitSession(short).identify()).rejects.toMatchObject({
      kind: 'unsupported',
      message: 'The unit’s details were too short to hold its id.',
    });
  });

  it('no slot number for the one it runs is refused', async () => {
    const unit = new FakeUnit();
    const silent = through(unit, {
      onReceive: (r) =>
        r?.[2] === Command.HARDWARE_PROFILE_INDEX ? changed(r, (c) => (c[6] = 0)) : r,
    });
    await expect(new UnitSession(silent).identify()).rejects.toMatchObject({
      kind: 'refused',
      message: 'The unit didn’t say which slot it runs.',
    });
  });
});

describe('a slot the unit does not hold', () => {
  it('cannot be switched to, and nothing is sent', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' }, 1: { name: 'B' } } });
    const session = await ready(unit);
    const before = unit.received.length;
    await expect(session.switchTo(5)).rejects.toThrow('The unit has no slot 5.');
    expect(unit.received).toHaveLength(before);
  });

  it('cannot be deleted, and nothing is sent', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' }, 1: { name: 'B' } } });
    const session = await ready(unit);
    const before = unit.received.length;
    await expect(session.deleteSlot(5)).rejects.toThrow('The unit has no slot 5.');
    expect(unit.received).toHaveLength(before);
  });
});

describe('which failures are let through and which are tried again', () => {
  it.each<[string, Error]>([
    ['an Error', new Error('the cable came out')],
    ['a UnitError of another kind', new UnitError('refused', 'the cable came out')],
  ])('%s while deleting is not taken for a lost answer', async (_, error) => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' }, 1: { name: 'B' } }, running: 0 });
    const broken = new UnitSession(
      through(unit, failing(Command.DELETE_PROFILE, error)),
      undefined,
      SHORT,
    );
    await broken.identify();
    await broken.readSlots();
    await expect(broken.deleteSlot(1)).rejects.toThrow('the cable came out');
  });

  it.each<[string, Error]>([
    ['an Error', new Error('the cable came out')],
    ['a UnitError of another kind', new UnitError('refused', 'the cable came out')],
  ])('%s while reading the slots is not read again', async (_, error) => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } } });
    const session = new UnitSession(
      through(unit, failing(Command.PROFILE_PAYLOAD_V2, error)),
      undefined,
      SHORT,
    );
    await session.identify();
    await expect(session.readSlots()).rejects.toThrow('the cable came out');
  });

  it.each<[string, Error]>([
    ['an Error', new Error('the cable came out')],
    ['a UnitError of another kind', new UnitError('refused', 'the cable came out')],
  ])('%s while adding a slot is not taken for a lost answer', async (_, error) => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } } });
    const session = new UnitSession(
      through(unit, failing(Command.CHECK_PROFILE, error)),
      undefined,
      SHORT,
    );
    await session.identify();
    await session.readSlots();
    await expect(session.write(1, 'Skiff', layout, UNIT_ID)).rejects.toThrow('the cable came out');
    expect(sentOf(unit, Command.PROFILE_NAME)).toBe(0);
  });

  it.each<[string, Error]>([
    ['an Error', new Error('the cable came out')],
    ['a UnitError of another kind', new UnitError('refused', 'the cable came out')],
  ])('%s on a command that may be repeated is not repeated', async (_, error) => {
    const unit = new FakeUnit();
    let attempts = 0;
    const session = new UnitSession(
      through(unit, {
        beforeSend: (report) => {
          if (parseHostReport(report).command !== Command.FIRMWARE_VERSION) return;
          attempts++;
          throw error;
        },
      }),
      undefined,
      SHORT,
    );
    await expect(session.identify()).rejects.toThrow('the cable came out');
    expect(attempts).toBe(1);
  });

  it('a lost answer to a command that may be repeated is repeated once, and said so', async () => {
    const unit = new FakeUnit({ loseFirstAnswerTo: [Command.FIRMWARE_VERSION] });
    const lines: string[] = [];
    await ready(unit, (line) => lines.push(line));
    expect(sentOf(unit, Command.FIRMWARE_VERSION)).toBe(2);
    expect(lines).toContain('no answer to FIRMWARE_VERSION; trying once more');
  });

  it('two lost answers are one repeat and then a refusal', async () => {
    const unit = new FakeUnit({ silentOn: [Command.FIRMWARE_VERSION] });
    await expect(new UnitSession(unit, undefined, SHORT).identify()).rejects.toMatchObject({
      kind: 'no-answer',
    });
    expect(sentOf(unit, Command.FIRMWARE_VERSION)).toBe(2);
  });
});

describe('what a session says it is doing', () => {
  it('traces a delete whose answer was lost, and a read that began again', async () => {
    const unit = new FakeUnit({
      slots: { 0: { name: 'A' }, 1: { name: 'B' } },
      running: 0,
      loseFirstAnswerTo: [Command.DELETE_PROFILE, Command.PROFILE_PAYLOAD_V2],
    });
    const lines: string[] = [];
    const session = new UnitSession(unit, (line) => lines.push(line), SHORT);
    await session.identify();
    await session.readSlots();
    await session.deleteSlot(1);
    expect(lines).toContain('the slots stopped coming part way; reading them again');
    expect(lines).toContain('no answer to deleting slot 1; reading the slots to see');
  });

  it('traces a new slot whose answer was lost', async () => {
    const unit = new FakeUnit({
      slots: { 0: { name: 'A' } },
      loseFirstAnswerTo: [Command.CHECK_PROFILE],
    });
    const lines: string[] = [];
    const session = await ready(unit, (line) => lines.push(line));
    await session.write(1, 'Skiff', layout, UNIT_ID);
    expect(lines).toContain('no answer to adding slot 1; reading the slots to see');
  });

  it('traces a write it refused, naming both units', async () => {
    const lines: string[] = [];
    const session = await ready(new FakeUnit({ deviceId: 29993 }), (line) => lines.push(line));
    await session.write(0, 'Skiff', layout, 49229).catch(() => undefined);
    expect(lines).toContain('write refused: layout is for unit 49229, this is 29993');
  });

  it('traces every report out and in, a report cut to its header and 16 bytes of payload', async () => {
    const lines: string[] = [];
    await ready(new FakeUnit({ slots: { 0: { name: 'A' } } }), (line) => lines.push(line));
    expect(lines.slice(0, 2)).toEqual([
      '→ FIRMWARE_VERSION 00000500010100',
      '← FIRMWARE_VERSION 020005010101027008',
    ]);
  });

  it('traces a long report as its header and its first 16 payload bytes, no more', async () => {
    const lines: string[] = [];
    const session = await ready(new FakeUnit({ slots: { 0: { name: 'A' } } }), (line) =>
      lines.push(line),
    );
    await session.write(0, 'Skiff', layout, UNIT_ID);
    const out = lines.find((line) => line.startsWith('→ OBM_COPY'));
    expect(out).toMatch(/^→ OBM_COPY 00440b[0-9a-f]{2}020139[0-9a-f]{32}$/);
  });

  it('traces a report it could not read, and goes on to the answer', async () => {
    const unit = new FakeUnit();
    let junked = false;
    const lines: string[] = [];
    const session = new UnitSession(
      through(unit, {
        onReceive: (report, timeoutMs) => {
          if (timeoutMs === 0 || junked) return report;
          junked = true;
          return new Uint8Array(10);
        },
      }),
      (line) => lines.push(line),
      SHORT,
    );
    await session.identify();
    expect(lines).toContain('← (unreadable, passed over) 00000000000000');
  });
});

describe('a write that goes wrong, said in words', () => {
  it('names the input that did not go in, and how many there were', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } }, silentOn: [Command.OBM_COPY] });
    const session = await ready(unit);
    await expect(session.write(0, 'Skiff', layout, UNIT_ID)).rejects.toThrow(
      'The unit didn’t answer OBM_COPY. Input 1 (1 of 2) didn’t go in; the slot holds a part-written layout. Write it again.',
    );
  });

  it('says the slot is not there to read back when the unit does not list it', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } } });
    const other = new FakeUnit({ slots: { 5: { name: 'Z' } } });
    let swapped = false;
    const session = new UnitSession(
      {
        send: async (report) => {
          const { command } = parseHostReport(report);
          const readBack =
            command === Command.PROFILE_PAYLOAD_V2 || command === Command.PROFILE_INPUT_PIECE;
          await (swapped && readBack ? other : unit).send(report);
          if (command === Command.OBM_COPY) swapped = true;
        },
        receive: async () => (await unit.receive()) ?? other.receive(),
      },
      undefined,
      SHORT,
    );
    await session.identify();
    await session.readSlots();
    await expect(session.write(0, 'Skiff', layout, UNIT_ID)).rejects.toMatchObject({
      kind: 'refused',
      written: 2,
      message: "All 2 inputs were sent, but slot 0 isn't there to read back.",
    });
  });

  it('says the name differs when the unit kept another', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } }, ignore: [Command.PROFILE_NAME] });
    const result = await (await ready(unit)).write(0, 'Skiff', layout, UNIT_ID);
    expect([result.nameDiffers, result.stored.name]).toEqual([true, 'A']);
  });
});

describe('how a session waits', () => {
  it('does not take an answer to another report of the same command for its own', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } } });
    const wrongSeq = through(unit, {
      onReceive: (r) =>
        r?.[2] === Command.OBM_COPY ? changed(r, (c) => (c[3] = ((c[3] ?? 0) + 1) % 255)) : r,
    });
    const session = new UnitSession(wrongSeq, undefined, SHORT);
    await session.identify();
    await session.readSlots();
    await expect(session.write(0, 'Skiff', layout, UNIT_ID)).rejects.toMatchObject({
      kind: 'no-answer',
      written: 0,
    });
  });

  it('passes over at most 256 reports before it asks, however much a unit says', async () => {
    const chatter = new Uint8Array(64);
    chatter.set([2, 0, Command.BUTTON_POSITION, 1, 1, 1, 2, 1, 1]);
    let passedOver = 0;
    let atFirstSend: number | undefined;
    const session = new UnitSession(
      {
        send: async () => {
          atFirstSend ??= passedOver;
        },
        receive: async (timeoutMs) => {
          if (timeoutMs > 0) return null;
          passedOver++;
          return chatter;
        },
      },
      undefined,
      200,
    );
    await expect(session.identify()).rejects.toMatchObject({ kind: 'no-answer' });
    expect(atFirstSend).toBe(256);
  });

  it('listens for nothing at all when it has no time to wait', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    let listened = 0;
    const session = new UnitSession(
      {
        send: async () => undefined,
        receive: async () => {
          listened++;
          return null;
        },
      },
      undefined,
      0,
    );
    await expect(session.identify()).rejects.toMatchObject({ kind: 'no-answer' });
    expect(listened).toBe(0);
  });
});

describe('more of what a session lets through, and says', () => {
  it.each<[string, Error]>([
    ['an Error', new Error('the cable came out')],
    ['a UnitError of another kind', new UnitError('refused', 'the cable came out')],
  ])('%s while reading the slots is tried once, not twice', async (_, error) => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } } });
    let attempts = 0;
    const session = new UnitSession(
      through(unit, {
        beforeSend: (report) => {
          if (parseHostReport(report).command !== Command.PROFILE_PAYLOAD_V2) return;
          attempts++;
          throw error;
        },
      }),
      undefined,
      SHORT,
    );
    await session.identify();
    await expect(session.readSlots()).rejects.toThrow('the cable came out');
    expect(attempts).toBe(1);
  });

  it('traces a report it passed over before asking', async () => {
    const unit = new FakeUnit({ slots: { 0: { name: 'A' } } });
    const lines: string[] = [];
    const session = await ready(unit, (line) => lines.push(line));
    const stale = new Uint8Array(64);
    stale.set([1, 0, Command.HARDWARE_PROFILE_INDEX, 9, 1, 1, 1, 0]);
    unit.inject(stale);
    await session.runningSlot();
    expect(lines).toContain('← (before asking, passed over) 01000e0901010100');
  });
});
