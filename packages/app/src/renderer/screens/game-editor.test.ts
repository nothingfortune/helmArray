import type { Game, Scheme } from '@helmarray/core';
import { blankKeysScheme } from '@helmarray/core';
import { describe, expect, it, vi } from 'vitest';
import type { HelmApi } from '../../shared/api';
import { GameEditor, NAME_FIELD } from './game-editor';
import type { EditorApi } from './game-editor';
import { addAction, newGame, renameGame, renameMode, updateAction } from './game-model';

const rover: Game = {
  id: 'rover',
  name: 'Rover',
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    {
      id: 'jump',
      name: 'Jump',
      mode: 'default',
      role: 'movement',
      required: false,
      native: { key: { kind: 'key', code: 'Space' } },
    },
  ],
};

function api(over: Partial<EditorApi> = {}) {
  return {
    saveGame: vi.fn<HelmApi['saveGame']>(over.saveGame ?? (() => Promise.resolve())),
    saveFileRead: vi.fn<HelmApi['saveFileRead']>(over.saveFileRead ?? (() => Promise.resolve())),
    deleteGame: vi.fn<HelmApi['deleteGame']>(over.deleteGame ?? (() => Promise.resolve())),
    createScheme: vi.fn<HelmApi['createScheme']>(
      over.createScheme ??
        ((gameId) =>
          Promise.resolve({
            ...blankKeysScheme({ ...rover, id: gameId }),
            id: 'rover-keys-1',
          } as Scheme)),
    ),
    setActive: vi.fn<HelmApi['setActive']>(over.setActive ?? (() => Promise.resolve())),
    readGameFile: vi.fn<HelmApi['readGameFile']>(
      over.readGameFile ?? (() => Promise.resolve({ ok: false, message: 'No file.' })),
    ),
  };
}

const open = (
  game: Game = rover,
  flags: Partial<{
    builtIn: boolean;
    edited: boolean;
    saved: boolean;
    taken: string[];
    reserved: { modes: string[]; actions: string[] };
    uses: { mode: string; action: string }[];
    found: boolean;
    readsFile: boolean;
    setupsOff: number;
  }> = {},
  calls = api(),
) => ({
  editor: new GameEditor({ game, builtIn: false, edited: false, saved: true, ...flags }, calls),
  calls,
});

