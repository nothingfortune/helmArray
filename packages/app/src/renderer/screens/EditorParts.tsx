// The Editor's parts, as the canvas draws them (docs/design/canvas/Editor.dc.html): the header's
// Scheme picker and device chooser, the device area, the checks, the side panel and the actions not
// on a button yet. Each draws what it is given and says what was asked of it; the Editor owns the
// state. Pure enough to be drawn in a test without a window.
import { useState } from 'react';
import { Popover } from 'radix-ui';
import type { AzeronUse, ControlId, Game, PadControl, Press, Role, Scheme } from '@helmarray/core';
import type { Preset } from '../../shared/api';
import { Controller, Keyboard, Mouse } from '../devices/Devices';
import { dragAction } from '../devices/drag';
import type { DropAction } from '../devices/drag';
import { Unit } from '../unit/Unit';
import type { UnitProps } from '../unit/Unit';
import {
  KEY_LABEL_LIMIT,
  NAME_LIMIT,
  chooseAzerons,
  chooseController,
  chooseKeyboard,
  hasDevices,
} from './editor-model';
import type { EditorView, FindingRow, PanelView, UnitSide } from './editor-view';
import type { CheckGroup } from './check-groups';
import { findingLocation } from './reveal';
import { MOUSE_WIDTH, keyboardRow, unitRow } from './editor-layout';
import { KEYBOARD_WIDTH } from '../devices/layouts';

const roleColour = (role: Role | undefined): string =>
  role === undefined ? 'var(--color-muted)' : `var(--color-${role})`;

export function BackLink({ onBack }: { onBack(): void }) {
  return (
    <button type="button" className="btn ghost ed-back" onClick={onBack}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      Library
    </button>
  );
}

function unitProps(side: UnitSide): Pick<UnitProps, 'keys' | 'conflicts' | 'stick'> {
  return {
    keys: side.keys,
    conflicts: side.conflicts,
    ...(side.stick === undefined ? {} : { stick: side.stick }),
  };
}

/** One finding: dot, its sentence, its fix, "Keep, I know". */
function CheckRow({
  row,
  onFix,
  onKeep,
  onShow,
}: {
  row: FindingRow;
  onFix(row: FindingRow): void;
  onKeep(row: FindingRow): void;
  onShow(row: FindingRow): void;
}) {
  return (
    <div className={`ed-check tone-${row.finding.severity}`}>
      <span
        className={`dot tone-${row.finding.severity === 'error' ? 'error' : 'warning'}`}
        aria-hidden="true"
      />
      {/* A finding with a place shows it when clicked: its mode, its control (reveal.ts). */}
      {findingLocation(row.finding) === undefined ? (
        <CheckText row={row} />
      ) : (
        <button type="button" className="ed-check-go" onClick={() => onShow(row)}>
          <CheckText row={row} />
        </button>
      )}
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
  );
}

/**
 * Findings of one rule about actions of one role, as one line with one fix and one "Keep, I know"
 * for them all; "Show each" opens the findings themselves, each with its own.
 */
function CheckGroupRow({
  group,
  onFix,
  onKeep,
  onFixAll,
  onKeepAll,
  onShow,
}: {
  group: CheckGroup;
  onFix(row: FindingRow): void;
  onKeep(row: FindingRow): void;
  onFixAll(group: CheckGroup): void;
  onKeepAll(group: CheckGroup): void;
  onShow(row: FindingRow): void;
}) {
  const severity = group.rows.some((r) => r.finding.severity === 'error') ? 'error' : 'warning';
  return (
    <div className="ed-check-group">
      <div className={`ed-check tone-${severity}`}>
        <span className={`dot tone-${severity}`} aria-hidden="true" />
        <span className="ed-check-text">
          <strong className="ed-check-subject">{group.subject}</strong>
          {group.rest}
        </span>
        {group.fix && (
          <button type="button" className="btn ed-fix" onClick={() => onFixAll(group)}>
            {group.fix.label}
          </button>
        )}
        {group.canKeep && (
          <button type="button" className="btn ghost" onClick={() => onKeepAll(group)}>
            Keep, I know
          </button>
        )}
      </div>
      <details className="ed-check-each">
        <summary>Show each</summary>
        {group.rows.map((row) => (
          <CheckRow key={row.key} row={row} onFix={onFix} onKeep={onKeep} onShow={onShow} />
        ))}
      </details>
    </div>
  );
}

/** A check's one sentence, its subject in bold, as the canvas draws it. */
function CheckText({ row }: { row: FindingRow }) {
  return (
    <span className="ed-check-text">
      {row.subject !== null && <strong className="ed-check-subject">{row.subject}</strong>}
      {row.rest}
      {/* Why its fix isn't offered, when its rule has one that can't act here. */}
      {row.why !== undefined && <span className="ed-check-why"> {row.why}</span>}
    </span>
  );
}

