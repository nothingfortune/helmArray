// The Editor screen (docs/plans/03-ui-system.md, canvas board docs/design/canvas/Editor.dc.html):
// both units big in the middle, the checks under them, the selected button and the actions not
// on a button yet in the side panel. It owns nothing outside itself: the app mounts it with a
// scheme id and a way back. Edits are pure functions in ./editor-model, what is drawn is worked
// out in ./editor-view, and both are tested without a DOM.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover, Tooltip } from 'radix-ui';
import { BUILT_IN_DEVICES, resolve } from '@helmarray/core';
import type {
  AzeronUse,
  ControlId,
  Game,
  PadControl,
  Plan,
  Press,
  Role,
  Scheme,
} from '@helmarray/core';
import type { Preset } from '../../shared/api';
import { Controller, Keyboard, Mouse } from '../devices/Devices';
import { dragAction } from '../devices/drag';
import { Unit } from '../unit/Unit';
import type { UnitProps } from '../unit/Unit';
import {
  NAME_LIMIT,
  acceptFinding,
  assign,
  canRedo,
  canUndo,
  chooseAzerons,
  chooseController,
  chooseKeyboard,
  clear,
  commit,
  adoptLedger,
  hasDevices,
  historyAction,
  isStick,
  isTextEntry,
  move,
  redo,
  renameScheme,
  setDevices,
  setLatch,
  setOutput,
  setPadControl,
  setTurbo,
  startHistory,
  undo,
  unacceptFinding,
} from './editor-model';
import type { History } from './editor-model';
import { assignable, editorView } from './editor-view';
import type { DeviceTabId, EditorView, FindingRow, PanelView, UnitSide } from './editor-view';
import { runMake, runPick } from './libraryFlow';
import { runCopy, runDelete } from './schemeFlow';
import './editor.css';

export interface EditorProps {
  /** The scheme to edit. A different id is a different editing session: its undo starts empty. */
  schemeId: string;
  /** The way back to the library. */
  onBack(): void;
  /**
   * Opens another setup of the game (switched to, made, or what is left after a delete). Without it
   * the Scheme picker only names the setup open.
   */
  onOpenScheme?(schemeId: string): void;
  /** Opens the Apply drawer. Without it the Apply button is shown, disabled, with a reason. */
  onApply?(): void;
  /**
   * Turns the Ctrl+Z / Ctrl+Y history shortcuts off. Set while something is over the editor (the
   * Apply drawer): an undo underneath would change the scheme being applied.
   */
  historyOff?: boolean;
  /**
   * Counts the applies that wrote the scheme's keys. When it changes the editor reads the scheme
   * again and takes its ledger: otherwise its next autosave would put the old, shorter one back
   * and a later edit would give buttons other keys.
   */
  keysKept?: number;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; scheme: Scheme; game: Game }
  | { kind: 'gone' }
  | { kind: 'no-game' }
  | { kind: 'failed' };

const PRESS_WORD: Record<Press, string> = { tap: 'tap', long: 'long press', double: 'double tap' };

const roleColour = (role: Role | undefined): string =>
  role === undefined ? 'var(--color-muted)' : `var(--color-${role})`;

function BackLink({ onBack }: { onBack(): void }) {
  return (
    <button type="button" className="btn ghost ed-back" onClick={onBack}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      Library
    </button>
  );
}

