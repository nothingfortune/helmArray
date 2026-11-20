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
