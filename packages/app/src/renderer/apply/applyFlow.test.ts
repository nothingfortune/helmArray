import { describe, expect, it } from 'vitest';
import type {
  AppState,
  ApplyGameRow,
  ApplyPreview,
  ApplyButtonChange,
  ApplyResult,
  ApplyUnitChange,
} from '../../shared/api';
import {
  START,
  byHandSection,
  padByHandSection,
  canApply,
  drawerView,
  gameSection,
  previewKey,
  reduce,
  unitSection,
  waitingOnGame,
} from './applyFlow';
import type { DrawerState } from './applyFlow';

/** A button Apply changes, as main sends it: the Reload on middle 1 by default. */
const button = (over: Partial<ApplyButtonChange> = {}): ApplyButtonChange => ({
  position: 'middle_1',
  actions: ['Reload'],
  sends: { kind: 'pad', control: 'X' },
  stick: null,
  wasEmpty: false,
  nowEmpty: false,
  ...over,
});

const unit = (over: Partial<ApplyUnitChange> = {}): ApplyUnitChange => ({
  hand: 'left',
  used: true,
  connected: true,
  differs: true,
  inputsChanged: 3,
  buttons: [
    button(),
    button({ position: 'index_5', actions: ['Silent running'], wasEmpty: true }),
    button({ position: 'dpad_up', actions: [], sends: null, nowEmpty: true }),
  ],
  write: { slot: 1, name: 'Main', overwrites: null },
  deletes: [
    { slot: 0, name: 'Default', ownCopy: false, game: null },
    { slot: 2, name: '', ownCopy: false, game: null },
  ],
  changes: [],
  problem: null,
  ...over,
});

const preview = (over: Partial<ApplyPreview> = {}): ApplyPreview => ({
  schemeId: 'skiff-main',
  schemeName: 'Main',
  gameId: 'skiff',
  gameName: 'Skiff',
  fingerprint: 'f1',
  ready: true,
  azeronOpen: false,
  busy: false,
  checks: [
    { ok: true, text: 'The Azeron app is closed.', kind: 'azeron-app' },
    { ok: true, text: 'The left Azeron is connected.', kind: 'unit' },
    { ok: true, text: 'The scheme has no errors.', kind: 'scheme' },
  ],
  anyChange: true,
  left: unit(),
  right: unit({ hand: 'right', inputsChanged: 1, deletes: [] }),
  game: { via: 'sheet', rows: [] },
  ...over,
});

const ready = (over: Partial<ApplyPreview> = {}): DrawerState => ({
  phase: 'ready',
  preview: preview(over),
});

const OK: ApplyResult = {
  ok: true,
  message: 'Both units now run the layout.',
  units: [
    { hand: 'left', status: 'applied', message: 'The left unit runs the layout.', slot: 1 },
    { hand: 'right', status: 'applied', message: 'The right unit runs the layout.', slot: 1 },
  ],
};
const FAILED: ApplyResult = {
  ok: false,
  message: 'The right unit failed: it is not connected; nothing on it was changed.',
  units: [
    {
      hand: 'left',
      status: 'applied',
      message: 'The left unit runs the layout.',
      slot: 1,
    },
    {
      hand: 'right',
      status: 'failed',
      message: 'The right unit failed: it is not connected; nothing on it was changed.',
      slot: null,
    },
  ],
};

