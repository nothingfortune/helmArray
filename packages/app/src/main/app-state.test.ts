import { describe, expect, it } from 'vitest';
import {
  FakeUnit,
  UnitSession,
  encodeRecord,
  storedFromWritten,
  unitRecords,
} from '@helmarray/azeron';
import {
  AZERONS_ONLY,
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  gameKeysPreset,
  helldivers2,
  resolve,
  unitOf,
  xboxControllerPreset,
} from '@helmarray/core';
import type { UnitProfile, UnitWrite } from '@helmarray/core';
import type { HeldUnit } from './apply-units';
import { composeAppState, holdsOf, pendingAsk } from './app-state';
import type { DevicesSnapshot, UnitSnapshot } from './devices';
import { handsFor } from './hands';
import type { HandStore } from './hands';

const LEFT = 49229;
const RIGHT = 29993;

const unit = (path: string, id: number | null, over: Partial<UnitSnapshot> = {}): UnitSnapshot => ({
  path,
  state: 'ready',
  ...(id !== null && {
    identity: { firmware: 112, deviceId: id, slotLimit: 8, runningSlot: 1 },
  }),
  ...over,
});

const known = (pairs: Record<number, 'left' | 'right'>): Pick<HandStore, 'get'> => ({
  get: (id) => pairs[id],
});

function compose(
  units: UnitSnapshot[],
  pairs: Record<number, 'left' | 'right'> = {},
  writeBlock: string | null = null,
) {
  const devices: DevicesSnapshot = { units };
  const ids = units.flatMap((u) => (u.identity ? [u.identity.deviceId] : []));
  return composeAppState({ devices, hands: handsFor(ids, known(pairs)), writeBlock });
}

describe('the app state', () => {
  it('has no chips and says the units are not connected when nothing is plugged in', () => {
    expect(compose([])).toEqual({
      devices: [],
      sync: { label: 'Units not connected', tone: 'warning' },
      writeBlock: null,
      question: null,
      activeGameId: null,
      activeSchemeId: null,
      onUnits: { left: null, right: null },
    });
  });

  it('carries the active game and scheme it is given', () => {
    const state = composeAppState({
      devices: { units: [] },
      hands: handsFor([], known({})),
      writeBlock: null,
      active: { gameId: 'everspace2', schemeId: 'everspace2-xbox-1' },
    });
    expect([state.activeGameId, state.activeSchemeId]).toEqual(['everspace2', 'everspace2-xbox-1']);
  });

  it('shows left then right, whatever order the units were found in', () => {
    const state = compose([unit('b', RIGHT), unit('a', LEFT)], {
      [LEFT]: 'left',
      [RIGHT]: 'right',
    });
    expect(state.devices.map((chip) => [chip.hand, chip.unitId])).toEqual([
      ['left', LEFT],
      ['right', RIGHT],
    ]);
  });

  it('puts units not yet placed after the hands', () => {
    const state = compose(
      [unit('x', null, { state: 'connecting' }), unit('b', RIGHT), unit('a', LEFT)],
      { [LEFT]: 'left', [RIGHT]: 'right' },
    );
    expect(state.devices.map((chip) => chip.hand)).toEqual(['left', 'right', 'unknown']);
  });

  it('carries each chip its unit id, state and firmware', () => {
    const state = compose([unit('a', LEFT)], { [LEFT]: 'left' });
    expect(state.devices[0]).toEqual({
      hand: 'left',
      unitId: LEFT,
      state: 'ready',
      firmware: 112,
      error: null,
      read: false, // this unit was handed over with no slots read
      running: null,
    });
  });

  it('says whether a unit is read, and the slot it runs, and nothing of readAt', () => {
    const read = (running: number, readAt: number) =>
      unit('a', LEFT, {
        slots: [],
        readAt,
        identity: { firmware: 112, deviceId: LEFT, slotLimit: 8, runningSlot: running },
      });
    const chip = compose([read(2, 1000)], { [LEFT]: 'left' }).devices[0];
    expect(chip).toMatchObject({ read: true, running: 2 });
    // A unit asked again with the same answer is the same state: nothing is told to a window.
    expect(compose([read(2, 4000)], { [LEFT]: 'left' })).toEqual(
      compose([read(2, 1000)], { [LEFT]: 'left' }),
    );
    expect(compose([read(3, 1000)], { [LEFT]: 'left' }).devices[0]?.running).toBe(3);
    // Given up (no slots): not read, and the slot it ran is not claimed.
    const unread = unit('a', LEFT, {
      identity: { firmware: 112, deviceId: LEFT, slotLimit: 8, runningSlot: 2 },
    });
    expect(compose([unread], { [LEFT]: 'left' }).devices[0]).toMatchObject({
      read: false,
      running: null,
    });
  });

  it('knows nothing of a unit that has not answered yet', () => {
    const state = compose([unit('a', null, { state: 'connecting' })]);
    expect(state.devices[0]).toEqual({
      hand: 'unknown',
      unitId: null,
      state: 'connecting',
      firmware: null,
      error: null,
      read: false,
      running: null,
    });
  });

  it('maps a failed unit’s error text through', () => {
    const state = compose([
      unit('a', null, {
        state: 'failed',
        error: 'This unit runs firmware 99; helmArray knows 111 and 112.',
      }),
    ]);
    expect(state.devices[0]).toMatchObject({
      state: 'failed',
      error: 'This unit runs firmware 99; helmArray knows 111 and 112.',
      unitId: null,
      firmware: null,
    });
  });

  it('keeps the hand of a unit that identified itself and then failed to read its slots', () => {
    const state = compose([unit('a', LEFT, { state: 'failed', error: 'no answer' })], {
      [LEFT]: 'left',
    });
    expect(state.devices[0]).toMatchObject({ hand: 'left', state: 'failed', error: 'no answer' });
  });

  it('gives the other unit the opposite hand, and asks nothing', () => {
    const state = compose([unit('a', LEFT), unit('b', RIGHT)], { [LEFT]: 'left' });
    expect(state.devices.map((chip) => chip.hand)).toEqual(['left', 'right']);
    expect(state.question).toBeNull();
  });

  it('asks for the left unit to be unplugged when two new units are plugged in', () => {
    const state = compose([unit('a', LEFT), unit('b', RIGHT)]);
    expect(state.devices.map((chip) => chip.hand)).toEqual(['unknown', 'unknown']);
    expect(state.question).toEqual({
      kind: 'press',
      prompt: 'Unplug your left Azeron for a moment, then plug it back in.',
    });
  });

  it('asks a single new unit outright, naming it', () => {
    const state = compose([unit('a', RIGHT)]);
    expect(state.question).toEqual({
      kind: 'choose',
      unitId: RIGHT,
      prompt: 'Is this your left or right Azeron?',
    });
  });

  it('asks nothing while a unit is still connecting', () => {
    const connecting = [
      unit('a', LEFT, { state: 'connecting' }),
      unit('b', null, { state: 'connecting' }),
    ];
    expect(compose(connecting).question).toBeNull();
    const hands = handsFor([LEFT], known({}));
    expect(pendingAsk({ units: connecting }, hands)).toBeNull();
    expect(pendingAsk({ units: [unit('a', LEFT)] }, hands)).toEqual(hands.ask);
  });

  it('passes the write block through', () => {
    const reason = 'Close the Azeron app first: it talks to the units too.';
    expect(compose([], {}, reason).writeBlock).toBe(reason);
  });

  describe('the sync pill', () => {
    it('says it has not checked, with both units there: nothing is applied until M4', () => {
      const state = compose([unit('a', LEFT), unit('b', RIGHT)], {
        [LEFT]: 'left',
        [RIGHT]: 'right',
      });
      expect(state.sync).toEqual({ label: 'Not checked yet', tone: 'warning' });
    });

    it('never says In sync, whatever is plugged in', () => {
      const pairs = { [LEFT]: 'left', [RIGHT]: 'right' } as const;
      for (const units of [
        [],
        [unit('a', LEFT)],
        [unit('b', RIGHT)],
        [unit('a', LEFT), unit('b', RIGHT)],
      ]) {
        expect(compose(units, pairs).sync.label).not.toBe('In sync');
      }
    });

    it('names the hand that is missing', () => {
      const state = compose([unit('a', LEFT)], { [LEFT]: 'left' });
      expect(state.sync).toEqual({ label: 'Right unit not connected', tone: 'warning' });
    });
  });
});

