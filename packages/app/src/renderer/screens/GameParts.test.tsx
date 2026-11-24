// The Game screen's parts: what each draws (react-dom/server), and what each does when used. The
// parts keep no state, so a test calls one with its props and finds the element a person would use
// by its name; its handler is then called as the browser would. The window itself is the e2e suite's
// (packages/app/e2e/game.spec.ts).
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Game } from '@helmarray/core';
import { describe, expect, it, vi } from 'vitest';
import type { Edit } from './GameParts';
import {
  ActionRow,
  ActionTable,
  AddAction,
  BackLink,
  ModeHead,
  ModeTabs,
  Notices,
  PressField,
  TitleBar,
  WaitStrip,
  titleNote,
} from './GameParts';
import type { ActionRowProps, TitleBarProps } from './GameParts';

const PARTS = new Set<unknown>([
  ActionRow,
  ActionTable,
  AddAction,
  BackLink,
  ModeHead,
  ModeTabs,
  Notices,
  PressField,
  TitleBar,
  WaitStrip,
]);

type Props = Record<string, unknown> & { children?: ReactNode };
type El = ReactElement<Props>;

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

/** The element named `name`, by its label or, for a button with none, its text. */
function named(node: ReactNode, name: string): El {
  const found = elements(node).find(
    (e) =>
      e.props['aria-label'] === name ||
      (e.props['aria-label'] === undefined && e.type === 'button' && textOf(e) === name),
  );
  if (!found) throw new Error(`Nothing named ${name}`);
  return found;
}
const names = (node: ReactNode): string[] =>
  elements(node)
    .filter((e) => e.type === 'button' || e.type === 'input' || e.type === 'select')
    .map((e) => (e.props['aria-label'] as string | undefined) ?? textOf(e));

/** The element an event lands on, as far as a handler reads it: its attributes. */
function target() {
  const attributes = new Set<string>();
  return {
    attributes,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string) => void attributes.add(name),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
}

/** Calls a handler the element has, as the browser would. */
function fire(el: El, handler: string, event: Record<string, unknown> = {}) {
  const fn = el.props[handler];
  if (typeof fn !== 'function') throw new Error(`No ${handler}`);
  const preventDefault = vi.fn();
  (fn as (e: unknown) => void)({ preventDefault, currentTarget: target(), ...event });
  return { preventDefault };
}

const game: Game = {
  id: 'rover',
  name: 'Rover',
  modes: [
    { id: 'foot', name: 'On foot' },
    { id: 'drive', name: 'Driving' },
  ],
  actions: [
    {
      id: 'jump',
      name: 'Jump',
      mode: 'foot',
      role: 'movement',
      required: true,
      native: { key: { kind: 'key', code: 'Space' }, pad: 'A' },
    },
    { id: 'fire', name: 'Fire', mode: 'foot', role: 'combat', required: false },
    { id: 'honk', name: 'Honk', mode: 'drive', role: 'travel', required: false },
  ],
};
const jump = game.actions[0] as Game['actions'][number];
const fireAction = game.actions[1] as Game['actions'][number];

/** An `edit` that records its calls and applies each to the game, to read what it did. */
function editSpy() {
  const calls: { field: string | null | undefined; result: Game }[] = [];
  const edit: Edit = (fn, field) => void calls.push({ field, result: fn(game) });
  return { edit, calls };
}
const actionOf = (g: Game | undefined, id: string) => g?.actions.find((a) => a.id === id);

