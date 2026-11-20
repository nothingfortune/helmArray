// The built-in Cyborg II tables against the press-tested pin maps they were copied from.
// A typo in a pin becomes a wrong key on the hardware, so every pin is checked.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AzeronDevice } from '@helmarray/core';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from '@helmarray/core';

interface Reference {
  positions: Map<string, { pin: number; pinTwo?: number }>;
  unknownPins: number[];
  stickInvertX: boolean | undefined;
}

// Just enough YAML for these files: `positions:` holds `  name:` blocks of `    key: value`.
function readReference(file: string): Reference {
  const lines = readFileSync(new URL(`../reference/devices/${file}`, import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, ''))
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  const positions: Reference['positions'] = new Map();
  const unknownPins: number[] = [];
  let section = '';
  let current: { pin: number; pinTwo?: number } | null = null;
  let stickInvertX: boolean | undefined;
  for (const line of lines) {
    const top = /^(\w+):\s*(.*)$/.exec(line);
    if (top) {
      section = top[1] ?? '';
      if (section === 'stick_invert_x') stickInvertX = top[2] === 'true';
      continue;
    }
    if (section === 'unknown_pins') {
      const item = /^\s+-\s+(\d+)$/.exec(line);
      if (item) unknownPins.push(Number(item[1]));
    } else if (section === 'positions') {
      const name = /^ {2}(\w+):$/.exec(line);
      if (name?.[1]) {
        current = { pin: Number.NaN };
        positions.set(name[1], current);
        continue;
      }
      const field = /^ {4}(pin|pin_two):\s*(\d+)$/.exec(line);
      if (field && current) {
        if (field[1] === 'pin') current.pin = Number(field[2]);
        else current.pinTwo = Number(field[2]);
      }
    }
  }
  return { positions, unknownPins, stickInvertX };
}

describe.each([
  ['cyborg2-left.yaml', CYBORG2_LEFT],
  ['cyborg2-right.yaml', CYBORG2_RIGHT],
] as [string, AzeronDevice][])('%s', (file, unit) => {
  const reference = readReference(file);

  it('was read: 31 positions', () => {
    expect(reference.positions.size).toBe(31);
  });

  it('every position and pin matches the built-in table', () => {
    const builtIn = new Map(
      unit.positions.map((p) => [
        p.name,
        p.pinTwo === undefined ? { pin: p.pin } : { pin: p.pin, pinTwo: p.pinTwo },
      ]),
    );
    expect(builtIn).toEqual(reference.positions);
  });

  it('the dead pins match', () => {
    expect([...unit.unknownPins]).toEqual(reference.unknownPins);
  });

  it('the stick X fact matches, where the map states one', () => {
    // A map that states no fact has nothing to compare, so it is compared with itself.
    expect(unit.stick.invertX).toBe(reference.stickInvertX ?? unit.stick.invertX);
  });
});

it('the right map states the stick X fact', () => {
  expect(readReference('cyborg2-right.yaml').stickInvertX).toBe(false);
});