/** Lets the promises the editor started settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('an edit', () => {
  it('changes the game and saves it', () => {
    const { editor, calls } = open();
    editor.edit((g) => renameGame(g, 'Rover 2'));
    expect([editor.game.name, calls.saveGame.mock.calls]).toEqual([
      'Rover 2',
      [[{ ...rover, name: 'Rover 2' }]],
    ]);
  });

  it('is not saved while the game is not whole, and says why', () => {
    const { editor, calls } = open();
    editor.edit((g) => updateAction(g, 'jump', { name: '' }));
    expect([calls.saveGame.mock.calls.length, editor.problem]).toEqual([
      0,
      'Every action needs a name.',
    ]);
  });

  it('does nothing when nothing changes', () => {
    const { editor, calls } = open();
    const before = editor.state;
    editor.edit((g) => g);
    expect([editor.state, calls.saveGame.mock.calls.length]).toEqual([before, 0]);
  });

  it('tells its listeners, and stops when told to', () => {
    const { editor } = open();
    const heard: string[] = [];
    const stop = editor.subscribe(() => heard.push(editor.game.name));
    editor.edit((g) => renameGame(g, 'A'));
    stop();
    editor.edit((g) => renameGame(g, 'B'));
    expect(heard).toEqual(['A']);
  });

  it('marks the game saved once main has it, and a built-in game edited', async () => {
    const { editor } = open(rover, { builtIn: true, saved: false });
    editor.edit((g) => renameGame(g, 'Mine'));
    await settle();
    expect([editor.state.saved, editor.state.edited]).toEqual([true, true]);
  });

  it('keeps a game added by hand not marked as edited', async () => {
    const { editor } = open();
    editor.edit((g) => renameGame(g, 'Mine'));
    await settle();
    expect(editor.state.edited).toBe(false);
  });

  it('says so in one sentence when main refuses the save, and undoes what it refused', async () => {
    const { editor } = open(
      rover,
      {},
      api({
        saveGame: () =>
          Promise.reject(
            new Error(
              "Error invoking remote method 'helm:save-game': StoreError: The disk is full.",
            ),
          ),
      }),
    );
    editor.edit((g) => renameGame(g, 'Mine'));
    await settle();
    expect([editor.state.saveError, editor.game.name]).toEqual([
      "That change couldn't be saved, so it was undone. The disk is full.",
      'Rover',
    ]);
  });

  it('clears that sentence once a save goes through', async () => {
    let fail = true;
    const calls = api({
      saveGame: () => (fail ? Promise.reject(new Error('No.')) : Promise.resolve()),
    });
    const { editor } = open(rover, {}, calls);
    editor.edit((g) => renameGame(g, 'A'));
    await settle();
    fail = false;
    editor.edit((g) => renameGame(g, 'B'));
    await settle();
    expect(editor.state.saveError).toBeNull();
  });
});

describe('undo and redo', () => {
  it('undoes and redoes an edit, saving each time', () => {
    const { editor, calls } = open();
    editor.edit((g) => renameGame(g, 'A'));
    editor.undo();
    const undone = editor.game.name;
    editor.redo();
    expect([undone, editor.game.name, calls.saveGame.mock.calls.length]).toEqual(['Rover', 'A', 3]);
  });

  it('makes typing in one field one step', () => {
    const { editor } = open();
    editor.edit((g) => renameGame(g, 'R'), 'game-name');
    editor.edit((g) => renameGame(g, 'Ro'), 'game-name');
    editor.undo();
    expect(editor.game.name).toBe('Rover');
  });

  it('starts a new step after an undo, even in the same field', () => {
    const { editor } = open();
    editor.edit((g) => renameGame(g, 'A'), 'game-name');
    editor.edit((g) => renameGame(g, 'B'), 'other');
    editor.undo();
    editor.edit((g) => renameGame(g, 'C'), 'game-name');
    editor.undo();
    expect(editor.game.name).toBe('A');
  });

  it('says whether there is something to redo', () => {
    const { editor } = open();
    const before = editor.canRedo;
    editor.edit((g) => renameGame(g, 'A'));
    const edited = editor.canRedo;
    editor.undo();
    const undone = editor.canRedo;
    editor.redo();
    expect([before, edited, undone, editor.canRedo]).toEqual([false, false, true, false]);
  });

  it('does nothing with nothing to undo or redo', () => {
    const { editor, calls } = open();
    editor.undo();
    editor.redo();
    expect(calls.saveGame.mock.calls.length).toBe(0);
  });
});

describe('the mode shown', () => {
  it('is the first mode to start with', () => {
    expect(open().editor.mode).toBe('default');
  });

  it('follows a new mode, which is named for its place', () => {
    const { editor } = open();
    const id = editor.addMode();
    expect([editor.mode, editor.game.modes.at(-1)]).toEqual([id, { id: 'mode_2', name: 'Mode 2' }]);
  });

  it('names the first mode when a second is added, both in one step to undo', () => {
    const { editor } = open();
    editor.addMode();
    const added = editor.game.modes.map((m) => m.name);
    editor.undo();
    expect([added, editor.game.modes]).toEqual([
      ['Mode 1', 'Mode 2'],
      [{ id: 'default', name: 'Default' }],
    ]);
  });

  it('moves to another mode when the one shown is deleted', () => {
    const { editor } = open();
    editor.addMode();
    editor.deleteMode(editor.mode);
    expect([editor.mode, editor.game.modes.map((m) => m.id)]).toEqual(['default', ['default']]);
  });

  it('falls back to the first mode when the one shown is gone by undo', () => {
    const { editor } = open();
    editor.addMode();
    editor.undo();
    expect(editor.mode).toBe('default');
  });

  it('is picked', () => {
    const { editor } = open();
    editor.addMode();
    editor.setMode('default');
    expect(editor.mode).toBe('default');
  });
});

describe('whether the modes are shown', () => {
  /** Codex's sequence: two modes, the first one's name cleared, the other deleted. */
  function loneBlank() {
    const { editor } = open();
    const second = editor.addMode();
    editor.edit((g) => renameMode(g, 'default', ''), 'mode-name:default');
    editor.modeNameDone();
    editor.deleteMode(second);
    return editor;
  }

  it('hides them for one named mode, and shows them once a second is added', () => {
    const { editor } = open();
    const before = editor.state.modesShown;
    editor.addMode();
    expect([before, editor.state.modesShown]).toEqual([false, true]);
  });

  it('shows a lone mode with no name, so the name it needs can be typed', () => {
    const editor = loneBlank();
    expect([editor.game.modes, editor.state.modesShown]).toEqual([
      [{ id: 'default', name: '' }],
      true,
    ]);
  });

  it('never changes while the mode’s name is typed: the field being typed in stays', () => {
    const editor = loneBlank();
    const shown: boolean[] = [];
    for (const name of ['O', 'On', 'On foot']) {
      editor.edit((g) => renameMode(g, 'default', name), 'mode-name:default');
      shown.push(editor.state.modesShown);
    }
    expect(shown).toEqual([true, true, true]);
  });

  it('is decided again once the typing is done', () => {
    const editor = loneBlank();
    editor.edit((g) => renameMode(g, 'default', 'On foot'), 'mode-name:default');
    editor.modeNameDone();
    expect(editor.state.modesShown).toBe(false);
  });

  it('is decided again by any other edit, and by undo', () => {
    const editor = loneBlank();
    editor.edit((g) => renameMode(g, 'default', 'On foot'), 'mode-name:default');
    editor.edit((g) => renameGame(g, 'Rover 2'));
    const afterEdit = editor.state.modesShown;
    editor.undo();
    editor.undo();
    expect([afterEdit, editor.game.modes.length, editor.state.modesShown]).toEqual([
      false,
      1,
      true,
    ]);
  });
});