function row(over: Partial<ActionRowProps> = {}) {
  const spy = editSpy();
  const props: ActionRowProps = {
    action: jump,
    first: true,
    last: false,
    waiting: null,
    edit: spy.edit,
    onWait: vi.fn(),
    onPress: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  return { node: <ActionRow {...props} />, props, calls: spy.calls };
}

describe('an action row', () => {
  it('draws the name, role, required, both defaults and More, each named for the action', () => {
    expect(names(row().node)).toEqual([
      'Jump, name',
      'Jump, role',
      'Jump is required',
      'Jump, key: Space',
      "Clear Jump's key",
      'Jump, controller button: A',
      "Clear Jump's controller button",
      'More for Jump',
      // In the More menu, drawn once it is opened.
      'Move up',
      'Move down',
      'Delete Jump',
    ]);
  });

  it('says Set, dashed, for a default it has none of', () => {
    const html = renderToStaticMarkup(row({ action: fireAction }).node);
    expect([
      html.includes('aria-label="Set Fire&#x27;s key"'),
      html.includes('gm-press empty'),
    ]).toEqual([true, true]);
  });

  it('renames the action, typing being one step', () => {
    const { node, calls } = row();
    fire(named(node, 'Jump, name'), 'onChange', { target: { value: 'Leap' } });
    expect([calls[0]?.field, actionOf(calls[0]?.result, 'jump')?.name]).toEqual([
      'name:jump',
      'Leap',
    ]);
  });

  it('sets the role and required', () => {
    const { node, calls } = row();
    fire(named(node, 'Jump, role'), 'onChange', { target: { value: 'ability' } });
    fire(named(node, 'Jump is required'), 'onChange', { target: { checked: false } });
    expect([
      actionOf(calls[0]?.result, 'jump')?.role,
      actionOf(calls[1]?.result, 'jump')?.required,
    ]).toEqual(['ability', false]);
  });

  it('waits for a key, or a controller button, when its field is clicked', () => {
    const { node, props } = row();
    fire(named(node, 'Jump, key: Space'), 'onClick');
    fire(named(node, 'Jump, controller button: A'), 'onClick');
    expect(vi.mocked(props.onWait).mock.calls).toEqual([
      [{ action: 'jump', part: 'key' }],
      [{ action: 'jump', part: 'pad' }],
    ]);
  });

  it('clears a default with Delete on its field, or its ×', () => {
    const { node, calls } = row();
    const { preventDefault } = fire(named(node, 'Jump, key: Space'), 'onKeyDown', {
      key: 'Delete',
    });
    fire(named(node, "Clear Jump's controller button"), 'onClick');
    expect([
      preventDefault.mock.calls.length,
      actionOf(calls[0]?.result, 'jump')?.native,
      actionOf(calls[1]?.result, 'jump')?.native,
    ]).toEqual([1, { pad: 'A' }, { key: { kind: 'key', code: 'Space' } }]);
  });

  it('leaves other keys on a field alone', () => {
    const { node, calls } = row();
    fire(named(node, 'Jump, key: Space'), 'onKeyDown', { key: 'Enter' });
    expect(calls).toEqual([]);
  });

  it('takes a mouse button pressed on the key field while it waits', () => {
    const { node, props } = row({ waiting: 'key' });
    const { preventDefault } = fire(named(node, 'Press a key for Jump'), 'onMouseDown', {
      button: 2,
    });
    expect([vi.mocked(props.onPress).mock.calls, preventDefault.mock.calls.length]).toEqual([
      [[{ kind: 'mouse', button: 'right' }]],
      1,
    ]);
  });

  it('does not start a new wait on the click that ends a left press taken as the key', () => {
    const waitingRow = row({ waiting: 'key' });
    const el = target();
    fire(named(waitingRow.node, 'Press a key for Jump'), 'onMouseDown', {
      button: 0,
      currentTarget: el,
    });
    // Drawn again, not waiting: the same element gets the click.
    const after = row({ action: { ...jump, native: { key: { kind: 'mouse', button: 'left' } } } });
    fire(named(after.node, 'Jump, key: Left mouse button'), 'onClick', { currentTarget: el });
    fire(named(after.node, 'Jump, key: Left mouse button'), 'onClick', { currentTarget: el });
    expect([
      vi.mocked(waitingRow.props.onPress).mock.calls.length,
      vi.mocked(after.props.onWait).mock.calls,
    ]).toEqual([1, [[{ action: 'jump', part: 'key' }]]]);
  });

  it('marks nothing for a right press, which ends in no click', () => {
    const { node } = row({ waiting: 'key' });
    const el = target();
    fire(named(node, 'Press a key for Jump'), 'onMouseDown', { button: 2, currentTarget: el });
    expect([...el.attributes]).toEqual([]);
  });

  it('forgets the mark when the pointer leaves the field without a click', () => {
    const { node } = row({ waiting: 'key' });
    const el = target();
    const field = named(node, 'Press a key for Jump');
    fire(field, 'onMouseDown', { button: 0, currentTarget: el });
    fire(field, 'onMouseLeave', { currentTarget: el });
    expect([...el.attributes]).toEqual([]);
  });

  it('keeps the menu from opening on the waiting field, and ignores a click on it', () => {
    const { node, props } = row({ waiting: 'key' });
    const field = named(node, 'Press a key for Jump');
    const { preventDefault } = fire(field, 'onContextMenu');
    fire(field, 'onClick');
    expect([preventDefault.mock.calls.length, vi.mocked(props.onWait).mock.calls]).toEqual([1, []]);
  });

  it('takes no mouse button on a field not waiting, nor on the controller field', () => {
    const idle = row();
    fire(named(idle.node, 'Jump, key: Space'), 'onMouseDown', { button: 0 });
    const pad = row({ waiting: 'pad' });
    fire(named(pad.node, 'Press a button for Jump'), 'onMouseDown', { button: 0 });
    expect([
      vi.mocked(idle.props.onPress).mock.calls,
      vi.mocked(pad.props.onPress).mock.calls,
    ]).toEqual([[], []]);
  });

  it('ignores a mouse button with no name', () => {
    const { node, props } = row({ waiting: 'key' });
    fire(named(node, 'Press a key for Jump'), 'onMouseDown', { button: 7 });
    expect(vi.mocked(props.onPress).mock.calls).toEqual([]);
  });

  it('shows what to press under the row while it waits, and the list for what can’t be', () => {
    const html = renderToStaticMarkup(row({ waiting: 'key' }).node);
    expect([
      html.includes('Press Jump&#x27;s key or mouse button. Esc cancels.'),
      html.includes('Left Win'),
      html.includes('PrintScreen'),
    ]).toEqual([true, true, true]);
  });

  it('moves up and down, and deletes, from More', () => {
    const { node, calls } = row({ action: fireAction, first: false, last: true });
    fire(named(node, 'Move up'), 'onClick');
    fire(named(node, 'Move down'), 'onClick');
    fire(named(node, 'Delete Fire'), 'onClick');
    expect(calls.map((c) => c.result.actions.map((a) => a.id))).toEqual([
      ['fire', 'jump', 'honk'],
      ['jump', 'fire', 'honk'],
      ['jump', 'honk'],
    ]);
  });

  it('moves with Alt+Up and Alt+Down from anywhere in the row, and not otherwise', () => {
    const { node, calls } = row({ action: fireAction });
    const tr = elements(node).find((e) => e.type === 'tr') as El;
    fire(tr, 'onKeyDown', { altKey: true, key: 'ArrowUp' });
    fire(tr, 'onKeyDown', { altKey: false, key: 'ArrowUp' });
    fire(tr, 'onKeyDown', { altKey: true, key: 'ArrowLeft' });
    fire(tr, 'onKeyDown', { altKey: true, key: 'ArrowDown' });
    expect(calls.map((c) => c.result.actions.map((a) => a.id))).toEqual([
      ['fire', 'jump', 'honk'],
      ['jump', 'fire', 'honk'],
    ]);
  });

  it('does not move while it waits for a press: the arrows may be the key', () => {
    const { node, calls } = row({ waiting: 'key' });
    const tr = elements(node).find((e) => e.type === 'tr') as El;
    fire(tr, 'onKeyDown', { altKey: true, key: 'ArrowDown' });
    expect(calls).toEqual([]);
  });

  it('calls a nameless action "This action"', () => {
    expect(names(row({ action: { ...jump, name: ' ' } }).node)[0]).toBe('This action, name');
  });
});

describe('the wait strip', () => {
  const strip = (part: 'key' | 'pad') => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    return {
      node: <WaitStrip action={jump} part={part} onPick={onPick} onCancel={onCancel} />,
      onPick,
      onCancel,
    };
  };

  it('picks a key from the list', () => {
    const s = strip('key');
    fire(named(s.node, "Keys a press can't set"), 'onChange', { target: { value: 'Esc' } });
    expect(s.onPick.mock.calls).toEqual([[{ kind: 'key', code: 'Esc' }]]);
  });

  it('picks a controller button from the list', () => {
    const s = strip('pad');
    fire(named(s.node, 'Controller buttons'), 'onChange', { target: { value: 'RB' } });
    expect(s.onPick.mock.calls).toEqual([['RB']]);
  });

  it('picks nothing for the empty first line', () => {
    const s = strip('pad');
    fire(named(s.node, 'Controller buttons'), 'onChange', { target: { value: '' } });
    expect(s.onPick.mock.calls).toEqual([]);
  });

  it('cancels', () => {
    const s = strip('key');
    fire(named(s.node, 'Cancel'), 'onClick');
    expect(s.onCancel.mock.calls.length).toBe(1);
  });

  it('lists every Xbox control for a controller, in words', () => {
    const html = renderToStaticMarkup(strip('pad').node);
    expect([
      html.includes('Left stick up'),
      html.includes('D-pad down'),
      html.includes('No controller? Pick'),
    ]).toEqual([true, true, true]);
  });
});

