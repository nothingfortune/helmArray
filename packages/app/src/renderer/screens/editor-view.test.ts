import { describe, expect, it } from 'vitest';
import type { Scheme } from '@helmarray/core';
import { assign, acceptFinding, setLatch } from './editor-model';
import { assignable, editorView, signalText } from './editor-view';
import { game, keysScheme, padScheme, plan } from './editor-fixture';

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
      'L.index_1': { label: 'Boost', role: 'movement' },
      'L.middle_1': { label: 'Frame shift drive', role: 'travel' },
    });
    expect(ship.right.keys).toEqual({ 'R.index_1': { label: 'Fire', role: 'combat' } });
    const srv = view(keysScheme(), 'srv');
    expect(srv.left.keys).toEqual({ 'L.index_1': { label: 'Jump', role: 'movement' } });
    expect(srv.right.keys).toEqual({});
  });

  it('says so when a button has only a long press, so its tap is not mistaken for it', () => {
    const scheme = assign(
      keysScheme(),
      { mode: 'ship', control: 'L.index_2', press: 'long' },
      'gear',
    );
    expect(view(scheme).left.keys['L.index_2']).toEqual({
      label: 'Long: Landing gear',
      role: 'travel',
    });
  });

  it('draws an action the game no longer has as its id, with no role', () => {
    const scheme = { ...keysScheme(), map: { ship: { 'L.index_1': { tap: 'gone' } } } };
    expect(view(scheme).left.keys['L.index_1']).toEqual({ label: 'gone' });
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
    expect(view(keysScheme()).unplaced.map((a) => a.id)).toEqual([
      'galaxy',
      'hardpoints',
      'gear',
      'silent',
    ]);
    expect(view(keysScheme(), 'srv').unplaced.map((a) => a.id)).toEqual(['lights', 'srv_fire']);
  });

  it('counts an action on a long press as placed', () => {
    const scheme = assign(
      keysScheme(),
      { mode: 'ship', control: 'L.index_2', press: 'long' },
      'gear',
    );
    expect(view(scheme).unplaced.map((a) => a.id)).not.toContain('gear');
  });

  it('gives each with its name and role', () => {
    expect(view(keysScheme()).unplaced[0]).toEqual({
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
    expect(own?.sendsNote).toBe("the game's own key");
    const mouse = view(keysScheme(), 'ship', 'R.index_1').panel;
    expect(mouse?.sends).toBe('Left mouse button');
    const pad = view(padScheme(), 'ship', 'L.index_1').panel;
    expect(pad?.sends).toBe('Xbox RB');
    expect(pad?.sendsNote).toBe('your pad bindings');
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
    const edited = assign(base, { mode: 'ship', control: 'R.index_2', press: 'tap' }, 'hardpoints');
    expect(view(edited).findings.map((r) => r.key)).toEqual(view(base).findings.map((r) => r.key));
  });
});
