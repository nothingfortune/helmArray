import { describe, expect, it } from 'vitest';
import type { Game, Scheme } from '@helmarray/core';
import { assign, acceptFinding, clear, setLatch } from './editor-model';
import { assignable, deviceTabs, editorView, shownTab, signalText } from './editor-view';
import { game, keysScheme, padGame, padScheme, plan } from './editor-fixture';

const view = (
  scheme: Scheme,
  mode = 'ship',
  selected?: string,
  press?: 'tap' | 'long' | 'double',
) => editorView({ scheme, game, plan: plan(scheme), mode, selected, press });

describe('signalText', () => {
  it('words the signals a caption can show', () => {
    expect(signalText({ kind: 'key', code: 'NumAdd' })).toBe('Num +');
    expect(signalText({ kind: 'key', code: 'Num7' })).toBe('Num 7');
    expect(signalText({ kind: 'key', code: 'F13', mods: ['shift', 'ctrl'] })).toBe(
      'Shift+Ctrl+F13',
    );
    expect(signalText({ kind: 'key', code: 'LShift' })).toBe('Left Shift');
    expect(signalText({ kind: 'mouse', button: 'left' })).toBe('Left mouse button');
    expect(signalText({ kind: 'mouse', button: 'back' })).toBe('Mouse back');
    expect(signalText({ kind: 'scroll', dir: 'up', speed: 1 })).toBe('Scroll up');
    expect(signalText({ kind: 'pad', control: 'RB' })).toBe('Xbox RB');
    expect(signalText({ kind: 'pad', control: 'LS_UP' })).toBe('Xbox Left stick up');
    expect(signalText({ kind: 'macro', trigger: 'F14' })).toBe('Macro on F14');
  });
});

describe('modes', () => {
  it('shows tabs only when the game has more than one mode', () => {
    const v = view(keysScheme());
    expect(v.showModeTabs).toBe(true);
    expect(v.modes).toEqual([
      { id: 'ship', name: 'Ship', active: true },
      { id: 'srv', name: 'SRV', active: false },
    ]);
    const single = { ...game, modes: [{ id: 'ship', name: 'Ship' }] };
    const scheme = keysScheme();
    const one = editorView({ scheme, game: single, plan: plan(scheme, game), mode: 'ship' });
    expect(one.showModeTabs).toBe(false);
  });
});

describe('unit keys', () => {
  it('labels each key with its action in the current mode, with its role, per hand', () => {
    const ship = view(keysScheme());
    expect(ship.left.keys).toEqual({
      'L.index_1': { label: 'Boost', role: 'movement', action: 'boost', press: 'tap' },
      'L.middle_1': { label: 'Frame shift drive', role: 'travel', action: 'fsd', press: 'tap' },
    });
    expect(ship.right.keys).toEqual({
      'R.index_1': { label: 'Fire', role: 'combat', action: 'fire', press: 'tap' },
    });
    const srv = view(keysScheme(), 'srv');
    expect(srv.left.keys).toEqual({
      'L.index_1': { label: 'Jump', role: 'movement', action: 'jump', press: 'tap' },
    });
    expect(srv.right.keys).toEqual({});
  });

  it('says so when a button has only a long press, so its tap is not mistaken for it', () => {
    const scheme = assign(
      keysScheme(),
      { mode: 'ship', control: 'L.index_2', press: 'long' },
      'gear',
      game,
    );
    expect(view(scheme).left.keys['L.index_2']).toEqual({
      label: 'Long: Landing gear',
      role: 'travel',
      action: 'gear',
      press: 'long',
    });
  });

  it('draws an action the game no longer has as its id, with no role', () => {
    const scheme = { ...keysScheme(), map: { ship: { 'L.index_1': { tap: 'gone' } } } };
    expect(view(scheme).left.keys['L.index_1']).toEqual({
      label: 'gone',
      action: 'gone',
      press: 'tap',
    });
  });

  it('draws an action with no role yet neutral: no role, so no role colour', () => {
    const unrolled: Game = {
      ...game,
      actions: game.actions.map((a) => {
        if (a.id !== 'boost') return a;
        const copy = { ...a };
        delete copy.role;
        return copy;
      }),
    };
    const scheme = keysScheme();
    const v = editorView({ scheme, game: unrolled, plan: plan(scheme, unrolled), mode: 'ship' });
    expect(v.left.keys['L.index_1']).toEqual({ label: 'Boost', action: 'boost', press: 'tap' });
  });

  it('labels a key-mode stick by the actions its keys reach, else by the key', () => {
    const scheme: Scheme = {
      ...keysScheme(),
      behaviour: {
        ...keysScheme().behaviour,
        'L.stick': {
          stick: {
            mode: 'keys',
            directions: {
              up: { kind: 'key', code: 'J' },
              down: { kind: 'key', code: 'Insert' },
            },
          },
        },
      },
    };
    const stick = view(scheme).left.stick;
    expect(stick).toEqual({ up: 'Frame shift drive', down: 'Insert', role: 'travel' });
    expect(view(scheme).right.stick).toBeUndefined();
    expect(view(padScheme()).left.stick).toBeUndefined();
  });
});