describe('what a unit holds', () => {
  const profile = (scheme = xboxControllerPreset(helldivers2)): UnitProfile =>
    unitOf(resolve(scheme, helldivers2, BUILT_IN_DEVICES), 'left');
  const write = (p: UnitProfile): UnitWrite => ({
    schemeId: 'hd2-xbox',
    gameId: 'helldivers2',
    schemeName: 'Xbox controller',
    devices: { ...AZERONS_ONLY },
    output: 'pad',
    at: 7,
    profile: p,
  });
  /** The left unit as a real read of it says, running slot 1 with `p` written in it. */
  async function running(p: UnitProfile): Promise<HeldUnit> {
    const records = unitRecords(p, CYBORG2_LEFT).map((r) => storedFromWritten(encodeRecord(1, r)));
    const session = new UnitSession(
      new FakeUnit({ deviceId: LEFT, slots: { 1: { name: 'Main', records } }, running: 1 }),
    );
    const identity = await session.identify();
    return {
      deviceId: LEFT,
      running: 1,
      slotLimit: identity.slotLimit,
      slots: await session.readSlots(),
    };
  }

  it('is its last write, held, when the unit read runs that layout', async () => {
    expect(holdsOf(write(profile()), await running(profile()))).toEqual({
      schemeId: 'hd2-xbox',
      gameId: 'helldivers2',
      schemeName: 'Xbox controller',
      devices: AZERONS_ONLY,
      output: 'pad',
      at: 7,
      check: 'holds',
    });
  });

  it('differs when the unit read runs something else', async () => {
    const other = profile({
      ...gameKeysPreset(helldivers2),
      map: { default: { 'L.index_1': { tap: 'reload' } } },
    });
    expect(holdsOf(write(profile()), await running(other))?.check).toBe('differs');
  });

  it('is unknown, the last write only, for a unit not read; nothing for one never written', async () => {
    expect([
      holdsOf(write(profile()), undefined)?.check,
      holdsOf(null, await running(profile())),
    ]).toEqual(['unknown', null]);
  });

  it('goes into the state for each hand from the record handed in', () => {
    const state = composeAppState({
      devices: { units: [] },
      hands: handsFor([], known({})),
      writeBlock: null,
      held: { left: write(profile()), right: null },
    });
    expect([state.onUnits.left?.check, state.onUnits.right]).toEqual(['unknown', null]);
  });
});
