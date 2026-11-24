import { describe, expect, it } from 'vitest';
import { helldivers2 } from './games/helldivers2';
import { stickForOutput, stickKeysOf } from './sticks';

const key = (code: 'W' | 'A' | 'S' | 'D') => ({ kind: 'key' as const, code });

describe('stickForOutput', () => {
  it('is its hand’s Xbox stick for a controller, the tuning kept', () => {
    expect([
      stickForOutput('left', { mode: 'keys', deadzone: 12 }, 'pad', helldivers2),
      stickForOutput('right', undefined, 'pad', helldivers2),
    ]).toEqual([{ mode: 'pad-left', deadzone: 12 }, { mode: 'pad-right' }]);
  });

  it('sends the keys the game ships for its directions, with keys', () => {
    expect(stickForOutput('left', { mode: 'pad-left' }, 'keys', helldivers2)).toEqual({
      mode: 'keys',
      directions: { up: key('W'), down: key('S'), left: key('A'), right: key('D') },
    });
  });

  it('moves the mouse when the game ships no keys for its directions', () => {
    expect([
      stickKeysOf(helldivers2, 'right'),
      stickForOutput('right', undefined, 'keys', helldivers2),
    ]).toEqual([{}, { mode: 'mouse' }]);
  });
});