describe('adding an action', () => {
  it('adds it to the mode shown and waits for its key', () => {
    const { editor } = open();
    editor.addAction('Reload');
    expect([editor.game.actions.map((a) => a.id), editor.state.waiting]).toEqual([
      ['jump', 'reload'],
      { action: 'reload', part: 'key' },
    ]);
  });

  it('adds nothing for a name of nothing but spaces', () => {
    const { editor, calls } = open();
    editor.addAction('   ');
    expect([editor.game.actions.length, editor.state.waiting, calls.saveGame.mock.calls]).toEqual([
      1,
      null,
      [],
    ]);
  });

  it('saves a game set up from Steam at its first action, and not before', () => {
    const { editor, calls } = open(newGame('Everspace 2', [], 1128920), { saved: false });
    const before = calls.saveGame.mock.calls.length;
    editor.addAction('Boost');
    expect([before, calls.saveGame.mock.calls.map(([g]) => g.actions.length)]).toEqual([0, [1]]);
  });
});

describe('waiting for a press', () => {
  it('sets the key pressed, and stops waiting', () => {
    const { editor } = open();
    editor.wait({ action: 'jump', part: 'key' });
    editor.press({ kind: 'key', code: 'J' });
    expect([editor.game.actions[0]?.native, editor.state.waiting]).toEqual([
      { key: { kind: 'key', code: 'J' } },
      null,
    ]);
  });

  it('sets the controller button pressed', () => {
    const { editor } = open();
    editor.wait({ action: 'jump', part: 'pad' });
    editor.press('A');
    expect(editor.game.actions[0]?.native).toEqual({
      key: { kind: 'key', code: 'Space' },
      pad: 'A',
    });
  });

  it('ignores a press with nothing waited for', () => {
    const { editor, calls } = open();
    editor.press('A');
    expect(calls.saveGame.mock.calls.length).toBe(0);
  });

  it('ignores a key for a controller button and a controller button for a key', () => {
    const { editor, calls } = open();
    editor.wait({ action: 'jump', part: 'pad' });
    editor.press({ kind: 'key', code: 'J' });
    editor.wait({ action: 'jump', part: 'key' });
    editor.press('A');
    expect(calls.saveGame.mock.calls.length).toBe(0);
  });

  it('stops waiting when cancelled', () => {
    const { editor } = open();
    editor.wait({ action: 'jump', part: 'key' });
    editor.cancelWait();
    expect(editor.state.waiting).toBeNull();
  });

  it('stops waiting when the action waited for goes (an undo of its adding)', () => {
    const { editor } = open();
    editor.addAction('Reload');
    editor.undo();
    expect(editor.state.waiting).toBeNull();
  });
});

describe('a scheme from the game', () => {
  it('is made from the preset and made the active one, and its id given back', async () => {
    const { editor, calls } = open();
    expect([await editor.start('keys'), calls.setActive.mock.calls]).toEqual([
      'rover-keys-1',
      [['rover', 'rover-keys-1']],
    ]);
  });

  it('says why, and gives nothing back, when it can’t be made', async () => {
    const { editor } = open(
      rover,
      {},
      api({ createScheme: () => Promise.reject(new Error('Disk full.')) }),
    );
    expect([await editor.start('xbox'), editor.state.notice]).toEqual([
      null,
      "Couldn't make that scheme. Disk full.",
    ]);
  });

  it('is made once for two clicks at once', async () => {
    const { editor, calls } = open();
    await Promise.all([editor.start('keys'), editor.start('keys')]);
    expect(calls.createScheme.mock.calls.length).toBe(1);
  });
});

describe('deleting the game', () => {
  it('asks first, and can be kept', () => {
    const { editor } = open();
    editor.confirm(true);
    const asking = editor.state.confirming;
    editor.confirm(false);
    expect([asking, editor.state.confirming]).toEqual([true, false]);
  });

  it('deletes it', async () => {
    const { editor, calls } = open();
    expect([await editor.drop(), calls.deleteGame.mock.calls]).toEqual([true, [['rover']]]);
  });

  it('says why when it can’t, and stops asking', async () => {
    const { editor } = open(
      rover,
      {},
      api({ deleteGame: () => Promise.reject(new Error('StoreError: There is no such game.')) }),
    );
    editor.confirm(true);
    expect([await editor.drop(), editor.state.notice, editor.state.confirming]).toEqual([
      false,
      'There is no such game.',
      false,
    ]);
  });

  it('is done once for two clicks at once', async () => {
    const { editor, calls } = open();
    await Promise.all([editor.drop(), editor.drop()]);
    expect(calls.deleteGame.mock.calls.length).toBe(1);
  });
});

