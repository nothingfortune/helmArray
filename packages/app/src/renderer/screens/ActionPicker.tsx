// The action picker, over the side panel as the canvas draws it (Editor.dc.html, the EditorPicker
// board): a search, the role chips, the actions on no control and those on another, each row a
// drag source too. The search has the focus; the arrows move through the results, Enter picks the
// one shown, Esc closes. Not modal: the units stay there to drop on. What it shows is worked out in
// ./action-picker; `ActionPicker` holds the search, and `PickerPanel` draws it and says what was
// asked of it.
import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { Dispatch, KeyboardEvent, RefObject } from 'react';
import type { Game, ModeId, Scheme } from '@helmarray/core';
import { dragAction } from '../devices/drag';
import { PICKER_START, pickerKey, pickerReducer, pickerSource, pickerView } from './action-picker';
import type { PickerAction, PickerView } from './action-picker';
import type { EditorView } from './editor-view';
import { roleColour } from './role-words';

export interface ActionPickerProps {
  /** The editor's view, a control selected: the picker chooses for its target press. */
  view: EditorView;
  scheme: Scheme;
  game: Game;
  mode: ModeId;
  /** The mode shown, for a game with modes; null for a game with one. */
  modeName: string | null;
  onPick(actionId: string): void;
  onClose(): void;
}

/**
 * The picker for the selected control's target press, with its search, its role and the result
 * shown: they start afresh each time it opens. Once it is gone, the focus goes back to the Add or
 * Change it was opened from, when that is there again (Esc, Close, a pick); when the selection
 * moved elsewhere, it is not, and the focus stays where the player put it.
 */
export function ActionPicker({
  view,
  scheme,
  game,
  mode,
  modeName,
  onPick,
  onClose,
}: ActionPickerProps) {
  const [state, dispatch] = useReducer(pickerReducer, PICKER_START);
  const field = useRef<HTMLInputElement>(null);
  const source = useMemo(() => pickerSource(view, scheme, game, mode), [view, scheme, game, mode]);
  const shown = useMemo(
    () => (source === null ? null : pickerView(source, state.query, state.role, modeName)),
    [source, state.query, state.role, modeName],
  );
  const target = view.panel?.presses.find((r) => r.target);
  const at = Math.min(state.active, Math.max(0, (shown?.rows.length ?? 0) - 1));
  // Which Add or Change opened it: `${control}|${press}`, as the side panel marks it.
  const from = useRef(`${view.panel?.control ?? ''}|${target?.press ?? ''}`);
  useEffect(() => {
    field.current?.focus();
    const opener = from.current;
    return () =>
      document.querySelector<HTMLElement>(`.ed-panel [data-choose="${opener}"]`)?.focus();
  }, []);
  useEffect(() => {
    document.getElementById(`ed-choose-${at}`)?.scrollIntoView({ block: 'nearest' });
  }, [at, shown]);
  if (shown === null || target === undefined || view.panel === null) return null;
  return (
    <PickerPanel
      view={shown}
      at={at}
      query={state.query}
      heading={`${view.panel.where} · ${target.word}`}
      field={field}
      dispatch={dispatch}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

export interface PickerPanelProps {
  view: PickerView;
  /** The result Enter picks. */
  at: number;
  query: string;
  /** Where and which press: "Left · Index 5 · Tap". */
  heading: string;
  field: RefObject<HTMLInputElement | null>;
  dispatch: Dispatch<PickerAction>;
  onPick(actionId: string): void;
  onClose(): void;
}

/** The picker as drawn for a view of it. */
export function PickerPanel({
  view,
  at,
  query,
  heading,
  field,
  dispatch,
  onPick,
  onClose,
}: PickerPanelProps) {
  const onKey = (e: KeyboardEvent) => {
    const step = pickerKey(e.key, e.target === field.current, at, view.rows.length);
    if (step === null) return;
    // Esc before the search field's own, which would only empty it.
    e.preventDefault();
    if (step.kind === 'close') {
      e.stopPropagation();
      onClose();
    } else if (step.kind === 'move') dispatch({ type: 'move', to: step.to });
    else {
      const row = view.rows[at];
      if (row !== undefined) onPick(row.id);
    }
  };
  let index = 0;
  return (
    // The keys are the search field's and the dialog's own: Esc anywhere in it closes it.
    <div className="ed-choose" role="dialog" aria-label="Choose an action" onKeyDown={onKey}>
      <div className="ed-panel-head">
        <div className="ed-panel-names">
          <span className="ed-lbl">{heading}</span>
          <span className="ed-panel-title">Choose an action</span>
        </div>
        <button type="button" className="btn ghost icon" aria-label="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
      </div>
      <span className="ed-field ed-choose-search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.7" />
        </svg>
        <input
          ref={field}
          type="search"
          role="combobox"
          aria-label="Search actions"
          aria-autocomplete="list"
          aria-expanded={view.rows.length > 0}
          {...(view.rows.length > 0 && {
            'aria-controls': 'ed-choose-list',
            'aria-activedescendant': `ed-choose-${at}`,
          })}
          placeholder={view.placeholder}
          value={query}
          onChange={(e) => dispatch({ type: 'query', text: e.target.value })}
        />
      </span>
      <div className="ed-chips" role="group" aria-label="Role">
        {view.filters.map((f) => (
          <button
            key={f.id}
            type="button"
            className="ed-chip"
            aria-pressed={f.pressed}
            onClick={() => {
              dispatch({ type: 'role', chip: f.id });
              // Back to the search, so Enter picks rather than pressing the chip again.
              field.current?.focus();
            }}
          >
            {f.role !== undefined && (
              <span className="dot" style={{ background: roleColour(f.role) }} aria-hidden="true" />
            )}
            {f.name}
          </button>
        ))}
      </div>
      <div className="ed-choose-results">
        {view.empty !== null ? (
          <p className="ed-hint">{view.empty}</p>
        ) : (
          <div role="listbox" id="ed-choose-list" aria-label="Actions" className="ed-choose-list">
            {view.groups.map((group) => (
              <div
                key={group.id}
                role="group"
                className="ed-group"
                aria-labelledby={`ed-choose-group-${group.id}`}
              >
                <div className="ed-unplaced-head">
                  <span className="ed-lbl" id={`ed-choose-group-${group.id}`}>
                    {group.title}
                  </span>
                  <span className="ed-count">{group.rows.length}</span>
                </div>
                {group.rows.map((row) => {
                  const i = index++;
                  return (
                    // Picked with Enter from the search (aria-activedescendant), or clicked.
                    <div
                      key={row.id}
                      id={`ed-choose-${i}`}
                      role="option"
                      aria-selected={i === at}
                      className={`ed-act${i === at ? ' is-active' : ''}`}
                      draggable
                      onDragStart={dragAction(row.id)}
                      onClick={() => onPick(row.id)}
                    >
                      <span
                        className="dot"
                        style={{ background: roleColour(row.role) }}
                        aria-hidden="true"
                      />
                      <span className="ed-act-name">{row.name}</span>
                      {row.label !== undefined && <span className="ed-act-label">{row.label}</span>}
                      {row.where !== undefined && <span className="ed-act-where">{row.where}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="ed-choose-count" role="status">
        {view.count}
      </p>
    </div>
  );
}
