// One reveal for every place the Editor shows or selects a control after an action: the full
// location (mode, device tab, control, press). Tested on a two-mode game, Lite Dangerous's Ship
// and SRV (editor-fixture.ts), so a fix or an undo in the other mode is seen to switch to it.
import { describe, expect, it } from 'vitest';
import type { Finding, Scheme } from '@helmarray/core';
import { assign, redo, startHistory, commit, undo } from './editor-model';
import { editorView } from './editor-view';
import { game, keysScheme, plan } from './editor-fixture';
import { offerFor } from './fixes';
import type { EditorPlace } from './reveal';
import { editedLocation, findingLocation, reveal, tabOf } from './reveal';

/** The Editor, as it stands: in Ship, nothing selected, on the Azerons. */
const SHIP: EditorPlace = {
  mode: 'ship',
  selected: undefined,
  press: 'tap',
  tab: 'azerons',
  inspector: false,
};

/** A key scheme with Landing gear required and on no button: a finding in SRV's neighbour, Ship. */
const srvJumpMissing = (): Scheme => ({
  ...keysScheme(),
  // Jump (SRV) is required here, and on nothing: its finding is in SRV.
  map: { ...keysScheme().map, srv: {} },
});
const liteRequired = {
  ...game,
  actions: game.actions.map((a) => (a.id === 'jump' ? { ...a, required: true } : a)),
};

/** The next edit as the Editor makes it: on the place it shows, the selected control's press. */
const nextEdit = (scheme: Scheme, place: EditorPlace, action: string): Scheme =>
  assign(
    scheme,
    { mode: place.mode, control: place.selected ?? '', press: place.press },
    action,
    liteRequired,
  );

describe('reveal', () => {
  it('switches to the location’s mode, selects its control on its tab, and opens the inspector', () => {
    expect(reveal(SHIP, { mode: 'srv', control: 'key.J', press: 'tap' }, keysScheme())).toEqual({
      mode: 'srv',
      selected: 'key.J',
      press: 'tap',
      tab: 'keyboard',
      inspector: true,
    });
  });

  it('keeps what the location doesn’t say: a mode alone keeps the tab and drops the selection', () => {
    const at = { ...SHIP, selected: 'L.index_1', inspector: true };
    expect(reveal(at, { mode: 'srv' }, keysScheme())).toEqual({
      ...at,
      mode: 'srv',
      selected: undefined,
    });
  });

  it('finds each control’s tab: a unit’s, the keyboard’s, the controller’s, the mouse beside the left unit', () => {
    const left = { azerons: 'left', keyboard: false, mouse: true, controller: false } as const;
    expect([
      tabOf('R.index_1', keysScheme().devices),
      tabOf('key.J', keysScheme().devices),
      tabOf('pad.A', keysScheme().devices),
      tabOf('mouse.left', left),
      tabOf('mouse.left', { ...left, azerons: 'none', keyboard: true }),
    ]).toEqual(['azerons', 'keyboard', 'controller', 'azerons', 'keyboard']);
  });
});

describe('a fix in the other mode (Codex, #109)', () => {
  const scheme = srvJumpMissing();
  const p = plan(scheme, liteRequired);
  const finding = p.findings.find(
    (f) => f.rule === 'missing-required' && f.action === 'jump',
  ) as Finding;
  const offer = offerFor(finding, scheme, liteRequired, p);
  const fix = offer !== null && 'fix' in offer ? offer.fix : undefined;

  it('reveals the finding’s mode and the control it put the action on', () => {
    const location = fix?.reveal?.(scheme);
    const after = fix?.apply(scheme) ?? scheme;
    expect({
      mode: location?.mode,
      on: location?.control === undefined ? undefined : after.map['srv']?.[location.control]?.tap,
    }).toEqual({ mode: 'srv', on: 'jump' });
  });

  it('so the next edit lands in that mode, on that control', () => {
    const after = fix?.apply(scheme) ?? scheme;
    const place = reveal(SHIP, fix?.reveal?.(scheme) ?? {}, after);
    const next = nextEdit(after, place, 'lights');
    expect([place.mode, next.map['srv']?.[place.selected ?? '']?.tap, next.map['ship']]).toEqual([
      'srv',
      'lights',
      after.map['ship'],
    ]);
  });

  it('a group’s fix reveals its mode', () => {
    const both = {
      ...liteRequired,
      actions: liteRequired.actions.map((a) =>
        a.id === 'lights' ? { ...a, required: true, role: 'movement' as const } : a,
      ),
    };
    const v = editorView({ scheme, game: both, plan: plan(scheme, both), mode: 'ship' });
    const group = v.checks.find((c) => c.kind === 'group');
    expect(group?.kind === 'group' ? group.fix?.reveal?.(scheme)?.mode : undefined).toBe('srv');
  });
});

describe('a finding row, clicked', () => {
  it('reveals its control in its mode', () => {
    expect(
      findingLocation({
        rule: 'sends-nothing',
        severity: 'error',
        control: 'L.index_1',
        mode: 'srv',
        message: 'x',
      }),
    ).toEqual({ mode: 'srv', control: 'L.index_1', press: 'tap' });
  });

  it('reveals the mode alone for an action on no control, and nothing for a setup-wide one', () => {
    expect([
      findingLocation({
        rule: 'missing-required',
        severity: 'error',
        action: 'jump',
        mode: 'srv',
        message: 'x',
      }),
      findingLocation({ rule: 'mixed-input', severity: 'warning', message: 'x' }),
    ]).toEqual([{ mode: 'srv' }, undefined]);
  });
});

describe('undo and redo', () => {
  // An edit in SRV, made while the Editor showed SRV; then the player went back to Ship.
  const before = keysScheme();
  const after = assign(
    before,
    { mode: 'srv', control: 'L.ring_1', press: 'tap' },
    'lights',
    liteRequired,
  );

  it('reveal the mode and the control the edit they undo changed', () => {
    const history = undo(commit(startHistory(before), after));
    expect(editedLocation(after, history.present)).toEqual({
      mode: 'srv',
      control: 'L.ring_1',
      press: 'tap',
    });
  });

  it('and so does redo', () => {
    const history = redo(undo(commit(startHistory(before), after)));
    expect(editedLocation(before, history.present)).toEqual({
      mode: 'srv',
      control: 'L.ring_1',
      press: 'tap',
    });
  });

  it('reveal nothing for an edit outside the map: the next edit stays where the player is', () => {
    expect(editedLocation(before, { ...before, name: 'Renamed' })).toBeUndefined();
  });
});
