import { gameKeysPreset, gameProblem, helldivers2 } from '@helmarray/core';
import type { Game, Scheme } from '@helmarray/core';
import { describe, expect, it } from 'vitest';
import {
  actionsIn,
  addAction,
  addMode,
  canStartFrom,
  deleteAction,
  deleteMode,
  loadedOf,
  moveAction,
  moveMode,
  newGame,
  record,
  referencedIds,
  renameGame,
  renameMode,
  setDefaultKey,
  setDefaultPad,
  updateAction,
} from './game-model';
import { startHistory, undo } from './editor-model';

const two: Game = {
  id: 'rover',
  name: 'Rover',
  modes: [
    { id: 'foot', name: 'On foot' },
    { id: 'drive', name: 'Driving' },
  ],
  actions: [
    { id: 'jump', name: 'Jump', mode: 'foot', role: 'movement', required: true },
    { id: 'honk', name: 'Honk', mode: 'drive', role: 'travel', required: false },
    { id: 'fire', name: 'Fire', mode: 'foot', role: 'combat', required: false },
    { id: 'duck', name: 'Duck', mode: 'foot', role: 'movement', required: false },
  ],
};

const ids = (game: Game, mode: string) => actionsIn(game, mode).map((a) => a.id);

describe('newGame', () => {
  it('is a game with the name, one mode and no actions, that can be saved', () => {
    const game = newGame('Everspace 2', []);
    expect([game, gameProblem(game)]).toEqual([
      {
        id: 'everspace_2',
        name: 'Everspace 2',
        modes: [{ id: 'default', name: 'Default' }],
        actions: [],
      },
      null,
    ]);
  });

  it('keeps the Steam app id of a game set up from Steam', () => {
    expect(newGame('Everspace 2', [], 1128920).steamAppId).toBe(1128920);
  });

  it('takes an id no other game has', () => {
    expect(newGame('Helldivers 2', ['helldivers_2']).id).toBe('helldivers_2_2');
  });

  it('never takes an id Windows keeps for a device, or one every object inherits', () => {
    expect([newGame('Con', []).id, newGame('Constructor', []).id]).toEqual([
      'con_2',
      'constructor_2',
    ]);
  });

  it('starts from "game" for a name with nothing usable in an id', () => {
    expect(newGame('エースコンバット', []).id).toBe('game');
  });

  it('may start with no name, for "Add a game": it can’t be saved until it has one', () => {
    expect(gameProblem(newGame('', ['game']))).toBe('The game needs a name.');
  });
});

describe('renameGame', () => {
  it('changes the name only: the id stays', () => {
    expect(renameGame(two, 'Rover 2')).toEqual({ ...two, name: 'Rover 2' });
  });
});

describe('addAction', () => {
  it('adds the action at the end of its mode, with an id from its name', () => {
    const { game, id } = addAction(two, 'foot', 'Throw Grenade');
    expect([id, ids(game, 'foot')]).toEqual([
      'throw_grenade',
      ['jump', 'fire', 'duck', 'throw_grenade'],
    ]);
  });

  it('starts it not required, with no defaults, and the role of the action above it', () => {
    const { game, id } = addAction(two, 'foot', 'Crawl');
    expect(game.actions.find((a) => a.id === id)).toEqual({
      id: 'crawl',
      name: 'Crawl',
      mode: 'foot',
      role: 'movement',
      required: false,
    });
  });

  it('starts the first action of a mode as an ability', () => {
    const { game, id } = addAction(newGame('Rover', []), 'default', 'Jump');
    expect(game.actions.find((a) => a.id === id)?.role).toBe('ability');
  });

  it('gives a second action of the same name its own id', () => {
    const { id } = addAction(two, 'drive', 'Jump');
    expect(id).toBe('jump_2');
  });

  it('never gives an id every object inherits', () => {
    expect(addAction(two, 'foot', 'toString').id).toBe('tostring');
    expect(addAction(two, 'foot', 'hasOwnProperty').id).toBe('hasownproperty');
    expect(addAction(two, 'foot', 'constructor').id).toBe('constructor_2');
  });

  it('keeps the name as typed, trimmed', () => {
    const { game, id } = addAction(two, 'foot', '  Sprint  ');
    expect(game.actions.find((a) => a.id === id)?.name).toBe('Sprint');
  });
});

