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
import { editedLocation, findingLocation, navigate, reveal, tabOf } from './reveal';

/** The Editor, as it stands: in Ship, nothing selected, on the Azerons. */
const SHIP: EditorPlace = {
  mode: 'ship',
  selected: undefined,
  press: 'tap',
  tab: 'azerons',
  inspector: false,
  picking: null,
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
      picking: null,
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

describe('transient state belongs to one location: every way of moving clears it', () => {
  // On L index 1 in Ship, the side panel open.
  const ON: EditorPlace = { ...SHIP, selected: 'L.index_1', inspector: true };
  /** The transient states the Editor keeps for the place it shows. */
  const STATES: [string, EditorPlace][] = [
    ['the picker open on the tap', navigate.choose(ON, 'tap')],
    ['the picker open on the long press', navigate.choose(ON, 'long')],
    ['the long press targeted', navigate.target(ON, 'long')],
  ];
  const scheme = keysScheme();
  /** Every kind of move: of control, mode, tab, devices, output, the side panel, undo and redo. */
  const MOVES: [string, (p: EditorPlace) => EditorPlace][] = [
    ['another control selected', (p) => navigate.select(p, 'L.index_2')],
    ['the control clicked again, deselected', (p) => navigate.select(p, 'L.index_1')],
    ['the side panel closed', (p) => navigate.close(p)],
    ['another mode', (p) => navigate.mode(p, 'srv')],
    ['another device tab', (p) => navigate.tab(p, 'keyboard')],
    ['the devices changed', (p) => navigate.devices(p, 'keyboard')],
    [
      'a fix or a finding revealing another control',
      (p) => reveal(p, { control: 'R.index_1' }, scheme),
    ],
    ['a fix revealing another mode', (p) => reveal(p, { mode: 'srv' }, scheme)],
    [
      'undo or redo showing where its edit was',
      (p) => navigate.travel(p, { mode: 'ship', control: 'L.middle_1', press: 'tap' }, scheme),
    ],
  ];
  /** Moves that keep the control but still end the picker: it was for that output, panel, edit. */
  const STAYS: [string, (p: EditorPlace) => EditorPlace][] = [
    ['the Azerons switched to send the controller', (p) => navigate.output(p)],
    ['the side panel hidden', (p) => navigate.inspector(p)],
    [
      'undo or redo of an edit with no control to show',
      (p) => navigate.travel(p, undefined, scheme),
    ],
  ];

  it('each state is there before the move: the table starts from it', () => {
    expect(STATES.map(([, p]) => [p.picking, p.press])).toEqual([
      [{ control: 'L.index_1', press: 'tap' }, 'tap'],
      [{ control: 'L.index_1', press: 'long' }, 'long'],
      [null, 'long'],
    ]);
  });

  it('a move of location clears the picker and the press targeted', () => {
    const faults: string[] = [];
    for (const [state, start] of STATES)
      for (const [move, by] of MOVES) {
        const after = by(start);
        if (after.picking !== null || after.press !== 'tap')
          faults.push(`${state}, then ${move}: ${JSON.stringify([after.picking, after.press])}`);
      }
    expect(faults).toEqual([]);
  });

  it('a move that keeps the control still closes the picker', () => {
    const faults: string[] = [];
    for (const [state, start] of STATES)
      for (const [move, by] of STAYS) {
        const after = by(start);
        if (after.picking !== null) faults.push(`${state}, then ${move}`);
      }
    expect(faults).toEqual([]);
  });

  it('Codex’s sequence: the picker on one control, another selected, the first again: no picker', () => {
    const open = navigate.choose(ON, 'tap');
    const back = navigate.select(navigate.select(open, 'L.index_2'), 'L.index_1');
    expect([back.selected, back.picking, back.press]).toEqual(['L.index_1', null, 'tap']);
  });

  it('a pick reveals the same control and press: the picker is closed by the pick, not the move', () => {
    const open = navigate.choose(ON, 'long');
    const after = reveal(open, { mode: 'ship', control: 'L.index_1', press: 'long' }, scheme);
    expect([after.picking, navigate.pickDone(after).picking]).toEqual([
      { control: 'L.index_1', press: 'long' },
      null,
    ]);
  });

  it('choosing a press with nothing selected does nothing', () => {
    expect(navigate.choose(SHIP, 'tap')).toBe(SHIP);
  });

  it('a control selected opens the side panel; clicked again, it is deselected', () => {
    const shut = { ...SHIP, inspector: false };
    const on = navigate.select(shut, 'L.index_1');
    expect([on.inspector, navigate.select(on, 'L.index_1').selected]).toEqual([true, undefined]);
  });

  it('a device tab gained is shown; none gained keeps the tab', () => {
    expect([navigate.devices(ON, 'keyboard').tab, navigate.devices(ON, undefined).tab]).toEqual([
      'keyboard',
      'azerons',
    ]);
  });

  it('the side panel toggled shows and hides', () => {
    expect([navigate.inspector(ON).inspector, navigate.inspector(SHIP).inspector]).toEqual([
      false,
      true,
    ]);
  });
});