describe('the title bar', () => {
  function bar(over: Partial<TitleBarProps> = {}) {
    const spy = editSpy();
    const props: TitleBarProps = {
      game,
      builtIn: false,
      edited: false,
      saved: true,
      canUndo: true,
      confirming: false,
      busy: false,
      starts: ['xbox', 'keys'],
      edit: spy.edit,
      onBack: vi.fn(),
      onUndo: vi.fn(),
      onConfirm: vi.fn(),
      onDrop: vi.fn(),
      onStart: vi.fn(),
      onNameDone: vi.fn(),
      ...over,
    };
    return { node: <TitleBar {...props} />, props, calls: spy.calls };
  }

  it('offers, for a game added by hand: back, its name, undo, delete and the two defaults', () => {
    expect(names(bar().node)).toEqual([
      'Library',
      'Game name',
      'Undo',
      'Delete game',
      'Xbox controller',
      "Game's own keys",
    ]);
  });

  it('offers Back to helmArray’s for your copy of a built-in game, and nothing to delete', () => {
    expect(names(bar({ builtIn: true, edited: true, starts: [] }).node)).toEqual([
      'Library',
      'Game name',
      'Undo',
      "Back to helmArray's",
    ]);
  });

  it('offers neither for a built-in game not yet edited, nor a new game not yet saved', () => {
    expect([
      names(bar({ builtIn: true, starts: [] }).node),
      names(bar({ saved: false, starts: [] }).node),
    ]).toEqual([
      ['Library', 'Game name', 'Undo'],
      ['Library', 'Game name', 'Undo'],
    ]);
  });

  it('renames the game, typing being one step', () => {
    const { node, calls } = bar();
    fire(named(node, 'Game name'), 'onChange', { target: { value: 'Rover 2' } });
    expect([calls[0]?.field, calls[0]?.result.name]).toEqual(['game-name', 'Rover 2']);
  });

  it('says the name is typed when the field is left or Enter is pressed, and not for other keys', () => {
    const { node, props } = bar();
    fire(named(node, 'Game name'), 'onBlur');
    fire(named(node, 'Game name'), 'onKeyDown', { key: 'Enter' });
    fire(named(node, 'Game name'), 'onKeyDown', { key: 'a' });
    expect(vi.mocked(props.onNameDone).mock.calls.length).toBe(2);
  });

  it('goes back, undoes, and starts a scheme from either default', () => {
    const { node, props } = bar();
    fire(named(node, 'Library'), 'onClick');
    fire(named(node, 'Undo'), 'onClick');
    fire(named(node, 'Xbox controller'), 'onClick');
    fire(named(node, "Game's own keys"), 'onClick');
    expect([
      vi.mocked(props.onBack).mock.calls.length,
      vi.mocked(props.onUndo).mock.calls.length,
      vi.mocked(props.onStart).mock.calls,
    ]).toEqual([1, 1, [['xbox'], ['keys']]]);
  });

  it('asks before deleting, and deletes or keeps it', () => {
    const first = bar();
    fire(named(first.node, 'Delete game'), 'onClick');
    const asking = bar({ confirming: true });
    fire(named(asking.node, 'Delete'), 'onClick');
    fire(named(asking.node, 'Keep it'), 'onClick');
    expect([
      vi.mocked(first.props.onConfirm).mock.calls,
      vi.mocked(asking.props.onDrop).mock.calls.length,
      vi.mocked(asking.props.onConfirm).mock.calls,
      renderToStaticMarkup(asking.node).includes('Delete Rover and its schemes?'),
    ]).toEqual([[[true]], 1, [[false]], true]);
  });

  it('asks before going back to helmArray’s', () => {
    const first = bar({ builtIn: true, edited: true });
    fire(named(first.node, "Back to helmArray's"), 'onClick');
    const asking = bar({ builtIn: true, edited: true, confirming: true });
    expect([
      vi.mocked(first.props.onConfirm).mock.calls,
      renderToStaticMarkup(asking.node).includes('Drop your edits?'),
      names(asking.node).filter((n) => n === "Back to helmArray's").length,
    ]).toEqual([[[true]], true, 1]);
  });

  it('heads the page with the game’s name, or "New game" before it has one', () => {
    expect([
      renderToStaticMarkup(bar().node).includes('<h1 class="sr-only">Rover</h1>'),
      renderToStaticMarkup(bar({ game: { ...game, name: '' } }).node).includes(
        '<h1 class="sr-only">New game</h1>',
      ),
    ]).toEqual([true, true]);
  });

  it('says whose game it is', () => {
    expect([
      titleNote(true, true, true),
      titleNote(true, false, true),
      titleNote(false, false, true),
      titleNote(false, false, false),
    ]).toEqual([
      "Your copy of helmArray's game",
      "helmArray's game. Your edits are kept as your copy.",
      'Added by you',
      'New game',
    ]);
  });
});