describe('unplaced actions', () => {
  it("lists the mode's actions that are on no press, in the game's order", () => {
    expect(view(keysScheme()).lists[0]?.actions.map((a) => a.id)).toEqual([
      'galaxy',
      'hardpoints',
      'gear',
      'silent',
    ]);
    expect(view(keysScheme(), 'srv').lists[0]?.actions.map((a) => a.id)).toEqual([
      'lights',
      'srv_fire',
    ]);
  });

  it('counts an action on a long press as placed', () => {
    const scheme = assign(
      keysScheme(),
      { mode: 'ship', control: 'L.index_2', press: 'long' },
      'gear',
      game,
    );
    expect(view(scheme).lists[0]?.actions.map((a) => a.id)).not.toContain('gear');
  });

  it('gives each with its name and role', () => {
    expect(view(keysScheme()).lists[0]?.actions[0]).toEqual({
      id: 'galaxy',
      name: 'Galaxy map',
      role: 'menu',
    });
  });

  it('only accepts an action of the game, in the mode it is dropped in', () => {
    expect(assignable(game, 'ship', 'gear')).toBe(true);
    expect(assignable(game, 'srv', 'gear')).toBe(false);
    expect(assignable(game, 'ship', 'nope')).toBe(false);
  });
});

describe('the side panel', () => {
  it('is absent with nothing selected', () => {
    expect(view(keysScheme()).panel).toBeNull();
  });

  it('shows the selected button in every mode', () => {
    const panel = view(keysScheme(), 'ship', 'L.index_1').panel;
    expect(panel?.where).toBe('Left · Index 1');
    expect(panel?.title).toBe('Boost');
    expect(panel?.across).toEqual([
      { mode: 'ship', name: 'Ship', label: 'Boost', active: true },
      { mode: 'srv', name: 'SRV', label: 'Jump', active: false },
    ]);
    const empty = view(keysScheme(), 'ship', 'R.dpad_up').panel;
    expect(empty?.title).toBe('Empty');
    expect(empty?.across.map((r) => r.label)).toEqual([null, null]);
  });

  it('lists tap, long and double, with the target press marked', () => {
    const scheme = assign(
      keysScheme(),
      { mode: 'ship', control: 'L.index_1', press: 'long' },
      'galaxy',
      game,
    );
    const rows = view(scheme, 'ship', 'L.index_1', 'long').panel?.presses;
    expect(rows?.map((r) => [r.press, r.action?.name, r.target, r.available])).toEqual([
      ['tap', 'Boost', false, true],
      ['long', 'Galaxy map', true, true],
      ['double', undefined, false, true],
    ]);
  });

  it('targets the tap unless told otherwise', () => {
    const rows = view(keysScheme(), 'ship', 'L.index_1').panel?.presses;
    expect(rows?.find((r) => r.target)?.press).toBe('tap');
  });

  it('is absent for a control of a device the setup no longer has', () => {
    // A key selected, then the keyboard taken away (by an undo, say).
    expect(view(keysScheme(), 'ship', 'key.J').panel).toBeNull();
  });

  it('targets the tap when the press asked for is one the button can’t send', () => {
    // A long press targeted with keys, then the Azerons switched to a controller.
    const rows = view(padScheme(), 'ship', 'L.index_1', 'long').panel?.presses;
    expect(rows?.find((r) => r.target)?.press).toBe('tap');
  });

  it('has no long press or double tap to give a controller button', () => {
    const rows = view(padScheme(), 'ship', 'L.index_1').panel?.presses;
    expect(rows?.map((r) => r.available)).toEqual([true, false, false]);
  });

  it('shows turbo and latch', () => {
    const scheme = setLatch(keysScheme(), 'L.index_1', true);
    const panel = view(scheme, 'ship', 'L.index_1').panel;
    expect(panel?.latch).toBe(true);
    expect(panel?.turbo).toBe(false);
  });

  it('captions what it sends from the resolved plan, and where that came from', () => {
    const own = view(keysScheme(), 'ship', 'L.index_1').panel;
    expect(own?.sends).toBe('Left Shift');
    expect(own?.sendsNote).toBe('as the game ships it');
    const mouse = view(keysScheme(), 'ship', 'R.index_1').panel;
    expect(mouse?.sends).toBe('Left mouse button');
    const pad = view(padScheme(), 'ship', 'L.index_1').panel;
    expect(pad?.sends).toBe('Xbox RB');
    // This game ships Boost on no Xbox control: the game's controller binding is set to RB.
    expect(pad?.sendsNote).toBe("set it in the game's controls");
  });

  it("captions the key chosen for the game's file when it is written", () => {
    const scheme: Scheme = { ...keysScheme(), writeGameFile: true };
    const g = { ...game, file: { format: 'elite-binds' as const } };
    const panel = editorView({
      scheme,
      game: g,
      plan: plan(scheme, g),
      mode: 'ship',
      selected: 'L.index_1',
    }).panel;
    // Dealt in device order: the middle finger's button took Insert, so this one gets Home.
    expect(panel?.sends).toBe('Home');
    expect(panel?.sendsNote).toBe('chosen for you');
  });

  it('sends nothing, in words, for an empty button with no signal', () => {
    expect(view(keysScheme(), 'ship', 'R.dpad_up').panel?.sends).toBeNull();
  });

  it('describes the stick instead of presses', () => {
    const panel = view(padScheme(), 'ship', 'L.stick').panel;
    expect(panel).toMatchObject({
      title: 'Stick',
      stick: true,
      presses: [],
      across: [],
      sends: 'Xbox left stick',
    });
  });
});

