// The Game screen's parts, drawn from what they are given: no state of their own, so each can be
// drawn to markup and its handlers called in a test. The screen (Game.tsx) holds the state in a
// GameEditor and listens for presses; these only show and report.

import type { RefObject } from 'react';
import { Popover } from 'radix-ui';
import type { Action, Game, ModeId, PadControl, Role, Signal } from '@helmarray/core';
import { PAD_CONTROLS, ROLES } from '@helmarray/core';
import type { Preset } from '../../shared/api';
import { CANT_PRESS, mouseSignalOf } from './capture';
import { padWord, signalText } from './editor-view';
import type { Waiting } from './game-editor';
import {
  actionsIn,
  deleteAction,
  moveAction,
  moveMode,
  renameGame,
  renameMode,
  setDefaultKey,
  setDefaultPad,
  updateAction,
} from './game-model';

/** An edit of the game, and the text field it was typed in (so typing is one step to undo). */
export type Edit = (fn: (game: Game) => Game, field?: string | null) => void;

export const ROLE_WORDS: Record<Role, string> = {
  combat: 'Combat',
  movement: 'Movement',
  ability: 'Ability',
  travel: 'Travel',
  menu: 'Menu',
};

export const PRESET_WORDS: Record<Preset, string> = {
  xbox: 'Xbox controller',
  keys: "Game's own keys",
};

/** The action's name as the screen says it: an action being renamed to nothing is "This action". */
const nameOf = (action: Action) => (action.name.trim() === '' ? 'This action' : action.name);

export function BackLink({ onBack }: { onBack(): void }) {
  return (
    <button type="button" className="btn ghost gm-back" onClick={onBack}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      Library
    </button>
  );
}

/** The line under the game's name: whose game it is. */
export function titleNote(builtIn: boolean, edited: boolean, saved: boolean): string {
  if (builtIn)
    return edited
      ? "Your copy of helmArray's game"
      : "helmArray's game. Your edits are kept as your copy.";
  return saved ? 'Added by you' : 'New game';
}

export interface TitleBarProps {
  game: Game;
  builtIn: boolean;
  edited: boolean;
  saved: boolean;
  canUndo: boolean;
  confirming: boolean;
  busy: boolean;
  starts: readonly Preset[];
  nameRef?: RefObject<HTMLInputElement | null>;
  edit: Edit;
  onBack(): void;
  onUndo(): void;
  onConfirm(asking: boolean): void;
  onDrop(): void;
  onStart(preset: Preset): void;
}