describe('what the screen offers', () => {
  it('offers the defaults a game with actions can start from', () => {
    expect(open().editor.starts.map((c) => [c.preset, c.unavailable])).toEqual([
      ['xbox', undefined],
      ['keys', undefined],
    ]);
  });

  it('shows Xbox controller off, with why, for a game whose sticks must send keys', () => {
    expect(open({ ...rover, needsKeyStick: true }).editor.starts).toEqual([
      {
        preset: 'xbox',
        label: 'Xbox controller',
        unavailable: 'Rover plays on keys: it stutters when a controller and keys are mixed.',
      },
      { preset: 'keys', label: "Game's own keys" },
    ]);
  });

  it('offers only Xbox controller for a game with no keys of its own', () => {
    const padOnly = {
      ...rover,
      actions: rover.actions.map((a) => ({ ...a, native: { pad: 'A' as const } })),
    };
    expect(open(padOnly).editor.starts.map((c) => c.preset)).toEqual(['xbox']);
  });

  it('offers none while the game is not whole', () => {
    const { editor } = open();
    editor.edit((g) => renameGame(g, ''));
    expect(editor.starts).toEqual([]);
  });

  it('lists the actions of the mode shown', () => {
    const { editor } = open();
    editor.edit((g) => addAction(g, 'default', 'Reload').game);
    expect(editor.rows.map((a) => a.id)).toEqual(['jump', 'reload']);
  });
});

describe('the new-action field', () => {
  it('keeps what is typed, and adds it as an action, emptied after', () => {
    const { editor } = open();
    editor.type('Reload');
    const typed = editor.state.draft;
    editor.addDraft();
    expect([typed, editor.state.draft, editor.game.actions.at(-1)?.name]).toEqual([
      'Reload',
      '',
      'Reload',
    ]);
  });

  it('adds nothing while it holds nothing but spaces, and keeps them', () => {
    const { editor } = open();
    editor.type('  ');
    editor.addDraft();
    expect([editor.game.actions.length, editor.state.draft]).toEqual([1, '  ']);
  });
});

describe('a new game’s id', () => {
  /** "Add a game": a game with no name yet, the other games' ids taken. */
  const added = (taken: string[] = []) => open(newGame('', taken), { saved: false, taken });

  it('is not sent while its name is typed, and is when the typing is done', () => {
    const { editor, calls } = added();
    editor.edit((g) => renameGame(g, 'A'), 'game-name');
    editor.edit((g) => renameGame(g, 'Ac'), 'game-name');
    const whileTyping = calls.saveGame.mock.calls.length;
    editor.nameDone();
    expect([whileTyping, calls.saveGame.mock.calls.map(([g]) => [g.id, g.name])]).toEqual([
      0,
      [['ac', 'Ac']],
    ]);
  });

  it('is made from its name when first sent, not from the name it opened with', () => {
    const { editor, calls } = added(['game']);
    editor.edit((g) => renameGame(g, 'Ace Combat 7'), 'game-name');
    editor.addAction('Fire');
    expect([editor.game.id, calls.saveGame.mock.calls.map(([g]) => g.id)]).toEqual([
      'ace_combat_7',
      ['ace_combat_7'],
    ]);
  });

  it('is never another game’s', () => {
    const { editor, calls } = added(['ace_combat_7']);
    editor.edit((g) => renameGame(g, 'Ace Combat 7'), 'game-name');
    editor.nameDone();
    expect(calls.saveGame.mock.calls[0]?.[0].id).toBe('ace_combat_7_2');
  });

  it('stays once sent: a later rename keeps it, and is saved as it is typed', () => {
    const { editor, calls } = added();
    editor.edit((g) => renameGame(g, 'Rover'), 'game-name');
    editor.nameDone();
    editor.edit((g) => renameGame(g, 'Rover 2'), 'game-name');
    expect(calls.saveGame.mock.calls.map(([g]) => [g.id, g.name])).toEqual([
      ['rover', 'Rover'],
      ['rover', 'Rover 2'],
    ]);
  });

  it('is kept by an undo after it was sent', () => {
    const { editor } = added();
    editor.edit((g) => renameGame(g, 'Rover'), 'game-name');
    editor.addAction('Jump');
    editor.undo();
    expect([editor.game.id, editor.game.actions.length]).toEqual(['rover', 0]);
  });

  it('of a game set up from Steam is its name’s, sent with its first action', () => {
    const { editor, calls } = open(newGame('Everspace 2', ['other'], 1128920), {
      saved: false,
      taken: ['other'],
    });
    editor.addAction('Boost');
    expect(calls.saveGame.mock.calls.map(([g]) => [g.id, g.steamAppId])).toEqual([
      ['everspace_2', 1128920],
    ]);
  });

  it('is not touched for a game main has: typing its name saves it, and done does nothing more', () => {
    const { editor, calls } = open();
    editor.edit((g) => renameGame(g, 'Rov'), 'game-name');
    editor.nameDone();
    expect(calls.saveGame.mock.calls.map(([g]) => [g.id, g.name])).toEqual([['rover', 'Rov']]);
  });

  it('is not sent while the game has no name', () => {
    const { editor, calls } = added();
    editor.nameDone();
    expect(calls.saveGame.mock.calls).toEqual([]);
  });
});

