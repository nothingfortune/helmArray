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
  drop,
  followLabels,
  redo,
  renameScheme,
  setDevices,
  setKeyLabel,
  setLatch,
  setOutput,
  setPadControl,
  setTurbo,
  startHistory,
  undo,
  unacceptFinding,
} from './editor-model';
import type { History } from './editor-model';
import { assignable, editorView, gainedTab, opensApply } from './editor-view';
import { openPicker } from './action-picker';
import { ActionPicker } from './ActionPicker';
import { sidePanelWidth } from './editor-layout';
import type { DeviceTabId } from './editor-view';
import type { Fix } from './fixes';
import { editedLocation, findingLocation, navigate, reveal } from './reveal';
import { useOffers } from './useOffers';
import type { EditorPlace, Location } from './reveal';
import type { DragSource } from '../devices/drag';
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
import { RecentGames } from './RecentGames';
import type { ApplyButton } from '../apply/applyButton';
import './editor.css';

export interface EditorProps {
  /** The scheme to edit. A different id is a different editing session: its undo starts empty. */
  schemeId: string;
  /** The way back to the library. */
  onBack(): void;
  /**
   * Opens another setup (switched to, made, or what is left after a delete; another game's, from
   * the recent games). `made`: it was just made from a preset (J1), so the drawer opens on it when
   * it has nothing to fix. Without it the Scheme picker only names the setup open.
   */
  onOpenScheme?(schemeId: string, made?: boolean): void;
  /** Opens the Apply drawer. Without it the Apply button is shown, disabled, with a reason. */
  onApply?(): void;
  /**
   * The scheme was just made from a preset (J1): once it is drawn, the Apply drawer opens by itself
   * if it has nothing to fix (`opensApply`). With something to fix the Editor stays, to fix it.
   */
  applyWhenReady?: boolean;
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
  /** What the Apply button says: "Apply 3", or "Applied" once in sync. Plain "Apply" without it. */
  applyButton?: ApplyButton;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; scheme: Scheme; game: Game }
  | { kind: 'gone' }
  | { kind: 'no-game' }
  | { kind: 'failed' };

const PRESS_WORD: Record<Press, string> = { tap: 'tap', long: 'long press', double: 'double tap' };

/**
 * The content width of an element, kept up to date: a ref to put on it, and its width (undefined
 * until it is first measured). A callback ref, so an element that comes and goes is followed.
 */
function useContentWidth(): [(el: HTMLElement | null) => void, number | undefined] {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const watching = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    watching.current?.disconnect();
    watching.current = null;
    if (el === null) return;
    const watch = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    watch.observe(el);
    watching.current = watch;
  }, []);
  return [ref, width];
}

