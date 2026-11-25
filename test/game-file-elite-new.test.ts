// Elite's own file made from the preset the game ships (reference/game-files/
// elite-KeyboardMouseOnly.binds, read only: nothing here writes to it), byte for byte: the BOM,
// the CRLF and every line that doesn't change. And the property: made, then written, then
// harvested, gives back what was written.

import { readFileSync } from 'node:fs';
import type { GameBinding, KeyCode, MouseButton, Signal } from '@helmarray/core';
import {
  ELITE_KEYS,
  ELITE_NEW_BINDS,
  ELITE_NEW_PRESET,
  harvestEliteBinds,
  newEliteBinds,
  writeEliteBinds,
} from '@helmarray/games';
import { describe, expect, it } from 'vitest';

const SHIPPED_BYTES = readFileSync(
  new URL('../reference/game-files/elite-KeyboardMouseOnly.binds', import.meta.url),
);
// As the app reads it: UTF-8, the BOM kept as the first character.
const SHIPPED = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(SHIPPED_BYTES);
const GAME = { id: 'elite', name: 'Elite Dangerous' };
const encode = (text: string) => Buffer.from(new TextEncoder().encode(text));

describe("Elite: the player's file made from the shipped preset", () => {
  const made = newEliteBinds(SHIPPED);
  const before = SHIPPED_BYTES.toString('latin1').split('\r\n');
  const after = encode(made).toString('latin1').split('\r\n');

  it('keeps the byte order mark, and the CRLF on every line', () => {
    const bytes = encode(made);
    expect({
      bom: [...bytes.subarray(0, 3)],
      lines: after.length,
      bareLf: /[^\r]\n/.test(made),
      bareCr: /\r(?!\n)/.test(made),
      grew: bytes.length - SHIPPED_BYTES.length,
    }).toEqual({
      bom: [0xef, 0xbb, 0xbf],
      lines: before.length,
      bareLf: false,
      bareCr: false,
      grew:
        '<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">'.length -
        '<Root PresetName="KeyboardMouseOnly" SortOrder="0">'.length,
    });
  });

  it('changes the root line only, to the Custom preset 4.1', () => {
    const changed = after.flatMap((line, i) => (line === before[i] ? [] : [[i, before[i], line]]));
    expect(changed).toEqual([
      [
        1,
        '<Root PresetName="KeyboardMouseOnly" SortOrder="0">',
        '<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">',
      ],
    ]);
  });

  it('holds what the shipped preset holds', () => {
    expect(harvestEliteBinds(made, GAME)).toEqual(harvestEliteBinds(SHIPPED, GAME));
  });

  it('is named as the root says: the Custom preset, version 4.1', () => {
    expect([ELITE_NEW_BINDS, ELITE_NEW_PRESET]).toEqual(['Custom.4.1.binds', 'Custom']);
  });
});

// ---- The property: made, then written, then harvested, gives back what was written ----

/** mulberry32: a small seeded generator, so every run makes the same cases. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WRITABLE_KEYS = (Object.keys(ELITE_KEYS) as KeyCode[]).filter((k) => ELITE_KEYS[k] !== null);
const MOUSE: readonly MouseButton[] = ['left', 'right', 'middle', 'back', 'forward'];

describe('Elite: made, written and harvested, over 200 seeded schemes, holds what was written', () => {
  const made = newEliteBinds(SHIPPED);
  const shipped = harvestEliteBinds(made, GAME).game;

  it('every action written reads back as written, every other as the preset has it, and the bytes stay CRLF with the BOM', () => {
    const faults: string[] = [];
    let written = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = seeded(seed * 7919);
      const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
      const rows = new Map<string, GameBinding>();
      for (let n = 1 + Math.floor(rand() * 12); n > 0; n--) {
        const action = pick(shipped.actions);
        const roll = rand();
        const signal: Signal | null =
          roll < 0.1
            ? null
            : roll < 0.25
              ? { kind: 'mouse', button: pick(MOUSE) }
              : { kind: 'key', code: pick(WRITABLE_KEYS) };
        rows.set(action.id, {
          set: 'keyboard',
          mode: action.mode,
          action: action.id,
          signal,
          native: null,
        });
      }
      let text: string;
      try {
        text = writeEliteBinds(made, [...rows.values()]);
      } catch (error) {
        faults.push(`seed ${seed}: ${String(error)}`);
        continue;
      }
      written++;
      const back = new Map(harvestEliteBinds(text, GAME).game.actions.map((a) => [a.id, a]));
      for (const action of shipped.actions) {
        const row = rows.get(action.id);
        const expected = row === undefined ? action.native?.key : (row.signal ?? undefined);
        const got = back.get(action.id)?.native?.key;
        if (JSON.stringify(got) !== JSON.stringify(expected))
          faults.push(
            `seed ${seed}: ${action.id} reads ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`,
          );
      }
      if (!text.startsWith('﻿') || /[^\r]\n/.test(text))
        faults.push(`seed ${seed}: the BOM or the CRLF was lost`);
    }
    expect({ faults, written }).toEqual({ faults: [], written: 200 });
  });
});