describe('updateAction', () => {
  it('renames an action and keeps its id, so setups show the new name', () => {
    const game = updateAction(two, 'jump', { name: 'Leap' });
    expect(game.actions.find((a) => a.name === 'Leap')?.id).toBe('jump');
  });

  it('sets the role and required', () => {
    const game = updateAction(two, 'fire', { role: 'ability', required: true });
    expect(game.actions.find((a) => a.id === 'fire')).toMatchObject({
      role: 'ability',
      required: true,
    });
  });

  it('leaves the game as it was for an action it doesn’t have', () => {
    expect(updateAction(two, 'nobody', { name: 'X' })).toBe(two);
  });
});

describe('the defaults', () => {
  it('sets a default key and a default controller button', () => {
    const keyed = setDefaultKey(two, 'jump', { kind: 'key', code: 'Space' });
    const both = setDefaultPad(keyed, 'jump', 'A');
    expect(both.actions.find((a) => a.id === 'jump')?.native).toEqual({
      key: { kind: 'key', code: 'Space' },
      pad: 'A',
    });
  });

  it('clears one and keeps the other', () => {
    const both = setDefaultPad(
      setDefaultKey(two, 'jump', { kind: 'key', code: 'Space' }),
      'jump',
      'A',
    );
    expect(setDefaultKey(both, 'jump', null).actions.find((a) => a.id === 'jump')?.native).toEqual({
      pad: 'A',
    });
  });

  it('drops the defaults altogether once both are cleared', () => {
    const keyed = setDefaultKey(two, 'jump', { kind: 'mouse', button: 'left' });
    const cleared = setDefaultKey(keyed, 'jump', null);
    expect(cleared.actions.find((a) => a.id === 'jump')).toEqual(two.actions[0]);
  });

  it('copies the signal it is given', () => {
    const signal = { kind: 'key', code: 'R' } as const;
    const game = setDefaultKey(two, 'fire', signal);
    expect(game.actions.find((a) => a.id === 'fire')?.native?.key).not.toBe(signal);
  });
});

describe('moving an action', () => {
  it('moves it up past the action above it in its own mode, whatever lies between', () => {
    // Honk (Driving) sits between Jump and Fire in the list; Fire moves above Jump.
    expect(ids(moveAction(two, 'fire', -1), 'foot')).toEqual(['fire', 'jump', 'duck']);
  });

  it('moves it down', () => {
    expect(ids(moveAction(two, 'jump', 1), 'foot')).toEqual(['fire', 'jump', 'duck']);
  });

  it('leaves the first where it is when moved up, and the last when moved down', () => {
    expect([moveAction(two, 'jump', -1), moveAction(two, 'duck', 1)]).toEqual([two, two]);
  });

  it('leaves the other modes’ actions where they are', () => {
    expect(ids(moveAction(two, 'fire', -1), 'drive')).toEqual(['honk']);
  });
});

describe('deleting an action', () => {
  it('takes it out of the game', () => {
    expect(ids(deleteAction(two, 'fire'), 'foot')).toEqual(['jump', 'duck']);
  });
});

describe('the modes', () => {
  it('adds a mode at the end, with an id from its name', () => {
    const { game, id } = addMode(two, 'In the ship');
    expect([id, game.modes.map((m) => m.id)]).toEqual([
      'in_the_ship',
      ['foot', 'drive', 'in_the_ship'],
    ]);
  });

  it('never gives a mode an id every object inherits: mode ids are keys of every setup’s map', () => {
    expect([addMode(two, 'Constructor').id, addMode(two, '__proto__').id]).toEqual([
      'constructor_2',
      'proto',
    ]);
  });

  it('renames a mode and keeps its id', () => {
    expect(renameMode(two, 'drive', 'In the rover').modes[1]).toEqual({
      id: 'drive',
      name: 'In the rover',
    });
  });

  it('moves a mode left and right', () => {
    expect([moveMode(two, 'drive', -1).modes.map((m) => m.id), moveMode(two, 'drive', 1)]).toEqual([
      ['drive', 'foot'],
      two,
    ]);
  });

  it('deletes a mode with its actions', () => {
    const game = deleteMode(two, 'foot');
    expect([game.modes.map((m) => m.id), game.actions.map((a) => a.id)]).toEqual([
      ['drive'],
      ['honk'],
    ]);
  });

  it('never deletes the last mode: a game has at least one', () => {
    const one = deleteMode(two, 'foot');
    expect(deleteMode(one, 'drive')).toBe(one);
  });
});