describe('the modes', () => {
  it('draws a tab per mode with its count of actions, the one shown selected', () => {
    const html = renderToStaticMarkup(
      <ModeTabs game={game} mode="drive" onMode={vi.fn()} onAddMode={vi.fn()} />,
    );
    expect([
      html.includes('aria-selected="true" class="gm-tab">Driving<span class="gm-count">1</span>'),
      html.includes('aria-selected="false" class="gm-tab">On foot<span class="gm-count">2</span>'),
    ]).toEqual([true, true]);
  });

  it('picks a mode and adds one', () => {
    const onMode = vi.fn();
    const onAddMode = vi.fn();
    const node = <ModeTabs game={game} mode="foot" onMode={onMode} onAddMode={onAddMode} />;
    // A tab's text is its name and its count of actions.
    const driving = elements(node).find(
      (e) => e.props['role'] === 'tab' && textOf(e) === 'Driving1',
    );
    fire(driving as El, 'onClick');
    fire(named(node, 'Add mode'), 'onClick');
    expect([onMode.mock.calls, onAddMode.mock.calls.length]).toEqual([[['drive']], 1]);
  });

  it('calls a mode with no name "Unnamed" on its tab', () => {
    const unnamed = { ...game, modes: [{ id: 'foot', name: '' }] };
    expect(
      renderToStaticMarkup(
        <ModeTabs game={unnamed} mode="foot" onMode={vi.fn()} onAddMode={vi.fn()} />,
      ),
    ).toContain('Unnamed');
  });

  it('renames, moves and deletes the mode shown', () => {
    const spy = editSpy();
    const onDeleteMode = vi.fn();
    const node = <ModeHead game={game} mode="drive" edit={spy.edit} onDeleteMode={onDeleteMode} />;
    fire(named(node, 'Mode name'), 'onChange', { target: { value: 'In the rover' } });
    fire(named(node, 'Move left'), 'onClick');
    fire(named(node, 'Move right'), 'onClick');
    fire(named(node, 'Delete mode'), 'onClick');
    expect([
      spy.calls[0]?.field,
      spy.calls[0]?.result.modes[1]?.name,
      spy.calls[1]?.result.modes.map((m) => m.id),
      spy.calls[2]?.result.modes.map((m) => m.id),
      onDeleteMode.mock.calls,
    ]).toEqual([
      'mode-name:drive',
      'In the rover',
      ['drive', 'foot'],
      ['foot', 'drive'],
      [['drive']],
    ]);
  });

  it('offers no moving or deleting for a game with one mode', () => {
    const one = { ...game, modes: [{ id: 'foot', name: 'On foot' }] };
    expect(
      names(<ModeHead game={one} mode="foot" edit={vi.fn()} onDeleteMode={vi.fn()} />),
    ).toEqual(['Mode name']);
  });
});