describe('the ids the game’s saved schemes name', () => {
  it('are never given to a new action or mode, though the game has forgotten them', () => {
    const { editor } = open(rover, { reserved: { modes: ['default_2'], actions: ['grapple'] } });
    editor.addAction('Grapple');
    const mode = editor.addMode();
    expect([editor.game.actions.at(-1)?.id, mode]).toEqual(['grapple_2', 'mode_2']);
  });

  it('are reserved for a mode named like one', () => {
    const { editor } = open(rover, { reserved: { modes: ['mode_2'], actions: [] } });
    expect(editor.addMode()).toBe('mode_2_2');
  });
});

describe('the wait and the question belong to the mode shown: every move ends them', () => {
  /** Two modes, Jump in Default: an edit to undo first, then the transient state. */
  const twoModes: Game = { ...rover, modes: [...rover.modes, { id: 'drive', name: 'Driving' }] };
  const STATES: [string, (e: GameEditor) => void][] = [
    ['waiting for Jump’s key', (e) => e.wait({ action: 'jump', part: 'key' })],
    ['waiting for Jump’s controller button', (e) => e.wait({ action: 'jump', part: 'pad' })],
    ['asking before Delete game', (e) => e.confirm(true)],
  ];
  const MOVES: [string, (e: GameEditor) => void][] = [
    ['another mode shown', (e) => e.setMode('drive')],
    ['a mode added, and shown', (e) => void e.addMode()],
    ['undo', (e) => e.undo()],
    [
      'redo',
      (e) => {
        e.undo();
        e.wait({ action: 'jump', part: 'key' });
        e.confirm(true);
        e.redo();
      },
    ],
  ];

  it('each state is there before the move', () => {
    const faults: string[] = [];
    for (const [state, start] of STATES) {
      const { editor } = open(twoModes);
      editor.edit((g) => renameGame(g, 'Rover 2'));
      start(editor);
      if (editor.state.waiting === null && !editor.state.confirming) faults.push(state);
    }
    expect(faults).toEqual([]);
  });

  it('after each move, nothing is waited for and nothing asked', () => {
    const faults: string[] = [];
    for (const [state, start] of STATES)
      for (const [move, by] of MOVES) {
        const { editor } = open(twoModes);
        editor.edit((g) => renameGame(g, 'Rover 2'));
        start(editor);
        by(editor);
        if (editor.state.waiting !== null || editor.state.confirming)
          faults.push(`${state}, then ${move}`);
      }
    expect(faults).toEqual([]);
  });

  it('a mode picked again, the one shown, ends nothing', () => {
    const { editor } = open(twoModes);
    editor.wait({ action: 'jump', part: 'key' });
    editor.setMode('default');
    expect(editor.state.waiting).toEqual({ action: 'jump', part: 'key' });
  });
});

describe('an edit main refuses', () => {
  const refusing = (after: number) => {
    let n = 0;
    return api({
      saveGame: () =>
        ++n > after
          ? Promise.reject(new Error('saveGame: the game needs a name.'))
          : Promise.resolve(),
    });
  };

  it('is undone, back to the game main took last, and says so in one sentence', async () => {
    const { editor } = open(rover, {}, refusing(1));
    editor.edit((g) => renameGame(g, 'Rover 2'));
    editor.edit((g) => renameGame(g, 'Rover 3'));
    await settle();
    expect([editor.game.name, editor.state.saveError]).toEqual([
      'Rover 2',
      "That change couldn't be saved, so it was undone. saveGame: the game needs a name.",
    ]);
  });

  it('goes back to the game as it opened when main took nothing', async () => {
    const { editor } = open(rover, {}, refusing(0));
    editor.edit((g) => renameGame(g, 'Rover 2'));
    await settle();
    expect(editor.game).toEqual(rover);
  });

  it("makes a new game's id afresh after going back to it: main never had the one it was given", async () => {
    let n = 0;
    const calls = api({
      saveGame: () => (++n === 1 ? Promise.reject(new Error('No.')) : Promise.resolve()),
    });
    const { editor } = open(newGame('', []), { saved: false, taken: [] }, calls);
    editor.edit((g) => renameGame(g, 'Rover'), NAME_FIELD);
    editor.nameDone();
    await settle();
    editor.edit((g) => renameGame(g, 'Skiff'), NAME_FIELD);
    editor.nameDone();
    await settle();
    expect(calls.saveGame.mock.calls.map(([g]) => g.id)).toEqual(['rover', 'skiff']);
  });

  it('puts away a read of the file made while the refused edit was on its way', async () => {
    let refuse = (): void => undefined;
    const calls = api({
      saveGame: () => new Promise<void>((_done, no) => (refuse = () => no(new Error('No.')))),
      readGameFile: () => Promise.resolve({ ok: false, message: 'No file.' }),
    });
    const { editor } = open(rover, { readsFile: true }, calls);
    editor.edit((g) => renameGame(g, 'Rover 2'));
    await editor.readFile();
    const during = editor.state.fileRead;
    refuse();
    await settle();
    expect([during, editor.state.fileRead]).toEqual([
      { kind: 'failed', message: 'No file.' },
      null,
    ]);
  });

  it('waits while a later edit may still be saved', async () => {
    let n = 0;
    const { editor } = open(
      rover,
      {},
      api({
        saveGame: () => (++n === 1 ? Promise.reject(new Error('busy')) : Promise.resolve()),
      }),
    );
    editor.edit((g) => renameGame(g, 'Rover 2'));
    editor.edit((g) => renameGame(g, 'Rover 3'));
    await settle();
    expect([editor.game.name, editor.state.saveError]).toEqual(['Rover 3', null]);
  });
});