describe('the setup’s devices', () => {
  const devices = (over: Partial<Scheme['devices']>): Scheme['devices'] => ({
    ...keysScheme().devices,
    ...over,
  });
  const withDevices = (over: Partial<Scheme['devices']>, base: Scheme = keysScheme()): Scheme => ({
    ...base,
    devices: devices(over),
  });

  it('are the tabs: Azerons, the keyboard with the mouse, the controller, as the setup has them', () => {
    expect([
      deviceTabs(devices({})).map((t) => t.label),
      deviceTabs(devices({ keyboard: true, mouse: true, controller: true })).map((t) => t.label),
      deviceTabs(devices({ azerons: 'none', controller: true })).map((t) => t.label),
      deviceTabs(devices({ azerons: 'none' })),
    ]).toEqual([['Azerons'], ['Azerons', 'Keyboard', 'Controller'], ['Controller'], []]);
  });

  it('draw the mouse beside the left unit in a left Azeron + mouse setup, with no tab of its own', () => {
    const v = view(withDevices({ azerons: 'left', mouse: true }));
    expect([v.tabs.map((t) => t.id), v.hands, v.mouseBeside, v.mouse]).toEqual([
      ['azerons'],
      ['left'],
      true,
      true,
    ]);
  });

  it('give a mouse with nothing else to draw it a tab of its own', () => {
    expect(deviceTabs(devices({ azerons: 'none', mouse: true }))).toEqual([
      { id: 'keyboard', label: 'Mouse' },
    ]);
  });

  it('show the tab asked for while the setup has it, else its first', () => {
    const tabs = deviceTabs(devices({ keyboard: true, mouse: true }));
    expect([
      shownTab(tabs, 'keyboard'),
      shownTab(tabs, 'controller'),
      shownTab(tabs, undefined),
      shownTab([], 'keyboard'),
    ]).toEqual(['keyboard', 'azerons', 'azerons', null]);
  });

  it('call a tab’s controls by what they are: buttons, keys or mouse buttons', () => {
    const scheme = withDevices({ keyboard: true, mouse: true, controller: true });
    const word = (tab: 'azerons' | 'keyboard' | 'controller') =>
      editorView({ scheme, game, plan: plan(scheme), mode: 'ship', tab }).controlWord;
    expect([
      word('azerons'),
      word('keyboard'),
      word('controller'),
      editorView({
        scheme: withDevices({ azerons: 'none', mouse: true }),
        game,
        plan: plan(withDevices({ azerons: 'none', mouse: true })),
        mode: 'ship',
      }).controlWord,
    ]).toEqual(['button', 'key or mouse button', 'button', 'mouse button']);
  });

  it('offer “Azerons send” only to a setup with Azerons', () => {
    expect([
      view(keysScheme()).output,
      view(padScheme()).output,
      view(withDevices({ azerons: 'none', keyboard: true, mouse: true })).output,
    ]).toEqual(['keys', 'pad', null]);
  });
});

