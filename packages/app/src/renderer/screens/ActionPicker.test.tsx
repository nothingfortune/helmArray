// The action picker drawn to markup (react-dom/server), and what its controls ask for when used,
// with the side panel's presses it opens from and the list it stands over: a stateless part is
// called with its props and the element a person would use is found by its name or role, its
// handler then called as the browser would. The window itself is the e2e suite's
// (packages/app/e2e/picker.spec.ts).
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Scheme } from '@helmarray/core';
import { ActionPicker, PickerPanel } from './ActionPicker';
import type { PickerPanelProps } from './ActionPicker';
import { Panel, Unplaced } from './EditorParts';
import { pickerSource, pickerView } from './action-picker';
import type { PickerSource, RoleFilter } from './action-picker';
import { editorView } from './editor-view';
import { game, keysScheme, plan } from './editor-fixture';

type Props = Record<string, unknown> & { children?: ReactNode };
type El = ReactElement<Props>;

const none = () => undefined;
const PARTS = new Set<unknown>([PickerPanel, Panel, Unplaced]);

/** Every element the node draws, the parts above opened up into what they draw. */
function elements(node: ReactNode): El[] {
  const out: El[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) {
      for (const child of n as ReactNode[]) visit(child);
      return;
    }
    if (!isValidElement(n)) return;
    const el = n as El;
    if (typeof el.type === 'function' && PARTS.has(el.type)) {
      visit((el.type as (p: Props) => ReactNode)(el.props));
      return;
    }
    out.push(el);
    visit(el.props.children);
  };
  visit(node);
  return out;
}

/** The text an element holds. */
const textOf = (node: ReactNode): string =>
  Array.isArray(node)
    ? (node as ReactNode[]).map(textOf).join('')
    : typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : isValidElement(node)
        ? textOf((node as El).props.children)
        : '';

/** The first element that matches, or a failure naming what was looked for. */
function find(node: ReactNode, what: string, match: (e: El) => boolean): El {
  const found = elements(node).find(match);
  if (!found) throw new Error(`Nothing for ${what}`);
  return found;
}
const labelled = (node: ReactNode, name: string) =>
  find(node, name, (e) => e.props['aria-label'] === name);
const button = (node: ReactNode, text: string) =>
  find(node, text, (e) => e.type === 'button' && textOf(e) === text);
const options = (node: ReactNode) => elements(node).filter((e) => e.props['role'] === 'option');

/** Calls a handler the element has, as the browser would; what it asked of the event. */
function fire(el: El, handler: string, event: Record<string, unknown> = {}) {
  const fn = el.props[handler];
  if (typeof fn !== 'function') throw new Error(`No ${handler}`);
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  (fn as (e: unknown) => void)({ preventDefault, stopPropagation, ...event });
  return { preventDefault, stopPropagation };
}

const sourceOf = (scheme: Scheme, selected: string): PickerSource => {
  const v = editorView({ scheme, game, plan: plan(scheme), mode: 'ship', selected });
  const source = pickerSource(v, scheme, game, 'ship');
  if (source === null) throw new Error('no picker');
  return source;
};

/** The panel for L index 2 on the keys scheme, with spies for what it asks for. */
function drawn(query = '', role: RoleFilter = 'all', at = 0) {
  const field = { current: { focus: vi.fn() } as unknown as HTMLInputElement };
  const props: PickerPanelProps = {
    view: pickerView(sourceOf(keysScheme(), 'L.index_2'), query, role, 'Ship'),
    at,
    query,
    heading: 'Left · Index 2 · Tap',
    field,
    dispatch: vi.fn(),
    onPick: vi.fn(),
    onClose: vi.fn(),
  };
  return { props, field, node: <PickerPanel {...props} /> };
}