describe('the action table', () => {
  const table = (
    rows: Game['actions'],
    waiting: { action: string; part: 'key' | 'pad' } | null = null,
  ) => (
    <ActionTable
      rows={rows}
      waiting={waiting}
      edit={vi.fn()}
      onWait={vi.fn()}
      onPress={vi.fn()}
      onCancel={vi.fn()}
    />
  );

  it('says there are no actions yet, and what to do', () => {
    expect(renderToStaticMarkup(table([]))).toContain(
      'No actions yet. Type one below and press Enter, then press its key.',
    );
  });

  it('draws a row per action, under the column names', () => {
    const html = renderToStaticMarkup(table([jump, fireAction]));
    expect([html.split('class="gm-row"').length - 1, html.includes('>Controller</th>')]).toEqual([
      2,
      true,
    ]);
  });

  it('shows the wait on the row it is for, only', () => {
    const html = renderToStaticMarkup(table([jump, fireAction], { action: 'fire', part: 'pad' }));
    expect([
      html.includes('Press Fire&#x27;s button on the controller.'),
      html.includes('Press Jump'),
    ]).toEqual([true, false]);
  });
});

describe('the new-action field', () => {
  it('reports what is typed, and adds on Enter', () => {
    const onType = vi.fn();
    const onAdd = vi.fn();
    const node = <AddAction draft="Reload" onType={onType} onAdd={onAdd} />;
    fire(named(node, 'New action'), 'onChange', { target: { value: 'Reloa' } });
    const form = elements(node).find((e) => e.type === 'form') as El;
    const { preventDefault } = fire(form, 'onSubmit');
    expect([onType.mock.calls, onAdd.mock.calls.length, preventDefault.mock.calls.length]).toEqual([
      [['Reloa']],
      1,
      1,
    ]);
  });

  it('has Add turned off while there is nothing to add', () => {
    expect(
      renderToStaticMarkup(<AddAction draft=" " onType={vi.fn()} onAdd={vi.fn()} />),
    ).toContain('disabled=""');
  });
});

describe('the notices', () => {
  it('draws each sentence there is, as an alert', () => {
    const html = renderToStaticMarkup(<Notices lines={['One.', null, 'Two.']} />);
    expect(html.split('role="alert"').length - 1).toBe(2);
  });
});
