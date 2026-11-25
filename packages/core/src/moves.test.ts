import { describe, expect, it } from 'vitest';
import type { ActionMove } from './harvest';
import { moveInBaselines, moveInPlan, moveInScheme } from './moves';
import type { Scheme, Signal } from './model';
import type { Baselines } from './sheets';
import type { GameBinding, Plan } from './plan';

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;

/** Boost, typed in under `default`, is the file's `Boost` in `flight` now. */
const BOOST: ActionMove = { action: 'boost', mode: 'default', to: 'Boost', toMode: 'flight' };
/** Fire, typed in under `flight`, is the file's `Fire` in the same mode. */
const FIRE: ActionMove = { action: 'fire', mode: 'flight', to: 'Fire', toMode: 'flight' };

const scheme = (over: Partial<Scheme> = {}): Scheme => ({
  id: 's',
  gameId: 'es2',
  name: 'Keys',
  devices: { azerons: 'both', keyboard: false, mouse: false, controller: false },
  output: 'keys',
  padMap: {},
  writeGameFile: true,
  map: {
    default: { 'L.1': { tap: 'boost', long: 'wave' }, 'L.2': { tap: 'boost' } },
    flight: { 'R.1': { tap: 'fire' } },
  },
  behaviour: {},
  ledger: { 'L.1': { tap: key('F13') } },
  accepted: [
    { rule: 'required-unplaced', action: 'boost', reason: 'mine' },
    { rule: 'stick', control: 'L.1', reason: 'mine' },
  ],
  ...over,
});

describe('moveInScheme', () => {
  it("moves each placement of a moved action to the file's id and mode, leaving the rest", () => {
    expect(moveInScheme(scheme(), [BOOST]).map).toEqual({
      default: { 'L.1': { long: 'wave' } },
      flight: { 'R.1': { tap: 'fire' }, 'L.1': { tap: 'Boost' }, 'L.2': { tap: 'Boost' } },
    });
  });

  it('renames in place an action that keeps its mode', () => {
    expect(moveInScheme(scheme(), [FIRE]).map['flight']).toEqual({ 'R.1': { tap: 'Fire' } });
  });

  it('drops a control and a mode the moves leave empty', () => {
    const only = scheme({ map: { default: { 'L.2': { tap: 'boost' } } } });
    expect(moveInScheme(only, [BOOST]).map).toEqual({ flight: { 'L.2': { tap: 'Boost' } } });
  });

  it("keeps what is already on the press it would move to: the moved one isn't placed there", () => {
    const taken = scheme({
      map: { default: { 'L.1': { tap: 'boost' } }, flight: { 'L.1': { tap: 'fire' } } },
    });
    expect(moveInScheme(taken, [BOOST]).map).toEqual({ flight: { 'L.1': { tap: 'fire' } } });
  });

  it('gives a press two moved actions would share to the first', () => {
    const two = scheme({
      map: { default: { 'L.1': { tap: 'boost' } }, spare: { 'L.1': { tap: 'warp' } } },
    });
    const warp: ActionMove = { action: 'warp', mode: 'spare', to: 'Warp', toMode: 'flight' };
    expect(moveInScheme(two, [BOOST, warp]).map).toEqual({ flight: { 'L.1': { tap: 'Boost' } } });
  });

  it("moves a placement under a mode other than the action's own by id only", () => {
    const elsewhere = scheme({ map: { spare: { 'L.1': { tap: 'boost' } } } });
    expect(moveInScheme(elsewhere, [BOOST]).map).toEqual({ spare: { 'L.1': { tap: 'Boost' } } });
  });

  it('renames the findings you kept about a moved action', () => {
    expect(moveInScheme(scheme(), [BOOST]).accepted).toEqual([
      { rule: 'required-unplaced', action: 'Boost', reason: 'mine' },
      { rule: 'stick', control: 'L.1', reason: 'mine' },
    ]);
  });

  it('moves a key label with the action when nothing is left on that control in its mode', () => {
    const labelled = scheme({ keyLabels: { default: { 'L.1': 'WV', 'L.2': 'BST' } } });
    expect(moveInScheme(labelled, [BOOST]).keyLabels).toEqual({
      default: { 'L.1': 'WV' },
      flight: { 'L.2': 'BST' },
    });
  });

  it("keeps a label where the moved action's new control already has one", () => {
    const labelled = scheme({
      map: { default: { 'L.2': { tap: 'boost' } }, flight: {} },
      keyLabels: { default: { 'L.2': 'BST' }, flight: { 'L.2': 'OLD' } },
    });
    expect(moveInScheme(labelled, [BOOST]).keyLabels).toEqual({ flight: { 'L.2': 'OLD' } });
  });

  it('leaves the ledger alone: it is per control and press, and names no action', () => {
    expect(moveInScheme(scheme(), [BOOST]).ledger).toEqual(scheme().ledger);
  });

  it('gives back the very scheme when no move names anything in it', () => {
    const s = scheme();
    const other: ActionMove = { action: 'nope', mode: 'default', to: 'Nope', toMode: 'flight' };
    expect(moveInScheme(s, [other])).toBe(s);
  });

  it('keeps a mode or a control named __proto__ as an ordinary key', () => {
    const odd = scheme({
      map: JSON.parse(
        '{"__proto__": {"__proto__": {"tap": "wave"}}, "default": {"L.1": {"tap": "boost"}}}',
      ) as Scheme['map'],
      keyLabels: JSON.parse('{"__proto__": {"__proto__": "W"}}') as NonNullable<
        Scheme['keyLabels']
      >,
    });
    const moved = moveInScheme(odd, [BOOST]);
    expect([
      Object.hasOwn(moved.map, '__proto__'),
      JSON.stringify(moved.map),
      JSON.stringify(moved.keyLabels),
    ]).toEqual([
      true,
      '{"__proto__":{"__proto__":{"tap":"wave"}},"flight":{"L.1":{"tap":"Boost"}}}',
      '{"__proto__":{"__proto__":"W"}}',
    ]);
  });

  it('changes nothing more the second time', () => {
    const once = moveInScheme(scheme({ keyLabels: { default: { 'L.2': 'B' } } }), [BOOST, FIRE]);
    expect(moveInScheme(once, [BOOST, FIRE])).toBe(once);
  });
});

