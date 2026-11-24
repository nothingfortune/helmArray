// What every control of the keyboard, the mouse and the controller is, as a button: its state
// classes, its role's colours, what is said after what is seen, and its handlers (select, drop,
// drag its action off). Pure: the component hands in the drop outline's state.

import type { ControlId } from '@helmarray/core';
import type { UnitKey } from '../unit/Unit';
import { roleVars } from '../unit/role';
import { dragFrom, dropHandlers } from './drag';
import type { DropAction } from './drag';

export interface DeviceProps {
  /** Control id to its action. A missing entry draws the control plain: it does nothing. */
  keys: Readonly<Record<ControlId, UnitKey | undefined>>;
  selected?: ControlId | undefined;
  conflicts?: ReadonlySet<ControlId>;
  onSelect?: (id: ControlId) => void;
  onDropAction?: DropAction;
}

export interface ControlState extends DeviceProps {
  /** The control a drag is over, for its outline. */
  dropTarget: ControlId | null;
  setDropTarget(control: ControlId | null): void;
}

/**
 * One control: its button attributes, its action's label (null when it has none), and what a screen
 * reader says after what is seen (", conflict", which of a pair a key is). The button's name is its
 * own text, so it begins with what is seen on it. A stick (`canTake` false) takes no drop.
 */
export function controlFor(state: ControlState, id: ControlId, canTake: boolean, after = '') {
  const { keys, selected, conflicts, onSelect, onDropAction, dropTarget, setDropTarget } = state;
  const action = keys[id];
  const conflict = conflicts?.has(id) === true;
  const classes = [
    action === undefined ? 'is-plain' : 'is-assigned',
    ...(selected === id ? ['is-selected'] : []),
    ...(conflict ? ['is-conflict'] : []),
    ...(dropTarget === id ? ['is-drop'] : []),
  ];
  return {
    label: action?.label ?? null,
    /** The key's short label, for a key too small for the action's name. */
    short: action?.short,
    said: `${after}${conflict ? ', conflict' : ''}`,
    attrs: {
      type: 'button' as const,
      className: classes.join(' '),
      style: roleVars(action?.role),
      'aria-current': selected === id ? ('true' as const) : undefined,
      onClick: () => onSelect?.(id),
      ...(onDropAction !== undefined && canTake
        ? dropHandlers(id, onDropAction, setDropTarget)
        : {}),
      ...(onDropAction !== undefined && action?.action !== undefined
        ? { draggable: true, onDragStart: dragFrom(id, action.action, action.press ?? 'tap') }
        : {}),
    },
  };
}

/** Which drawn part is lit: the selected control's, or the one a drag is over. */
export function litParts(
  rows: readonly { id: ControlId; part: string }[],
  ...ids: (ControlId | null | undefined)[]
): Set<string> {
  return new Set(rows.filter((r) => ids.includes(r.id)).map((r) => r.part));
}

/** Which of a pair a key is, said after its action: "Shift, Sprint, left one". */
export function sideOf(id: ControlId): string {
  if (/^key\.L(Shift|Ctrl|Alt|Win)$/.test(id)) return ', left one';
  if (/^key\.R(Shift|Ctrl|Alt|Win)$/.test(id)) return ', right one';
  return '';
}