describe('the action picker, drawn', () => {
  const html = (scheme: Scheme, selected: string, modeName: string | null = null) =>
    renderToStaticMarkup(
      <ActionPicker
        view={editorView({ scheme, game, plan: plan(scheme), mode: 'ship', selected })}
        scheme={scheme}
        game={game}
        mode="ship"
        modeName={modeName}
        onPick={none}
        onClose={none}
      />,
    );

  it('is a dialog with its heading, the search, the role chips, both groups counted, and the count', () => {
    const page = html(keysScheme(), 'L.index_2', 'Ship');
    const count = (text: string) => page.split(text).length - 1;
    expect([
      page.includes('role="dialog" aria-label="Choose an action"'),
      page.includes('Left · Index 2 · Tap'),
      page.includes('placeholder="Search Ship actions"'),
      count('class="ed-chip"'),
      page.includes('Not on a button'),
      page.includes('Already on a button · picking moves it here'),
      count('role="option"'),
      page.includes('7 Ship actions'),
    ]).toEqual([true, true, true, 6, true, true, 7, true]);
  });

  it('shows the first result as the one Enter picks', () => {
    const page = html(keysScheme(), 'L.index_2');
    expect([
      page.includes('aria-activedescendant="ed-choose-0"'),
      page.split('aria-selected="true"').length - 1,
      page.includes('id="ed-choose-0" role="option" aria-selected="true"'),
    ]).toEqual([true, 1, true]);
  });

  it('draws each row as a drag source, with where it is now', () => {
    const page = html(keysScheme(), 'L.index_2');
    expect([page.split('draggable="true"').length - 1, page.includes('Right · Index 1')]).toEqual([
      7,
      true,
    ]);
  });

  it('draws nothing with no button to choose for: the stick', () => {
    expect(html(keysScheme(), 'L.stick')).toBe('');
  });

  it('with nothing to offer, says so in place of the list, and the search controls no list', () => {
    const page = renderToStaticMarkup(
      <PickerPanel
        view={pickerView({ word: 'button', candidates: [] }, '', 'all', null)}
        at={0}
        query=""
        heading="Left · Index 2 · Tap"
        field={{ current: null }}
        dispatch={none}
        onPick={none}
        onClose={none}
      />,
    );
    expect([
      page.includes('No actions to pick here.'),
      page.includes('role="listbox"'),
      page.includes('aria-expanded="false"'),
      page.includes('aria-controls'),
      page.includes('aria-activedescendant'),
    ]).toEqual([true, false, true, false, false]);
  });
});

describe('the action picker, used', () => {
  it('typing in the search asks for that search', () => {
    const { props, node } = drawn();
    fire(labelled(node, 'Search actions'), 'onChange', { target: { value: 'boo' } });
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'query', text: 'boo' });
  });

  it('a chip asks for its role, and gives the focus back to the search', () => {
    const { props, field, node } = drawn();
    fire(button(node, 'Combat'), 'onClick');
    expect([
      vi.mocked(props.dispatch).mock.calls,
      vi.mocked(field.current.focus).mock.calls.length,
    ]).toEqual([[[{ type: 'role', chip: 'combat' }]], 1]);
  });

  it('a row clicked is picked', () => {
    const { props, node } = drawn();
    const hardpoints = options(node).find((o) => textOf(o).startsWith('Hardpoints'));
    if (hardpoints === undefined) throw new Error('no Hardpoints row');
    fire(hardpoints, 'onClick');
    expect(props.onPick).toHaveBeenCalledWith('hardpoints');
  });

  it('a row dragged carries its action', () => {
    const { node } = drawn();
    const first = options(node)[0];
    if (first === undefined) throw new Error('no row');
    const data = new Map<string, string>();
    fire(first, 'onDragStart', {
      dataTransfer: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' },
    });
    expect([...data.values()]).toEqual(['galaxy']);
  });

  it('Close closes it', () => {
    const { props, node } = drawn();
    fire(labelled(node, 'Close'), 'onClick');
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('Esc closes it, before the search field empties itself', () => {
    const { props, node } = drawn('gal');
    const dialog = labelled(node, 'Choose an action');
    const e = fire(dialog, 'onKeyDown', { key: 'Escape', target: {} });
    expect([
      vi.mocked(props.onClose).mock.calls.length,
      e.preventDefault.mock.calls.length,
      e.stopPropagation.mock.calls.length,
    ]).toEqual([1, 1, 1]);
  });

  it('Enter in the search picks the result shown', () => {
    const { props, field, node } = drawn('', 'all', 1);
    fire(labelled(node, 'Choose an action'), 'onKeyDown', { key: 'Enter', target: field.current });
    // The second row: Hardpoints, after Galaxy map.
    expect(props.onPick).toHaveBeenCalledWith('hardpoints');
  });

  it('an arrow in the search moves to the next result', () => {
    const { props, field, node } = drawn();
    fire(labelled(node, 'Choose an action'), 'onKeyDown', {
      key: 'ArrowDown',
      target: field.current,
    });
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'move', to: 1 });
  });

  it('Enter on a chip is the chip’s own: nothing is picked', () => {
    const { props, node } = drawn();
    const e = fire(labelled(node, 'Choose an action'), 'onKeyDown', {
      key: 'Enter',
      target: {},
    });
    expect([vi.mocked(props.onPick).mock.calls, e.preventDefault.mock.calls]).toEqual([[], []]);
  });
});