/** Loads the scheme and its game, then hands them to the editor. Keyed by scheme id. */
function EditorLoader({
  schemeId,
  onBack,
  onOpenScheme,
  onApply,
  historyOff,
  keysKept,
}: EditorProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const scheme = await window.helm.getScheme(schemeId);
        if (scheme === null) {
          if (current) setLoad({ kind: 'gone' });
          return;
        }
        const games = await window.helm.listGames();
        const entry = games.find((g) => g.game.id === scheme.gameId);
        if (!current) return;
        setLoad(entry ? { kind: 'ready', scheme, game: entry.game } : { kind: 'no-game' });
      } catch {
        if (current) setLoad({ kind: 'failed' });
      }
    })();
    return () => {
      current = false;
    };
  }, [schemeId]);

  if (load.kind === 'ready') {
    return (
      <EditorBody
        scheme={load.scheme}
        game={load.game}
        onBack={onBack}
        onOpenScheme={onOpenScheme}
        onApply={onApply}
        historyOff={historyOff === true}
        keysKept={keysKept ?? 0}
      />
    );
  }
  const words: Record<Exclude<Load['kind'], 'ready'>, string> = {
    loading: 'Opening the scheme…',
    gone: "This scheme isn't there any more.",
    'no-game': "This scheme's game isn't in your library.",
    failed: "Couldn't open this scheme.",
  };
  return (
    <div className="editor">
      <div className="ed-bar">
        <BackLink onBack={onBack} />
      </div>
      <p className="ed-state" role="status">
        {words[load.kind]}
      </p>
    </div>
  );
}

/** The editor for one scheme. */
export function Editor(props: EditorProps) {
  return <EditorLoader key={props.schemeId} {...props} />;
}

function unitProps(side: UnitSide): Pick<UnitProps, 'keys' | 'conflicts' | 'stick'> {
  return {
    keys: side.keys,
    conflicts: side.conflicts,
    ...(side.stick === undefined ? {} : { stick: side.stick }),
  };
}

interface BodyProps {
  scheme: Scheme;
  game: Game;
  onBack(): void;
  onOpenScheme: ((schemeId: string) => void) | undefined;
  onApply: (() => void) | undefined;
  historyOff: boolean;
  keysKept: number;
}