describe('the Apply drawer flow', () => {
  it('starts loading, and shows the preview when it comes', () => {
    expect(START.phase).toBe('loading');
    expect(reduce(START, { type: 'preview', preview: preview() })).toEqual(ready());
  });

  it('allows Apply only when the preview says ready and nothing else is running', () => {
    expect(canApply(ready())).toBe(true);
    expect(canApply(ready({ ready: false }))).toBe(false);
    expect(canApply(ready({ busy: true }))).toBe(false);
    expect(canApply(START)).toBe(false);
    expect(drawerView(ready({ ready: false })).apply).toEqual({ label: 'Apply', disabled: true });
    expect(drawerView(ready()).apply).toEqual({ label: 'Apply', disabled: false });
  });

  it('shows a section for each unit the setup uses, and none for one it does not', () => {
    const leftOnly = ready({
      right: unit({ hand: 'right', used: false, differs: false, write: null, deletes: [] }),
    });
    expect(drawerView(leftOnly).sections.map((section) => section.hand)).toEqual(['left']);
    expect(drawerView(ready()).sections.map((section) => section.hand)).toEqual(['left', 'right']);
  });

  it('does not start an apply that is not ready, nor from any other step', () => {
    expect(reduce(ready({ ready: false }), { type: 'apply' }).phase).toBe('ready');
    expect(reduce(START, { type: 'apply' })).toBe(START);
    const applying = reduce(ready(), { type: 'apply' });
    expect(applying.phase).toBe('applying');
    // A second press while it writes does nothing.
    expect(reduce(applying, { type: 'apply' })).toBe(applying);
  });

  it('cannot be closed, nor cancelled, while it writes, and says it is writing', () => {
    const view = drawerView(reduce(ready(), { type: 'apply' }));
    expect(view.closable).toBe(false);
    expect(view.cancel.disabled).toBe(true);
    expect(view.apply).toEqual({ label: 'Applying…', disabled: true });
    expect(view.progress).toMatch(/Writing to your Azerons/);
    expect(drawerView(ready()).closable).toBe(true);
  });

  it('ignores a fresh look while it writes and after it has ended', () => {
    const applying = reduce(ready(), { type: 'apply' });
    expect(reduce(applying, { type: 'preview', preview: preview({ ready: false }) })).toBe(
      applying,
    );
    const done = reduce(applying, { type: 'applied', result: OK });
    expect(reduce(done, { type: 'preview', preview: preview({ ready: false }) })).toBe(done);
  });

  it('takes a fresh look while it is only showing the preview', () => {
    const next = reduce(ready(), { type: 'preview', preview: preview({ ready: false }) });
    expect(canApply(next)).toBe(false);
  });

  it('shows the result in one sentence, with Apply gone and only Close left', () => {
    const done = reduce(reduce(ready(), { type: 'apply' }), { type: 'applied', result: OK });
    const view = drawerView(done);
    expect(view.result).toEqual({
      ok: true,
      headline: 'Both units now run the layout.',
      lines: ['The left unit runs the layout.', 'The right unit runs the layout.'],
    });
    expect(view.apply).toBeNull();
    expect(view.cancel).toEqual({ label: 'Close', disabled: false });
    expect(view.closable).toBe(true);
    expect(view.sections).toEqual([]);
  });

  it('on failure says what failed and what was left as it was, and offers to try again', () => {
    const done = reduce(reduce(ready(), { type: 'apply' }), { type: 'applied', result: FAILED });
    const view = drawerView(done);
    expect(view.result?.ok).toBe(false);
    expect(view.result?.headline).toBe(FAILED.message);
    // The unit that did go through is said too; the failure is not said twice.
    expect(view.result?.lines).toEqual(['The left unit runs the layout.']);
    expect(view.apply).toEqual({ label: 'Try again', disabled: false });
    expect(reduce(done, { type: 'retry' })).toBe(START);
  });

  describe('when the scheme changed since the preview', () => {
    const CHANGED: ApplyResult = {
      ok: false,
      changed: true,
      message: 'The layout changed since the preview: look again.',
      units: [],
    };

    it('goes back to looking, with the reason, instead of ending as a failure', () => {
      const state = reduce(reduce(ready(), { type: 'apply' }), {
        type: 'applied',
        result: CHANGED,
      });
      expect(state).toEqual({ phase: 'loading', notice: CHANGED.message });
      expect(drawerView(state)).toMatchObject({
        loading: 'Looking at what changes…',
        notice: CHANGED.message,
        result: null,
      });
    });

    it('shows the new preview with the reason kept, and Apply allowed again', () => {
      const looking = reduce(reduce(ready(), { type: 'apply' }), {
        type: 'applied',
        result: CHANGED,
      });
      const next = reduce(looking, { type: 'preview', preview: preview({ fingerprint: 'f2' }) });
      expect(next).toMatchObject({ phase: 'ready', notice: CHANGED.message });
      expect(canApply(next)).toBe(true);
      expect(drawerView(next).notice).toBe(CHANGED.message);
      // The next apply is of the layout now shown.
      expect(next.phase === 'ready' && next.preview.fingerprint).toBe('f2');
    });

    it('says nothing of a change on an ordinary preview, or a later apply', () => {
      expect(drawerView(ready()).notice).toBeNull();
      const applying = reduce(
        reduce(reduce(ready(), { type: 'apply' }), { type: 'applied', result: CHANGED }),
        { type: 'preview', preview: preview() },
      );
      expect(drawerView(reduce(applying, { type: 'apply' })).notice).toBeNull();
    });
  });

  it('does not offer to retry after a success', () => {
    const done = reduce(reduce(ready(), { type: 'apply' }), { type: 'applied', result: OK });
    expect(reduce(done, { type: 'retry' })).toBe(done);
  });

  it('turns an apply that never answered into a failed result', () => {
    const done = reduce(reduce(ready(), { type: 'apply' }), {
      type: 'applyFailed',
      message: "Couldn't apply.",
    });
    expect(drawerView(done).result).toMatchObject({ ok: false, headline: "Couldn't apply." });
  });

  it('says when the preview could not be had', () => {
    const state = reduce(START, { type: 'previewFailed', message: "Couldn't check." });
    expect(drawerView(state).unavailable).toBe("Couldn't check.");
    expect(drawerView(state).apply?.disabled).toBe(true);
    expect(reduce(START, { type: 'open' })).toBe(START);
  });

  it('shows what is ready as checks and crosses, one sentence each', () => {
    const view = drawerView(
      ready({
        ready: false,
        checks: [{ ok: false, text: 'Close the Azeron app first: it talks to the units too.' }],
      }),
    );
    expect(view.checks).toEqual([
      { ok: false, text: 'Close the Azeron app first: it talks to the units too.' },
    ]);
    expect(view.title).toBe('Apply Main');
    expect(view.subtitle).toBe('Skiff · what changes');
  });
});

