// The Game screen's state, outside React: the game and its undo history, the mode shown, what a
// press is waited for, and saving. Every edit goes through here; the screen draws `state` and calls
// the methods. Pure of the DOM: main is reached through the API handed in, so tests use fakes.

import type { Action, ActionId, Game, ModeId, PadControl, Signal } from '@helmarray/core';
import { gameProblem } from '@helmarray/core';
import type { HelmApi, Preset } from '../../shared/api';
import { canUndo, redo, startHistory, undo } from './editor-model';
import type { History } from './editor-model';
import {
  actionsIn,
  addAction,
  addMode,
  canStartFrom,
  deleteMode,
  record,
  setDefaultKey,
  setDefaultPad,
} from './game-model';
import { plainReason, runMake } from './libraryFlow';

/** What the screen waits for a press of: an action's default key, or its controller button. */
export interface Waiting {
  action: ActionId;
  part: 'key' | 'pad';
}

export type EditorApi = Pick<HelmApi, 'saveGame' | 'deleteGame' | 'createScheme' | 'setActive'>;

export interface Loaded {
  game: Game;
  /** A game that ships with helmArray: an edit makes it your copy. */
  builtIn: boolean;
  /** It is your copy already. */
  edited: boolean;
  /** Main has it: a game set up from Steam is not saved until its first edit. */
  saved: boolean;
}

export interface GameEditorState {
  history: History<Game>;
  saved: boolean;
  edited: boolean;
  /** The mode shown, as picked; `GameEditor.mode` is the one that exists. */
  mode: ModeId;
  waiting: Waiting | null;
  /** Asking before *Delete game* or *Back to helmArray's*. */
  confirming: boolean;
  /** A scheme is being made, or the game deleted: further clicks wait. */
  busy: boolean;
  saveError: string | null;
  /** One plain sentence when making a scheme or deleting failed. */
  notice: string | null;
  /** What is typed in the new-action field. */
  draft: string;
}

export class GameEditor {
  private readonly builtIn: boolean;
  private current: GameEditorState;
  private readonly listeners = new Set<() => void>();
  /** The text field the last edit was typed in, so typing is one step to undo. */
  private lastField: string | null = null;

  constructor(
    loaded: Loaded,
    private readonly api: EditorApi,
  ) {
    this.current = {
      history: startHistory(loaded.game),
      saved: loaded.saved,
      edited: loaded.edited,
      mode: loaded.game.modes[0]?.id ?? 'default',
      waiting: null,
      confirming: false,
      busy: false,
      saveError: null,
      notice: null,
      draft: '',
    };
    this.builtIn = loaded.builtIn;
  }

  get state(): GameEditorState {
    return this.current;
  }

  get game(): Game {
    return this.current.history.present;
  }

  /** The first thing wrong with the game, or null: it is saved only when whole. */
  get problem(): string | null {
    return gameProblem(this.game);
  }

  /** The mode shown: the one picked while it exists, else the first. */
  get mode(): ModeId {
    const { modes } = this.game;
    return modes.some((m) => m.id === this.current.mode)
      ? this.current.mode
      : (modes[0]?.id ?? 'default');
  }

  /** The actions of the mode shown, in order. */
  get rows(): Action[] {
    return actionsIn(this.game, this.mode);
  }

  /** What a scheme of the game can start from now; nothing while it isn't whole. */
  get starts(): Preset[] {
    return this.problem === null ? canStartFrom(this.game) : [];
  }

  get canUndo(): boolean {
    return canUndo(this.current.history);
  }