describe("reading the game's own file", () => {
  /** Rover as its file has it now: Jump moved to J, and a new action. */
  const fileRover: Game = {
    ...rover,
    file: { format: 'unreal-ini' },
    actions: [
      {
        ...(rover.actions[0] as Game['actions'][number]),
        native: { key: { kind: 'key', code: 'J' } },
      },
      { id: 'duck', name: 'Duck', mode: 'default', required: false },
    ],
  };
  const reads = () =>
    api({ readGameFile: () => Promise.resolve({ ok: true, file: fileRover, held: null }) });

  it('is offered only for a game whose file helmArray reads', () => {
    expect([
      open(rover, { readsFile: true }).editor.readsFile,
      open(rover).editor.readsFile,
    ]).toEqual([true, false]);
  });

  it('shows what saving it changes, and saves nothing until asked', async () => {
    const { editor, calls } = open(rover, { readsFile: true }, reads());
    const reading = editor.readFile();
    const during = editor.state.fileRead;
    await reading;
    expect({
      during,
      read: editor.state.fileRead,
      asked: calls.readGameFile.mock.calls,
      saved: calls.saveGame.mock.calls.length,
    }).toEqual({
      during: 'reading',
      read: {
        kind: 'changes',
        game: expect.objectContaining({ file: { format: 'unreal-ini' } }) as Game,
        lines: [
          "Apply can write the game's controls file from now on.",
          '1 new action in Default: Duck.',
          'Jump keeps your default key, Space (the file has J).',
        ],
        moves: [],
      },
      asked: [['rover']],
      saved: 0,
    });
  });

  it('saves the changes with the one button, as one edit undo takes back', async () => {
    const { editor, calls } = open(rover, { readsFile: true }, reads());
    await editor.readFile();
    editor.takeFile();
    const taken = editor.game;
    editor.undo();
    expect({
      ids: taken.actions.map((a) => a.id),
      saved: calls.saveGame.mock.calls[0]?.[0],
      list: editor.state.fileRead,
      undone: editor.game,
    }).toEqual({ ids: ['jump', 'duck'], saved: taken, list: null, undone: rover });
  });

  it('keeps the key you set, on a game never read before: every value it has is yours', async () => {
    const { editor } = open(rover, { readsFile: true }, reads());
    await editor.readFile();
    editor.takeFile();
    expect(editor.game.actions[0]?.native?.key).toEqual({ kind: 'key', code: 'Space' });
  });

  it('puts the list away with Cancel, saving nothing', async () => {
    const { editor, calls } = open(rover, { readsFile: true }, reads());
    await editor.readFile();
    editor.dropFile();
    editor.takeFile();
    expect([editor.state.fileRead, editor.game, calls.saveGame.mock.calls.length]).toEqual([
      null,
      rover,
      0,
    ]);
  });

  it('drops a list made before an edit: it would undo the edit', async () => {
    const { editor } = open(rover, { readsFile: true }, reads());
    await editor.readFile();
    editor.edit((g) => renameGame(g, 'Rover 2'));
    editor.takeFile();
    expect([editor.state.fileRead, editor.game.name, editor.game.actions.length]).toEqual([
      null,
      'Rover 2',
      1,
    ]);
  });

  it('drops a list made before an undo', async () => {
    const { editor } = open(rover, { readsFile: true }, reads());
    editor.edit((g) => renameGame(g, 'Rover 2'));
    await editor.readFile();
    editor.undo();
    expect(editor.state.fileRead).toBeNull();
  });

  it("says why when the file can't be read, and when the ask itself fails", async () => {
    const failing = open(rover, { readsFile: true });
    await failing.editor.readFile();
    const broken = open(
      rover,
      { readsFile: true },
      api({ readGameFile: () => Promise.reject(new Error('IPC gone')) }),
    );
    await broken.editor.readFile();
    expect([failing.editor.state.fileRead, broken.editor.state.fileRead]).toEqual([
      { kind: 'failed', message: 'No file.' },
      { kind: 'failed', message: "Couldn't read the game's file. IPC gone" },
    ]);
  });

  it('asks once while a read is under way', async () => {
    const { editor, calls } = open(rover, { readsFile: true }, reads());
    const first = editor.readFile();
    await editor.readFile();
    await first;
    expect(calls.readGameFile).toHaveBeenCalledTimes(1);
  });
});

