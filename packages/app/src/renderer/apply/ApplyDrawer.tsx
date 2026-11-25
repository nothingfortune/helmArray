import { useEffect, useReducer, useRef } from 'react';
import { Dialog } from 'radix-ui';
import type { AppState } from '../../shared/api';
import { plainReason } from '../screens/libraryFlow';
import { START, drawerView, previewKey, reduce, waitingOnGame } from './applyFlow';
import type { GameSection } from './applyFlow';
import './apply.css';

export interface ApplyDrawerProps {
  /** The scheme to apply. */
  schemeId: string;
  open: boolean;
  onClose(): void;
  /** An apply ran, and may have written keys into the scheme: whoever shows it takes them. */
  onApplied?(): void;
  /** The app state: when a unit or the Azeron app changes, what is ready is looked at again. */
  state: AppState | null;
}

/** While the game is open the drawer looks again this often, to see it closed. */
const GAME_RELOOK_MS = 2000;

/**
 * The game's half: the bindings to set, by set and mode where there is more than one; for the
 * game's file, its name and a note first.
 */
function Game({ section }: { section: GameSection }) {
  return (
    <section className="apply-unit" aria-label={section.title}>
      <div className="apply-unit-head">
        <h3 className="section-title">{section.title}</h3>
        <span className="hint">{section.summary}</span>
      </div>
      {section.file !== undefined && <p className="apply-file">{section.file}</p>}
      {section.note !== undefined && <p className="apply-note">{section.note}</p>}
      {section.groups.map((group) => (
        <div key={group.label ?? ''} className="apply-group">
          {group.label !== null && <span className="apply-group-label">{group.label}</span>}
          {group.lines.map((line) => (
            <p key={line} className="apply-line kind-game">
              {line}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}

/** A check's dot: green when it is ready, red when it is not. Its words say which as well. */
function Mark({ ok }: { ok: boolean }) {
  return <span className={`dot apply-dot tone-${ok ? 'ok' : 'error'}`} aria-hidden="true" />;
}

/**
 * Apply slides over the page from the right (like Settings): what is ready, what changes on each
 * unit, then Cancel and Apply. Opened by the Editor's Apply button; closed by Cancel, Escape or
 * the scrim, but never while it writes.
 */
export function ApplyDrawer({ schemeId, open, onClose, onApplied, state }: ApplyDrawerProps) {
  const [drawer, dispatch] = useReducer(reduce, START);
  // The newest look wins: an answer that comes back after a newer ask is dropped.
  const asked = useRef(0);
  const key = previewKey(state);

  const look = () => {
    const ask = ++asked.current;
    window.helm.previewApply(schemeId).then(
      (preview) => {
        if (ask === asked.current) dispatch({ type: 'preview', preview });
      },
      (error: unknown) => {
        if (ask === asked.current)
          dispatch({
            type: 'previewFailed',
            message: `Couldn't check what is ready. ${plainReason(error)}`.trim(),
          });
      },
    );
  };

  useEffect(() => {
    if (!open) return;
    look();
    // `look` is a fresh function each render; what it reads is the scheme and the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schemeId, key]);

  useEffect(() => {
    if (open) dispatch({ type: 'open' });
  }, [open]);

  // Nothing tells the window when the game closes: while the drawer waits for it, it looks again.
  const waiting = open && waitingOnGame(drawer);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(look, GAME_RELOOK_MS);
    return () => clearInterval(timer);
    // `look` is a fresh function each render; what it reads is the scheme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, schemeId]);

  const view = drawerView(drawer);

  const apply = () => {
    if (drawer.phase === 'done') {
      dispatch({ type: 'retry' });
      look();
      return;
    }
    if (drawer.phase !== 'ready') return;
    dispatch({ type: 'apply' });
    const shown = drawer.preview;
    // Exactly the layout that was shown: if the scheme changed since, main refuses and the
    // drawer looks again.
    window.helm.apply(schemeId, shown.fingerprint).then(
      (result) => {
        dispatch({ type: 'applied', result });
        if (result.units.length > 0) onApplied?.();
        if (result.changed === true) look();
      },
      (error: unknown) =>
        dispatch({
          type: 'applyFailed',
          message: `Couldn't apply. ${plainReason(error)}`.trim(),
        }),
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && view.closable && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content
          className="drawer apply-drawer"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => !view.closable && e.preventDefault()}
          onInteractOutside={(e) => !view.closable && e.preventDefault()}
        >
          <div className="apply-head">
            <Dialog.Title className="drawer-title">{view.title}</Dialog.Title>
            <span className="hint">{view.subtitle}</span>
          </div>

          <div className="apply-body" aria-busy={drawer.phase === 'applying'}>
            {view.notice !== null && (
              <p className="notice tone-warning" role="status">
                {view.notice}
              </p>
            )}
            {view.loading !== null && <p className="hint">{view.loading}</p>}
            {view.unavailable !== null && (
              <p className="notice tone-error" role="alert">
                {view.unavailable}
              </p>
            )}

            {view.result !== null && (
              <section className="apply-result" aria-label="Result">
                <p
                  className={`apply-headline ${view.result.ok ? 'tone-ok' : 'tone-error'}`}
                  role={view.result.ok ? 'status' : 'alert'}
                >
                  <Mark ok={view.result.ok} />
                  {view.result.headline}
                </p>
                {view.result.lines.map((line) => (
                  <p key={line} className="hint">
                    {line}
                  </p>
                ))}
              </section>
            )}
            {view.sheet !== null && <Game section={view.sheet} />}

            {view.checks.length > 0 && (
              <section aria-label="What is ready">
                <ul className="apply-checks">
                  {view.checks.map((check) => (
                    <li key={check.text} className="apply-check">
                      <Mark ok={check.ok} />
                      <span className="sr-only">{check.ok ? 'Ready: ' : 'Not ready: '}</span>
                      {check.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {view.sections.map((section) => (
              <section key={section.hand} className="apply-unit" aria-label={section.title}>
                <div className="apply-unit-head">
                  <h3 className="section-title">{section.title}</h3>
                  <span className="hint">{section.summary}</span>
                </div>
                {section.lines.map((line) => (
                  <p key={line.text} className={`apply-line kind-${line.kind}`}>
                    {line.text}
                  </p>
                ))}
              </section>
            ))}

            {view.game !== null && <Game section={view.game} />}

            {view.progress !== null && (
              <div className="apply-progress">
                <div className="apply-bar" role="progressbar" aria-label="Applying" />
                <p className="hint">{view.progress}</p>
              </div>
            )}
          </div>

          <div className="apply-foot">
            <button
              type="button"
              className="btn ghost"
              disabled={view.cancel.disabled}
              onClick={onClose}
            >
              {view.cancel.label}
            </button>
            {view.apply !== null && (
              <button
                type="button"
                className="btn primary"
                disabled={view.apply.disabled}
                onClick={apply}
              >
                {view.apply.label}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
