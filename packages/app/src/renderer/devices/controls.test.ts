import { describe, expect, it, vi } from 'vitest';
import { ACTION_DRAG_TYPE } from '../unit/layout';
import { roleVars } from '../unit/role';
import { controlFor, litParts, sideOf } from './controls';
import type { ControlState } from './controls';
import { FROM_DRAG_TYPE } from './drag';
import { MOUSE_ROWS } from './layouts';

const state = (over: Partial<ControlState> = {}): ControlState => ({
  keys: { 'key.R': { label: 'Reload', role: 'combat', action: 'reload' } },
  dropTarget: null,
  setDropTarget: vi.fn(),
  ...over,
});

describe('a control of the keyboard, the mouse or the controller', () => {
  it('has its action and its role’s colours, or is plain', () => {
    const r = controlFor(state(), 'key.R', true);
    const t = controlFor(state(), 'key.T', true);
    expect([r.label, r.attrs.className, r.attrs.style, t.label, t.attrs.className]).toEqual([
      'Reload',
      'is-assigned',
      roleVars('combat'),
      null,
      'is-plain',
    ]);
  });

  it('says it is selected, in conflict, or under a drag', () => {
    const c = controlFor(
      state({ selected: 'key.R', conflicts: new Set(['key.R']), dropTarget: 'key.R' }),
      'key.R',
      true,
      ', left one',
    );
    expect([c.attrs.className, c.attrs['aria-current'], c.said]).toEqual([
      'is-assigned is-selected is-conflict is-drop',
      'true',
      ', left one, conflict',
    ]);
  });

  it('is selected by a click', () => {
    const onSelect = vi.fn();
    controlFor(state({ onSelect }), 'key.T', true).attrs.onClick();
    expect(onSelect.mock.calls).toEqual([['key.T']]);
  });

  it('takes a drop and lets its own action be dragged off, only where the editor allows it', () => {
    const onDropAction = vi.fn();
    const editing = controlFor(state({ onDropAction }), 'key.R', true).attrs;
    const shown = controlFor(state(), 'key.R', true).attrs;
    const stick = controlFor(state({ onDropAction }), 'pad.left_stick', false).attrs;
    expect([
      'onDrop' in editing,
      'draggable' in editing,
      'onDrop' in shown,
      'draggable' in shown,
      'onDrop' in stick,
    ]).toEqual([true, true, false, false, false]);
  });

  it('drags its action off with where it came from', () => {
    const onDropAction = vi.fn();
    const attrs = controlFor(state({ onDropAction }), 'key.R', true).attrs;
    const data: Record<string, string> = {};
    const dataTransfer = {
      types: [] as string[],
      getData: (t: string) => data[t] ?? '',
      setData: (t: string, v: string) => void (data[t] = v),
      effectAllowed: '',
      dropEffect: '',
    };
    (attrs as unknown as { onDragStart(e: { dataTransfer: unknown }): void }).onDragStart({
      dataTransfer,
    });
    expect(data).toEqual({ [ACTION_DRAG_TYPE]: 'reload', [FROM_DRAG_TYPE]: 'key.R' });
  });
});

describe('the drawing’s lit parts', () => {
  it('lights the part of the selected control and of the one under a drag', () => {
    expect([...litParts(MOUSE_ROWS, 'mouse.left', 'mouse.back')]).toEqual(['left', 'side1']);
    expect(litParts(MOUSE_ROWS, undefined, null).size).toBe(0);
  });
});

describe('which of a pair a key is', () => {
  it('is said for Shift, Ctrl, Alt and Win, and nothing else', () => {
    expect(
      ['key.LShift', 'key.RCtrl', 'key.LWin', 'key.RAlt', 'key.L', 'key.R'].map(sideOf),
    ).toEqual([', left one', ', right one', ', left one', ', right one', '', '']);
  });
});

describe('a role’s colours', () => {
  it('are its dot and its tint, and plain for an action with no role', () => {
    expect([roleVars('combat'), roleVars(undefined)]).toEqual([
      { '--role': 'var(--color-combat)', '--tint': 'var(--color-combat-tint)' },
      { '--role': 'var(--color-muted)', '--tint': 'var(--color-raised)' },
    ]);
  });
});
