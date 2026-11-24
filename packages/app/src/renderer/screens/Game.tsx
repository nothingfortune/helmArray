// The Game screen: a game's modes and actions, and each action's default key and controller button
// (docs/plans/04-roadmap.md, M4.5, *Game data in the app*). Not drawn on the canvas: designed in its
// style, from the tokens. Reached from a Library tile: *Set up* on a game helmArray doesn't know,
// *Edit game* on one it does, and *Add a game* for one Steam doesn't list.
//
// A default is set by pressing it while the window has focus: ordinary keydown and mousedown in the
// page, and the Gamepad API (`navigator.getGamepads`) read once a frame only while a controller
// button is waited for (press-listener.ts). Nothing listens outside the window. The state is a
// GameEditor (game-editor.ts): edits are saved as they are made once the game is whole, and undo
// is in memory. The parts are drawn by GameParts.tsx.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GameEntry } from '../../shared/api';
import { snapshotsOf } from './capture';
import { isTextEntry } from './editor-model';
import { GameEditor } from './game-editor';
import type { Loaded } from './game-editor';
import { loadedOf } from './game-model';
import type { GameTarget } from './game-model';
import {
  ActionTable,
  AddAction,
  BackLink,
  ModeHead,
  ModeTabs,
  Notices,
  TitleBar,
} from './GameParts';
import { listenForPress, listenForUndo } from './press-listener';
import './game.css';

export type { GameTarget };

export interface GameScreenProps {
  target: GameTarget;
  onBack(): void;
  /** A scheme was made from the game: open it in the editor. */
  onOpenEditor(schemeId: string): void;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'failed' }
  /** `generation` counts the reads: the editor is made anew for each, never kept across one. */
  | ({ kind: 'ready'; generation: number } & Loaded);

/** Loads the game (or makes the new one, unsaved) and hands it to the screen. */
export function GameScreen(props: GameScreenProps) {
  const { target } = props;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [reloads, setReloads] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    let live = true;
    window.helm.listGames().then(
      (games: GameEntry[]) => {
        if (!live) return;
        const loaded = loadedOf(target, games);
        setLoad(
          loaded === null
            ? { kind: 'gone' }
            : { kind: 'ready', generation: ++generation.current, ...loaded },
        );
      },
      () => {
        if (live) setLoad({ kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [target, reloads]);

  if (load.kind === 'ready') {
    return (
      <GameBody
        key={load.generation}
        {...props}
        loaded={load}
        onReload={() => {
          // Nothing is shown from the data main has just replaced: the screen waits for the new.
          setLoad({ kind: 'loading' });
          setReloads((n) => n + 1);
        }}
      />
    );
  }
  const words = {
    loading: 'Opening the game…',
    gone: "This game isn't in your library any more.",
    failed: "Couldn't open this game.",
  };
  return (
    <main className="gm">
      <div className="gm-bar">
        <BackLink onBack={props.onBack} />
      </div>
      <p className="gm-state" role="status">
        {words[load.kind]}
      </p>
    </main>
  );
}

/** The pads as the Gamepad API has them now. */
const readPads = () =>
  snapshotsOf(typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : []);

const closest = (e: Event, selector: string) =>
  e.target instanceof Element && e.target.closest(selector) !== null;

function GameBody({
  loaded,
  onBack,
  onOpenEditor,
  onReload,
}: GameScreenProps & { loaded: Loaded; onReload(): void }) {
  const [editor] = useState(() => new GameEditor(loaded, window.helm));
  const state = useSyncExternalStore(editor.subscribe, () => editor.state);
  const nameRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const modeNameRef = useRef<HTMLInputElement>(null);
  /** Where the focus goes back to once a press is set or the wait ends. */
  const returnTo = useRef<HTMLElement | null>(null);
  const wasWaiting = useRef(false);

  const game = state.history.present;
  const { waiting } = state;

  // The first thing to do has the focus: the name of a game with none, else the new-action field
  // of a game with no actions yet.
  useEffect(() => {
    if (loaded.game.name.trim() === '') nameRef.current?.focus();
    else if (loaded.game.actions.length === 0) addRef.current?.focus();
  }, [loaded.game]);

  useEffect(
    () =>
      listenForUndo(window, {
        enabled: () => editor.state.waiting === null,
        inText: (e) => e.target instanceof HTMLElement && isTextEntry(e.target),
        undo: editor.undo,
        redo: editor.redo,
      }),
    [editor],
  );

  // While a press is waited for: keys and mouse presses in the window, and the pads.
  useEffect(() => {
    if (waiting === null) return;
    return listenForPress(
      waiting.part,
      {
        target: window,
        pads: readPads,
        frame: (fn) => requestAnimationFrame(fn),
        cancelFrame: (id) => cancelAnimationFrame(id),
        inZone: (e) => closest(e, '[data-wait-zone]'),
        inList: (e) => closest(e, '[data-wait-strip]'),
        focusList: () => {
          const list = document.querySelector<HTMLElement>('[data-wait-strip] select');
          list?.focus();
          return list !== null;
        },
      },
      { press: editor.press, cancel: editor.cancelWait },
    );
  }, [waiting, editor]);

  // When a wait ends, the focus goes back to where it began: the field, or the new-action field.
  useEffect(() => {
    if (waiting !== null) {
      if (!wasWaiting.current) {
        const active = document.activeElement;
        returnTo.current = active instanceof HTMLElement ? active : null;
      }
      wasWaiting.current = true;
      return;
    }
    if (wasWaiting.current) returnTo.current?.focus();
    wasWaiting.current = false;
  }, [waiting]);

  const addMode = () => {
    editor.addMode();
    requestAnimationFrame(() => {
      modeNameRef.current?.focus();
      modeNameRef.current?.select();
    });
  };

  return (
    <main className="gm">
      <TitleBar
        game={game}
        builtIn={loaded.builtIn}
        edited={state.edited}
        saved={state.saved}
        canUndo={editor.canUndo}
        confirming={state.confirming}
        busy={state.busy}
        starts={editor.starts}
        nameRef={nameRef}
        edit={editor.edit}
        onBack={onBack}
        onNameDone={editor.nameDone}
        onUndo={editor.undo}
        onConfirm={editor.confirm}
        onDrop={() => {
          void editor.drop().then((done) => {
            if (!done) return;
            if (loaded.builtIn) onReload();
            else onBack();
          });
        }}
        onStart={(preset) => {
          void editor.start(preset).then((schemeId) => {
            if (schemeId !== null) onOpenEditor(schemeId);
          });
        }}
      />
      <Notices
        lines={[
          // Not while a new game has no name yet: there is nothing to say until it is typed.
          editor.problem !== null && game.name.trim() !== ''
            ? `${editor.problem} Not saved until then.`
            : null,
          state.saveError,
          state.notice,
        ]}
      />
      <ModeTabs game={game} mode={editor.mode} onMode={editor.setMode} onAddMode={addMode} />
      <section className="gm-panel" role="tabpanel" aria-label="Actions">
        <ModeHead
          game={game}
          mode={editor.mode}
          inputRef={modeNameRef}
          edit={editor.edit}
          onDeleteMode={editor.deleteMode}
        />
        <ActionTable
          rows={editor.rows}
          waiting={waiting}
          edit={editor.edit}
          onWait={editor.wait}
          onPress={editor.press}
          onCancel={editor.cancelWait}
        />
        <AddAction
          draft={state.draft}
          inputRef={addRef}
          onType={editor.type}
          onAdd={editor.addDraft}
        />
      </section>
    </main>
  );
}
