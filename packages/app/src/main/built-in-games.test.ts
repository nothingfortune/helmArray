import { describe, expect, it } from 'vitest';
import { BUILT_IN_GAMES } from './built-in-games';

describe('the built-in games', () => {
  it('ship Helldivers 2, the M4 test game', () => {
    expect(BUILT_IN_GAMES.map((g) => g.id)).toContain('helldivers2');
  });

  it('have one entry per id', () => {
    const ids = BUILT_IN_GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
