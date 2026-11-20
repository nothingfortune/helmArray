// The Editor screen (docs/plans/03-ui-system.md, canvas board docs/design/canvas/Editor.dc.html):
// both units big in the middle, the checks under them, the selected button and the actions not
// on a button yet in the side panel. It owns nothing outside itself: the app mounts it with a
// scheme id and a way back. Edits are pure functions in ./editor-model, what is drawn is worked
// out in ./editor-view, and both are tested without a DOM.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from 'radix-ui';
import { BUILT_IN_DEVICES, resolve } from '@helmarray/core';
import type { ControlId, Game, Plan, Press, Scheme } from '@helmarray/core';
import {
  acceptFinding,
  assign,
  canRedo,
  canUndo,
  clear,
  commit,
  adoptLedger,
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
import type { DeviceTabId } from './editor-view';
import { runMake, runPick } from './libraryFlow';
import { runCopy, runDelete } from './schemeFlow';
import {
  BackLink,
  Checks,
  DeviceArea,
  DevicesChooser,
  Panel,
  SchemePicker,
  Unplaced,
} from './EditorParts';
import type { PickerActions } from './EditorParts';
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
