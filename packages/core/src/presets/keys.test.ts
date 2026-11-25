import { describe, expect, it } from 'vitest';
import type { Game } from '../model';
import { gameKeysPreset } from './keys';

const gameWith = (modes: string[]): Game => ({
  id: 'odd',
  name: 'Odd',
  modes: modes.map((id) => ({ id, name: id })),
  actions: [],
});

describe('the game keys preset with mode ids that are also Object properties', () => {
  it('has an empty entry of its own for a mode named constructor', () => {
    const scheme = gameKeysPreset(gameWith(['default', 'constructor']));
    expect(Object.getOwnPropertyDescriptor(scheme.map, 'constructor')?.value).toEqual({});
  });

  it('has an entry of its own for a mode named __proto__, not a changed prototype', () => {
    const scheme = gameKeysPreset(gameWith(['default', '__proto__']));
    expect(Object.keys(scheme.map)).toEqual(['default', '__proto__']);
  });

  it('keeps the entries of the modes around them', () => {
    const scheme = gameKeysPreset(gameWith(['__proto__', 'a', 'toString']));
    expect(Object.keys(scheme.map)).toEqual(['__proto__', 'a', 'toString']);
  });
});

describe('the game keys preset, placing the actions with no Xbox home', () => {
  it('places a required action before one that is not, whatever the game lists first', () => {
    const game: Game = {
      id: 'odd',
      name: 'Odd',
      modes: [{ id: 'default', name: 'Default' }],
      actions: [
        {
          id: 'wave',
          name: 'Wave',
          mode: 'default',
          required: false,
          native: { key: { kind: 'key', code: 'K' } },
        },
        {
          id: 'fire',
          name: 'Fire',
          mode: 'default',
          required: true,
          native: { key: { kind: 'key', code: 'L' } },
        },
      ],
    };
    const map = gameKeysPreset(game).map['default'] ?? {};
    expect([map['R.index_1']?.tap, map['R.index_2']?.tap]).toEqual(['fire', 'wave']);
  });
});