describe("reading the game's own file into a game typed in on the Game screen", () => {
  /** Rover as its file has it: Jump in Ground, a mode the game typed in doesn't have. */
  const fileRover: Game = {
    ...rover,
    file: { format: 'unreal-ini' },
    modes: [{ id: 'ground', name: 'Ground' }],
    actions: [{ id: 'Jump', name: 'Jump', mode: 'ground', required: false }],
  };
  const reads = (over: Partial<EditorApi> = {}) =>
    api({
      readGameFile: () => Promise.resolve({ ok: true, file: fileRover, held: null }),
      ...over,
    });
  const MOVE = { action: 'jump', mode: 'default', to: 'Jump', toMode: 'ground' };

  it('saves it with the moves, for main to follow everywhere at once, and not as a plain save', async () => {
    const { editor, calls } = open(rover, { readsFile: true }, reads());
    await editor.readFile();
    editor.takeFile();
    await settle();
    expect({
      file: calls.saveFileRead.mock.calls,
      plain: calls.saveGame.mock.calls.length,
      ids: editor.game.actions.map((a) => `${a.mode}/${a.id}`),
      saved: editor.state.saved,
    }).toEqual({
      file: [[editor.game, [MOVE]]],
      plain: 0,
      ids: ['ground/Jump'],
      saved: true,
    });
  });

  it('shows the mode tabs when the read leaves more than one mode', async () => {
    const twoModes: Game = {
      ...fileRover,
      modes: [...fileRover.modes, { id: 'air', name: 'Air' }],
      actions: [...fileRover.actions, { id: 'Fly', name: 'Fly', mode: 'air', required: false }],
    };
    const { editor } = open(
      rover,
      { readsFile: true },
      reads({ readGameFile: () => Promise.resolve({ ok: true, file: twoModes, held: null }) }),
    );
    const before = editor.state.modesShown;
    await editor.readFile();
    editor.takeFile();
    await settle();
    expect([before, editor.state.modesShown]).toEqual([false, true]);
  });

  it('makes a built-in game your copy once that save is done, and clears an earlier error', async () => {
    let fail = true;
    const { editor } = open(
      rover,
      { readsFile: true, builtIn: true },
      reads({
        saveGame: () => (fail ? Promise.reject(new Error('disk full')) : Promise.resolve()),
      }),
    );
    editor.edit((g) => renameGame(g, 'Rover 2'));
    await settle();
    const before = [editor.state.edited, editor.state.saveError !== null];
    fail = false;
    await editor.readFile();
    editor.takeFile();
    await settle();
    expect([before, editor.state.edited, editor.state.saveError]).toEqual([
      [false, true],
      true,
      null,
    ]);
  });

  it('goes back to the read once main has saved it when the next edit is refused, and takes edits again', async () => {
    let n = 0;
    const { editor } = open(
      rover,
      { readsFile: true },
      reads({ saveGame: () => (++n === 1 ? Promise.reject(new Error('No.')) : Promise.resolve()) }),
    );
    await editor.readFile();
    editor.takeFile();
    await settle();
    const read = editor.game;
    editor.edit((g) => renameGame(g, 'Rover 2'));
    await settle();
    const back = editor.game;
    editor.edit((g) => renameGame(g, 'Rover 3'));
    await settle();
    expect([back === read, read.actions[0]?.id, editor.game.name]).toEqual([
      true,
      'Jump',
      'Rover 3',
    ]);
  });

  it("can't be undone once main has saved it: the setups already follow the file's ids", async () => {
    const { editor } = open(rover, { readsFile: true }, reads());
    editor.edit((g) => renameGame(g, 'Rover 2'));
    await editor.readFile();
    editor.takeFile();
    await settle();
    expect([editor.canUndo, editor.canRedo]).toEqual([false, false]);
  });

  it("isn't taken until main has saved it: nothing changes here, and edits wait, meanwhile", async () => {
    let finish = (): void => undefined;
    const { editor, calls } = open(
      rover,
      { readsFile: true },
      reads({ saveFileRead: () => new Promise<void>((done) => (finish = done)) }),
    );
    await editor.readFile();
    editor.takeFile();
    editor.edit((g) => renameGame(g, 'Rover 2'));
    const during = [editor.game, editor.state.busy, calls.saveGame.mock.calls.length];
    finish();
    await settle();
    expect([during, editor.game.actions.map((a) => a.id), editor.state.busy]).toEqual([
      [rover, true, 0],
      ['Jump'],
      false,
    ]);
  });

  it("keeps the game and its history when main refuses it, says so, and a later edit saves the game's own ids (Codex's case)", async () => {
    const { editor, calls } = open(
      rover,
      { readsFile: true },
      reads({
        saveFileRead: () =>
          Promise.reject(
            new Error(
              "Error invoking remote method 'helm:save-file-read': StoreError: sheets.json was left as it was: This list of bindings to set in the game was saved by a newer helmArray. Update helmArray to open it.",
            ),
          ),
      }),
    );
    editor.edit((g) => renameGame(g, 'Rover 2'));
    await editor.readFile();
    editor.takeFile();
    await settle();
    const after = {
      game: editor.game,
      canUndo: editor.canUndo,
      read: editor.state.fileRead,
    };
    editor.edit((g) => renameGame(g, 'Rover 3'));
    expect([after, calls.saveGame.mock.calls.at(-1)?.[0]?.actions.map((a) => a.id)]).toEqual([
      {
        game: { ...rover, name: 'Rover 2' },
        canUndo: true,
        read: {
          kind: 'failed',
          message:
            "What was read from the game's file wasn't saved, so nothing changed. sheets.json was left as it was: This list of bindings to set in the game was saved by a newer helmArray. Update helmArray to open it.",
        },
      },
      ['jump'],
    ]);
  });

  it('keeps a mode a setup still places something else in', async () => {
    const { editor } = open(
      rover,
      { readsFile: true, uses: [{ mode: 'default', action: 'gone' }] },
      reads(),
    );
    await editor.readFile();
    editor.takeFile();
    await settle();
    expect(editor.game.modes.map((m) => m.id)).toEqual(['default', 'ground']);
  });
});