export function Checks({
  view,
  onFix,
  onKeep,
  onFlag,
  onFixAll,
  onKeepAll,
  onShow = () => undefined,
}: {
  view: EditorView;
  onFix(row: FindingRow): void;
  onKeep(row: FindingRow): void;
  onFlag(row: FindingRow): void;
  /** A group's fix: every finding in it fixed, one after the other. */
  onFixAll(group: CheckGroup): void;
  /** A group's "Keep, I know": every finding in it kept. */
  onKeepAll(group: CheckGroup): void;
  /** A finding's sentence clicked: show where it is (its mode, its control). */
  onShow?(row: FindingRow): void;
}) {
  return (
    <section className="ed-checks" aria-label="Checks">
      {view.findings.length === 0 && (
        <p className="ed-clear">
          <span className="dot tone-ok" aria-hidden="true" />
          Nothing to fix.
        </p>
      )}
      {view.checks.map((item) =>
        item.kind === 'row' ? (
          <CheckRow
            key={item.row.key}
            row={item.row}
            onFix={onFix}
            onKeep={onKeep}
            onShow={onShow}
          />
        ) : (
          <CheckGroupRow
            key={item.key}
            group={item}
            onFix={onFix}
            onKeep={onKeep}
            onFixAll={onFixAll}
            onKeepAll={onKeepAll}
            onShow={onShow}
          />
        ),
      )}
      {view.kept.length > 0 && (
        <details className="ed-kept">
          <summary>{view.kept.length} kept</summary>
          {view.kept.map((row) => (
            <div key={row.key} className="ed-check is-kept">
              <span className="dot tone-ok" aria-hidden="true" />
              <CheckText row={row} />
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

export function Panel({
  panel,
  onClose,
  onMode,
  onTarget,
  onClear,
  onTurbo,
  onLatch,
  onPad,
  onKeyLabel,
}: {
  panel: PanelView;
  onClose(): void;
  onMode(mode: string): void;
  onTarget(press: Press): void;
  onClear(press: Press): void;
  onTurbo(on: boolean): void;
  onLatch(on: boolean): void;
  onPad(pad: PadControl): void;
  /** The key label typed, when the field is left or Enter is pressed. */
  onKeyLabel(text: string): void;
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
        <div className="ed-group" role="group" aria-labelledby="ed-directions">
          <span className="ed-lbl" id="ed-directions">
            Directions
          </span>
          {panel.directions.map((row) => (
            <div key={row.direction} className="ed-slot ed-direction">
              <span className="ed-slot-word">{row.word}</span>
              {row.action ? (
                <span className="ed-slot-name">{row.action.name}</span>
              ) : (
                <span className="ed-slot-empty">Nothing</span>
              )}
              {row.sends !== null && <span className="ed-direction-sends">{row.sends}</span>}
            </div>
          ))}
        </div>
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
          {panel.keyLabel !== null && (
            <KeyLabelField
              // A new control, or a label changed elsewhere (an undo), starts the field afresh.
              key={`${panel.control}|${panel.keyLabel.value}`}
              value={panel.keyLabel.value}
              placeholder={panel.keyLabel.placeholder}
              onSave={onKeyLabel}
            />
          )}
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

/**
 * "Key label", as the canvas draws it under Press: the player's short word for the key, shown on
 * it only when the action's name won't fit. Saved when the field is left or Enter is pressed.
 */
export function KeyLabelField({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave(text: string): void;
}) {
  const [text, setText] = useState(value);
  return (
    <form
      className="ed-group"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text);
      }}
    >
      <label className="ed-lbl" htmlFor="ed-key-label">
        Key label
      </label>
      <span className="ed-field">
        <input
          id="ed-key-label"
          type="text"
          value={text}
          placeholder={placeholder}
          maxLength={KEY_LABEL_LIMIT}
          aria-describedby="ed-key-label-hint"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onSave(text)}
        />
      </span>
      <span className="ed-note" id="ed-key-label-hint">
        Shown on the key only when the game&apos;s word won&apos;t fit at a readable size.
      </span>
    </form>
  );
}

export function Unplaced({
  view,
  modeName,
  prompt,
  onPlace,
}: {
  view: EditorView;
  /** The mode shown, for a game with modes to tell apart; null for a game with one. */
  modeName: string | null;
  prompt: string | null;
  onPlace(id: string): void;
}) {
  const act = (a: { id: string; name: string; role?: Role | undefined }, note?: string) => (
    <li key={a.id}>
      <button
        type="button"
        className="ed-act"
        draggable
        aria-disabled={prompt === null}
        onDragStart={dragAction(a.id)}
        onClick={() => prompt !== null && onPlace(a.id)}
      >
        <span className="dot" style={{ background: roleColour(a.role) }} aria-hidden="true" />
        <span className="ed-act-name">{a.name}</span>
        {note !== undefined && <span className="ed-act-where">{note}</span>}
      </button>
    </li>
  );
  return (
    <div className="ed-group ed-unplaced">
      {prompt !== null && <p className="ed-hint">{prompt}</p>}
      {view.lists.map((list) => (
        <div key={list.set} className="ed-group">
          <div className="ed-unplaced-head">
            <span className="ed-lbl">
              Not on a {list.word}
              {modeName === null ? '' : ` · ${modeName}`}
            </span>
            <span className="ed-count">{list.actions.length}</span>
          </div>
          {list.actions.length === 0 ? (
            <p className="ed-hint">
              Every {modeName === null ? '' : `${modeName} `}action is on a {list.word}.
            </p>
          ) : (
            <ul className="ed-actions">{list.actions.map((a) => act(a))}</ul>
          )}
        </div>
      ))}
      {view.onStick.length > 0 && (
        <div className="ed-group ed-on-stick">
          <div className="ed-unplaced-head">
            <span className="ed-lbl">On the stick</span>
            <span className="ed-count">{view.onStick.length}</span>
          </div>
          <ul className="ed-actions">{view.onStick.map((a) => act(a, a.where))}</ul>
        </div>
      )}
      {view.moves.length > 0 && (
        <div className="ed-group ed-moves">
          <div className="ed-unplaced-head">
            <span className="ed-lbl">Already on a {view.controlWord} · picking moves it here</span>
            <span className="ed-count">{view.moves.length}</span>
          </div>
          <ul className="ed-actions">{view.moves.map((a) => act(a, a.where))}</ul>
        </div>
      )}
    </div>
  );
}

/** The confirmation before a setup is deleted: it names the scheme, so it never reads as a device. */
export const deleteQuestion = (name: string): string => `Delete the scheme “${name}”?`;

/** What the Scheme picker can do: each switches the editor to the setup it leads to. */
export interface PickerActions {
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
export function SchemePicker({
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
          <div className="choices" role="group" aria-labelledby="ed-picker-list">
            <span className="hint" id="ed-picker-list">
              {game.name}
            </span>
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
          <div className="choices" role="group" aria-labelledby="ed-picker-new">
            <span className="hint" id="ed-picker-new">
              New from
            </span>
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
            <div className="ed-confirm" role="group" aria-label={deleteQuestion(scheme.name)}>
              <span>{deleteQuestion(scheme.name)}</span>
              {/* The two answers stay together on one row. */}
              <span className="ed-confirm-buttons">
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
              </span>
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

/**
 * Why None can't be picked, said beside it rather than left to a greyed-out guess; null when it
 * can be.
 */
export const noneWhy = (devices: Scheme['devices']): string | null =>
  hasDevices(chooseAzerons(devices, 'none'))
    ? null
    : 'None needs another device: a setup plays with at least one.';

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
export function DevicesChooser({
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
  const why = noneWhy(devices);
  const noneOff = why !== null;
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
                  {...(c.value === 'none' && noneOff && { 'aria-describedby': 'ed-devices-why' })}
                />
                {c.label}
              </label>
            ))}
            {noneOff && (
              <p className="hint ed-devices-why" id="ed-devices-why">
                {why}
              </p>
            )}
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
export function DeviceArea({
  view,
  width,
  selected,
  onSelect,
  onDropAction,
}: {
  view: EditorView;
  /** The width the devices have, measured; undefined before it is (each then fills its share). */
  width?: number | undefined;
  selected: ControlId | undefined;
  onSelect(id: ControlId): void;
  onDropAction: DropAction;
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
  if (view.tab === 'keyboard') {
    const row = keyboardRow(width, view.mouse && view.keyboard);
    return (
      <div className={`ed-kbm${row.mouseBelow ? ' is-below' : ''}`}>
        {view.keyboard && (
          <div
            className={`ed-kb${row.scale === undefined ? '' : ' is-scaled'}`}
            style={row.scale === undefined ? undefined : { width: KEYBOARD_WIDTH * row.scale }}
          >
            <Keyboard {...fixed} />
          </div>
        )}
        {view.mouse && <Mouse {...fixed} />}
      </div>
    );
  }
  if (view.tab === 'controller') return <Controller {...fixed} />;
  const row = unitRow(width, view.hands.length, view.mouseBeside ? MOUSE_WIDTH : 0);
  return (
    <div className={`ed-units${row.stacked ? ' is-stacked' : ''}`}>
      {view.hands.map((hand) => (
        <div key={hand} className={`ed-unit${row.scale === undefined ? '' : ' is-scaled'}`}>
          <Unit
            hand={hand}
            {...unitProps(view[hand])}
            {...(row.scale === undefined ? {} : { scale: row.scale })}
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
