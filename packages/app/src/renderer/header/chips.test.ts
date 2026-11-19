import { describe, expect, it } from 'vitest';
import type { DeviceChip } from '../../shared/api';
import { chipView, chipViews } from './chips';

const chip = (over: Partial<DeviceChip> = {}): DeviceChip => ({
  hand: 'left',
  unitId: 49229,
  state: 'ready',
  firmware: 3,
  error: null,
  ...over,
});

describe('chipView', () => {
  it('names the chip by hand, and Azeron when the hand is not known', () => {
    expect(chipView(chip({ hand: 'left' }), 0).label).toBe('Left');
    expect(chipView(chip({ hand: 'right' }), 0).label).toBe('Right');
    expect(chipView(chip({ hand: 'unknown' }), 0).label).toBe('Azeron');
  });

  it('colours the dot by state: ready ok, connecting warning, failed error', () => {
    expect(chipView(chip({ state: 'ready' }), 0).tone).toBe('ok');
    expect(chipView(chip({ state: 'connecting' }), 0).tone).toBe('warning');
    expect(chipView(chip({ state: 'failed', error: 'x' }), 0).tone).toBe('error');
  });

  it('says the state in words as well as colour', () => {
    expect(chipView(chip({ state: 'ready' }), 0).statusWord).toBe('ready');
    expect(chipView(chip({ state: 'connecting' }), 0).statusWord).toBe('connecting');
    expect(chipView(chip({ state: 'failed', error: 'x' }), 0).statusWord).toBe('failed');
  });

  it('puts the error sentence in the tooltip of a failed unit only', () => {
    const failed = chip({ state: 'failed', error: 'The unit stopped answering.' });
    expect(chipView(failed, 0).tooltip).toBe('The unit stopped answering.');
    expect(chipView(chip({ state: 'ready', error: 'old' }), 0).tooltip).toBeNull();
    expect(chipView(chip({ state: 'connecting' }), 0).tooltip).toBeNull();
  });

  it('still explains a failure that arrived without a sentence', () => {
    expect(chipView(chip({ state: 'failed', error: null }), 0).tooltip).toBe(
      'This unit did not answer.',
    );
  });

  it('keys a chip by its unit, or by its place when the unit has no id', () => {
    expect(chipView(chip({ unitId: 7 }), 3).key).toBe('unit-7');
    expect(chipView(chip({ unitId: null }), 3).key).toBe('slot-3');
  });
});

describe('chipViews', () => {
  it('draws one chip per unit plugged in, in the order sent, and none for no units', () => {
    expect(chipViews([])).toEqual([]);
    const views = chipViews([
      chip({ hand: 'left', unitId: 1 }),
      chip({ hand: 'unknown', unitId: 2, state: 'connecting' }),
    ]);
    expect(views.map((view) => view.label)).toEqual(['Left', 'Azeron']);
    expect(new Set(views.map((view) => view.key)).size).toBe(2);
  });
});