describe("reading the game's own file, with setups made before the game had its file format", () => {
  /** Rover's file: Run only, none of the game's actions by name, so nothing moves. */
  const fileRover: Game = {
    ...rover,
    file: { format: 'unreal-ini' },
    actions: [{ id: 'Run', name: 'Run', mode: 'default', required: false }],
  };
  const reads = (over: Partial<EditorApi> = {}) =>
    api({
      readGameFile: () => Promise.resolve({ ok: true, file: fileRover, held: null }),
      ...over,
    });

  it('says the setups will now write the controls file', async () => {
    const { editor } = open(rover, { readsFile: true, setupsOff: 2 }, reads());
    await editor.readFile();
    const read = editor.state.fileRead;
    expect(read !== null && read !== 'reading' && read.kind === 'changes' && read.lines).toContain(
      'Your 2 setups for Rover will now write its controls file.',
    );
  });

  it('saves it through main with the setups, though nothing moved, and not as a plain save', async () => {
    const { editor, calls } = open(rover, { readsFile: true, setupsOff: 2 }, reads());
    await editor.readFile();
    editor.takeFile();
    await settle();
    expect({
      file: calls.saveFileRead.mock.calls,
      plain: calls.saveGame.mock.calls.length,
      canUndo: editor.canUndo,
      saved: editor.state.saved,
    }).toEqual({ file: [[editor.game, []]], plain: 0, canUndo: false, saved: true });
  });

  it('says nothing of the setups on the next read, once main has turned them on', async () => {
    const { editor } = open(rover, { readsFile: true, setupsOff: 2 }, reads());
    await editor.readFile();
    editor.takeFile();
    await settle();
    await editor.readFile();
    expect(editor.state.fileRead).toMatchObject({ kind: 'same' });
  });

  it('is a plain edit, to undo like any other, with no setup to turn on', async () => {
    const { editor, calls } = open(rover, { readsFile: true }, reads());
    await editor.readFile();
    editor.takeFile();
    await settle();
    expect({
      file: calls.saveFileRead.mock.calls.length,
      plain: calls.saveGame.mock.calls.length,
      canUndo: editor.canUndo,
    }).toEqual({ file: 0, plain: 1, canUndo: true });
  });
});

describe('a game read from its file and not saved yet', () => {
  it('is saved under the id helmArray knows it by at its first edit', () => {
    const { editor, calls } = open(
      { ...rover, id: 'everspace2', name: 'Everspace 2' },
      { saved: false, found: true },
    );
    editor.edit((g) => renameGame(g, 'ES2'));
    expect(calls.saveGame.mock.calls[0]?.[0]?.id).toBe('everspace2');
  });
});
