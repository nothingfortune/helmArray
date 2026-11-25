import { useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import type { AppState, LibraryEntry } from '../../shared/api';
import { coverUrl } from '../../shared/cover';
import { START, runMake, runPick, step } from './libraryFlow';
import type { FlowEvent, FlowState } from './libraryFlow';
import {
  chosenScheme,
  currentCard,
  defaultChoices,
  filterEntries,
  heldSchemes,
  setupWords,
  statusLine,
  summary,
} from './libraryView';
import { useLibrary } from './useLibrary';
import { PresetButtons } from './PresetButtons';
import { gameTarget, needsSetUp } from './gameTile';
import type { GameTarget } from './game-model';
import { sheetLine } from '../apply/bindSheet';
import type { SheetLine } from '../apply/bindSheet';

type Send = (event: FlowEvent) => void;
type OpenGame = (target: GameTarget) => void;

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3.5 3.5" />
    </svg>
  );
}

/**
 * A portrait or header image, or the dashed placeholder when there is none (or it won't load).
 * `inButton`: the art is inside the tile's button, whose name is the game's: there a portrait's
 * "No cover" is drawn (CSS), not text the name doesn't hold. Elsewhere it is text.
 */
function Art({
  entry,
  kind,
  inButton = false,
}: {
  entry: LibraryEntry;
  kind: 'portrait' | 'header';
  inButton?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const there = kind === 'portrait' ? entry.hasCover : entry.hasHeader;
  if (entry.appId === null || !there || failed) {
    if (kind === 'portrait' && inButton) {
      return <span className="art-none" data-placeholder="No cover" aria-hidden="true" />;
    }
    return <span className="art-none">{kind === 'portrait' ? 'No cover' : entry.name}</span>;
  }
  return (
    <img className="art" src={coverUrl(entry.appId, kind)} alt="" onError={() => setFailed(true)} />
  );
}

function Choices({ entry, send }: { entry: LibraryEntry; send: Send }) {
  return (
    <div className="choices">
      <span className="hint">{entry.schemes.length > 0 ? 'New from' : 'Start from'}</span>
      <PresetButtons
        choices={defaultChoices(entry)}
        idPrefix={`start-${entry.gameId ?? entry.appId ?? 'game'}`}
        onChoose={(preset) => send({ type: 'choose', entry, preset })}
      />
    </div>
  );
}

/**
 * *Edit actions*: the game's actions and modes, on the Game screen. Named for what it opens, so it
 * doesn't read as the scheme the tile opens.
 */
function EditGame({ entry, onOpenGame }: { entry: LibraryEntry; onOpenGame: OpenGame }) {
  return (
    <button
      type="button"
      className="btn ghost small"
      aria-label={`Edit actions: ${entry.name}`}
      onClick={() => onOpenGame(gameTarget(entry))}
    >
      Edit actions
    </button>
  );
}

function Tile({
  entry,
  onUnits,
  flow,
  send,
  onOpenGame,
}: {
  entry: LibraryEntry;
  /** The schemes the units hold, by their record. */
  onUnits: ReadonlySet<string>;
  flow: FlowState;
  send: Send;
  onOpenGame: OpenGame;
}) {
  const status = statusLine(entry, onUnits);
  const cover = (inButton: boolean) => (
    <span className={`cover${entry.hasCover ? '' : ' cover-empty'}`}>
      <Art entry={entry} kind="portrait" inButton={inButton} />
    </span>
  );
  const body = cover(true);
  const caption = (
    <>
      <div className="game-name">{entry.name}</div>
      <div className={`status tone-${status.tone}`}>
        {status.tone !== 'unsupported' && <span className="dot" />}
        {status.text}
      </div>
    </>
  );

  // A game helmArray has no data for (or none yet): set it up on the Game screen first.
  if (needsSetUp(entry)) {
    return (
      <li className="tile unsupported">
        {cover(false)}
        <div className="game-name">{entry.name}</div>
        <button
          type="button"
          className="btn small"
          aria-label={`Set up ${entry.name}`}
          onClick={() => onOpenGame(gameTarget(entry))}
        >
          Set up
        </button>
      </li>
    );
  }

  const label = `${entry.name}. ${status.text}`;
  if (chosenScheme(entry) === null) {
    // No scheme yet: the click asks what to start from, and the next click makes it.
    return (
      <li className="tile">
        <Popover.Root
          open={flow.picking === entry.gameId}
          onOpenChange={(open) => !open && send({ type: 'dismiss' })}
        >
          <Popover.Anchor asChild>
            <button
              type="button"
              className="tile-button"
              aria-label={label}
              onClick={() => send({ type: 'tile', entry })}
            >
              {body}
            </button>
          </Popover.Anchor>
          {caption}
          <EditGame entry={entry} onOpenGame={onOpenGame} />
          <Popover.Portal>
            <Popover.Content
              className="popover"
              sideOffset={8}
              aria-label={`Start ${entry.name} from`}
            >
              <Choices entry={entry} send={send} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </li>
    );
  }

  // The schemes list opens beside the cover (its anchor), so it never sits over its own tile.
  return (
    <li className="tile">
      <Popover.Root>
        <Popover.Anchor asChild>
          <button
            type="button"
            className="tile-button"
            aria-label={label}
            onClick={() => send({ type: 'tile', entry })}
          >
            {body}
          </button>
        </Popover.Anchor>
        {caption}
        <EditGame entry={entry} onOpenGame={onOpenGame} />
        <Popover.Trigger asChild>
          <button type="button" className="btn ghost small" aria-label={`${entry.name} schemes`}>
            {entry.schemes.length > 1 ? `${entry.schemes.length} schemes` : 'Schemes'}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="popover"
            side="right"
            align="start"
            sideOffset={8}
            aria-label={`${entry.name} schemes`}
          >
            <div className="choices">
              <span className="hint">Open a scheme</span>
              {entry.schemes.map((scheme) => (
                <button
                  key={scheme.id}
                  type="button"
                  className="btn"
                  aria-current={scheme.id === entry.activeSchemeId ? 'true' : undefined}
                  onClick={() => send({ type: 'pick', entry, schemeId: scheme.id })}
                >
                  {scheme.name}
                  <span className="choice-note">{setupWords(scheme)}</span>
                </button>
              ))}
            </div>
            <Choices entry={entry} send={send} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </li>
  );
}

/**
 * What is still to set by hand in a game's controls, from the last apply's bind sheet: one line on
 * the card, *Show* for the rows, *Done* once they are set.
 */
function SheetReminder({ line, onDone }: { line: SheetLine; onDone(gameId: string): void }) {
  return (
    <div className="current-sheet" role="status">
      <span className="dot tone-warning" aria-hidden="true" />
      <span>{line.text}</span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="btn ghost small" aria-label="Show what to set">
            Show
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="popover sheet-popover"
            sideOffset={8}
            align="start"
            aria-label={line.section.title}
          >
            <span className="hint">{line.section.title}</span>
            {line.section.groups.map((group) => (
              <div key={group.label ?? ''} className="sheet-group">
                {group.label !== null && <span className="sheet-group-label">{group.label}</span>}
                {group.lines.map((text) => (
                  <p key={text} className="sheet-line">
                    {text}
                  </p>
                ))}
              </div>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button
        type="button"
        className="btn ghost small"
        aria-label="Done, they are set"
        onClick={() => onDone(line.gameId)}
      >
        Done
      </button>
    </div>
  );
}

/** The Library: what is current on the Azerons, then every game as a cover with one line. */
export function Library({
  state,
  onOpenEditor,
  onOpenGame,
  onSheetDone,
}: {
  state: AppState | null;
  /** `made`: the scheme was just made from a preset (J1), not one opened. */
  onOpenEditor: (schemeId: string, made?: boolean) => void;
  /** The Game screen: *Set up*, *Edit actions* and *Add a game*. */
  onOpenGame: OpenGame;
  /** *Done* on what is still to set by hand in a game's controls (`state.sheets`). */
  onSheetDone?(gameId: string): void;
}) {
  const library = useLibrary();
  const [flow, setFlow] = useState<FlowState>(START);
  const [query, setQuery] = useState('');
  // The flow's state is also kept here so a second click in the same moment sees the first.
  const live = useRef<FlowState>(START);

  const send: Send = (event) => {
    const next = step(live.current, event);
    live.current = next.state;
    setFlow(next.state);
    const command = next.command;
    if (command?.type === 'open-editor') onOpenEditor(command.schemeId);
    else if (command?.type === 'pick-and-open') {
      void runPick(window.helm, command.gameId, command.schemeId).then((outcome) => {
        if (outcome.ok) onOpenEditor(outcome.schemeId);
        else send({ type: 'failed', message: outcome.message });
      });
    } else if (command?.type === 'make-and-open') {
      void runMake(window.helm, command.gameId, command.preset).then((outcome) => {
        if (outcome.ok) {
          send({ type: 'finished' });
          onOpenEditor(outcome.schemeId, true);
        } else send({ type: 'failed', message: outcome.message });
      });
    }
  };

  const entries = library.entries ?? [];
  const card = currentCard(entries, state);
  const held = heldSchemes(state);
  const shown = filterEntries(entries, query);
  const editing = card?.scheme ?? null;
  const sheet = sheetLine(state?.sheets ?? [], card?.entry.gameId ?? null);

  return (
    <main className="screen library">
      <section className="current" aria-label="On your Azerons now">
        <div className="current-art">
          {card ? (
            <Art entry={card.entry} kind="header" />
          ) : (
            <span className="art-none">No game yet</span>
          )}
        </div>
        <div className="current-body">
          <div className="current-text">
            <span className="eyebrow">On your Azerons now</span>
            <span className="current-title">{card ? card.title : 'Nothing yet'}</span>
            <span className="hint">{card ? card.detail : 'Pick a game below to start.'}</span>
            {sheet !== null && onSheetDone !== undefined && (
              <SheetReminder line={sheet} onDone={onSheetDone} />
            )}
          </div>
          {card !== null && editing !== null && (
            <div className="row">
              <button
                type="button"
                className="btn primary"
                onClick={() => send({ type: 'open', entry: card.entry, schemeId: editing.id })}
              >
                Edit scheme
              </button>
            </div>
          )}
        </div>
      </section>

      {flow.error !== null && (
        <p className="notice tone-error" role="alert">
          {flow.error}
        </p>
      )}

      <section className="games">
        <div className="games-head">
          <h1 className="section-title">Games</h1>
          <span className="hint">{summary(entries)}</span>
          <button
            type="button"
            className="btn ghost"
            onClick={library.rescan}
            disabled={library.scanning}
          >
            {library.scanning ? 'Looking…' : 'Look again'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => onOpenGame({ kind: 'new', name: '' })}
          >
            Add a game
          </button>
          <label className="search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Find a game"
              aria-label="Find a game"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        {library.error !== null && (
          <p className="notice tone-error" role="alert">
            {library.error}
          </p>
        )}
        {library.entries === null && library.error === null && (
          <p className="hint">Looking for your games…</p>
        )}
        {library.entries !== null && entries.length === 0 && (
          <p className="hint">
            No games found. helmArray looks in Steam; install a game there and press Look again.
          </p>
        )}
        {library.entries !== null && entries.length > 0 && shown.length === 0 && (
          <p className="hint">No game by that name.</p>
        )}

        <ul className="grid">
          {shown.map((entry) => (
            <Tile
              key={`${entry.appId ?? ''}/${entry.gameId ?? ''}/${entry.name}`}
              entry={entry}
              onUnits={held}
              flow={flow}
              send={send}
              onOpenGame={onOpenGame}
            />
          ))}
        </ul>
      </section>
    </main>
  );
}