const row = (over: Partial<ApplyGameRow> = {}): ApplyGameRow => ({
  set: 'controller',
  mode: 'default',
  modeName: 'Default',
  action: 'reload',
  actionName: 'Reload',
  to: { kind: 'pad', control: 'Y' },
  from: { kind: 'pad', control: 'X' },
  ...over,
});
const NO_UNIT = unit({ used: false, connected: false, write: null, deletes: [], inputsChanged: 0 });

describe('the game half of the drawer', () => {
  it('is a bind sheet: what to set in the game’s own controls, one line per action', () => {
    expect(gameSection({ via: 'sheet', rows: [row()] })).toEqual({
      title: "In the game's controls",
      summary: '1 to set by hand',
      groups: [{ label: null, lines: ['Set Reload to Xbox Y'] }],
    });
  });

  it("says why the rows are set by hand when the game's file helmArray would write isn't there", () => {
    const note = "helmArray can't find Skiff's controls file, so set these in the game's own menu.";
    expect(gameSection({ via: 'sheet', rows: [row()], note })).toEqual({
      title: "In the game's controls",
      summary: '1 to set by hand',
      note,
      groups: [{ label: null, lines: ['Set Reload to Xbox Y'] }],
    });
  });

  it('says to take an action off what it was on when the setup puts it on nothing', () => {
    expect(gameSection({ via: 'sheet', rows: [row({ to: null })] })?.groups[0]?.lines).toEqual([
      'Take Reload off Xbox X',
    ]);
  });

  it('groups the rows by the game’s two sets of bindings, and by mode when it has several', () => {
    const rows = [
      row(),
      row({ set: 'keyboard', to: { kind: 'key', code: 'T' }, from: { kind: 'key', code: 'R' } }),
      row({
        set: 'keyboard',
        mode: 'srv',
        modeName: 'SRV',
        action: 'jump',
        actionName: 'Jump',
        to: { kind: 'key', code: 'J' },
        from: null,
      }),
    ];
    expect(gameSection({ via: 'sheet', rows })).toEqual({
      title: "In the game's controls",
      summary: '3 to set by hand',
      groups: [
        { label: 'Controller · Default', lines: ['Set Reload to Xbox Y'] },
        { label: 'Keyboard and mouse · Default', lines: ['Set Reload to T'] },
        { label: 'Keyboard and mouse · SRV', lines: ['Set Jump to J'] },
      ],
    });
  });

  it('names only what tells the groups apart: the two sets of a game with one mode', () => {
    const rows = [row(), row({ set: 'keyboard', to: { kind: 'key', code: 'T' } })];
    expect(gameSection({ via: 'sheet', rows })?.groups.map((g) => g.label)).toEqual([
      'Controller',
      'Keyboard and mouse',
    ]);
  });

  it('is the game file once helmArray writes it', () => {
    expect(gameSection({ via: 'file', rows: [row(), row({ action: 'x' })] })).toMatchObject({
      title: 'Game file',
      summary: '2 bindings',
    });
  });

  it('is not there when no binding changes', () => {
    expect(gameSection({ via: 'sheet', rows: [] })).toBeNull();
  });

  it('shows in the drawer beside the unit sections, before Apply', () => {
    const view = drawerView(ready({ game: { via: 'sheet', rows: [row()] } }));
    expect([view.sections.map((s) => s.hand), view.game?.groups[0]?.lines]).toEqual([
      ['left', 'right'],
      ['Set Reload to Xbox Y'],
    ]);
  });

  it('stays after Apply as what is left to do by hand: the bind sheet', () => {
    const done = reduce(
      reduce(ready({ game: { via: 'sheet', rows: [row()] } }), { type: 'apply' }),
      {
        type: 'applied',
        result: OK,
      },
    );
    expect(drawerView(done).sheet).toEqual({
      title: "Now, in Skiff's controls",
      summary: '1 to set by hand',
      groups: [{ label: null, lines: ['Set Reload to Xbox Y'] }],
    });
  });

  it('is no bind sheet after an apply that failed: nothing is to be set yet', () => {
    const done = reduce(
      reduce(ready({ game: { via: 'sheet', rows: [row()] } }), { type: 'apply' }),
      {
        type: 'applied',
        result: FAILED,
      },
    );
    expect(drawerView(done).sheet).toBeNull();
  });
});