describe('the keyboard, the mouse and the controller', () => {
  const kbm: Scheme = {
    ...keysScheme(),
    devices: { azerons: 'none', keyboard: true, mouse: true, controller: false },
    map: { ship: { 'key.J': { tap: 'fsd' }, 'mouse.left': { tap: 'fire' } }, srv: {} },
  };
  const tabView = (scheme: Scheme, tab: 'azerons' | 'keyboard' | 'controller', selected?: string) =>
    editorView({ scheme, game: padGame, plan: plan(scheme, padGame), mode: 'ship', selected, tab });

  it('label their keys and buttons with their actions, like the units', () => {
    expect(tabView(kbm, 'keyboard').fixed).toEqual({
      'key.J': { label: 'Frame shift drive', role: 'travel', action: 'fsd', press: 'tap' },
      'mouse.left': { label: 'Fire', role: 'combat', action: 'fire', press: 'tap' },
    });
  });

  it('label a controller button with what the Azeron button sending its control does', () => {
    const scheme: Scheme = {
      ...padScheme(),
      devices: { ...padScheme().devices, controller: true },
    };
    expect(tabView(scheme, 'controller').fixed['pad.RT']).toEqual({
      label: 'Fire',
      role: 'combat',
      action: 'fire',
      press: 'tap',
    });
  });

  it('list for the selected control’s own set: the mouse beside the left unit is the keyboard’s', () => {
    // Codex's case: the left Azeron sends Xbox controls, the mouse beside it keys, no keyboard.
    const scheme: Scheme = {
      ...padScheme(),
      devices: { azerons: 'left', keyboard: false, mouse: true, controller: false },
      map: { ship: { 'L.index_1': { tap: 'fire' } }, srv: {} },
    };
    const none = tabView(scheme, 'azerons');
    const mouse = tabView(scheme, 'azerons', 'mouse.left');
    const unit = tabView(scheme, 'azerons', 'L.index_2');
    expect([
      none.lists.map((l) => [l.set, l.word, l.actions.some((a) => a.id === 'fire')]),
      mouse.lists.map((l) => [l.set, l.word, l.actions.some((a) => a.id === 'fire')]),
      unit.lists.map((l) => [l.set, l.word, l.actions.some((a) => a.id === 'fire')]),
      [mouse.controlWord, unit.controlWord],
    ]).toEqual([
      [
        ['controller', 'button', false],
        ['keyboard', 'mouse button', true],
      ],
      [['keyboard', 'mouse button', true]],
      [['controller', 'button', false]],
      ['mouse button', 'button'],
    ]);
  });

  it('offer, with a control selected, the actions of its set on other controls, to move here', () => {
    const scheme: Scheme = {
      ...keysScheme(),
      map: { ship: { 'L.index_1': { tap: 'boost' }, 'R.index_1': { tap: 'fire' } }, srv: {} },
    };
    const v = tabView(scheme, 'azerons', 'L.index_1');
    expect([v.moves, tabView(scheme, 'azerons').moves]).toEqual([
      [{ id: 'fire', name: 'Fire', role: 'combat', where: 'Right · Index 1' }],
      [],
    ]);
  });

  it('call a mouse tab’s controls mouse buttons, with nothing selected', () => {
    const scheme: Scheme = {
      ...keysScheme(),
      devices: { azerons: 'none', keyboard: false, mouse: true, controller: false },
      map: { ship: {}, srv: {} },
    };
    expect(tabView(scheme, 'keyboard').controlWord).toBe('mouse button');
  });

  it('call the keyboard and the mouse on one tab keys or mouse buttons', () => {
    const scheme: Scheme = {
      ...keysScheme(),
      devices: { azerons: 'none', keyboard: true, mouse: true, controller: false },
      map: { ship: {}, srv: {} },
    };
    expect(tabView(scheme, 'keyboard').lists.map((l) => l.word)).toEqual(['key or mouse button']);
  });

  it('keep the tab’s lists while the stick is selected: it has no set', () => {
    const v = tabView(padScheme(), 'azerons', 'L.stick');
    expect([v.lists.map((l) => l.set), v.moves]).toEqual([['controller'], []]);
  });

  it('list as not placed the actions on no control of the set the tab is bound through', () => {
    const both: Scheme = {
      ...padScheme(),
      devices: { azerons: 'both', keyboard: true, mouse: true, controller: false },
      map: { ship: { 'L.index_1': { tap: 'boost' }, 'key.J': { tap: 'fsd' } }, srv: {} },
    };
    const azerons = tabView(both, 'azerons').lists[0]?.actions.map((a) => a.id) ?? [];
    const keyboard = tabView(both, 'keyboard').lists[0]?.actions.map((a) => a.id) ?? [];
    expect([
      azerons.includes('fsd'),
      azerons.includes('boost'),
      keyboard.includes('fsd'),
      keyboard.includes('boost'),
    ]).toEqual([true, false, false, true]);
  });

  it('show a key in the side panel: what it is, a tap only, and the key itself as what it sends', () => {
    const panel = tabView(kbm, 'keyboard', 'key.J').panel;
    expect([
      panel?.where,
      panel?.title,
      panel?.presses.map((r) => r.available),
      panel?.behaviour,
      panel?.unavailable,
      panel?.padChoice,
      panel?.sends,
      panel?.sendsNote,
    ]).toEqual([
      'Keyboard · J',
      'Frame shift drive',
      [true, false, false],
      false,
      'Not on a key',
      null,
      'J',
      'as the game ships it',
    ]);
  });

  it('say an action moved to another key is set in the game’s controls', () => {
    const moved: Scheme = { ...kbm, map: { ship: { 'key.T': { tap: 'fsd' } }, srv: {} } };
    expect(tabView(moved, 'keyboard', 'key.T').panel?.sendsNote).toBe(
      "set it in the game's controls",
    );
  });

  it('show a mouse button and a controller button by their own names', () => {
    const scheme: Scheme = { ...kbm, devices: { ...kbm.devices, controller: true } };
    expect([
      tabView(scheme, 'keyboard', 'mouse.left').panel?.where,
      tabView(scheme, 'keyboard', 'mouse.left').panel?.sends,
      tabView(scheme, 'controller', 'pad.LT').panel?.where,
      tabView(scheme, 'controller', 'pad.LT').panel?.sends,
      tabView(scheme, 'controller', 'pad.LT').panel?.unavailable,
    ]).toEqual([
      'Mouse · Left button',
      'Left mouse button',
      'Controller · LT',
      'Xbox LT',
      'Not on a controller',
    ]);
  });

  it('show a controller stick as a stick: no presses, its own directions', () => {
    const scheme: Scheme = { ...kbm, devices: { ...kbm.devices, controller: true } };
    expect(tabView(scheme, 'controller', 'pad.left_stick').panel).toMatchObject({
      where: 'Controller · L stick',
      stick: true,
      presses: [],
      sends: 'Xbox left stick',
    });
  });

  it('mark a conflict on any device, in the current mode', () => {
    const base = plan(kbm, padGame);
    const finding = (control: string, mode: string) => ({
      rule: 'key-collision',
      severity: 'error' as const,
      message: 'Two actions on one key.',
      control,
      mode,
    });
    const v = editorView({
      scheme: kbm,
      game: padGame,
      plan: { ...base, findings: [finding('key.J', 'ship'), finding('mouse.left', 'srv')] },
      mode: 'ship',
    });
    expect([...v.conflicts]).toEqual(['key.J']);
  });
});

