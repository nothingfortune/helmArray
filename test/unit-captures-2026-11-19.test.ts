// The captures of 2026-11-19 (reference/unit-protocol/captures-2026-11-19.json): the Azeron app
// writing the Recon profiles to both units, and reading every slot back on reconnecting. They
// settled which Xbox stick a unit drives, how a unit stores scroll, mouse back and forward,
// the deadzone scale and the app's turbo rate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PinPlan, Signal, UnitProfile } from '@helmarray/core';
import { CYBORG2_LEFT, CYBORG2_RIGHT, DEFAULT_TURBO_INTERVAL } from '@helmarray/core';
import type { StoredSlot } from '@helmarray/azeron';
import {
  SlotStream,
  decodeStoredRecord,
  encodeRecord,
  fromHex,
  parseUnitReport,
  storedFromWritten,
  toHex,
  unitRecords,
} from '@helmarray/azeron';

interface Fixture {
  writes: {
    capture: string;
    unit: 'left' | 'right';
    slot: number;
    name: string;
    records: string[];
  }[];
  reads: { unit: 'left' | 'right'; frames: string[] }[];
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../reference/unit-protocol/captures-2026-11-19.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

/** Every slot each unit streamed, in order: a later read of a slot replaces an earlier one. */
const slots = (unit: 'left' | 'right'): StoredSlot[] =>
  fixture.reads
    .filter((r) => r.unit === unit)
    .flatMap((r) => {
      const stream = new SlotStream();
      r.frames.forEach((hex) => stream.push(parseUnitReport(fromHex(hex))));
      return stream.slots();
    });
const slotOf = (unit: 'left' | 'right', slot: number) =>
  slots(unit)
    .filter((s) => s.slot === slot)
    .at(-1);

const write = (capture: string, unit: 'left' | 'right') => {
  const found = fixture.writes.find((w) => w.capture === capture && w.unit === unit);
  if (!found) throw new Error(`no ${capture} write to the ${unit} unit`);
  return found;
};
const record = (w: Fixture['writes'][number], id: number) => {
  const hex = w.records.find((r) => fromHex(r)[1] === id);
  if (!hex) throw new Error(`no input ${id} in ${w.capture}`);
  return fromHex(hex);
};

describe('reading back', () => {
  it('reads every slot both units streamed, with nothing left undecoded', () => {
    for (const unit of ['left', 'right'] as const) {
      const all = slots(unit);
      expect(all.length).toBeGreaterThan(1);
      expect(all.flatMap((s) => s.records).filter((r) => r.kind === 'undecoded')).toEqual([]);
    }
  });

  it('reads scroll back as written: speed 20 up and speed 70 down, on both units', () => {
    for (const [unit, slot] of [
      ['left', 2],
      ['right', 1],
      ['left', 3],
    ] as const) {
      const held = slotOf(unit, slot);
      expect(held?.name).toBe('Recon L');
      const tap = (id: number) => {
        const r = held?.records.find((x) => x.id === id);
        return r?.kind === 'button' ? r.tap : undefined;
      };
      expect(tap(3)).toMatchObject({
        typeByte: 0x23,
        wheel: { x: 0, y: 1, interval: 150, yInterval: 120 },
      });
      expect(tap(4)).toMatchObject({
        typeByte: 0x23,
        wheel: { x: 0, y: -1, interval: 150, yInterval: 45 },
      });
    }
  });

  it('matches the fake unit: every record it stores for a write is what the unit stored', () => {
    const pairs = [
      [write('write-left-recon', 'left'), slotOf('left', 2)],
      [write('write-left-recon', 'right'), slotOf('right', 1)],
      [write('read-connect', 'left'), slotOf('left', 3)],
    ] as const;
    for (const [w, held] of pairs) {
      expect(w.records).toHaveLength(31);
      for (const hex of w.records) {
        const written = fromHex(hex);
        const real = held?.records.find((r) => r.id === written[1]);
        expect(
          decodeStoredRecord(storedFromWritten(written)),
          `${w.capture} input ${written[1]}`,
        ).toEqual(real);
      }
    }
  });
});

describe('what helmArray writes, against what the app wrote', () => {
  const stick = (unit: 'left' | 'right', stickPlan: UnitProfile['stick'], slot: number): string => {
    const device = unit === 'left' ? CYBORG2_LEFT : CYBORG2_RIGHT;
    const profile: UnitProfile = { deviceId: device.id, hand: unit, pins: [], stick: stickPlan };
    const s = unitRecords(profile, device).find((r) => r.kind === 'stick');
    return s ? toHex(encodeRecord(slot, s)) : '';
  };

  it('the right unit as the Xbox right stick, byte for byte', () => {
    expect(stick('right', { mode: 'pad-right', angle: 176, invertX: false }, 0)).toBe(
      toHex(record(write('write-right-rstick', 'right'), 24)),
    );
  });

  it('the right unit as the Xbox left stick, byte for byte', () => {
    expect(stick('right', { mode: 'pad-left', angle: 176, invertX: false }, 1)).toBe(
      toHex(record(write('write-right-lstick', 'right'), 24)),
    );
  });

  it('the left unit as the Xbox right stick, and with deadzones of 10 and 20 percent', () => {
    expect(stick('left', { mode: 'pad-right', angle: 0, invertX: false }, 2)).toBe(
      toHex(record(write('write-left-recon', 'left'), 24)),
    );
    expect(
      stick(
        'left',
        { mode: 'pad-right', angle: 0, invertX: false, deadzone: 10, outerEdge: 80 },
        3,
      ),
    ).toBe(toHex(record(write('read-connect', 'left'), 24)));
  });

  // A tap's block is bytes 4 to 23 of a key record; a scrolling tap's, bytes 4 to 10. The rest
  // differs only in how an empty press is written (helmArray 11, the app 2.0.3 6).
  const tapBytes = (signal: Signal, id: number, slot: number, pin: Partial<PinPlan> = {}) => {
    const pinNumber = record(write('write-left-recon', 'left'), id)[2] ?? -1;
    const name = CYBORG2_LEFT.positions.find((p) => p.pin === pinNumber)?.name ?? '';
    const plan: PinPlan = {
      control: `L.${name}`,
      position: name,
      pin: pinNumber,
      presses: { tap: signal },
      turbo: false,
      latch: false,
      ...pin,
    };
    const profile: UnitProfile = {
      deviceId: CYBORG2_LEFT.id,
      hand: 'left',
      pins: [plan],
      stick: { mode: 'keys', angle: 0, invertX: false },
    };
    const r = unitRecords(profile, CYBORG2_LEFT).find((x) => x.id === id);
    return r ? encodeRecord(slot, r) : new Uint8Array();
  };

  it('mouse back and forward, as the app sent them', () => {
    const sent = write('write-left-recon', 'left');
    expect(toHex(tapBytes({ kind: 'mouse', button: 'back' }, 1, 2).slice(0, 24))).toBe(
      toHex(record(sent, 1).slice(0, 24)),
    );
    expect(toHex(tapBytes({ kind: 'mouse', button: 'forward' }, 2, 2).slice(0, 24))).toBe(
      toHex(record(sent, 2).slice(0, 24)),
    );
  });

  it('scroll at speeds 20 and 70, as the app sent them', () => {
    const sent = write('write-left-recon', 'left');
    expect(toHex(tapBytes({ kind: 'scroll', dir: 'up', speed: 20 }, 3, 2).slice(0, 11))).toBe(
      toHex(record(sent, 3).slice(0, 11)),
    );
    expect(toHex(tapBytes({ kind: 'scroll', dir: 'down', speed: 70 }, 4, 2).slice(0, 11))).toBe(
      toHex(record(sent, 4).slice(0, 11)),
    );
  });

  it('turbo at the app’s own default rate, as the app sent it', () => {
    const sent = record(write('read-connect', 'left'), 17);
    const ours = tapBytes({ kind: 'key', code: 'T' }, 17, 3, {
      turbo: { interval: DEFAULT_TURBO_INTERVAL },
    });
    expect(toHex(ours.slice(0, 24))).toBe(toHex(sent.slice(0, 24)));
    expect(sent[23]).toBe(20);
  });
});