describe('a setup with no Azeron, or the left one only', () => {
  it('has no unit section, a game half, and Apply allowed: applying is setting the game', () => {
    const view = drawerView(
      ready({
        left: NO_UNIT,
        right: { ...NO_UNIT, hand: 'right' },
        anyChange: false,
        checks: [{ ok: true, text: 'The scheme has no errors.' }],
        game: { via: 'sheet', rows: [row({ set: 'keyboard', to: { kind: 'key', code: 'T' } })] },
      }),
    );
    expect([view.sections, view.game?.groups[0]?.lines, view.apply]).toEqual([
      [],
      ['Set Reload to T'],
      { label: 'Apply', disabled: false },
    ]);
  });

  it('says what it does while it applies: no Azeron, the left one, or both', () => {
    const progress = (over: Partial<ApplyPreview>) =>
      drawerView(reduce(ready(over), { type: 'apply' })).progress;
    expect([
      progress({ left: NO_UNIT, right: { ...NO_UNIT, hand: 'right' } }),
      progress({ right: { ...NO_UNIT, hand: 'right' } }),
      progress({}),
    ]).toEqual([
      'Applying…',
      'Writing to your left Azeron. Keep it plugged in and the Azeron app closed.',
      'Writing to your Azerons, the left one first. Keep them plugged in and the Azeron app closed.',
    ]);
  });
});

describe('what changes on a unit', () => {
  it("lists each button that changes in the game's words, and counts buttons", () => {
    expect(unitSection(unit(), false)).toEqual({
      hand: 'left',
      title: 'Left Azeron',
      summary: '3 buttons',
      lines: [
        { kind: 'button', text: 'Middle 1 · Reload' },
        { kind: 'button', text: 'Index 5 · Silent running · new' },
        { kind: 'button', text: 'D-pad ↑ · cleared' },
        { kind: 'housekeeping', text: 'Your layout “Default” is removed.' },
        { kind: 'housekeeping', text: 'A layout with no name is removed.' },
      ],
    });
  });

  it('says one button in the singular, for a drag onto one empty button', () => {
    const one = unit({
      buttons: [button({ position: 'middle_2', wasEmpty: true })],
      deletes: [],
    });
    expect(unitSection(one, false)).toMatchObject({
      summary: '1 button',
      lines: [{ kind: 'button', text: 'Middle 2 · Reload · new' }],
    });
  });

  it('names every action on a button, and what a button with none sends', () => {
    const lines = unitSection(
      unit({
        buttons: [
          button({ actions: ['Fire', 'Map'] }),
          button({ position: 'middle_2', actions: [], sends: { kind: 'pad', control: 'Y' } }),
        ],
        deletes: [],
      }),
      false,
    ).lines;
    expect(lines.map((l) => l.text)).toEqual(['Middle 1 · Fire, Map', 'Middle 2 · Xbox Y']);
  });

  it('says what the stick does once applied', () => {
    const stick = (mode: 'pad-left' | 'mouse') =>
      button({ position: 'stick', actions: [], sends: null, stick: { mode } });
    const lines = unitSection(
      unit({ buttons: [stick('pad-left'), stick('mouse')], deletes: [] }),
      false,
    ).lines;
    expect(lines.map((l) => l.text)).toEqual(['Stick · Xbox left stick', 'Stick · Mouse movement']);
  });

  it('says a unit already holding the layout has no change, or no button change', () => {
    const same = unit({ differs: false, inputsChanged: 0, buttons: [], write: null, deletes: [] });
    expect(unitSection(same, false)).toMatchObject({
      summary: 'No change',
      lines: [{ kind: 'same', text: 'It already holds this layout.' }],
    });
    expect(
      unitSection(
        { ...same, deletes: [{ slot: 4, name: 'Spare', ownCopy: false, game: null }] },
        false,
      ),
    ).toEqual({
      hand: 'left',
      title: 'Left Azeron',
      summary: 'No button changes',
      lines: [{ kind: 'housekeeping', text: 'Your layout “Spare” is removed.' }],
    });
  });

  it('says a unit that is not connected, or waits for the Azeron app, has nothing to show', () => {
    expect(unitSection(unit({ connected: false }), false)).toMatchObject({
      summary: 'Not connected',
      lines: [],
    });
    expect(unitSection(unit({ connected: false }), true)).toMatchObject({
      summary: 'Waiting for the Azeron app to close',
      lines: [],
    });
  });

  it('shows why a unit cannot be done', () => {
    const section = unitSection(
      unit({ buttons: [], write: null, deletes: [], problem: 'No room.' }),
      false,
    );
    expect(section.summary).toBe("Can't be done");
    expect(section.lines).toEqual([{ kind: 'problem', text: 'No room.' }]);
  });
});