const binding = (set: GameBinding['set'], mode: string, action: string): GameBinding => ({
  set,
  mode,
  action,
  signal: key('F13'),
  native: null,
});

const plan = (): Plan => ({
  units: {},
  bindings: [
    { mode: 'default', control: 'L.1', press: 'tap', action: 'boost', signal: key('F13') },
    { mode: 'default', control: 'L.1', press: 'long', action: 'wave', signal: key('F14') },
  ],
  gameBindings: [binding('keyboard', 'default', 'boost'), binding('keyboard', 'default', 'wave')],
  bindSheet: [binding('keyboard', 'default', 'boost')],
  ledger: {},
  findings: [
    { rule: 'r', severity: 'warning', action: 'boost', mode: 'default', message: 'm' },
    { rule: 'r', severity: 'warning', action: 'boost', message: 'm' },
    { rule: 'r', severity: 'error', control: 'L.1', mode: 'default', message: 'm' },
  ],
});

describe('moveInPlan', () => {
  it('moves every binding, game binding, sheet row and finding of a moved action', () => {
    const moved = moveInPlan(plan(), [BOOST]);
    expect([
      moved.bindings.map((b) => `${b.mode}/${b.action}`),
      moved.gameBindings.map((b) => `${b.mode}/${b.action}`),
      moved.bindSheet.map((b) => `${b.mode}/${b.action}`),
      moved.findings.map((f) => `${f.mode ?? '-'}/${f.action ?? '-'}`),
    ]).toEqual([
      ['flight/Boost', 'default/wave'],
      ['flight/Boost', 'default/wave'],
      ['flight/Boost'],
      ['flight/Boost', '-/Boost', 'default/-'],
    ]);
  });

  it("keeps a row's mode when it isn't the action's old one", () => {
    const p = { ...plan(), gameBindings: [binding('controller', 'spare', 'boost')] };
    expect(moveInPlan(p, [BOOST]).gameBindings).toEqual([binding('controller', 'spare', 'Boost')]);
  });

  it('gives back the very plan when no move names anything in it', () => {
    const p = plan();
    expect(moveInPlan(p, [{ action: 'x', mode: 'm', to: 'X', toMode: 'm' }])).toBe(p);
  });
});

describe('moveInBaselines', () => {
  const baselines: Baselines = {
    games: [
      { gameId: 'es2', held: [binding('keyboard', 'default', 'boost')] },
      { gameId: 'other', held: [binding('keyboard', 'default', 'boost')] },
    ],
  };

  it('moves what the game holds, and only that game', () => {
    expect(moveInBaselines(baselines, 'es2', [BOOST])).toEqual({
      games: [
        { gameId: 'es2', held: [binding('keyboard', 'flight', 'Boost')] },
        { gameId: 'other', held: [binding('keyboard', 'default', 'boost')] },
      ],
    });
  });

  it('gives back the very baselines when the game holds nothing a move names', () => {
    expect(moveInBaselines(baselines, 'none', [BOOST])).toBe(baselines);
  });
});