/** The bar: back, the game's name (edited in place), undo, drop or delete, and *New scheme from*. */
export function TitleBar({
  game,
  builtIn,
  edited,
  saved,
  canUndo,
  confirming,
  busy,
  starts,
  nameRef,
  edit,
  onBack,
  onUndo,
  onConfirm,
  onDrop,
  onStart,
}: TitleBarProps) {
  return (
    <div className="gm-bar">
      <BackLink onBack={onBack} />
      <div className="gm-titles">
        <h1 className="sr-only">{game.name.trim() === '' ? 'New game' : game.name}</h1>
        <input
          ref={nameRef}
          className="gm-name"
          aria-label="Game name"
          placeholder="Name the game"
          value={game.name}
          onChange={(e) => {
            const name = e.target.value;
            edit((g) => renameGame(g, name), 'game-name');
          }}
        />
        <span className="gm-note">{titleNote(builtIn, edited, saved)}</span>
      </div>
      <div className="gm-spacer" />
      <button
        type="button"
        className="btn icon"
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M5 4L2 7l3 3M2 7h7.5a4 4 0 010 8H7" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
      {builtIn && edited && !confirming && (
        <button type="button" className="btn ghost" onClick={() => onConfirm(true)}>
          Back to helmArray&apos;s
        </button>
      )}
      {!builtIn && saved && !confirming && (
        <button type="button" className="btn ghost gm-danger" onClick={() => onConfirm(true)}>
          Delete game
        </button>
      )}
      {confirming && (
        <div className="gm-confirm" role="group" aria-label="Are you sure?">
          <span>{builtIn ? 'Drop your edits?' : `Delete ${game.name}? Its schemes are kept.`}</span>
          <button type="button" className="btn gm-danger-solid" disabled={busy} onClick={onDrop}>
            {builtIn ? "Back to helmArray's" : 'Delete'}
          </button>
          <button type="button" className="btn ghost" onClick={() => onConfirm(false)}>
            Keep it
          </button>
        </div>
      )}
      {starts.length > 0 && (
        <div className="gm-start" role="group" aria-label="New scheme from">
          <span className="gm-start-label">New scheme from</span>
          {starts.map((preset) => (
            <button
              key={preset}
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onStart(preset)}
            >
              {PRESET_WORDS[preset]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sentences about what is wrong: each one line, read out as it appears. */
export function Notices({ lines }: { lines: readonly (string | null)[] }) {
  return (
    <>
      {lines
        .filter((line): line is string => line !== null)
        .map((line) => (
          <p key={line} className="notice tone-error gm-notice" role="alert">
            {line}
          </p>
        ))}
    </>
  );
}

/** The mode tabs, each with its count of actions, and *Add mode*. */
export function ModeTabs({
  game,
  mode,
  onMode,
  onAddMode,
}: {
  game: Game;
  mode: ModeId;
  onMode(mode: ModeId): void;
  onAddMode(): void;
}) {
  return (
    <div className="gm-modes">
      <div className="gm-tabs" role="tablist" aria-label="Modes">
        {game.modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={m.id === mode}
            className="gm-tab"
            onClick={() => onMode(m.id)}
          >
            {m.name.trim() === '' ? 'Unnamed' : m.name}
            <span className="gm-count">{actionsIn(game, m.id).length}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn ghost small" onClick={onAddMode}>
        Add mode
      </button>
    </div>
  );
}

/** The mode's name, and with more than one mode, moving and deleting it. */
export function ModeHead({
  game,
  mode,
  inputRef,
  edit,
  onDeleteMode,
}: {
  game: Game;
  mode: ModeId;
  inputRef?: RefObject<HTMLInputElement | null>;
  edit: Edit;
  onDeleteMode(mode: ModeId): void;
}) {
  const current = game.modes.find((m) => m.id === mode);
  return (
    <div className="gm-mode-head">
      <label className="gm-mode-name">
        <span className="gm-eyebrow">Mode</span>
        <input
          ref={inputRef}
          aria-label="Mode name"
          value={current?.name ?? ''}
          onChange={(e) => {
            const name = e.target.value;
            edit((g) => renameMode(g, mode, name), `mode-name:${mode}`);
          }}
        />
      </label>
      {game.modes.length > 1 && (
        <div className="gm-mode-tools">
          <button
            type="button"
            className="btn ghost small"
            disabled={game.modes[0]?.id === mode}
            onClick={() => edit((g) => moveMode(g, mode, -1))}
          >
            Move left
          </button>
          <button
            type="button"
            className="btn ghost small"
            disabled={game.modes.at(-1)?.id === mode}
            onClick={() => edit((g) => moveMode(g, mode, 1))}
          >
            Move right
          </button>
          <button
            type="button"
            className="btn ghost small gm-danger"
            onClick={() => onDeleteMode(mode)}
          >
            Delete mode
          </button>
        </div>
      )}
    </div>
  );
}

export interface PressFieldProps {
  part: 'key' | 'pad';
  /** The action's name, for the field's own. */
  name: string;
  /** What the default is, in words; null when there is none. */
  text: string | null;
  waiting: boolean;
  onStart(): void;
  /** A mouse button pressed on the field while it waits for a key. */
  onMouse(signal: Signal): void;
  onClear(): void;
}

/**
 * One default: what it is, in mono like a key's caption, dashed when there is none, amber while
 * a press is waited for. A click waits; Delete clears. Its name always holds what it shows.
 */
export function PressField({
  part,
  name,
  text,
  waiting,
  onStart,
  onMouse,
  onClear,
}: PressFieldProps) {
  const what = part === 'key' ? 'key' : 'controller button';
  const shown = waiting ? (part === 'key' ? 'Press a key' : 'Press a button') : (text ?? 'Set');
  const label = waiting
    ? `${shown} for ${name}`
    : text === null
      ? `Set ${name}'s ${what}`
      : `${name}, ${what}: ${text}`;
  return (
    <span className="gm-press-cell" data-wait-zone={waiting ? '' : undefined}>
      <button
        type="button"
        className={`gm-press${text === null ? ' empty' : ''}${waiting ? ' waiting' : ''}`}
        aria-label={label}
        title={waiting ? undefined : `Click, then press the ${what}. Delete clears it.`}
        onClick={() => {
          if (!waiting) onStart();
        }}
        onMouseDown={(e) => {
          if (!waiting || part !== 'key') return;
          e.preventDefault();
          const signal = mouseSignalOf(e.button);
          if (signal !== null) onMouse(signal);
        }}
        onContextMenu={(e) => {
          if (waiting) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (!waiting && (e.key === 'Delete' || e.key === 'Backspace') && text !== null) {
            e.preventDefault();
            onClear();
          }
        }}
      >
        {shown}
      </button>
      {!waiting && text !== null && (
        <button
          type="button"
          className="gm-clear"
          tabIndex={-1}
          aria-label={`Clear ${name}'s ${what}`}
          onClick={onClear}
        >
          ×
        </button>
      )}
    </span>
  );
}

/**
 * Under a row while it waits: what to press, the list of what a press can't set (for a key: Tab,
 * Esc, the Windows keys, Print Screen; for a controller with none plugged in: every button), and
 * Cancel.
 */
export function WaitStrip({
  action,
  part,
  onPick,
  onCancel,
}: {
  action: Action;
  part: 'key' | 'pad';
  onPick(value: Signal | PadControl): void;
  onCancel(): void;
}) {
  const name = nameOf(action);
  return (
    <div className="gm-wait" data-wait-zone data-wait-strip>
      <span className="gm-wait-text" role="status">
        {part === 'key'
          ? `Press ${name}'s key or mouse button. Esc cancels.`
          : `Press ${name}'s button on the controller. Esc cancels.`}
      </span>
      <label className="gm-pick">
        <span>{part === 'key' ? 'Or pick' : 'No controller? Pick'}</span>
        <select
          aria-label={part === 'key' ? "Keys a press can't set" : 'Controller buttons'}
          value=""
          onChange={(e) => {
            const value = e.target.value;
            if (value === '') return;
            onPick(
              part === 'key' ? ({ kind: 'key', code: value } as Signal) : (value as PadControl),
            );
          }}
        >
          <option value="">…</option>
          {(part === 'key' ? CANT_PRESS : PAD_CONTROLS).map((v) => (
            <option key={v} value={v}>
              {part === 'key'
                ? signalText({ kind: 'key', code: v } as Signal)
                : padWord(v as PadControl)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn ghost small" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export interface ActionRowProps {
  action: Action;
  first: boolean;
  last: boolean;
  /** What this row waits for a press of, or null. */
  waiting: Waiting['part'] | null;
  edit: Edit;
  onWait(waiting: Waiting): void;
  onPress(value: Signal | PadControl): void;
  onCancel(): void;
}

/** One action: its name, role, required, default key and controller button, and More. */
export function ActionRow({
  action,
  first,
  last,
  waiting,
  edit,
  onWait,
  onPress,
  onCancel,
}: ActionRowProps) {
  const name = nameOf(action);
  const id = action.id;
  return (
    <>
      <tr
        className="gm-row"
        onKeyDown={(e) => {
          // Alt+Up and Alt+Down move the action, from anywhere in its row.
          if (waiting !== null || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown'))
            return;
          e.preventDefault();
          edit((g) => moveAction(g, id, e.key === 'ArrowUp' ? -1 : 1));
        }}
      >
        <td>
          <span className={`gm-role-dot role-${action.role}`} aria-hidden="true" />
          <input
            className="gm-action-name"
            aria-label={`${name}, name`}
            value={action.name}
            onChange={(e) => {
              const value = e.target.value;
              edit((g) => updateAction(g, id, { name: value }), `name:${id}`);
            }}
          />
        </td>
        <td>
          <select
            className="gm-role"
            aria-label={`${name}, role`}
            value={action.role}
            onChange={(e) => {
              const role = e.target.value as Role;
              edit((g) => updateAction(g, id, { role }));
            }}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_WORDS[role]}
              </option>
            ))}
          </select>
        </td>
        <td className="gm-center">
          <input
            type="checkbox"
            className="gm-check"
            aria-label={`${name} is required`}
            checked={action.required}
            onChange={(e) => {
              const required = e.target.checked;
              edit((g) => updateAction(g, id, { required }));
            }}
          />
        </td>
        <td>
          <PressField
            part="key"
            name={name}
            text={action.native?.key === undefined ? null : signalText(action.native.key)}
            waiting={waiting === 'key'}
            onStart={() => onWait({ action: id, part: 'key' })}
            onMouse={onPress}
            onClear={() => edit((g) => setDefaultKey(g, id, null))}
          />
        </td>
        <td>
          <PressField
            part="pad"
            name={name}
            text={action.native?.pad === undefined ? null : padWord(action.native.pad)}
            waiting={waiting === 'pad'}
            onStart={() => onWait({ action: id, part: 'pad' })}
            onMouse={onPress}
            onClear={() => edit((g) => setDefaultPad(g, id, null))}
          />
        </td>
        <td className="gm-center">
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" className="btn icon ghost" aria-label={`More for ${name}`}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="3" cy="8" r="1.5" fill="currentColor" />
                  <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                  <circle cx="13" cy="8" r="1.5" fill="currentColor" />
                </svg>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="popover" sideOffset={6} aria-label={`More for ${name}`}>
                <div className="choices">
                  <button
                    type="button"
                    className="btn"
                    disabled={first}
                    onClick={() => edit((g) => moveAction(g, id, -1))}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={last}
                    onClick={() => edit((g) => moveAction(g, id, 1))}
                  >
                    Move down
                  </button>
                  <Popover.Close asChild>
                    <button
                      type="button"
                      className="btn gm-danger"
                      onClick={() => edit((g) => deleteAction(g, id))}
                    >
                      Delete {name}
                    </button>
                  </Popover.Close>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </td>
      </tr>
      {waiting !== null && (
        <tr className="gm-wait-row">
          <td colSpan={6}>
            <WaitStrip action={action} part={waiting} onPick={onPress} onCancel={onCancel} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The mode's actions, or a line saying there are none yet. */
export function ActionTable({
  rows,
  waiting,
  edit,
  onWait,
  onPress,
  onCancel,
}: {
  rows: readonly Action[];
  waiting: Waiting | null;
  edit: Edit;
  onWait(waiting: Waiting): void;
  onPress(value: Signal | PadControl): void;
  onCancel(): void;
}) {
  if (rows.length === 0) {
    return (
      <p className="gm-empty">
        No actions yet. Type one below and press Enter, then press its key.
      </p>
    );
  }
  return (
    <table className="gm-table">
      <thead>
        <tr>
          <th scope="col">Action</th>
          <th scope="col">Role</th>
          <th scope="col">Required</th>
          <th scope="col">Key</th>
          <th scope="col">Controller</th>
          <th scope="col">
            <span className="sr-only">More</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((action, i) => (
          <ActionRow
            key={action.id}
            action={action}
            first={i === 0}
            last={i === rows.length - 1}
            waiting={waiting?.action === action.id ? waiting.part : null}
            edit={edit}
            onWait={onWait}
            onPress={onPress}
            onCancel={onCancel}
          />
        ))}
      </tbody>
    </table>
  );
}

/** The new-action field: type a name, Enter, and the new action waits for its key. */
export function AddAction({
  draft,
  inputRef,
  onType,
  onAdd,
}: {
  draft: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onType(text: string): void;
  onAdd(): void;
}) {
  return (
    <form
      className="gm-add"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd();
      }}
    >
      <input
        ref={inputRef}
        aria-label="New action"
        placeholder="New action: type its name, press Enter"
        value={draft}
        onChange={(e) => onType(e.target.value)}
      />
      <button type="submit" className="btn" disabled={draft.trim() === ''}>
        Add
      </button>
    </form>
  );
}
