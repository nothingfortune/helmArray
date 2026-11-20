// Dragging an action onto a control, the same on every device: from the list of actions not on a
// control yet, or from a control that has one (which moves it). Pure: the handlers take the parts of
// a drag event they read, so they are tested without a window.

import type { ControlId } from '@helmarray/core';
import { ACTION_DRAG_TYPE, dragCarriesAction } from '../unit/layout';

/** The drag type a control sets when its own action is dragged off it: where it came from. */
export const FROM_DRAG_TYPE = 'application/x-helm-from';

/** What these handlers read of a drag event. */
export interface DragLike {
  preventDefault(): void;
  dataTransfer: {
    types: readonly string[];
    getData(type: string): string;
    setData(type: string, value: string): void;
    effectAllowed: string;
    dropEffect: string;
  };
  currentTarget: { contains(node: unknown): boolean };
  relatedTarget: unknown;
}

/** An action dropped on a control; `from` when it was dragged off another control. */
export type DropAction = (control: ControlId, actionId: string, from?: ControlId) => void;

/** Starts dragging a control's own action: it moves to wherever it is dropped. */
export function dragFrom(control: ControlId, actionId: string) {
  return (e: Pick<DragLike, 'dataTransfer'>) => {
    e.dataTransfer.setData(ACTION_DRAG_TYPE, actionId);
    e.dataTransfer.setData(FROM_DRAG_TYPE, control);
    e.dataTransfer.effectAllowed = 'copyMove';
  };
}

/** Starts dragging an action from the list. */
export function dragAction(actionId: string) {
  return (e: Pick<DragLike, 'dataTransfer'>) => {
    e.dataTransfer.setData(ACTION_DRAG_TYPE, actionId);
    e.dataTransfer.effectAllowed = 'copy';
  };
}

/**
 * A control's drop handlers. `mark` is told which control a drag is over (null when it leaves),
 * for the drop outline. A drop on the control an action came from does nothing.
 */
export function dropHandlers(
  control: ControlId,
  onDrop: DropAction,
  mark: (control: ControlId | null) => void,
) {
  return {
    onDragOver: (e: DragLike) => {
      if (!dragCarriesAction(e.dataTransfer.types)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      mark(control);
    },
    onDragLeave: (e: DragLike) => {
      // Moving onto the key's own label is not leaving the key.
      if (!e.currentTarget.contains(e.relatedTarget)) mark(null);
    },
    onDrop: (e: DragLike) => {
      e.preventDefault();
      mark(null);
      const actionId = e.dataTransfer.getData(ACTION_DRAG_TYPE);
      const from = e.dataTransfer.getData(FROM_DRAG_TYPE);
      if (actionId === '' || from === control) return;
      if (from === '') onDrop(control, actionId);
      else onDrop(control, actionId, from);
    },
  };
}
