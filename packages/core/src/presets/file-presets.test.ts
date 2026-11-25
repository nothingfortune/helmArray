// The presets for a game whose file helmArray writes (M5): a new scheme writes the file, so its
// bindings go into the game rather than onto a bind sheet, and the *game's own keys* preset still
// has the units send the game's own keys.

import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '../devices/index';
import type { Game } from '../model';
import { resolve } from '../resolve';
import { blankKeysScheme, gameKeysPreset } from './keys';
import { xboxControllerPreset } from './xbox';

const withoutFile: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [
    { id: 'ship', name: 'Ship' },
    { id: 'foot', name: 'On foot' },
  ],
  actions: [
    {
      id: 'boost',
      name: 'Boost',
      mode: 'ship',
      role: 'movement',
      required: true,
      native: { key: { kind: 'key', code: 'Tab' }, pad: 'A' },
    },
    {
      id: 'map',
      name: 'Galaxy map',
      mode: 'ship',
      role: 'menu',
      required: false,
      native: { key: { kind: 'key', code: 'M' }, pad: 'Y' },
    },
    {
      id: 'sprint',
      name: 'Sprint',
      mode: 'foot',
      role: 'movement',
      required: false,
      native: { key: { kind: 'key', code: 'LShift' }, pad: 'B' },
    },
  ],
};
const withFile: Game = { ...withoutFile, file: { format: 'elite-binds' } };

const pins = (game: Game, scheme: ReturnType<typeof gameKeysPreset>) => {
  const plan = resolve(scheme, game, BUILT_IN_DEVICES);
  return [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])].flatMap((p) =>
    p.presses.tap === undefined ? [] : [[p.control, p.presses.tap]],
  );
};

describe('the presets, for a game whose file helmArray writes', () => {
  it('write the file for a game that has one, and leave it alone for a game that has none', () => {
    expect({
      xbox: [xboxControllerPreset(withFile), xboxControllerPreset(withoutFile)].map(
        (s) => s.writeGameFile,
      ),
      keys: [gameKeysPreset(withFile), gameKeysPreset(withoutFile)].map((s) => s.writeGameFile),
      blank: [blankKeysScheme(withFile), blankKeysScheme(withoutFile)].map((s) => s.writeGameFile),
    }).toEqual({ xbox: [true, false], keys: [true, false], blank: [true, false] });
  });

  it('put the bindings into the file, with nothing left for a bind sheet', () => {
    const plan = resolve(xboxControllerPreset(withFile), withFile, BUILT_IN_DEVICES);
    expect({ file: plan.gameFile, sheet: plan.bindSheet }).toEqual({
      file: { format: 'elite-binds' },
      sheet: [],
    });
  });

  it("has the units send the game's own keys, as it does for a game with no file", () => {
    const sent = pins(withFile, gameKeysPreset(withFile));
    expect({ sent, same: sent }).toEqual({
      sent: expect.arrayContaining([expect.arrayContaining([{ kind: 'key', code: 'Tab' }])]),
      same: pins(withoutFile, gameKeysPreset(withoutFile)),
    });
  });

  it("keeps the game's own keys in the ledger, so an edit later never moves them", () => {
    const scheme = gameKeysPreset(withFile);
    expect({
      withFile: Object.values(scheme.ledger).map((presses) => presses.tap),
      withoutFile: gameKeysPreset(withoutFile).ledger,
    }).toEqual({
      withFile: expect.arrayContaining([
        { kind: 'key', code: 'Tab' },
        { kind: 'key', code: 'M' },
        { kind: 'key', code: 'LShift' },
      ]),
      withoutFile: {},
    });
  });
});