  /** For `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private set(patch: Partial<GameEditorState>): void {
    this.current = { ...this.current, ...patch };
    // A wait for an action that is gone (undone) ends.
    const waiting = this.current.waiting;
    if (waiting !== null && !this.game.actions.some((a) => a.id === waiting.action))
      this.current = { ...this.current, waiting: null };
    for (const listener of this.listeners) listener();
  }

  private save(game: Game): void {
    if (gameProblem(game) !== null) return;
    this.api.saveGame(game).then(
      () => this.set({ saved: true, edited: this.builtIn, saveError: null }),
      (error: unknown) =>
        this.set({ saveError: `Couldn't save the game. ${plainReason(error)}`.trim() }),
    );
  }

  /** An edit: into the history, and saved. `field` names a text field, so typing is one step. */
  readonly edit = (fn: (game: Game) => Game, field: string | null = null): void => {
    const before = this.current.history;
    const next = fn(before.present);
    if (next === before.present) return;
    const history = record(before, next, field, this.lastField);
    this.lastField = field;
    this.set({ history });
    this.save(next);
  };

  private travel(step: (h: History<Game>) => History<Game>): void {
    const history = step(this.current.history);
    if (history === this.current.history) return;
    this.lastField = null;
    this.set({ history });
    this.save(history.present);
  }

  readonly undo = (): void => {
    this.travel(undo);
  };

  readonly redo = (): void => {
    this.travel(redo);
  };

  readonly setMode = (mode: ModeId): void => {
    this.set({ mode });
  };

  /** Adds a mode named for its place (*Mode 2*) and shows it. Gives its id back. */
  readonly addMode = (): ModeId => {
    const added = addMode(this.game, `Mode ${this.game.modes.length + 1}`);
    this.edit(() => added.game);
    this.set({ mode: added.id });
    return added.id;
  };

  readonly deleteMode = (mode: ModeId): void => {
    this.edit((g) => deleteMode(g, mode));
  };

  /** What is typed in the new-action field. */
  readonly type = (draft: string): void => {
    this.set({ draft });
  };

  /** Adds the action typed in the new-action field, and empties it. */
  readonly addDraft = (): void => {
    if (this.current.draft.trim() === '') return;
    const name = this.current.draft;
    this.set({ draft: '' });
    this.addAction(name);
  };

  /** Adds an action to the mode shown, then waits for its key. Nothing for an empty name. */
  readonly addAction = (name: string): void => {
    if (name.trim() === '') return;
    const added = addAction(this.game, this.mode, name);
    this.edit(() => added.game);
    this.set({ waiting: { action: added.id, part: 'key' } });
  };

  readonly wait = (waiting: Waiting): void => {
    this.set({ waiting });
  };

  readonly cancelWait = (): void => {
    if (this.current.waiting !== null) this.set({ waiting: null });
  };

  /** The press waited for: a key or mouse button, or a controller button. */
  readonly press = (value: Signal | PadControl): void => {
    const waiting = this.current.waiting;
    if (waiting === null) return;
    const isPad = typeof value === 'string';
    if (isPad !== (waiting.part === 'pad')) return;
    this.edit((g) =>
      typeof value === 'string'
        ? setDefaultPad(g, waiting.action, value)
        : setDefaultKey(g, waiting.action, value),
    );
    this.set({ waiting: null });
  };

  readonly confirm = (asking: boolean): void => {
    this.set({ confirming: asking });
  };

  /** Makes a scheme of the game from a preset, the active one. Its id, or null (and a notice). */
  readonly start = async (preset: Preset): Promise<string | null> => {
    if (this.current.busy) return null;
    this.set({ busy: true, notice: null });
    const outcome = await runMake(this.api, this.game.id, preset);
    this.set({ busy: false, notice: outcome.ok ? null : outcome.message });
    return outcome.ok ? outcome.schemeId : null;
  };

  /** Deletes the game you added, or drops your copy of a built-in one. Whether it was done. */
  readonly drop = async (): Promise<boolean> => {
    if (this.current.busy) return false;
    this.set({ busy: true, notice: null });
    try {
      await this.api.deleteGame(this.game.id);
      this.set({ busy: false });
      return true;
    } catch (error) {
      this.set({ busy: false, confirming: false, notice: plainReason(error) });
      return false;
    }
  };
}
