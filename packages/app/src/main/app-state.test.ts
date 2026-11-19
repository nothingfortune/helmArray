import { describe, expect, it } from 'vitest';
import { composeAppState, pendingAsk } from './app-state';
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
    });
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
