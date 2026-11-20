import { afterEach, describe, expect, it } from 'vitest';
import type { Action, Game } from '../model';
import { xboxControllerPreset } from './xbox';

const action = (id: string, mode: string, pad: 'A' | 'B'): Action => ({
  id,
  name: id,
  mode,
  role: 'combat',
  required: false,
  native: { pad },
});

const gameWith = (modes: string[], actions: Action[]): Game => ({
  id: 'odd',
  name: 'Odd',
  modes: modes.map((id) => ({ id, name: id })),
  actions,
});

describe('the Xbox controller preset with mode ids that are also Object properties', () => {
  // The unfixed code looked a mode up with `map[action.mode]` on a plain object, so an action
  // whose mode is not the game's, named `constructor`, found Object itself and the preset wrote
  // a button onto it. Clean up whatever a failing run leaves on the global.
  afterEach(() => {
    Reflect.deleteProperty(Object, 'L.index_3');
    Reflect.deleteProperty(Object.prototype, 'L.index_3');
  });

  it('ignores an action whose mode the game does not have, even one named like an Object property', () => {
    const scheme = xboxControllerPreset(
      gameWith(['default'], [action('stray', 'constructor', 'A')]),
    );
    expect({
      mapKeys: Object.keys(scheme.map),
      onObject: Object.hasOwn(Object, 'L.index_3'),
    }).toEqual({ mapKeys: ['default'], onObject: false });
  });

  it('places an action in a mode named constructor, as that mode own entry', () => {
    const scheme = xboxControllerPreset(
      gameWith(['default', 'constructor'], [action('wheel', 'constructor', 'A')]),
    );
    expect(Object.getOwnPropertyDescriptor(scheme.map, 'constructor')?.value).toEqual({
      'L.index_3': { tap: 'wheel' },
    });
  });

  it('keeps a mode named __proto__ as an own entry of the map and its actions in it', () => {
    const scheme = xboxControllerPreset(
      gameWith(['default', '__proto__'], [action('wheel', '__proto__', 'A')]),
    );
    expect(
      Object.entries(scheme.map).map(([mode, byControl]) => [mode, Object.keys(byControl)]),
    ).toEqual([
      ['default', []],
      ['__proto__', ['L.index_3']],
    ]);
  });
});