describe('what is ready, as the drawer shows it', () => {
  it('shows only what can fail or needs doing: the Azeron app always, the rest when not ready', () => {
    expect(drawerView(ready()).checks).toEqual([
      { ok: true, text: 'The Azeron app is closed.', kind: 'azeron-app' },
    ]);
  });

  it('shows every check that is not ready', () => {
    const checks = [
      {
        ok: false,
        text: 'Close the Azeron app first: it talks to the units too.',
        kind: 'azeron-app' as const,
      },
      { ok: false, text: "The right Azeron isn't connected.", kind: 'unit' as const },
      { ok: true, text: 'The left Azeron is connected.', kind: 'unit' as const },
    ];
    expect(drawerView(ready({ ready: false, checks })).checks).toEqual([checks[0], checks[1]]);
  });
});

describe('when to look again', () => {
  const state = (over: Partial<AppState> = {}): AppState => ({
    devices: [
      {
        hand: 'left',
        unitId: 1,
        state: 'ready',
        firmware: 112,
        error: null,
        read: true,
        running: 1,
      },
      {
        hand: 'right',
        unitId: 2,
        state: 'ready',
        firmware: 112,
        error: null,
        read: true,
        running: 1,
      },
    ],
    sync: { label: 'In sync', tone: 'ok' },
    writeBlock: null,
    question: null,
    activeGameId: null,
    activeSchemeId: null,
    onUnits: { left: null, right: null },
    sheets: [],
    ...over,
  });

  const withLeft = (over: Partial<AppState['devices'][number]>): AppState => {
    const s = state();
    return { ...s, devices: s.devices.map((d, i) => (i === 0 ? { ...d, ...over } : d)) };
  };
  /** How many times a drawer open on this run of states would have looked again. */
  const previews = (states: AppState[]) =>
    states.reduce(
      (n, s, i) => (i > 0 && previewKey(s) !== previewKey(states[i - 1] ?? null) ? n + 1 : n),
      0,
    );

  it('changes with the Azeron app opening or closing, and not otherwise with the app state', () => {
    const base = previewKey(state());
    expect(previewKey(state({ writeBlock: 'Close the Azeron app first.' }))).not.toBe(base);
    expect(previewKey(state({ activeGameId: 'skiff', activeSchemeId: 'x' }))).toBe(base);
    expect(previewKey(null)).toBe('');
  });

  it('looks again when a unit is unplugged and when it is plugged back', () => {
    const [both, one] = [state(), state({ devices: state().devices.slice(1) })];
    expect(previews([both, one, both])).toBe(2);
    expect(previewKey(withLeft({ state: 'connecting', read: false, running: null }))).not.toBe(
      previewKey(both),
    );
  });

  it('looks again when a unit goes unread and when it is read again, once each', () => {
    const read = state();
    const unread = withLeft({ read: false, running: null });
    expect(previewKey(unread)).not.toBe(previewKey(read));
    // Unread, then read: two changes of key, so two previews, and the last shows it recovered.
    expect(previews([read, unread, read])).toBe(2);
  });

  it('looks again when the profile button moves a unit to another slot', () => {
    expect(previewKey(withLeft({ running: 0 }))).not.toBe(previewKey(state()));
  });

  it('does not look again for a unit asked again with the same answer (readAt is not in the state)', () => {
    expect(previews([state(), state(), state(), state()])).toBe(0);
  });

  it('looks again when the scheme was edited elsewhere (what the pill says changes), not on a plain tick', () => {
    const edited = state({ sync: { label: '2 changes not applied', tone: 'warning' } });
    expect(previews([state(), edited, edited])).toBe(1);
    const moved = state({
      sync: {
        label: 'Left unit differs',
        tone: 'error',
        detail: 'Left unit: 3 buttons not as applied.',
      },
    });
    expect(previewKey(moved)).not.toBe(previewKey(state()));
  });

  it('looks again when a unit is told which hand it is', () => {
    const asked = state({ question: { kind: 'press', prompt: 'Unplug your left Azeron.' } });
    expect(previews([asked, state()])).toBe(1);
  });
});

// What main says of each layout Apply removes (by identity: `layoutIdentity`), and the line the
// drawer gives it. Every one that isn't the scheme's own earlier copy is said, whatever its name.
describe('the layouts a unit loses, said', () => {
  const removing = (deletes: ApplyUnitChange['deletes']) =>
    unitSection(unit({ buttons: [], deletes }), false)
      .lines.filter((l) => l.kind === 'housekeeping')
      .map((l) => l.text);

  it.each([
    ['its own earlier copy', { name: 'Main', ownCopy: true, game: 'Skiff' }, []],
    [
      'another scheme of the same game, same name',
      { name: 'Main', ownCopy: false, game: 'Skiff' },
      ['Your layout “Main” from Skiff is removed.'],
    ],
    [
      'another game, same name',
      { name: 'Xbox controller', ownCopy: false, game: 'Everspace 2' },
      ['Your layout “Xbox controller” from Everspace 2 is removed.'],
    ],
    [
      'no record, or one the unit does not agree with',
      { name: 'Main', ownCopy: false, game: null },
      ['Your layout “Main” is removed.'],
    ],
    [
      'a layout with no name',
      { name: '', ownCopy: false, game: null },
      ['A layout with no name is removed.'],
    ],
  ] as const)('%s', (_, layout, lines) => {
    expect(removing([{ slot: 1, ...layout }])).toEqual(lines);
  });

  it('says a layout written over, which the unit was not running, by its name', () => {
    const over = unit({
      buttons: [],
      write: { slot: 3, name: 'Main', overwrites: { slot: 3, name: 'Old' } },
      deletes: [],
    });
    expect(unitSection(over, false).lines.map((l) => l.text)).toEqual([
      'Your layout “Old” is removed.',
    ]);
  });
});

