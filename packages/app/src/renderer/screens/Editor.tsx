// The Editor screen (docs/plans/03-ui-system.md, canvas board docs/design/canvas/Editor.dc.html):
// both units big in the middle, the checks under them, the selected button and the actions not
// on a button yet in the side panel. It owns nothing outside itself: the app mounts it with a
// scheme id and a way back. Edits are pure functions in ./editor-model, what is drawn is worked
// out in ./editor-view, and both are tested without a DOM.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Tooltip } from 'radix-ui';
import { BUILT_IN_DEVICES, resolve } from '@helmarray/core';
import type { ControlId, Game, Plan, Press, Role, Scheme } from '@helmarray/core';
import { Unit } from '../unit/Unit';
import type { UnitProps } from '../unit/Unit';
import { ACTION_DRAG_TYPE } from '../unit/layout';
import {
  acceptFinding,
  assign,
  canRedo,
  canUndo,
  clear,
  commit,
  historyAction,
  isStick,
  isTextEntry,
  redo,
  setLatch,
  setTurbo,
  startHistory,
  undo,
  unacceptFinding,
} from './editor-model';
import type { History } from './editor-model';
import { assignable, editorView } from './editor-view';
import type { EditorView, FindingRow, PanelView, UnitSide } from './editor-view';
import './editor.css';

export interface EditorProps {
  /** The scheme to edit. A different id is a different editing session: its undo starts empty. */
  schemeId: string;
  /** The way back to the library. */
  onBack(): void;
  /** Opens the Apply drawer. Without it the Apply button is shown, disabled, with a reason. */
  onApply?(): void;
  /**
   * Turns the Ctrl+Z / Ctrl+Y history shortcuts off. Set while something is over the editor (the
   * Apply drawer): an undo underneath would change the scheme being applied.
   */
  historyOff?: boolean;
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

/** A tooltip around something that may be disabled: the span takes hover and focus for it. */
function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="ed-tip" tabIndex={0}>
            {children}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tooltip" side="bottom" sideOffset={8}>
            {text}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

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
function EditorLoader({ schemeId, onBack, onApply, historyOff }: EditorProps) {
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
        onApply={onApply}
        historyOff={historyOff === true}
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
  onApply: (() => void) | undefined;
  historyOff: boolean;
}

function EditorBody({ scheme: loaded, game, onBack, onApply, historyOff }: BodyProps) {
  const [history, setHistory] = useState<History<Scheme>>(() => startHistory(loaded));
  const historyRef = useRef(history);
  const [mode, setMode] = useState(() => game.modes[0]?.id ?? 'default');
  const [selected, setSelected] = useState<ControlId | undefined>(undefined);
  const [press, setPress] = useState<Press>('tap');
  const [saveFailed, setSaveFailed] = useState(false);

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
        ? editorView({ scheme, game, plan: planned.plan, mode, selected, press })
        : null,
    [planned, scheme, game, mode, selected, press],
  );

  const select = (id: ControlId) => {
    setSelected(selected === id ? undefined : id);
    setPress('tap');
  };
  const place = (control: ControlId, actionId: string, which: Press) => {
    if (isStick(control) || !assignable(game, mode, actionId)) return;
    edit((s) => assign(s, { mode, control, press: which }, actionId, game));
  };
  const dropOn = (control: ControlId, actionId: string) => {
    if (isStick(control)) return;
    place(control, actionId, 'tap');
    setSelected(control);
    setPress('tap');
  };

  const canPlace = selected !== undefined && !isStick(selected);

  return (
    <Tooltip.Provider>
      <div className="editor">
        <div className="ed-bar">
          <BackLink onBack={onBack} />
          <div className="ed-titles">
            <h1 className="ed-game">{game.name}</h1>
            <span className="ed-scheme">Scheme: {scheme.name}</span>
          </div>
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
          <Tip text="Set when the scheme was made. You can't change it here yet.">
            <div className="ed-seg" role="group" aria-label="The Azerons send">
              <button
                type="button"
                className="ed-seg-btn"
                disabled
                aria-pressed={scheme.output === 'keys'}
              >
                Keys
              </button>
              <button
                type="button"
                className="ed-seg-btn"
                disabled
                aria-pressed={scheme.output === 'pad'}
              >
                Controller
              </button>
            </div>
          </Tip>
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
            <section className="ed-main" aria-label="Units and checks">
              <div className="ed-units">
                {(['left', 'right'] as const).map((hand) => (
                  <div key={hand} className="ed-unit">
                    <Unit
                      hand={hand}
                      {...unitProps(view[hand])}
                      selected={selected ?? ''}
                      onSelect={select}
                      onDropAction={dropOn}
                    />
                  </div>
                ))}
              </div>
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
                    Click one, then click an action below, or drag an action onto a button.
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
}: {
  panel: PanelView;
  onClose(): void;
  onMode(mode: string): void;
  onTarget(press: Press): void;
  onClear(press: Press): void;
  onTurbo(on: boolean): void;
  onLatch(on: boolean): void;
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
                  aria-label={`${row.word}: ${row.action?.name ?? (row.available ? 'empty' : 'not on a controller')}`}
                  onClick={() => row.available && onTarget(row.press)}
                >
                  <span className="ed-slot-word">{row.word}</span>
                  {row.action ? (
                    <span className="ed-slot-name">{row.action.name}</span>
                  ) : (
                    <span className="ed-slot-empty">
                      {row.available ? 'Add' : 'Not on a controller'}
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
        </>
      )}

      <div className="ed-sends">
        <span className="ed-sends-label">Sends</span>
        <span className="ed-sends-signal">{panel.sends ?? 'nothing'}</span>
        <span className="ed-sends-note">{panel.sendsNote}</span>
      </div>
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
                onDragStart={(e) => {
                  e.dataTransfer.setData(ACTION_DRAG_TYPE, a.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
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
