// The Azeron app open blocks only what it blocks: the units the active setup uses. For every
// setup (both Azerons, the left one, none) with the keyboard or the controller, the Azeron app
// open or closed, and the scheme as applied or edited since, the pill, the band under the header
// and the Editor's Apply button say what is true of that setup.

import { describe, expect, it } from 'vitest';
import type { Hand, Plan, Scheme, SetupDevices } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  blankKeysScheme,
  helldivers2,
  resolve,
  unitOf,
} from '@helmarray/core';
import {
  FakeUnit,
  UnitSession,
  encodeRecord,
  storedFromWritten,
  unitRecords,
} from '@helmarray/azeron';
import { composeAppState } from '../../packages/app/src/main/app-state';
import type { UnitSnapshot } from '../../packages/app/src/main/devices';
import { handsFor } from '../../packages/app/src/main/hands';
import { applyButton } from '../../packages/app/src/renderer/apply/applyButton';

const LEFT = 49229;
const RIGHT = 29993;
const DEVICE = { left: CYBORG2_LEFT, right: CYBORG2_RIGHT } as const;
const IDS = { left: LEFT, right: RIGHT } as const;
const KNOWN = { get: (id: number) => (id === LEFT ? ('left' as const) : ('right' as const)) };
const BLOCK = 'Close the Azeron app first: it talks to the units too.';
const game = helldivers2;
const planOf = (scheme: Scheme): Plan => resolve(scheme, game, BUILT_IN_DEVICES);

/** A setup of Helldivers 2 from the game's own keys, playing with these devices. */
const setup = (azerons: SetupDevices['azerons'], other: 'keyboard' | 'controller'): Scheme => ({
  ...blankKeysScheme(game),
  devices: {
    azerons,
    keyboard: other === 'keyboard',
    mouse: other === 'keyboard' || azerons === 'left',
    controller: other === 'controller',
  },
});

/** One edit the game is told about: Jump on a key, or on a controller button, it doesn't ship. */
const edited = (scheme: Scheme, other: 'keyboard' | 'controller'): Scheme => ({
  ...scheme,
  map: {
    ...scheme.map,
    default: {
      ...scheme.map['default'],
      ...(other === 'keyboard' ? { 'key.J': { tap: 'jump' } } : { 'pad.Y': { tap: 'jump' } }),
    },
  },
});

/** A unit as the devices service lists it: read and holding `plan`'s half, or paused. */
async function unit(hand: Hand, plan: Plan, paused: boolean): Promise<UnitSnapshot> {
  const records = plan.units[hand]
    ? unitRecords(unitOf(plan, hand), DEVICE[hand]).map((r) =>
        storedFromWritten(encodeRecord(1, r)),
      )
    : [];
  const session = new UnitSession(
    new FakeUnit({ deviceId: IDS[hand], slots: { 1: { name: 'Main', records } }, running: 1 }),
  );
  const identity = await session.identify();
  if (paused) return { path: hand, state: 'paused', identity };
  return { path: hand, state: 'ready', identity, slots: await session.readSlots() };
}

const CASES = (['both', 'left', 'none'] as const).flatMap((azerons) =>
  (['keyboard', 'controller'] as const).flatMap((other) =>
    ([true, false] as const).flatMap((open) =>
      (['applied', 'edited'] as const).map((state) => ({ azerons, other, open, state })),
    ),
  ),
);

/** What is true: the Azeron app blocks only a setup with an Azeron in it. */
function expected(c: (typeof CASES)[number]) {
  const blocked = c.open && c.azerons !== 'none';
  if (blocked) {
    return {
      pill: 'Azeron app is open',
      band: true,
      button: c.state === 'edited' ? 'Apply 1' : 'Apply',
    };
  }
  return c.state === 'edited'
    ? { pill: '1 change not applied', band: false, button: 'Apply 1' }
    : { pill: 'In sync', band: false, button: 'Applied' };
}

describe('what the Azeron app being open blocks, setup by setup', () => {
  it.each(CASES)('$azerons Azerons + $other, Azeron app open: $open, $state', async (c) => {
    const scheme = setup(c.azerons, c.other);
    const applied = planOf(scheme);
    const current = planOf(c.state === 'edited' ? edited(scheme, c.other) : scheme);
    const units = [await unit('left', applied, c.open), await unit('right', applied, c.open)];
    const state = composeAppState({
      devices: { units },
      hands: handsFor([LEFT, RIGHT], KNOWN),
      writeBlock: c.open ? BLOCK : null,
      active: { gameId: game.id, schemeId: scheme.id },
      plans: { active: true, applied, current },
    });
    expect({
      pill: state.sync.label,
      band: state.sync.paused === true,
      button: applyButton(state, scheme.id).label,
    }).toEqual(expected(c));
  });
});