describe('the Xbox control an Azeron button sends, in the side panel', () => {
  const padView = (scheme: Scheme, selected: string) =>
    editorView({ scheme, game: padGame, plan: plan(scheme, padGame), mode: 'ship', selected });

  it('names the control it sends, and every one it may send instead, with what is on it', () => {
    const choice = padView(padScheme(), 'L.index_1').panel?.padChoice;
    expect([
      choice?.current,
      choice?.locked,
      choice?.options.find((o) => o.pad === 'A')?.label,
      choice?.options.find((o) => o.pad === 'X')?.label,
      choice?.options.some((o) => o.pad === 'LS_UP' || o.pad === 'RS_LEFT'),
    ]).toEqual(['RB', false, 'A · Frame shift drive', 'X', false]);
  });

  it('is there for an empty button too, sending nothing yet', () => {
    expect(padView(padScheme(), 'L.index_4').panel?.padChoice?.current).toBeNull();
  });

  it('is not there with key output, nor for the stick', () => {
    expect([
      view(keysScheme(), 'ship', 'L.index_1').panel?.padChoice,
      padView(padScheme(), 'L.stick').panel?.padChoice,
    ]).toEqual([null, null]);
  });

  it('is locked on a button sending a stick’s direction for the stick’s action', () => {
    const scheme: Scheme = {
      ...padScheme(),
      padMap: { ...padScheme().padMap, 'L.index_4': 'LS_UP' },
      map: { ship: { 'L.index_4': { tap: 'boost' } }, srv: {} },
    };
    expect(padView(scheme, 'L.index_4').panel?.padChoice).toMatchObject({
      current: 'LS_UP',
      locked: true,
    });
  });
});

