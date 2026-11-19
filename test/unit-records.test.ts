// The record encoder against every OBM_COPY the Azeron app was recorded sending. The fixtures
// hold the app's own export of each input and the bytes it sent for it; the adapter below
// turns the export into records (it is test code: helmArray builds records from its plans).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ProtocolError,
  encodeRecord,
  fromHex,
  hostReports,
  profileNamePayload,
  toHex,
} from '@helmarray/azeron';
import type { Export } from './azeron-export';
import { adapt } from './azeron-export';

const json = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../reference/${path}`, import.meta.url), 'utf8')) as T;

interface Copy {
  slot: number;
  input: Export;
  frames: string[];
}

describe('every OBM_COPY the app sent', () => {
  const copies = [
    ...json<{ copies: Copy[] }>('unit-protocol/write-slot3.json').copies,
    ...json<{ copies: Copy[] }>('unit-protocol/write-112.json').copies,
  ];
  const records = json<{ records: { slot: number; input: Export; wire: string }[] }>(
    'unit-protocol/onboard-112.json',
  ).records;

  it('is a good sample: every block type and stick mode, scroll, and both units', () => {
    expect(copies.length + records.length).toBe(79);
    const all = [...copies.map((c) => c.input), ...records.map((r) => r.input)].map(adapt);
    const kinds = new Set(
      all.flatMap((r) =>
        r.kind === 'stick' ? [`stick:${r.mode}`] : [r.tap.type, r.long.type, r.double.type],
      ),
    );
    expect([...kinds].sort()).toEqual(
      [
        'disabled',
        'key',
        'mouse',
        'none',
        'pad',
        'stick:keys',
        'stick:mouse',
        'stick:pad',
        'trigger',
        'wheel',
      ].sort(),
    );
  });

  it('is rebuilt byte for byte, framed as the app framed it', () => {
    for (const copy of copies) {
      const seq = fromHex(copy.frames[0] ?? '')[3] ?? 0;
      const built = hostReports('OBM_COPY', seq, encodeRecord(copy.slot, adapt(copy.input)));
      expect(built.map(toHex), `input ${copy.input.id}`).toEqual(copy.frames);
    }
  });

  it('reproduces onboard-112.json, record by record', () => {
    for (const r of records) {
      expect(toHex(encodeRecord(r.slot, adapt(r.input))), `input ${r.input.id}`).toBe(r.wire);
    }
  });
});

describe('the profile name', () => {
  const sent = [
    json<{ profileName: string }>('unit-protocol/write-slot3.json').profileName,
    ...json<{ appCopyOverExistingSlot: { profileName: string[] } }>('unit-protocol/session2.json')
      .appCopyOverExistingSlot.profileName,
  ].map((hex) => {
    const bytes = fromHex(hex);
    const payload = bytes.slice(7, 7 + (bytes[6] ?? 0));
    return {
      hex,
      seq: bytes[3] ?? 0,
      slot: payload[0] ?? 0,
      name: String.fromCharCode(...payload.slice(2)),
    };
  });

  it('is rebuilt as the app sent it', () => {
    const fits = sent.filter((s) => s.name.length <= 19);
    expect(fits.length).toBeGreaterThan(0);
    for (const s of fits) {
      expect(
        hostReports('PROFILE_NAME', s.seq, profileNamePayload(s.slot, s.name)).map(toHex),
      ).toEqual([s.hex]);
    }
  });

  it('is refused past 19 characters, though the app sent one: the unit keeps only 19', () => {
    // "Everspace 2 akimbo v10 (right)" went out whole and was stored cut short, so reading
    // the slot back would never match what was written.
    const long = sent.filter((s) => s.name.length > 19);
    expect(long.map((s) => s.name)).toEqual(['Everspace 2 akimbo v10 (right)']);
    expect(() => profileNamePayload(long[0]?.slot ?? 0, long[0]?.name ?? '')).toThrow(
      ProtocolError,
    );
  });

  it('refuses one a unit can’t keep', () => {
    expect(() => profileNamePayload(1, '')).toThrow(ProtocolError);
    expect(() => profileNamePayload(1, 'x'.repeat(20))).toThrow(ProtocolError);
    expect(() => profileNamePayload(1, 'Café')).toThrow(ProtocolError);
    expect(profileNamePayload(1, 'x'.repeat(19))).toHaveLength(21);
  });

  it('refuses a slot that would wrap or round to another slot', () => {
    expect(() => profileNamePayload(257, 'Name')).toThrow(ProtocolError);
    expect(() => profileNamePayload(1.9, 'Name')).toThrow(ProtocolError);
    expect(() => profileNamePayload(-1, 'Name')).toThrow(ProtocolError);
    expect(profileNamePayload(5, 'Name')[0]).toBe(5);
  });
});
