// The fake unit against a real one: the app wrote the all-fields test profile into slot 3
// (write-slot3) and read it straight back (read-slot3). What the fake stores for each written
// record must be what the real unit gave back.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromHex, storedFromWritten, toHex } from '@helmarray/azeron';

const json = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../reference/${path}`, import.meta.url), 'utf8')) as T;

const payloadOf = (frames: string[]) =>
  Uint8Array.from(frames.map(fromHex).flatMap((f) => [...f.slice(7, 7 + (f[6] ?? 0))]));

/** The records a stream carried, as stored: page 0, then page 1, by input id. */
function storedRecords(frames: string[]): Map<number, Uint8Array> {
  const pages = new Map<string, number[]>();
  for (const hex of frames) {
    const f = fromHex(hex);
    const p = f.slice(7, 7 + (f[6] ?? 0));
    const [a = 0, b = 0, c = 0] = p;
    if (b !== 2) continue;
    pages.set(`${a}:${c}`, [...(pages.get(`${a}:${c}`) ?? []), ...p.slice(4)]);
  }
  const ids = new Set([...pages.keys()].map((k) => Number(k.split(':')[0])));
  return new Map(
    [...ids].map((id) => [
      id,
      Uint8Array.from([...(pages.get(`${id}:0`) ?? []), ...(pages.get(`${id}:1`) ?? [])]),
    ]),
  );
}

describe('the fake unit stores what a real unit stored', () => {
  const written = json<{ copies: { input: { id: number }; frames: string[] }[] }>(
    'unit-protocol/write-slot3.json',
  ).copies;
  const stored = storedRecords(json<{ frames: string[] }>('unit-protocol/read-slot3.json').frames);

  it('for every button record, byte for byte (the last two bytes are padding)', () => {
    const buttons = written.filter((c) => fromHex(c.frames[0] ?? '')[1] === 68);
    expect(buttons.length).toBe(30);
    for (const copy of buttons) {
      const real = stored.get(copy.input.id) ?? new Uint8Array();
      expect(
        toHex(storedFromWritten(payloadOf(copy.frames)).slice(0, 66)),
        `input ${copy.input.id}`,
      ).toBe(toHex(real.slice(0, 66)));
    }
  });

  it('for the stick, but for the two quirks no one has explained', () => {
    const copy = written.find((c) => fromHex(c.frames[0] ?? '')[1] === 134);
    const fake = storedFromWritten(payloadOf(copy?.frames ?? []));
    const real = stored.get(copy?.input.id ?? -1) ?? new Uint8Array();
    // The cones went out as 41 and 49 and came back as 49 and 45 (unit-protocol.md, "Not known
    // yet"); and which of bits 0–2 holds combined, hold trigger and angle lock is unknown.
    const masked = (b: Uint8Array) => {
      const copyOf = Uint8Array.from(b.slice(0, 132));
      copyOf[15] = 0;
      copyOf[16] = 0;
      copyOf[118] = (copyOf[118] ?? 0) & ~0x07;
      return toHex(copyOf);
    };
    expect(masked(fake)).toBe(masked(real));
    expect((fake[118] ?? 0) & 0x07).toBe(7);
    expect((real[118] ?? 0) & 0x07).toBe(7);
  });
});
