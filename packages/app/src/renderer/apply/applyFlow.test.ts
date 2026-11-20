import { describe, expect, it } from 'vitest';
import type { AppState, ApplyPreview, ApplyResult, ApplyUnitChange } from '../../shared/api';
import { START, canApply, drawerView, previewKey, reduce, unitSection } from './applyFlow';
import type { DrawerState } from './applyFlow';

const unit = (over: Partial<ApplyUnitChange> = {}): ApplyUnitChange => ({
  hand: 'left',
  connected: true,
  differs: true,
  inputsChanged: 3,
  write: { slot: 1, name: 'Main', overwrites: null },
  deletes: [
    { slot: 0, name: 'Default' },
    { slot: 2, name: '' },
  ],
  changes: [],
  problem: null,
  ...over,
});

const preview = (over: Partial<ApplyPreview> = {}): ApplyPreview => ({
  schemeId: 'skiff-main',
  schemeName: 'Main',
  gameName: 'Skiff',
  ready: true,
  azeronOpen: false,
  busy: false,
  checks: [
    { ok: true, text: 'The Azeron app is closed.' },
    { ok: true, text: 'The scheme has no errors.' },
  ],
  anyChange: true,
  left: unit(),
  right: unit({ hand: 'right', inputsChanged: 1, deletes: [] }),
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
      message: 'The left unit runs the layout in slot 1.',
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
    expect(view.result?.lines).toEqual(['The left unit runs the layout in slot 1.']);
    expect(view.apply).toEqual({ label: 'Try again', disabled: false });
    expect(reduce(done, { type: 'retry' })).toBe(START);
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

describe('what changes on a unit', () => {
  it('names the slot written and the slots deleted, by name', () => {
    expect(unitSection(unit(), false)).toEqual({
      hand: 'left',
      title: 'Left Azeron',
      summary: '3 inputs change',
      lines: [
        { kind: 'write', text: 'A new slot 1 ("Main") is written, then switched to.' },
        { kind: 'delete', text: 'Slot 0 (Default) is deleted.' },
        { kind: 'delete', text: 'Slot 2 is deleted.' },
      ],
    });
  });

  it('says a slot is written over, by its name, when there is no free one', () => {
    const section = unitSection(
      unit({ write: { slot: 3, name: 'Main', overwrites: { slot: 3, name: 'Old' } } }),
      false,
    );
    expect(section.lines[0]?.text).toBe(
      'Slot 3 (Old) is written over with "Main", then switched to.',
    );
  });

  it('says one input in the singular', () => {
    expect(unitSection(unit({ inputsChanged: 1 }), false).summary).toBe('1 input changes');
  });

  it('says a unit already holding the layout has no change, or only a tidy up', () => {
    const same = unit({ differs: false, inputsChanged: 0, write: null, deletes: [] });
    expect(unitSection(same, false)).toMatchObject({
      summary: 'No change',
      lines: [{ kind: 'same', text: 'It already holds this layout.' }],
    });
    expect(unitSection({ ...same, deletes: [{ slot: 4, name: 'Spare' }] }, false).summary).toBe(
      'Tidy up',
    );
  });

  it('says a unit that is not connected, or was not looked at, has nothing to show', () => {
    expect(unitSection(unit({ connected: false }), false)).toMatchObject({
      summary: 'Not connected',
      lines: [],
    });
    expect(unitSection(unit({ connected: false }), true)).toMatchObject({
      summary: 'Not looked at',
      lines: [],
    });
  });

  it('shows why a unit cannot be done', () => {
    const section = unitSection(unit({ write: null, deletes: [], problem: 'No room.' }), false);
    expect(section.summary).toBe("Can't be done");
    expect(section.lines).toEqual([{ kind: 'problem', text: 'No room.' }]);
  });
});

describe('when to look again', () => {
  const state = (over: Partial<AppState> = {}): AppState => ({
    devices: [
      { hand: 'left', unitId: 1, state: 'ready', firmware: 112, error: null },
      { hand: 'right', unitId: 2, state: 'ready', firmware: 112, error: null },
    ],
    sync: { label: 'In sync', tone: 'ok' },
    writeBlock: null,
    question: null,
    activeGameId: null,
    activeSchemeId: null,
    ...over,
  });

  it('changes with the Azeron app, a unit and a hand, and not with the pill', () => {
    const base = previewKey(state());
    expect(previewKey(state({ writeBlock: 'Close the Azeron app first.' }))).not.toBe(base);
    expect(previewKey(state({ devices: [] }))).not.toBe(base);
    expect(previewKey(state({ sync: { label: '3 changes not applied', tone: 'warning' } }))).toBe(
      base,
    );
    expect(previewKey(null)).toBe('');
  });
});
