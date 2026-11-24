// A game's data, and the action-deleted check, against the hostile ids of editor-fixture.ts: modes
// and actions named `__proto__`, `constructor`, `toString` and `hasOwnProperty`.
import { BUILT_IN_DEVICES, gameKeysPreset, gameProblem, resolve } from '@helmarray/core';
import type { Game, Scheme } from '@helmarray/core';
import { describe, expect, it } from 'vitest';
import { assign } from './editor-model';
import { HOSTILE_IDS, hostileGame, hostileOneMode } from './editor-fixture';
import { addAction, addMode, newGame } from './game-model';

describe('saving a game with hostile ids', () => {
  // The engine keeps such ids as entries, and the Game screen never makes one. A game sent to be
  // saved, or read from a file, with one is refused in a sentence rather than taken.
  it('refuses a mode named like an inherited property', () => {
    expect([gameProblem(hostileGame), gameProblem(hostileOneMode)]).toEqual([
      "The mode Proto has an id helmArray can't use.",
      "The mode Proto has an id helmArray can't use.",
    ]);
  });

  it('refuses an action named like one, in a mode that is fine', () => {
    const game: Game = {
      ...hostileGame,
      modes: [{ id: 'default', name: 'Default' }],
      actions: hostileGame.actions.map((a) => ({ ...a, mode: 'default' })),
    };
    expect(gameProblem(game)).toBe("Interact has an id helmArray can't use.");
  });

  it('never makes one: a mode or an action named so gets an id of its own', () => {
    const start = newGame('Hostile', []);
    const ids = HOSTILE_IDS.map((name) => [
      addMode(start, name).id,
      addAction(start, 'default', name).id,
    ]);
    expect(ids).toEqual([
      ['proto', 'proto'],
      ['constructor_2', 'constructor_2'],
      ['tostring', 'tostring'],
      ['hasownproperty', 'hasownproperty'],
    ]);
  });
});

describe('the action-deleted check, on hostile ids', () => {
  /** Interact (`__proto__`) on index 1 and Reload (`constructor`) on index 2, in mode `__proto__`. */
  const scheme = (): Scheme => {
    const at = (s: Scheme, control: string, action: string) =>
      assign(s, { mode: '__proto__', control, press: 'tap' }, action, hostileGame);
    return at(
      at(gameKeysPreset(hostileGame), 'L.index_1', '__proto__'),
      'L.index_2',
      'constructor',
    );
  };
  const deleted = (s: Scheme, g: Game) =>
    resolve(s, g, BUILT_IN_DEVICES)
      .findings.filter((f) => f.rule === 'action-deleted')
      .map((f) => [f.control, f.mode, f.action]);
  const without = (id: string): Game => ({
    ...hostileGame,
    actions: hostileGame.actions.filter((a) => a.id !== id),
  });

  it('finds nothing while the game has every action', () => {
    expect(deleted(scheme(), hostileGame)).toEqual([]);
  });

  it('finds an action named __proto__ deleted, in the mode named __proto__', () => {
    expect(deleted(scheme(), without('__proto__'))).toEqual([
      ['L.index_1', '__proto__', '__proto__'],
    ]);
  });

  it('finds an action named constructor deleted', () => {
    expect(deleted(scheme(), without('constructor'))).toEqual([
      ['L.index_2', '__proto__', 'constructor'],
    ]);
  });

  it('finds the actions of a mode named __proto__ gone with it, with no mode', () => {
    const noProto: Game = {
      ...hostileGame,
      modes: hostileGame.modes.filter((m) => m.id !== '__proto__'),
      actions: hostileGame.actions.filter((a) => a.mode !== '__proto__'),
    };
    expect(deleted(scheme(), noProto)).toEqual([
      ['L.index_1', undefined, '__proto__'],
      ['L.index_2', undefined, 'constructor'],
    ]);
  });

  it('leaves every object’s prototype as it was', () => {
    resolve(scheme(), without('__proto__'), BUILT_IN_DEVICES);
    expect([Object.keys(Object.prototype), typeof ({} as { toString: unknown }).toString]).toEqual([
      [],
      'function',
    ]);
  });
});