describe('checks', () => {
  it('has none for a tidy scheme', () => {
    const v = view(keysScheme());
    expect(v.findings).toEqual([]);
    expect(v.kept).toEqual([]);
  });

  it('lists errors before warnings', () => {
    let scheme = setLatch(keysScheme(), 'L.index_1', true); // warning
    scheme = { ...scheme, map: { ...scheme.map, ship: { 'L.index_1': { tap: 'boost' } } } }; // fsd missing: error
    expect(view(scheme).findings.map((r) => r.finding.severity)).toEqual(['error', 'warning']);
  });

  it('offers a fix where there is an obvious one, and not where there is not', () => {
    let scheme = setLatch(keysScheme(), 'L.index_1', true);
    scheme = { ...scheme, map: { ...scheme.map, ship: { 'L.index_1': { tap: 'boost' } } } };
    const rows = view(scheme).findings;
    expect(rows.find((r) => r.finding.rule === 'hold-on-movement')?.fix?.label).toBe(
      'Turn off hold to latch',
    );
    expect(rows.find((r) => r.finding.rule === 'missing-required')?.fix).toBeUndefined();
  });

  it('moves a finding the player kept into the kept list, with their reason', () => {
    const latched = setLatch(keysScheme(), 'L.index_1', true);
    const found = plan(latched).findings[0];
    if (!found) throw new Error('expected a finding');
    const kept = acceptFinding(latched, found);
    const v = view(kept);
    expect(v.findings).toEqual([]);
    expect(v.kept).toHaveLength(1);
    expect(v.kept[0]?.kept).toBe('Kept on purpose');
    expect(v.kept[0]?.fix).toBeUndefined();
  });

  it('lets the player keep a check but not a resolver finding', () => {
    const latched = setLatch(keysScheme(), 'L.index_1', true);
    expect(view(latched).findings[0]?.canKeep).toBe(true);
    const spent = editorView({
      scheme: latched,
      game,
      plan: {
        ...plan(latched),
        findings: [{ rule: 'pool-spent', severity: 'error', message: 'x' }],
      },
      mode: 'ship',
    });
    expect(spent.findings[0]?.canKeep).toBe(false);
  });

  it('marks the controls in conflict, in the current mode only, for the hand they are on', () => {
    // The left button sends W (a key it was given) while the left stick's up sends W for nothing.
    const scheme: Scheme = {
      ...keysScheme(),
      ledger: { 'L.index_1': { tap: { kind: 'key', code: 'W' } } },
      behaviour: {
        ...keysScheme().behaviour,
        ...keysScheme().behaviour,
        'L.stick': { stick: { mode: 'keys', directions: { up: { kind: 'key', code: 'W' } } } },
      },
    };
    const ship = view(scheme);
    expect(ship.findings.some((r) => r.finding.rule === 'key-collision')).toBe(true);
    expect([...ship.left.conflicts]).toEqual(['L.stick']);
    expect([...ship.right.conflicts]).toEqual([]);
  });

  it('leaves a kept conflict unmarked', () => {
    const scheme: Scheme = {
      ...keysScheme(),
      ledger: { 'L.index_1': { tap: { kind: 'key', code: 'W' } } },
      behaviour: {
        ...keysScheme().behaviour,
        ...keysScheme().behaviour,
        'L.stick': { stick: { mode: 'keys', directions: { up: { kind: 'key', code: 'W' } } } },
      },
    };
    const collision = plan(scheme).findings.find((f) => f.rule === 'key-collision');
    if (!collision) throw new Error('expected a collision');
    expect(view(acceptFinding(scheme, collision)).left.conflicts.size).toBe(0);
  });

  it('gives each finding a key that does not change with an unrelated edit', () => {
    const base = setLatch(keysScheme(), 'L.index_1', true);
    const edited = assign(
      base,
      { mode: 'ship', control: 'R.index_2', press: 'tap' },
      'hardpoints',
      game,
    );
    expect(view(edited).findings.map((r) => r.key)).toEqual(view(base).findings.map((r) => r.key));
  });

  it('gives every finding its own key, even when core reports one rule twice', () => {
    // Long and double on one pad button: sends-nothing once for each. The editor no longer puts
    // them there; a scheme saved before can still have them.
    const scheme: Scheme = {
      ...padScheme(),
      map: {
        ship: {
          ...padScheme().map['ship'],
          'L.index_1': { tap: 'boost', long: 'galaxy', double: 'gear' },
        },
      },
    };
    const rows = [...view(scheme).findings, ...view(scheme).kept];
    expect(rows.filter((r) => r.finding.rule === 'sends-nothing')).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe('controller output: the game is rebound, and the panel says so', () => {
  const padView = (scheme: Scheme, mode = 'ship', selected?: string) =>
    editorView({ scheme, game: padGame, plan: plan(scheme, padGame), mode, selected });
  const tap = (control: string, mode = 'ship') => ({ mode, control, press: 'tap' as const });

  it('has no findings when each button sends what the game puts its action on', () => {
    expect(padView(padScheme()).findings).toEqual([]);
  });

  it('flags nothing for an action the game ships on no Xbox control: the button gets it', () => {
    const scheme = assign(padScheme(), tap('R.index_1'), 'gear', padGame);
    const v = padView(scheme, 'ship', 'R.index_1');
    expect([v.findings, v.panel?.title, v.panel?.sends, v.panel?.sendsNote]).toEqual([
      [],
      'Landing gear',
      'Xbox RT',
      "set it in the game's controls",
    ]);
  });

  it('captions a button whose action the game already has on its control: as the game ships it', () => {
    const panel = padView(padScheme(), 'ship', 'R.index_1').panel;
    expect([panel?.sends, panel?.sendsNote]).toEqual(['Xbox RT', 'as the game ships it']);
  });

  it('shows a cleared button as empty and sending nothing', () => {
    const cleared = clear(padScheme(), tap('R.index_1'));
    const panel = padView(cleared, 'ship', 'R.index_1').panel;
    expect([panel?.title, panel?.sends]).toEqual(['Empty', null]);
  });

  it("shows on an Azeron button what the controller's own button sending the same control does", () => {
    const scheme: Scheme = {
      ...padScheme(),
      devices: { ...padScheme().devices, controller: true },
      map: { ...padScheme().map, ship: { 'pad.RT': { tap: 'fire' } } },
    };
    const v = padView(scheme, 'ship', 'R.index_1');
    expect([v.right.keys['R.index_1']?.label, v.panel?.title]).toEqual(['Fire', 'Fire']);
  });
});

describe('words for a signal that names an Object property', () => {
  it('writes a key code of constructor as itself', () => {
    expect(signalText({ kind: 'key', code: 'constructor' as never })).toBe('constructor');
  });

  it('writes a pad control of toString as itself', () => {
    expect(signalText({ kind: 'pad', control: 'toString' as never })).toBe('Xbox toString');
  });
});

describe('key labels', () => {
  const labelled: Scheme = {
    ...keysScheme(),
    devices: { azerons: 'both', keyboard: true, mouse: true, controller: false },
    map: {
      ship: {
        'L.middle_1': { tap: 'fsd' },
        'key.J': { tap: 'galaxy' },
        'mouse.left': { tap: 'fire' },
      },
      srv: { 'L.middle_1': { tap: 'jump' } },
    },
    keyLabels: { ship: { 'L.middle_1': 'FSD', 'key.J': 'Map' } },
  };

  it('go with the keys they are set on, in their mode only', () => {
    const ship = view(labelled);
    expect([
      ship.left.keys['L.middle_1']?.short,
      ship.fixed['key.J']?.short,
      view(labelled, 'srv').left.keys['L.middle_1']?.short,
    ]).toEqual(['FSD', 'Map', undefined]);
  });

  it('leave a key with none as it was', () => {
    expect(view(keysScheme()).left.keys['L.index_1']).not.toHaveProperty('short');
  });

  it('are offered in the side panel for a unit button or a key with an action, the name as a hint', () => {
    expect([
      view(labelled, 'ship', 'L.middle_1').panel?.keyLabel,
      view(labelled, 'ship', 'key.J').panel?.keyLabel,
      view(labelled, 'srv', 'L.middle_1').panel?.keyLabel,
    ]).toEqual([
      { value: 'FSD', placeholder: 'Frame shift drive' },
      { value: 'Map', placeholder: 'Galaxy map' },
      { value: '', placeholder: 'Jump' },
    ]);
  });

  it('are not offered for an empty button, the stick, or a mouse button (its row has room)', () => {
    expect([
      view(labelled, 'ship', 'L.index_4').panel?.keyLabel,
      view(labelled, 'ship', 'L.stick').panel?.keyLabel,
      view(labelled, 'ship', 'mouse.left').panel?.keyLabel,
    ]).toEqual([null, null, null]);
  });
});