describe('canStartFrom', () => {
  it('offers both defaults for a game with keys and controller buttons', () => {
    expect(canStartFrom(helldivers2)).toEqual(['xbox', 'keys']);
  });

  it('offers only the Xbox controller for a game with no default keys', () => {
    expect(canStartFrom(setDefaultPad(two, 'jump', 'A'))).toEqual(['xbox']);
  });

  it('offers nothing for a game with no actions yet', () => {
    expect(canStartFrom(newGame('Rover', []))).toEqual([]);
  });
});

describe('record', () => {
  it('makes each edit a step to undo', () => {
    const h = record(record(startHistory('a'), 'b', null, null), 'c', null, null);
    expect([h.past, undo(h).present]).toEqual([['a', 'b'], 'b']);
  });

  it('makes typing in one field one step: the letters after the first replace each other', () => {
    const one = record(startHistory('Jum'), 'Jump', 'name:jump', null);
    const two = record(one, 'Jumps', 'name:jump', 'name:jump');
    expect([two.past, undo(two).present]).toEqual([['Jum'], 'Jum']);
  });

  it('starts a new step when another field is typed in', () => {
    const one = record(startHistory('a'), 'b', 'name:jump', null);
    const two = record(one, 'c', 'name:fire', 'name:jump');
    expect(two.past).toEqual(['a', 'b']);
  });

  it('drops what was undone once something new is typed', () => {
    const one = record(record(startHistory('a'), 'b', null, null), 'c', 'name:x', null);
    const back = undo(one);
    expect(record(back, 'd', 'name:x', 'name:x').future).toEqual([]);
  });
});

describe('loadedOf', () => {
  const entries = [
    { game: helldivers2, builtIn: true, edited: true as const },
    { game: two, builtIn: false },
  ];

  it('opens a game helmArray knows, saying whose it is', () => {
    expect([
      loadedOf({ kind: 'edit', gameId: 'helldivers2' }, entries),
      loadedOf({ kind: 'edit', gameId: 'rover' }, entries),
    ]).toEqual([
      {
        game: helldivers2,
        builtIn: true,
        edited: true,
        saved: true,
        reserved: { modes: [], actions: [] },
      },
      {
        game: two,
        builtIn: false,
        edited: false,
        saved: true,
        reserved: { modes: [], actions: [] },
      },
    ]);
  });

  it('reserves the ids the game’s saved schemes name', () => {
    const scheme = {
      ...gameKeysPreset(two),
      map: { foot: { 'L.index_1': { tap: 'grapple' } } },
    };
    expect(loadedOf({ kind: 'edit', gameId: 'rover' }, entries, [scheme])?.reserved).toEqual({
      modes: ['foot'],
      actions: ['grapple'],
    });
  });

  it('is nothing for a game that isn’t there any more', () => {
    expect(loadedOf({ kind: 'edit', gameId: 'gone' }, entries)).toBeNull();
  });

  it('makes a new game, not saved yet, with an id no game has', () => {
    expect(loadedOf({ kind: 'new', name: 'Rover', steamAppId: 7 }, entries)).toEqual({
      game: {
        id: 'rover_2',
        name: 'Rover',
        steamAppId: 7,
        modes: [{ id: 'default', name: 'Default' }],
        actions: [],
      },
      builtIn: false,
      edited: false,
      saved: false,
      taken: ['helldivers2', 'rover'],
    });
  });
});

