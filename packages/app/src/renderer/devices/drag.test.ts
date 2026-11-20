import { describe, expect, it, vi } from 'vitest';
import { ACTION_DRAG_TYPE } from '../unit/layout';
import { FROM_DRAG_TYPE, dragAction, dragFrom, dropHandlers } from './drag';
import type { DragLike } from './drag';

function drag(data: Record<string, string> = {}, inside = false) {
  const store = { ...data };
  const event: DragLike = {
    preventDefault: vi.fn(),
    dataTransfer: {
      types: Object.keys(store),
      getData: (type) => store[type] ?? '',
      setData: (type, value) => void (store[type] = value),
      effectAllowed: 'none',
      dropEffect: 'none',
    },
    currentTarget: { contains: () => inside },
    relatedTarget: null,
  };
  return { event, store };
}

describe('dragging an action', () => {
  it('from the list carries the action only', () => {
    const { event, store } = drag();
    dragAction('reload')(event);
    expect([store, event.dataTransfer.effectAllowed]).toEqual([
      { [ACTION_DRAG_TYPE]: 'reload' },
      'copy',
    ]);
  });

  it('off a control carries the action and where it came from', () => {
    const { event, store } = drag();
    dragFrom('L.middle_1', 'reload')(event);
    expect(store).toEqual({ [ACTION_DRAG_TYPE]: 'reload', [FROM_DRAG_TYPE]: 'L.middle_1' });
  });
});

describe('dropping it on a control', () => {
  const setup = () => {
    const onDrop = vi.fn();
    const mark = vi.fn();
    return { onDrop, mark, handlers: dropHandlers('L.middle_2', onDrop, mark) };
  };

  it('accepts a drag that carries an action, and marks the control', () => {
    const { mark, handlers } = setup();
    const { event } = drag({ [ACTION_DRAG_TYPE]: 'reload' });
    handlers.onDragOver(event);
    expect([
      vi.mocked(event.preventDefault).mock.calls.length,
      mark.mock.calls,
      event.dataTransfer.dropEffect,
    ]).toEqual([1, [['L.middle_2']], 'copy']);
  });

  it('refuses a drag that carries anything else', () => {
    const { mark, handlers } = setup();
    const { event } = drag({ 'text/plain': 'hello' });
    handlers.onDragOver(event);
    expect([vi.mocked(event.preventDefault).mock.calls.length, mark.mock.calls]).toEqual([0, []]);
  });

  it('unmarks when the drag leaves the control, not when it moves onto its label', () => {
    const { mark, handlers } = setup();
    handlers.onDragLeave(drag({}, true).event);
    handlers.onDragLeave(drag({}, false).event);
    expect(mark.mock.calls).toEqual([[null]]);
  });

  it('puts an action from the list on the control', () => {
    const { onDrop, mark, handlers } = setup();
    handlers.onDrop(drag({ [ACTION_DRAG_TYPE]: 'reload' }).event);
    expect([onDrop.mock.calls, mark.mock.calls]).toEqual([[['L.middle_2', 'reload']], [[null]]]);
  });

  it('moves an action dragged off another control, and does nothing back on its own', () => {
    const { onDrop, handlers } = setup();
    handlers.onDrop(drag({ [ACTION_DRAG_TYPE]: 'reload', [FROM_DRAG_TYPE]: 'L.middle_1' }).event);
    handlers.onDrop(drag({ [ACTION_DRAG_TYPE]: 'jump', [FROM_DRAG_TYPE]: 'L.middle_2' }).event);
    handlers.onDrop(drag({}).event);
    expect(onDrop.mock.calls).toEqual([['L.middle_2', 'reload', 'L.middle_1']]);
  });
});