/** Loads the scheme and its game, then hands them to the editor. Keyed by scheme id. */
function EditorLoader({
  schemeId,
  onBack,
  onOpenScheme,
  onApply,
  historyOff,
  keysKept,
  applyWhenReady,
  applyButton,
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
        applyWhenReady={applyWhenReady === true}
        applyButton={applyButton ?? { label: 'Apply', done: false }}
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
  onOpenScheme: ((schemeId: string, made?: boolean) => void) | undefined;
  onApply: (() => void) | undefined;
  historyOff: boolean;
  keysKept: number;
  applyWhenReady: boolean;
  applyButton: ApplyButton;
}

function EditorBody({
  scheme: loaded,
  game,
  onBack,
  onOpenScheme,
  onApply,
  historyOff,
  keysKept,
  applyWhenReady,
  applyButton,
}: BodyProps) {
  const [history, setHistory] = useState<History<Scheme>>(() => startHistory(loaded));
  const historyRef = useRef(history);
  // Where the Editor is, and what it shows there for now (reveal.ts): every move goes through
  // `navigate` or `reveal`, so what belongs to one location never outlives it.
  const [here, setPlace] = useState<EditorPlace>(() => ({
    mode: game.modes[0]?.id ?? 'default',
    selected: undefined,
    press: 'tap',
    tab: undefined,
    inspector: true,
    picking: null,
  }));
  const { mode, selected, press, tab, inspector, picking } = here;
  const [saveFailed, setSaveFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [bodyRef, bodyWidth] = useContentWidth();
  const [mainRef, mainWidth] = useContentWidth();

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
  // Every edit carries the key labels along: a label goes with its action (followLabels).
  const edit = useCallback(
    (fn: (s: Scheme) => Scheme) => change((h) => commit(h, followLabels(h.present, fn(h.present)))),
    [change],
  );

  // THE ONE way it goes somewhere after an action (reveal.ts): the mode, the tab, the control and
  // its press, all at once. An updater, so a key handler set up once moves from where it is now.
  const revealAt = useCallback((location: Location | undefined, on: Scheme) => {
    if (location !== undefined) setPlace((p) => reveal(p, location, on));
  }, []);
  /** A move the player makes: through `navigate`, from where the Editor is now. */
  const move = (to: (p: EditorPlace) => EditorPlace) => setPlace(to);
  /** Undo or redo, and back to where the edit it undid or redid was made. */
  const travel = useCallback(
    (step: typeof undo) => {
      const before = historyRef.current.present;
      change(step);
      const after = historyRef.current.present;
      const location = editedLocation(before, after);
      setPlace((p) => navigate.travel(p, location, after));
    },
    [change],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && isTextEntry(e.target)) return;
      const wanted = historyAction(e, !historyOff);
      if (wanted === null) return;
      e.preventDefault();
      travel(wanted === 'undo' ? undo : redo);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [travel, historyOff]);

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

  // The fix offers are worked out after the draw, a slice at a time (useOffers): the draw takes
  // what is there so far.
  const offers = useOffers(scheme, game, 'plan' in planned ? planned.plan : null);
  const view = useMemo(
    () =>
      'plan' in planned
        ? editorView({ scheme, game, plan: planned.plan, mode, selected, press, tab, offers })
        : null,
    [planned, scheme, game, mode, selected, press, tab, offers],
  );

  // J1: a scheme just made from a preset with nothing to fix goes straight to the drawer, once.
  const offered = useRef(false);
  useEffect(() => {
    if (!applyWhenReady || offered.current || view === null) return;
    offered.current = true;
    if (opensApply(view)) onApply?.();
  }, [applyWhenReady, view, onApply]);

  const select = (id: ControlId) => move((p) => navigate.select(p, id));
  /** A click on an action (from the list, or moved from another button): on the selected press. */
  const place = (control: ControlId, actionId: string, which: Press) => {
    if (isStick(control) || !assignable(game, mode, actionId)) return;
    edit((s) => assign(s, { mode, control, press: which }, actionId, game));
    revealAt({ mode, control, press: which }, scheme);
  };
  /** A drop: from the list it puts the action on; dragged off another control it moves it. */
  const dropOn = (control: ControlId, actionId: string, from?: DragSource) => {
    if (isStick(control) || !assignable(game, mode, actionId)) return;
    move(navigate.pickDone);
    edit((s) => drop(s, mode, control, actionId, from, game));
    revealAt({ mode, control, press: 'tap' }, scheme);
  };
  /** Opens a setup the picker made or switched to; a step that failed says why in one sentence. */
  const opened =
    (made: boolean) =>
    (outcome: { ok: true; schemeId: string } | { ok: false; message: string }) => {
      if (outcome.ok) onOpenScheme?.(outcome.schemeId, made);
      else setProblem(outcome.message);
    };
  const picker: PickerActions = {
    switchTo: (id) => void runPick(window.helm, game.id, id).then(opened(false)),
    make: (preset) => void runMake(window.helm, game.id, preset).then(opened(true)),
    copy: () => void runCopy(window.helm, game.id, scheme.id).then(opened(false)),
    rename: (name) => edit((s) => renameScheme(s, name)),
    remove: () =>
      void runDelete(window.helm, game.id, scheme.id).then((after) => {
        if (!after.ok) setProblem(after.message);
        else if (after.next === null) onBack();
        else onOpenScheme?.(after.next);
      }),
  };
  const changeDevices = (next: Scheme['devices']) => {
    // A device just added is shown at once: no second click on its tab.
    const added = gainedTab(scheme.devices, next);
    edit((s) => setDevices(s, next, game));
    move((p) => navigate.devices(p, added));
  };
  /** A fix, applied, and where it put something revealed: its mode, its control, its press. */
  const applyFix = (fix: Fix) => {
    const present = historyRef.current.present;
    const where = fix.reveal?.(present);
    edit(fix.apply);
    revealAt(where, historyRef.current.present);
  };
  const showTab = (id: DeviceTabId) => move((p) => navigate.tab(p, id));

  const canPlace = selected !== undefined && !isStick(selected);
  // The press a click on an action fills: the one asked for while the button can send it (the
  // view's own reading of it, so an undo or a switch of output never leaves an unsendable one).
  const target = view?.panel?.presses.find((r) => r.target)?.press ?? 'tap';
  const open = openPicker(picking, {
    inspector,
    selected,
    panel: view?.panel?.control,
    target,
  });
  const modeName =
    view !== null && view.modes.length > 1
      ? (view.modes.find((m) => m.active)?.name ?? null)
      : null;

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
          {onOpenScheme !== undefined && (
            <RecentGames openGameId={game.id} onOpen={(id) => onOpenScheme(id)} />
          )}
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
                    onClick={() => {
                      edit((s) => setOutput(s, output, game));
                      move(navigate.output);
                    }}
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
                  onClick={() => move((p) => navigate.mode(p, m.id))}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
          <div className="ed-spacer" />
          <button
            type="button"
            className="btn icon ed-insp"
            aria-label="Inspector"
            aria-pressed={inspector}
            title={inspector ? 'Hide the side panel' : 'Show the side panel'}
            onClick={() => move(navigate.inspector)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" />
              <path d="M10 2.5v11" stroke="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="btn icon"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={!canUndo(history)}
            onClick={() => travel(undo)}
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
            onClick={() => travel(redo)}
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
            <button
              type="button"
              className={`btn ed-primary${applyButton.done ? ' is-done' : ''}`}
              onClick={onApply}
            >
              {applyButton.label}
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
          <div className="ed-body" ref={bodyRef}>
            <section className="ed-main" aria-label="Devices and checks" ref={mainRef}>
              <DeviceArea
                view={view}
                width={mainWidth}
                selected={selected}
                onSelect={select}
                onDropAction={dropOn}
              />
              <Checks
                view={view}
                onFix={(row) => row.fix && applyFix(row.fix)}
                onKeep={(row) => edit((s) => acceptFinding(s, row.finding))}
                onFlag={(row) => edit((s) => unacceptFinding(s, row.finding))}
                onFixAll={(group) => group.fix && applyFix(group.fix)}
                onKeepAll={(group) =>
                  edit((s) => group.rows.reduce((x, row) => acceptFinding(x, row.finding), s))
                }
                onShow={(row) => revealAt(findingLocation(row.finding), scheme)}
              />
            </section>
            {inspector && (
              <aside
                className="ed-side"
                aria-label="Button and actions"
                style={{ width: `${sidePanelWidth(bodyWidth ?? window.innerWidth)}px` }}
              >
                {open !== null ? (
                  <ActionPicker
                    key={`${open.control}|${open.press}`}
                    view={view}
                    scheme={scheme}
                    game={game}
                    mode={mode}
                    modeName={modeName}
                    onPick={(id) => {
                      place(open.control, id, open.press);
                      move(navigate.pickDone);
                    }}
                    onClose={() => move(navigate.pickDone)}
                  />
                ) : view.panel === null ? (
                  <div className="ed-pick">
                    <h2 className="ed-pick-title">Pick a {view.controlWord}</h2>
                    <p className="ed-hint">
                      Click one, then click an action below, or drag an action onto a{' '}
                      {view.controlWord}. Drag a {view.controlWord}&apos;s action onto another to
                      move it.
                    </p>
                  </div>
                ) : (
                  <Panel
                    panel={view.panel}
                    onClose={() => move(navigate.close)}
                    onMode={(m) => move((p) => navigate.mode(p, m))}
                    onTarget={(which) => move((p) => navigate.target(p, which))}
                    onChoose={(which) => move((p) => navigate.choose(p, which))}
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
                    onKeyLabel={(text) =>
                      edit((s) => setKeyLabel(s, mode, view.panel?.control ?? '', text))
                    }
                  />
                )}
                {open === null && (
                  <Unplaced
                    view={view}
                    modeName={modeName}
                    prompt={
                      canPlace && view.panel
                        ? `Click an action to put it on ${view.panel.where}, ${PRESS_WORD[target]}.`
                        : null
                    }
                    onPlace={(id) => {
                      if (selected !== undefined && canPlace) place(selected, id, target);
                    }}
                  />
                )}
              </aside>
            )}
          </div>
        )}
      </div>
    </Tooltip.Provider>
  );
}