describe('ids are never given out twice', () => {
  it('keeps the id of a deleted action, and a new action named alike gets another', () => {
    const gone = deleteAction(two, 'fire');
    const { id } = addAction(gone, 'foot', 'Fire!');
    expect([gone.retired, id]).toEqual([{ modes: [], actions: ['fire'] }, 'fire_2']);
  });

  it('keeps the ids of a deleted mode and of its actions', () => {
    const gone = deleteMode(two, 'drive');
    expect([gone.retired, addMode(gone, 'Driving').id, addAction(gone, 'foot', 'Honk').id]).toEqual(
      [{ modes: ['drive'], actions: ['honk'] }, 'driving', 'honk_2'],
    );
  });

  it('never gives the id a saved scheme names, though the game itself has forgotten it', () => {
    const reserved = { modes: ['drive'], actions: ['grapple'] };
    expect([
      addAction(two, 'foot', 'Grapple', reserved).id,
      addMode(two, 'Drive', reserved).id,
    ]).toEqual(['grapple_2', 'drive_2']);
  });

  it('keeps each deleted id once', () => {
    const twice = deleteAction(addAction(deleteAction(two, 'fire'), 'foot', 'Fire').game, 'fire_2');
    expect(twice.retired).toEqual({ modes: [], actions: ['fire', 'fire_2'] });
  });

  it('is a game that can still be saved after deleting', () => {
    expect(gameProblem(deleteMode(deleteAction(two, 'fire'), 'drive'))).toBeNull();
  });
});

describe('referencedIds', () => {
  it('lists every mode and action a scheme names', () => {
    const scheme = {
      ...gameKeysPreset(two),
      map: {
        foot: { 'L.index_1': { tap: 'jump', long: 'gone' } },
        old_mode: { 'key.R': { tap: 'grapple' } },
      },
    };
    expect(referencedIds([scheme])).toEqual({
      modes: ['foot', 'old_mode'],
      actions: ['jump', 'gone', 'grapple'],
    });
  });

  it('reads a mode named __proto__ as a mode', () => {
    const scheme = {
      ...gameKeysPreset(two),
      map: JSON.parse('{"__proto__": {"L.index_1": {"tap": "x"}}}') as Scheme['map'],
    };
    expect(referencedIds([scheme])).toEqual({ modes: ['__proto__'], actions: ['x'] });
  });
});

describe('a property: whatever is added, renamed and deleted, no id is given out twice', () => {
  /** A small seeded generator, so a failure can be run again. */
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const NAMES = ['Fire', 'Fire!', 'fire', 'Jump', 'Constructor', '__proto__', 'Drive', ''];

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('holds over 300 steps from seed %i', (seed) => {
    const next = random(seed);
    const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(next() * list.length)];
    // A scheme saved at the start names every action the game had then.
    let game: Game = two;
    const issued = new Map<string, number>([
      ...two.actions.map((a) => [`a:${a.id}`, 1] as const),
      ...two.modes.map((m) => [`m:${m.id}`, 1] as const),
    ]);
    const issue = (key: string) => issued.set(key, (issued.get(key) ?? 0) + 1);
    for (let step = 0; step < 300; step++) {
      const roll = next();
      const mode = pick(game.modes)?.id ?? 'foot';
      const action = pick(game.actions)?.id;
      if (roll < 0.35) {
        const added = addAction(game, mode, pick(NAMES) ?? 'x');
        game = added.game;
        issue(`a:${added.id}`);
      } else if (roll < 0.5) {
        const added = addMode(game, pick(NAMES) ?? 'x');
        game = added.game;
        issue(`m:${added.id}`);
      } else if (roll < 0.65 && action !== undefined) {
        game = updateAction(game, action, { name: pick(NAMES) ?? 'x' });
      } else if (roll < 0.85 && action !== undefined) {
        game = deleteAction(game, action);
      } else {
        game = deleteMode(game, mode);
      }
    }
    expect([...issued].filter(([, times]) => times > 1)).toEqual([]);
  });
});
