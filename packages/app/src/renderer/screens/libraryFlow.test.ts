import { describe, expect, it, vi } from 'vitest';
import type { HelmApi, LibraryEntry } from '../../shared/api';
import { START, plainReason, runMake, runPick, step } from './libraryFlow';
import type { Command, FlowEvent, FlowState } from './libraryFlow';
import { entry } from './libraryFixtures';

const XBOX = {
  id: 'hd2-xbox',
  name: 'Xbox controller',
  output: 'pad' as const,
  devices: { azerons: 'both' as const, keyboard: false, mouse: false, controller: false },
};
const COUCH = { ...XBOX, id: 'hd2-couch', name: 'Couch' };
const TWO = entry({ schemes: [COUCH, XBOX], activeSchemeId: XBOX.id });
const NEW = { ...entry(), schemes: [] as LibraryEntry['schemes'] };
const UNKNOWN = entry({ gameId: null, nativeKeys: false });
const SET_UP = entry({ schemes: [XBOX], activeSchemeId: XBOX.id });

/** Plays a series of events through the reducer, counting the clicks. */
function play(events: FlowEvent[], from: FlowState = START) {
  let state = from;
  const commands: Command[] = [];
  for (const event of events) {
    const next = step(state, event);
    state = next.state;
    if (next.command) commands.push(next.command);
  }
  return { state, commands };
}

describe('a game whose sticks must send keys', () => {
  const ES2 = { ...NEW, name: 'Everspace 2', gameId: 'everspace2', needsKeyStick: true as const };

  it('makes nothing from Xbox controller: the choice is off', () => {
    const picking = play([{ type: 'tile', entry: ES2 }]).state;
    expect(play([{ type: 'choose', entry: ES2, preset: 'xbox' }], picking)).toEqual({
      state: picking,
      commands: [],
    });
  });

  it('makes its own keys in the one click, as for any game', () => {
    expect(
      play([
        { type: 'tile', entry: ES2 },
        { type: 'choose', entry: ES2, preset: 'keys' },
      ]).commands,
    ).toEqual([{ type: 'make-and-open', gameId: 'everspace2', preset: 'keys' }]);
  });
});

describe('J1: pick a game, pick a default, play', () => {
  it('takes two clicks for a game with no scheme: the game, then the default', () => {
    const first = play([{ type: 'tile', entry: NEW }]);
    expect(first.commands).toEqual([]);
    expect(first.state.picking).toBe('helldivers2');
    const second = play([{ type: 'choose', entry: NEW, preset: 'xbox' }], first.state);
    expect(second.commands).toEqual([
      { type: 'make-and-open', gameId: 'helldivers2', preset: 'xbox' },
    ]);
    expect(second.state).toEqual({ picking: null, busy: true, error: null });
  });

  it("starts from the game's own keys the same way", () => {
    const { commands } = play([
      { type: 'tile', entry: NEW },
      { type: 'choose', entry: NEW, preset: 'keys' },
    ]);
    expect(commands).toEqual([{ type: 'make-and-open', gameId: 'helldivers2', preset: 'keys' }]);
  });

  it('takes one click for a game that already has schemes: its active one opens', () => {
    expect(play([{ type: 'tile', entry: SET_UP }]).commands).toEqual([
      { type: 'open-editor', schemeId: 'hd2-xbox' },
    ]);
  });

  it('opens another scheme of the game when asked to, and refuses one that is not its own', () => {
    expect(play([{ type: 'open', entry: SET_UP, schemeId: 'hd2-xbox' }]).commands).toEqual([
      { type: 'open-editor', schemeId: 'hd2-xbox' },
    ]);
    expect(play([{ type: 'open', entry: SET_UP, schemeId: 'someone-elses' }]).commands).toEqual([]);
  });

  it('picks another setup of a game in two clicks: the list, then the setup, which opens as the active one', () => {
    // The first click opens the list (the Library's own popover); this is the second.
    expect(play([{ type: 'pick', entry: TWO, schemeId: 'hd2-couch' }]).commands).toEqual([
      { type: 'pick-and-open', gameId: 'helldivers2', schemeId: 'hd2-couch' },
    ]);
    expect(play([{ type: 'pick', entry: TWO, schemeId: 'not-its-own' }]).commands).toEqual([]);
  });

  it('does nothing at all for a game helmArray does not know: no command, no picker', () => {
    const { state, commands } = play([
      { type: 'tile', entry: UNKNOWN },
      { type: 'choose', entry: UNKNOWN, preset: 'xbox' },
    ]);
    expect(commands).toEqual([]);
    expect(state).toEqual(START);
  });

  it('ignores every click while a scheme is being made, so it is made once', () => {
    const making = play([
      { type: 'tile', entry: NEW },
      { type: 'choose', entry: NEW, preset: 'xbox' },
    ]);
    const more = play(
      [
        { type: 'choose', entry: NEW, preset: 'xbox' },
        { type: 'choose', entry: NEW, preset: 'keys' },
        { type: 'tile', entry: NEW },
        { type: 'tile', entry: SET_UP },
        { type: 'open', entry: SET_UP, schemeId: 'hd2-xbox' },
      ],
      making.state,
    );
    expect(more.commands).toEqual([]);
    expect(more.state).toBe(making.state);
  });

  it('shows one plain sentence when making fails, and takes clicks again', () => {
    const making = play([
      { type: 'tile', entry: NEW },
      { type: 'choose', entry: NEW, preset: 'xbox' },
    ]);
    const failed = play([{ type: 'failed', message: "Couldn't make that scheme." }], making.state);
    expect(failed.state).toEqual({
      picking: null,
      busy: false,
      error: "Couldn't make that scheme.",
    });
    const again = play([{ type: 'tile', entry: NEW }], failed.state);
    expect(again.state).toEqual({ picking: 'helldivers2', busy: false, error: null });
  });

  it('clears the sentence on the next click, and closes the picker on dismiss', () => {
    const failed: FlowState = { picking: null, busy: false, error: 'oops' };
    expect(play([{ type: 'tile', entry: SET_UP }], failed).state.error).toBeNull();
    const open = play([{ type: 'tile', entry: NEW }]);
    expect(play([{ type: 'dismiss' }], open.state).state.picking).toBeNull();
  });

  it('is free for clicks again once finished', () => {
    const making: FlowState = { picking: null, busy: true, error: null };
    expect(play([{ type: 'finished' }], making).state.busy).toBe(false);
  });
});

