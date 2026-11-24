import { describe, expect, it } from 'vitest';
import { AZERONS_ONLY } from './model';
import type { UnitProfile } from './plan';
import { NOTHING_HELD, recordApply } from './plan';

const profile = (hand: 'left' | 'right'): UnitProfile => ({
  deviceId: 'cyborg2',
  hand,
  pins: [],
  stick: { mode: 'keys', angle: 0, invertX: false },
});
const who = (schemeId: string, at: number) => ({
  schemeId,
  gameId: 'g',
  schemeName: schemeId,
  devices: { ...AZERONS_ONLY },
  output: 'pad' as const,
  at,
});
const both = { units: { left: profile('left'), right: profile('right') } };
const left = { units: { left: profile('left') } };

describe('what the units hold after an apply', () => {
  it('is the scheme, on each unit that came out holding it', () => {
    const held = recordApply(
      NOTHING_HELD,
      both,
      [
        { hand: 'left', status: 'applied' },
        { hand: 'right', status: 'unchanged' },
      ],
      who('a', 1),
    );
    expect([held.left?.schemeId, held.right?.schemeId, held.left?.profile]).toEqual([
      'a',
      'a',
      profile('left'),
    ]);
  });

  it('keeps the right unit’s last write when only the left one is written', () => {
    const first = recordApply(
      NOTHING_HELD,
      both,
      [
        { hand: 'left', status: 'applied' },
        { hand: 'right', status: 'applied' },
      ],
      who('a', 1),
    );
    const held = recordApply(first, left, [{ hand: 'left', status: 'applied' }], who('b', 2));
    expect([held.left?.schemeId, held.right?.schemeId]).toEqual(['b', 'a']);
  });

  it('keeps both for a setup with no Azeron, and a unit that failed or was never tried', () => {
    const first = recordApply(
      NOTHING_HELD,
      both,
      [
        { hand: 'left', status: 'applied' },
        { hand: 'right', status: 'applied' },
      ],
      who('a', 1),
    );
    const none = recordApply(first, { units: {} }, [], who('k', 2));
    const failed = recordApply(
      first,
      both,
      [
        { hand: 'left', status: 'failed' },
        { hand: 'right', status: 'not-attempted' },
      ],
      who('c', 3),
    );
    expect([none, failed]).toEqual([first, first]);
  });
});