function EditorBody({
  scheme: loaded,
  game,
  onBack,
  onOpenScheme,
  onApply,
  historyOff,
  keysKept,
}: BodyProps) {
  const [history, setHistory] = useState<History<Scheme>>(() => startHistory(loaded));
  const historyRef = useRef(history);
  const [mode, setMode] = useState(() => game.modes[0]?.id ?? 'default');
  const [selected, setSelected] = useState<ControlId | undefined>(undefined);
  const [press, setPress] = useState<Press>('tap');
  const [tab, setTab] = useState<DeviceTabId | undefined>(undefined);
  const [saveFailed, setSaveFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /** Applies a change to the history and saves the scheme if it changed. Never inside an updater. */
  const change = useCallback((next: (h: History<Scheme>) => History<Scheme>) => {
    const before = historyRef.current;
    const after = next(before);
    if (after === before) return;
    historyRef.current = after;
    setHistory(after);
    window.helm.saveScheme(after.present).then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
  }, []);
  const edit = useCallback(
    (fn: (s: Scheme) => Scheme) => change((h) => commit(h, fn(h.present))),
    [change],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && isTextEntry(e.target)) return;
      const wanted = historyAction(e, !historyOff);
      if (wanted === null) return;
      e.preventDefault();
      change(wanted === 'undo' ? undo : redo);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [change, historyOff]);

  // An apply wrote the keys it dealt into the saved scheme: take them (never saved from here).
  const firstKeys = useRef(keysKept);
  useEffect(() => {
    if (keysKept === firstKeys.current) return;
    firstKeys.current = keysKept;
    let current = true;
    window.helm.getScheme(loaded.id).then(
      (saved) => {
        if (!current || saved === null) return;
        const next = adoptLedger(historyRef.current, saved.ledger);
        if (next === historyRef.current) return;
        historyRef.current = next;
        setHistory(next);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [keysKept, loaded.id]);

  const scheme = history.present;
  const planned = useMemo((): { plan: Plan } | { error: string } => {
    try {
      return { plan: resolve(scheme, game, BUILT_IN_DEVICES) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Unknown problem.' };
    }
  }, [scheme, game]);

  const view = useMemo(
    () =>
      'plan' in planned
        ? editorView({ scheme, game, plan: planned.plan, mode, selected, press, tab })
        : null,
    [planned, scheme, game, mode, selected, press, tab],
  );

  const select = (id: ControlId) => {
    setSelected(selected === id ? undefined : id);
    setPress('tap');
  };
  const place = (control: ControlId, actionId: string, which: Press) => {
    if (isStick(control) || !assignable(game, mode, actionId)) return;
    edit((s) => assign(s, { mode, control, press: which }, actionId, game));
  };
  /** A drop: from the list it puts the action on; dragged off another control it moves it. */
  const dropOn = (control: ControlId, actionId: string, from?: ControlId) => {
    if (isStick(control) || !assignable(game, mode, actionId)) return;
    if (from === undefined) place(control, actionId, 'tap');
    else
      edit((s) =>
        move(s, { mode, control: from, press: 'tap' }, { mode, control, press: 'tap' }, game),
      );
    setSelected(control);
    setPress('tap');
  };
  /** Opens a setup the picker made or switched to; a step that failed says why in one sentence. */
  const opened = (outcome: { ok: true; schemeId: string } | { ok: false; message: string }) => {
    if (outcome.ok) onOpenScheme?.(outcome.schemeId);
    else setProblem(outcome.message);
  };
  const picker: PickerActions = {
    switchTo: (id) => void runPick(window.helm, game.id, id).then(opened),
    make: (preset) => void runMake(window.helm, game.id, preset).then(opened),
    copy: () => void runCopy(window.helm, game.id, scheme.id).then(opened),
    rename: (name) => edit((s) => renameScheme(s, name)),
    remove: () =>
      void runDelete(window.helm, game.id, scheme.id).then((after) => {
        if (!after.ok) setProblem(after.message);
        else if (after.next === null) onBack();
        else onOpenScheme?.(after.next);
      }),
  };
  const changeDevices = (next: Scheme['devices']) => {
    edit((s) => setDevices(s, next, game));
    setSelected(undefined);
  };
  const showTab = (id: DeviceTabId) => {
    setTab(id);
    setSelected(undefined);
  };

  const canPlace = selected !== undefined && !isStick(selected);

  return (
    <Tooltip.Provider>
      <div className="editor">
        <div className="ed-bar">
          <BackLink onBack={onBack} />
          <div className="ed-titles">
            <h1 className="ed-game">{game.name}</h1>
            <SchemePicker
              scheme={scheme}
              game={game}
              actions={onOpenScheme === undefined ? null : picker}
            />
          </div>
          <span className="ed-rule" aria-hidden="true" />
          {view !== null && view.tabs.length > 0 && (
            <div className="ed-seg" role="group" aria-label="Device">
              {view.tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="ed-seg-btn"
                  aria-pressed={view.tab === t.id}
                  onClick={() => showTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <DevicesChooser devices={scheme.devices} onChange={changeDevices} />
          {view?.output !== null && view?.output !== undefined && (
            <div className="ed-send">
              <span className="ed-send-label" id="ed-send-label">
                Azerons send
              </span>
              <div className="ed-seg" role="group" aria-labelledby="ed-send-label">
                {(['keys', 'pad'] as const).map((output) => (
                  <button
                    key={output}
                    type="button"
                    className="ed-seg-btn"
                    aria-pressed={view.output === output}
                    onClick={() => edit((s) => setOutput(s, output, game))}
                  >
                    {output === 'keys' ? 'Keys' : 'Controller'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {view?.showModeTabs === true && (
            <div className="ed-seg" role="tablist" aria-label="Mode">
              {view.modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={m.active}
                  className="ed-seg-btn"
                  onClick={() => setMode(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
          <div className="ed-spacer" />
          <button
            type="button"
            className="btn icon"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={!canUndo(history)}
            onClick={() => change(undo)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M5 4L2 7l3 3M2 7h7.5a4 4 0 010 8H7"
                stroke="currentColor"
                strokeWidth="1.7"
              />
            </svg>
          </button>
          <button
            type="button"
            className="btn icon"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!canRedo(history)}
            onClick={() => change(redo)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M11 4l3 3-3 3M14 7H6.5a4 4 0 000 8H9"
                stroke="currentColor"
                strokeWidth="1.7"
              />
            </svg>
          </button>
          {onApply === undefined ? (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button type="button" className="btn ed-primary" aria-disabled="true">
                  Apply
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="tooltip" side="bottom" sideOffset={8}>
                  Applying isn&apos;t available yet.
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ) : (
            <button type="button" className="btn ed-primary" onClick={onApply}>
              Apply
            </button>
          )}
        </div>

        {problem !== null && (
          <p className="notice tone-error" role="alert">
            {problem}
          </p>
        )}
        {saveFailed && (
          <p className="notice tone-warning" role="status">
            Your last change couldn&apos;t be saved. It is still here; try again in a moment.
          </p>
        )}

        {view === null ? (
          <p className="ed-state" role="alert">
            This scheme can&apos;t be drawn: {'error' in planned ? planned.error : ''}
          </p>
        ) : (
          <div className="ed-body">
            <section className="ed-main" aria-label="Devices and checks">
              <DeviceArea view={view} selected={selected} onSelect={select} onDropAction={dropOn} />
              <Checks
                view={view}
                onFix={(row) => row.fix && edit(row.fix.apply)}
                onKeep={(row) => edit((s) => acceptFinding(s, row.finding))}
                onFlag={(row) => edit((s) => unacceptFinding(s, row.finding))}
              />
            </section>
            <aside className="ed-side" aria-label="Button and actions">
              {view.panel === null ? (
                <div className="ed-pick">
                  <h2 className="ed-pick-title">Pick a button</h2>
                  <p className="ed-hint">
                    Click one, then click an action below, or drag an action onto a button. Drag a
                    button&apos;s action onto another to move it.
                  </p>
                </div>
              ) : (
                <Panel
                  panel={view.panel}
                  onClose={() => setSelected(undefined)}
                  onMode={setMode}
                  onTarget={setPress}
                  onClear={(which) =>
                    edit((s) =>
                      clear(s, { mode, control: view.panel?.control ?? '', press: which }),
                    )
                  }
                  onTurbo={(on) => edit((s) => setTurbo(s, view.panel?.control ?? '', on))}
                  onLatch={(on) => edit((s) => setLatch(s, view.panel?.control ?? '', on))}
                  onPad={(pad) =>
                    edit((s) => setPadControl(s, view.panel?.control ?? '', pad, game))
                  }
                />
              )}
              <Unplaced
                view={view}
                modeName={view.modes.find((m) => m.active)?.name ?? ''}
                prompt={
                  canPlace && view.panel
                    ? `Click an action to put it on ${view.panel.where}, ${PRESS_WORD[press]}.`
                    : null
                }
                onPlace={(id) => {
                  if (selected !== undefined && canPlace) place(selected, id, press);
                }}
              />
            </aside>
          </div>
        )}
      </div>
    </Tooltip.Provider>
  );
}

function Checks({
  view,
  onFix,
  onKeep,
  onFlag,
}: {
  view: EditorView;
  onFix(row: FindingRow): void;
  onKeep(row: FindingRow): void;
  onFlag(row: FindingRow): void;
}) {
  return (
    <section className="ed-checks" aria-label="Checks">
      {view.findings.length === 0 && (
        <p className="ed-clear">
          <span className="dot tone-ok" aria-hidden="true" />
          Nothing to fix.
        </p>
      )}
      {view.findings.map((row) => (
        <div key={row.key} className={`ed-check tone-${row.finding.severity}`}>
          <span
            className={`dot tone-${row.finding.severity === 'error' ? 'error' : 'warning'}`}
            aria-hidden="true"
          />
          <span className="ed-check-text">{row.finding.message}</span>
          {row.fix && (
            <button type="button" className="btn ed-fix" onClick={() => onFix(row)}>
              {row.fix.label}
            </button>
          )}
          {row.canKeep && (
            <button type="button" className="btn ghost" onClick={() => onKeep(row)}>
              Keep, I know
            </button>
          )}
        </div>
      ))}
      {view.kept.length > 0 && (
        <details className="ed-kept">
          <summary>{view.kept.length} kept</summary>
          {view.kept.map((row) => (
            <div key={row.key} className="ed-check is-kept">
              <span className="dot tone-ok" aria-hidden="true" />
              <span className="ed-check-text">{row.finding.message}</span>
              <button type="button" className="btn ghost" onClick={() => onFlag(row)}>
                Flag it again
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

function Panel({
  panel,
  onClose,
  onMode,
  onTarget,
  onClear,
  onTurbo,
  onLatch,
  onPad,
}: {
  panel: PanelView;
  onClose(): void;
  onMode(mode: string): void;
  onTarget(press: Press): void;
  onClear(press: Press): void;
  onTurbo(on: boolean): void;
  onLatch(on: boolean): void;
  onPad(pad: PadControl): void;
}) {
  return (
    <div className="ed-panel">
      <div className="ed-panel-head">
        <div className="ed-panel-names">
          <span className="ed-lbl">{panel.where}</span>
          <span className="ed-panel-title">{panel.title}</span>
        </div>
        <button type="button" className="btn ghost icon" aria-label="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
      </div>

      {panel.across.length > 1 && (
        <div className="ed-group">
          <span className="ed-lbl">In each mode</span>
          {panel.across.map((row) => (
            <button
              key={row.mode}
              type="button"
              className={`ed-across${row.active ? ' is-active' : ''}${row.label === null ? ' is-empty' : ''}`}
              aria-current={row.active ? 'true' : undefined}
              onClick={() => onMode(row.mode)}
            >
              <span className="ed-across-mode">{row.name}</span>
              <span>{row.label ?? 'Empty'}</span>
            </button>
          ))}
        </div>
      )}

      {panel.stick ? (
        <p className="ed-hint">
          The stick sends its four directions. Changing them isn&apos;t possible here yet.
        </p>
      ) : (
        <>
          <div className="ed-group">
            <span className="ed-lbl">Press</span>
            {panel.presses.map((row) => (
              <div key={row.press} className={`ed-slot${row.target ? ' is-target' : ''}`}>
                <button
                  type="button"
                  className="ed-slot-main"
                  aria-pressed={row.target}
                  aria-disabled={!row.available}
                  // No aria-label: the visible words ("Tap", then the action, "Add" or "Not on a
                  // controller") name the button, so the name begins with what is seen.
                  onClick={() => row.available && onTarget(row.press)}
                >
                  <span className="ed-slot-word">{row.word}</span>
                  {row.action ? (
                    <span className="ed-slot-name">{row.action.name}</span>
                  ) : (
                    <span className="ed-slot-empty">
                      {row.available ? 'Add' : panel.unavailable}
                    </span>
                  )}
                </button>
                {row.action && (
                  <button
                    type="button"
                    className="btn ghost icon"
                    aria-label={`Clear ${row.word.toLowerCase()}`}
                    onClick={() => onClear(row.press)}
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          {panel.behaviour && (
            <div className="ed-group">
              <span className="ed-lbl">Behaviour</span>
              <div className="ed-checks-row">
                <label className="ed-chk">
                  <input
                    type="checkbox"
                    checked={panel.turbo}
                    onChange={(e) => onTurbo(e.target.checked)}
                  />
                  Turbo
                </label>
                <label className="ed-chk">
                  <input
                    type="checkbox"
                    checked={panel.latch}
                    onChange={(e) => onLatch(e.target.checked)}
                  />
                  Hold to latch
                </label>
              </div>
            </div>
          )}
        </>
      )}

      {panel.padChoice !== null && !panel.padChoice.locked ? (
        <label className="ed-sends ed-sends-pick">
          <span className="ed-sends-label">Sends</span>
          <select
            className="ed-select"
            value={panel.padChoice.current ?? ''}
            onChange={(e) => onPad(e.target.value as PadControl)}
          >
            {panel.padChoice.current === null && <option value="">Nothing yet</option>}
            {panel.padChoice.options.map((o) => (
              <option key={o.pad} value={o.pad}>
                Xbox {o.label}
              </option>
            ))}
          </select>
          <span className="ed-sends-note">{panel.sendsNote}</span>
        </label>
      ) : (
        <div className="ed-sends">
          <span className="ed-sends-label">Sends</span>
          <span className="ed-sends-signal">{panel.sends ?? 'nothing'}</span>
          <span className="ed-sends-note">
            {panel.padChoice?.locked === true ? 'the stick’s own direction' : panel.sendsNote}
          </span>
        </div>
      )}
    </div>
  );
}

function Unplaced({
  view,
  modeName,
  prompt,
  onPlace,
}: {
  view: EditorView;
  modeName: string;
  prompt: string | null;
  onPlace(id: string): void;
}) {
  return (
    <div className="ed-group ed-unplaced">
      <div className="ed-unplaced-head">
        <span className="ed-lbl">Not on a button · {modeName}</span>
        <span className="ed-count">{view.unplaced.length}</span>
      </div>
      {prompt !== null && <p className="ed-hint">{prompt}</p>}
      {view.unplaced.length === 0 ? (
        <p className="ed-hint">Every {modeName} action is on a button.</p>
      ) : (
        <ul className="ed-actions">
          {view.unplaced.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="ed-act"
                draggable
                aria-disabled={prompt === null}
                onDragStart={dragAction(a.id)}
                onClick={() => prompt !== null && onPlace(a.id)}
              >
                <span
                  className="dot"
                  style={{ background: roleColour(a.role) }}
                  aria-hidden="true"
                />
                <span>{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the Scheme picker can do: each switches the editor to the setup it leads to. */
interface PickerActions {
  switchTo(schemeId: string): void;
  make(preset: Preset): void;
  copy(): void;
  rename(name: string): void;
  remove(): void;
}

/**
 * "Scheme: Main ▾", as drawn: the game's setups (switching is the second click), new ones from a
 * default or a copy of this one (also the second click), its name and, behind one confirmation,
 * deleting it.
 */
function SchemePicker({
  scheme,
  game,
  actions,
}: {
  scheme: Scheme;
  game: Game;
  actions: PickerActions | null;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Scheme[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(scheme.name);
  const nativeKeys = game.actions.some((a) => a.native?.key !== undefined);
  const label = `Scheme: ${scheme.name}`;
  if (actions === null) return <span className="ed-scheme">{label}</span>;
  const toggle = (next: boolean) => {
    setOpen(next);
    setConfirming(false);
    setName(scheme.name);
    if (next) window.helm.listSchemes(game.id).then(setList, () => setList([scheme]));
  };
  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };
  return (
    <Popover.Root open={open} onOpenChange={toggle}>
      <Popover.Trigger asChild>
        <button type="button" className="ed-scheme ed-scheme-btn">
          {label}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover ed-picker"
          sideOffset={8}
          align="start"
          aria-label="Schemes"
        >
          <div className="choices">
            <span className="hint">{game.name}</span>
            {(list ?? [scheme]).map((s) => (
              <button
                key={s.id}
                type="button"
                className="btn"
                aria-current={s.id === scheme.id ? 'true' : undefined}
                onClick={() => s.id !== scheme.id && choose(() => actions.switchTo(s.id))}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="choices">
            <span className="hint">New from</span>
            <button
              type="button"
              className="btn"
              onClick={() => choose(() => actions.make('xbox'))}
            >
              Xbox controller
            </button>
            {nativeKeys && (
              <button
                type="button"
                className="btn"
                onClick={() => choose(() => actions.make('keys'))}
              >
                Game&apos;s own keys
              </button>
            )}
            <button type="button" className="btn" onClick={() => choose(actions.copy)}>
              Copy this one
            </button>
          </div>
          <form
            className="ed-rename"
            onSubmit={(e) => {
              e.preventDefault();
              actions.rename(name);
            }}
          >
            <label className="hint" htmlFor="ed-scheme-name">
              Name
            </label>
            <span className="ed-field">
              <input
                id="ed-scheme-name"
                value={name}
                maxLength={NAME_LIMIT}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => actions.rename(name)}
              />
            </span>
          </form>
          {confirming ? (
            <div className="ed-confirm" role="group" aria-label={`Delete ${scheme.name}?`}>
              <span>Delete {scheme.name}?</span>
              <button
                type="button"
                className="btn ed-danger"
                onClick={() => choose(actions.remove)}
              >
                Delete
              </button>
              <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn ghost ed-danger-ghost"
              onClick={() => setConfirming(true)}
            >
              Delete this scheme
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const AZERON_CHOICES: { value: AzeronUse; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'left', label: 'Left + mouse' },
  { value: 'none', label: 'None' },
];

/**
 * What the setup plays with: which Azerons, the keyboard and mouse, the Xbox controller. Next to
 * the device tabs; one click opens it, the next changes it. A choice that would leave the setup
 * with nothing is not offered.
 */
function DevicesChooser({
  devices,
  onChange,
}: {
  devices: Scheme['devices'];
  onChange(next: Scheme['devices']): void;
}) {
  const offer = (next: Scheme['devices']) => ({
    disabled: !hasDevices(next),
    onChange: () => onChange(next),
  });
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn ghost ed-devices-btn">
          Devices
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover ed-devices"
          sideOffset={8}
          align="start"
          aria-label="Devices"
        >
          <fieldset className="ed-fieldset">
            <legend className="hint">Azerons</legend>
            {AZERON_CHOICES.map((c) => (
              <label key={c.value} className="ed-chk">
                <input
                  type="radio"
                  name="ed-azerons"
                  checked={devices.azerons === c.value}
                  {...offer(chooseAzerons(devices, c.value))}
                />
                {c.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="ed-fieldset">
            <legend className="hint">Also</legend>
            <label className="ed-chk">
              <input
                type="checkbox"
                checked={devices.keyboard}
                {...offer(chooseKeyboard(devices, !devices.keyboard))}
              />
              Keyboard and mouse
            </label>
            <label className="ed-chk">
              <input
                type="checkbox"
                checked={devices.controller}
                {...offer(chooseController(devices, !devices.controller))}
              />
              Xbox controller
            </label>
          </fieldset>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The middle of the editor: the device tab shown. The Azerons side by side (a left Azeron + mouse
 * setup has the mouse where the right unit was), the keyboard with the mouse, or the controller.
 */
function DeviceArea({
  view,
  selected,
  onSelect,
  onDropAction,
}: {
  view: EditorView;
  selected: ControlId | undefined;
  onSelect(id: ControlId): void;
  onDropAction(control: ControlId, actionId: string, from?: ControlId): void;
}) {
  const fixed = {
    keys: view.fixed,
    selected,
    conflicts: view.conflicts,
    onSelect,
    onDropAction,
  };
  if (view.tab === null)
    return <p className="ed-hint">This scheme has no devices. Choose them in Devices, above.</p>;
  if (view.tab === 'keyboard')
    return (
      <div className="ed-kbm">
        {view.keyboard && (
          <div className="ed-kb">
            <Keyboard {...fixed} />
          </div>
        )}
        {view.mouse && <Mouse {...fixed} />}
      </div>
    );
  if (view.tab === 'controller') return <Controller {...fixed} />;
  return (
    <div className="ed-units">
      {view.hands.map((hand) => (
        <div key={hand} className="ed-unit">
          <Unit
            hand={hand}
            {...unitProps(view[hand])}
            selected={selected ?? ''}
            onSelect={onSelect}
            onDropAction={onDropAction}
          />
        </div>
      ))}
      {view.mouseBeside && (
        <div className="ed-unit ed-mouse-beside">
          <Mouse {...fixed} />
        </div>
      )}
    </div>
  );
}