describe("the game's file in the drawer", () => {
  const FILE = { name: 'Custom.4.1.binds', same: false };
  const srv = row({
    set: 'keyboard',
    mode: 'srv',
    modeName: 'SRV',
    action: 'jump',
    actionName: 'Jump',
    to: { kind: 'key', code: 'J' },
    from: null,
  });

  it('is its own target: the file by name, how many bindings in each mode, and that a copy is kept', () => {
    const rows = [row(), row({ action: 'fire', actionName: 'Fire' }), srv];
    expect(gameSection({ via: 'file', rows, file: FILE })).toEqual({
      title: 'Game file',
      summary: '3 bindings',
      file: 'Custom.4.1.binds',
      note: 'Default 2 · SRV 1 · a copy of the old file is kept',
      groups: [
        { label: 'Controller · Default', lines: ['Reload · Xbox Y', 'Fire · Xbox Y'] },
        { label: 'Keyboard and mouse · SRV', lines: ['Jump · J'] },
      ],
    });
  });

  it('says what each binding goes on in the file, and what comes off', () => {
    const rows = [row(), row({ to: null }), row({ to: null, from: null })];
    expect(gameSection({ via: 'file', rows, file: FILE })?.groups[0]?.lines).toEqual([
      'Reload · Xbox Y',
      'Reload · off Xbox X',
      'Reload · on nothing',
    ]);
  });

  it("says in main's sentence that the file is made, in place of the copy kept", () => {
    const note =
      "Elite Dangerous has no controls file of its own yet, so helmArray makes one from the game's keyboard and mouse preset and sets the game to use it.";
    expect(gameSection({ via: 'file', rows: [row()], file: FILE, note })).toMatchObject({
      title: 'Game file',
      summary: '1 binding',
      file: 'Custom.4.1.binds',
      note,
    });
  });

  it('calls a file it makes, with no binding to change from the preset, a new file', () => {
    const made = { ...FILE, made: true as const };
    expect([
      gameSection({ via: 'file', rows: [], file: made })?.summary,
      gameSection({ via: 'file', rows: [row()], file: made })?.summary,
      gameSection({ via: 'file', rows: [], file: FILE })?.summary,
    ]).toEqual(['New file', '1 binding', '0 bindings']);
  });

  it('keeps the note short for a game with one mode', () => {
    expect(gameSection({ via: 'file', rows: [row()], file: FILE })).toMatchObject({
      summary: '1 binding',
      note: 'A copy of the old file is kept.',
    });
  });

  it('says it already holds the bindings, when nothing in it changes', () => {
    expect(gameSection({ via: 'file', rows: [], file: { ...FILE, same: true } })).toEqual({
      title: 'Game file',
      summary: 'No change',
      file: 'Custom.4.1.binds',
      note: 'It already holds these bindings.',
      groups: [],
    });
  });

  it("lists apart, to set by hand, the actions the file doesn't have, before Apply and after", () => {
    const wave = row({
      set: 'keyboard',
      action: 'wave',
      actionName: 'Wave',
      to: { kind: 'key', code: 'C' },
      from: null,
    });
    const game = { via: 'file' as const, rows: [row()], file: FILE, byHand: [wave] };
    const before = drawerView(ready({ game }));
    const after = drawerView(
      reduce(reduce(ready({ game }), { type: 'apply' }), { type: 'applied', result: OK }),
    );
    const failed = drawerView(
      reduce(reduce(ready({ game }), { type: 'apply' }), { type: 'applied', result: FAILED }),
    );
    expect({
      file: before.game?.groups[0]?.lines,
      byHand: before.byHand,
      after: after.sheet?.title,
      failed: failed.sheet,
    }).toEqual({
      file: ['Reload · Xbox Y'],
      byHand: {
        title: "In the game's controls",
        summary: '1 to set by hand',
        note: "Skiff's controls file doesn't have this action, so set it in the game's own menu.",
        groups: [{ label: null, lines: ['Set Wave to C'] }],
      },
      after: "Now, in Skiff's controls",
      failed: null,
    });
  });

  it('shows the bind sheet Apply sends back when the file went before it could be written: every row, why, and no Try again', () => {
    const note =
      "helmArray can't find Skiff's controls file, so set these in the game's own menu (changing any control there makes the game save one).";
    const wave = row({ action: 'wave', actionName: 'Wave', to: { kind: 'key', code: 'C' } });
    const game = { via: 'file' as const, rows: [], file: { ...FILE, same: true }, byHand: [wave] };
    const result = { ...OK, game: { via: 'sheet' as const, rows: [row(), wave], note } };
    const view = drawerView(
      reduce(reduce(ready({ game }), { type: 'apply' }), { type: 'applied', result }),
    );
    expect({ sheet: view.sheet, apply: view.apply, ok: view.result?.ok }).toEqual({
      sheet: {
        title: "Now, in Skiff's controls",
        summary: '2 to set by hand',
        note,
        groups: [{ label: null, lines: ['Set Reload to Xbox Y', 'Set Wave to C'] }],
      },
      apply: null,
      ok: true,
    });
  });

  it("says 'these actions' for more than one the file doesn't have, and nothing for none", () => {
    const wave = row({ action: 'wave', actionName: 'Wave' });
    const bow = row({ action: 'bow', actionName: 'Bow' });
    expect([
      byHandSection(preview({ game: { via: 'file', rows: [], file: FILE, byHand: [wave, bow] } }))
        ?.note,
      byHandSection(
        preview({ gameName: '', game: { via: 'file', rows: [], file: FILE, byHand: [wave] } }),
      )?.note,
      byHandSection(preview({ game: { via: 'file', rows: [], file: FILE } })),
    ]).toEqual([
      "Skiff's controls file doesn't have these actions, so set them in the game's own menu.",
      "The game's controls file doesn't have this action, so set it in the game's own menu.",
      null,
    ]);
  });

  it("lists apart, to set by hand, the controller buttons a file with no controller can't hold, before Apply and after", () => {
    const fire = row({ action: 'fire', actionName: 'Fire', to: { kind: 'pad', control: 'RB' } });
    const game = { via: 'file' as const, rows: [row()], file: FILE, padByHand: [fire] };
    const before = drawerView(ready({ game }));
    const after = drawerView(
      reduce(reduce(ready({ game }), { type: 'apply' }), { type: 'applied', result: OK }),
    );
    const failed = drawerView(
      reduce(reduce(ready({ game }), { type: 'apply' }), { type: 'applied', result: FAILED }),
    );
    expect({
      file: before.game?.groups[0]?.lines,
      byHand: before.byHand,
      padByHand: before.padByHand,
      after: { sheet: after.sheet, padByHand: after.padByHand?.title },
      failed: failed.padByHand,
    }).toEqual({
      file: ['Reload · Xbox Y'],
      byHand: null,
      padByHand: {
        title: "Controller, in the game's controls",
        summary: '1 to set by hand',
        note: "Skiff's controls file has no controller in it yet, so set this controller button in the game's own menu.",
        groups: [{ label: null, lines: ['Set Fire to Xbox RB'] }],
      },
      after: { sheet: null, padByHand: "Now, the controller in Skiff's controls" },
      failed: null,
    });
  });

  it('shows both lists apart, each with its own sentence, when the file lacks an action and has no controller', () => {
    const wave = row({ set: 'keyboard', action: 'wave', actionName: 'Wave' });
    const fire = row({ action: 'fire', actionName: 'Fire', to: { kind: 'pad', control: 'RB' } });
    const game = { via: 'file' as const, rows: [], file: FILE, byHand: [wave], padByHand: [fire] };
    const after = drawerView(
      reduce(reduce(ready({ game }), { type: 'apply' }), { type: 'applied', result: OK }),
    );
    expect([after.sheet?.title, after.padByHand?.title, after.byHand]).toEqual([
      "Now, in Skiff's controls",
      "Now, the controller in Skiff's controls",
      null,
    ]);
  });

  it('shows no controller list when Apply sends the whole game back to the bind sheet', () => {
    const fire = row({ action: 'fire', actionName: 'Fire', to: { kind: 'pad', control: 'RB' } });
    const game = { via: 'file' as const, rows: [row()], file: FILE, padByHand: [fire] };
    const result = { ...OK, game: { via: 'sheet' as const, rows: [row(), fire], note: 'Gone.' } };
    const view = drawerView(
      reduce(reduce(ready({ game }), { type: 'apply' }), { type: 'applied', result }),
    );
    expect([view.sheet?.summary, view.padByHand]).toEqual(['2 to set by hand', null]);
  });

  it("says 'these controller buttons' for more than one, and nothing for none", () => {
    const fire = row({ action: 'fire', actionName: 'Fire' });
    const boost = row({ action: 'boost', actionName: 'Boost' });
    expect([
      padByHandSection(
        preview({ game: { via: 'file', rows: [], file: FILE, padByHand: [fire, boost] } }),
      )?.note,
      padByHandSection(
        preview({ gameName: '', game: { via: 'file', rows: [], file: FILE, padByHand: [fire] } }),
      )?.note,
      padByHandSection(preview({ game: { via: 'file', rows: [], file: FILE } })),
    ]).toEqual([
      "Skiff's controls file has no controller in it yet, so set these controller buttons in the game's own menu.",
      "The game's controls file has no controller in it yet, so set this controller button in the game's own menu.",
      null,
    ]);
  });

  it("names no file it hasn't found", () => {
    expect(
      gameSection({ via: 'file', rows: [row()], file: { name: null, same: false } }),
    ).not.toHaveProperty('file');
  });

  it('shows the game closed with the Azeron app, always, and the file only when it is a problem', () => {
    const checks = [
      { ok: true, text: 'The Azeron app is closed.', kind: 'azeron-app' as const },
      { ok: true, text: 'Skiff is closed.', kind: 'game' as const },
      { ok: true, text: 'The left Azeron is connected.', kind: 'unit' as const },
      {
        ok: false,
        text: "helmArray can't find Skiff's controls file.",
        kind: 'game-file' as const,
      },
    ];
    expect(drawerView(ready({ ready: false, checks })).checks.map((c) => c.text)).toEqual([
      'The Azeron app is closed.',
      'Skiff is closed.',
      "helmArray can't find Skiff's controls file.",
    ]);
  });

  it('says it writes the game file too, while it writes', () => {
    const applying = reduce(ready({ game: { via: 'file', rows: [row()], file: FILE } }), {
      type: 'apply',
    });
    expect(drawerView(applying).progress).toBe(
      "Writing to your Azerons, the left one first, then Skiff's controls file. Keep them plugged in, and the Azeron app and Skiff closed.",
    );
  });

  it("names no game it doesn't know while it writes", () => {
    const file = { via: 'file' as const, rows: [row()], file: FILE };
    const units = reduce(ready({ gameName: '', game: file }), { type: 'apply' });
    const none = reduce(
      ready({ gameName: '', left: NO_UNIT, right: { ...NO_UNIT, hand: 'right' }, game: file }),
      { type: 'apply' },
    );
    expect([drawerView(units).progress, drawerView(none).progress]).toEqual([
      "Writing to your Azerons, the left one first, then the game's controls file. Keep them plugged in, and the Azeron app and the game closed.",
      "Writing the game's controls file. Keep the game closed.",
    ]);
  });

  it('says it writes only the game file for a setup with no Azeron', () => {
    const applying = reduce(
      ready({
        left: NO_UNIT,
        right: { ...NO_UNIT, hand: 'right' },
        game: { via: 'file', rows: [row()], file: FILE },
      }),
      { type: 'apply' },
    );
    expect(drawerView(applying).progress).toBe("Writing Skiff's controls file. Keep Skiff closed.");
  });

  it('says nothing of the file while it writes, when the file already holds the bindings', () => {
    const applying = reduce(
      ready({ game: { via: 'file', rows: [], file: { ...FILE, same: true } } }),
      { type: 'apply' },
    );
    expect(drawerView(applying).progress).toBe(
      'Writing to your Azerons, the left one first. Keep them plugged in and the Azeron app closed.',
    );
  });

  it('says after Apply what became of the file, and leaves nothing to set by hand', () => {
    const done = reduce(
      reduce(ready({ game: { via: 'file', rows: [row()], file: FILE } }), { type: 'apply' }),
      {
        type: 'applied',
        result: { ...OK, gameFile: { ok: true, message: 'Skiff now has the controls.' } },
      },
    );
    const view = drawerView(done);
    expect([view.result?.lines, view.sheet]).toEqual([
      [
        'The left unit runs the layout.',
        'The right unit runs the layout.',
        'Skiff now has the controls.',
      ],
      null,
    ]);
  });

  it("doesn't say the file's sentence twice when it is the headline", () => {
    const message = "Skiff's file couldn't be written, so it was put back as it was.";
    const done = reduce(
      reduce(ready({ game: { via: 'file', rows: [row()], file: FILE } }), { type: 'apply' }),
      { type: 'applied', result: { ...OK, ok: false, message, gameFile: { ok: false, message } } },
    );
    expect(drawerView(done).result?.lines).not.toContain(message);
  });

  it('looks again by itself while the game is open, and not otherwise', () => {
    const open = [{ ok: false, text: 'Close Skiff to apply.', kind: 'game' as const }];
    const other = [{ ok: false, text: "The right Azeron isn't connected.", kind: 'unit' as const }];
    expect([
      waitingOnGame(ready({ ready: false, checks: open })),
      waitingOnGame(ready({ ready: false, checks: other })),
      waitingOnGame(ready({ ready: false, checks: [...open, ...other] })),
      waitingOnGame(ready()),
      waitingOnGame(START),
    ]).toEqual([true, false, true, false, false]);
  });
});