describe('making the scheme', () => {
  const made = { id: 'helldivers2-xbox-1' } as Awaited<ReturnType<HelmApi['createScheme']>>;

  it('creates it from the preset, makes it active, then gives its id, in that order', async () => {
    const order: string[] = [];
    const api = {
      createScheme: vi.fn((gameId: string, preset: string) => {
        order.push(`create ${gameId} ${preset}`);
        return Promise.resolve(made);
      }),
      setActive: vi.fn((gameId: string, schemeId: string | null) => {
        order.push(`active ${gameId} ${schemeId}`);
        return Promise.resolve();
      }),
    };
    expect(await runMake(api, 'helldivers2', 'xbox')).toEqual({ ok: true, schemeId: made.id });
    expect(order).toEqual(['create helldivers2 xbox', 'active helldivers2 helldivers2-xbox-1']);
  });

  it('stops with one sentence when the scheme cannot be made, and sets nothing active', async () => {
    const api = {
      createScheme: vi.fn(() =>
        Promise.reject(
          new Error(
            "Error invoking remote method 'helm:create-scheme': StoreError: There is no such game.",
          ),
        ),
      ),
      setActive: vi.fn(() => Promise.resolve()),
    };
    expect(await runMake(api, 'nope', 'xbox')).toEqual({
      ok: false,
      message: "Couldn't make that scheme. There is no such game.",
    });
    expect(api.setActive).not.toHaveBeenCalled();
  });

  it('says so when the scheme was made but could not be set as the current one', async () => {
    const api = {
      createScheme: () => Promise.resolve(made),
      setActive: () => Promise.reject(new Error('disk full')),
    };
    const outcome = await runMake(api, 'helldivers2', 'keys');
    expect(outcome).toEqual({
      ok: false,
      message: "The scheme was made, but couldn't be set as the current one. disk full",
    });
  });
});

describe('plainReason', () => {
  it('picking makes the setup the active one, then gives its id', async () => {
    const setActive = vi.fn<HelmApi['setActive']>(() => Promise.resolve());
    expect([
      await runPick({ setActive }, 'helldivers2', 'hd2-couch'),
      setActive.mock.calls,
    ]).toEqual([{ ok: true, schemeId: 'hd2-couch' }, [['helldivers2', 'hd2-couch']]]);
  });

  it('picking says so in one sentence when the setup could not be made the active one', async () => {
    const setActive = vi.fn<HelmApi['setActive']>(() => Promise.reject(new Error('Disk full.')));
    expect(await runPick({ setActive }, 'helldivers2', 'hd2-couch')).toEqual({
      ok: false,
      message: "Couldn't switch to that scheme. Disk full.",
    });
  });

  it('drops the wrapping Electron adds and the error name', () => {
    expect(plainReason(new Error("Error invoking remote method 'x': StoreError: No."))).toBe('No.');
    expect(plainReason(new Error('Plain.'))).toBe('Plain.');
    expect(plainReason('text')).toBe('text');
  });
});