describe('the side panel’s presses, used', () => {
  /** The side panel on a control, with spies for what it asks for. */
  function sidePanel(scheme: Scheme, selected: string) {
    const v = editorView({ scheme, game, plan: plan(scheme), mode: 'ship', selected });
    if (v.panel === null) throw new Error('no panel');
    const asked = { onTarget: vi.fn(), onChoose: vi.fn(), onClear: vi.fn() };
    const node = (
      <Panel
        panel={v.panel}
        onClose={none}
        onMode={none}
        onTurbo={none}
        onLatch={none}
        onPad={none}
        onKeyLabel={none}
        {...asked}
      />
    );
    return { asked, node };
  }
  /** A press row's own button, by the word it starts with. */
  const row = (node: ReactNode, word: string) =>
    find(node, word, (e) => e.props['className'] === 'ed-slot-main' && textOf(e).startsWith(word));

  it('Add and Change ask for the picker on their press', () => {
    const { asked, node } = sidePanel(keysScheme(), 'L.index_1');
    fire(labelled(node, 'Change tap'), 'onClick');
    fire(labelled(node, 'Add long press'), 'onClick');
    expect(asked.onChoose.mock.calls).toEqual([['tap'], ['long']]);
  });

  it('a press row makes its press the one a click in the list fills', () => {
    const { asked, node } = sidePanel(keysScheme(), 'L.index_1');
    fire(row(node, 'Double'), 'onClick');
    expect(asked.onTarget.mock.calls).toEqual([['double']]);
  });

  it('a press the control can’t send asks for nothing', () => {
    // A controller button has a tap only.
    const pad: Scheme = { ...keysScheme(), output: 'pad', padMap: { 'L.index_1': 'RB' } };
    const { asked, node } = sidePanel(pad, 'L.index_1');
    fire(row(node, 'Long'), 'onClick');
    expect(asked.onTarget.mock.calls).toEqual([]);
  });

  it('Clear clears its press', () => {
    const { asked, node } = sidePanel(keysScheme(), 'L.index_1');
    fire(labelled(node, 'Clear tap'), 'onClick');
    expect(asked.onClear.mock.calls).toEqual([['tap']]);
  });
});

describe('the list under the side panel, used', () => {
  const list = (prompt: string | null) => {
    const v = editorView({
      scheme: keysScheme(),
      game,
      plan: plan(keysScheme()),
      mode: 'ship',
      selected: 'L.index_2',
    });
    const onPlace = vi.fn();
    const node = <Unplaced view={v} modeName={null} prompt={prompt} onPlace={onPlace} />;
    return { onPlace, node };
  };

  it('a click puts the action on the selected press', () => {
    const { onPlace, node } = list('Click an action to put it on Left · Index 2, tap.');
    fire(button(node, 'Galaxy map'), 'onClick');
    expect(onPlace.mock.calls).toEqual([['galaxy']]);
  });

  it('with no press to fill, a click does nothing', () => {
    const { onPlace, node } = list(null);
    fire(button(node, 'Galaxy map'), 'onClick');
    expect(onPlace.mock.calls).toEqual([]);
  });
});
