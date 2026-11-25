import type { Game, Scheme } from '@helmarray/core';
import { blankKeysScheme } from '@helmarray/core';
import { describe, expect, it, vi } from 'vitest';
import type { HelmApi } from '../../shared/api';
import { GameEditor } from './game-editor';
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

  it('says so in one sentence when main refuses the save', async () => {
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
    expect(editor.state.saveError).toBe("Couldn't save the game. The disk is full.");
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
    expect(open().editor.starts).toEqual(['xbox', 'keys']);
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
