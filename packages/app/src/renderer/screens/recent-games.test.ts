import { describe, expect, it } from 'vitest';
import type { LibrarySchemeRef } from '../../shared/api';
import { entry } from './libraryFixtures';
import { RECENT_LIMIT, recentGames } from './recent-games';

const scheme = (id: string): LibrarySchemeRef => ({
  id,
  name: id,
  output: 'pad',
  devices: { azerons: 'both', keyboard: false, mouse: false, controller: false },
});

const game = (gameId: string, name: string, at?: number, active?: string) =>
  entry({
    gameId,
    name,
    schemes: [scheme(`${gameId}-a`), scheme(`${gameId}-b`)],
    activeSchemeId: active ?? null,
    applied: at === undefined ? null : { schemeId: `${gameId}-a`, at, changes: 0 },
  });

describe('recentGames', () => {
  it('leaves out the game open, a game with no scheme and one helmArray doesn’t know', () => {
    const list = recentGames(
      [
        game('open', 'Open'),
        entry({ gameId: 'bare', name: 'Bare', schemes: [] }),
        entry({ gameId: null, name: 'Unknown' }),
        game('other', 'Other'),
      ],
      'open',
    );
    expect(list.map((g) => g.gameId)).toEqual(['other']);
  });

  it('puts the one applied last first, then the others applied, then the rest by name', () => {
    const list = recentGames(
      [game('z', 'Zed'), game('old', 'Old', 100), game('a', 'Ace'), game('new', 'New', 200)],
      'none',
      10,
    );
    expect(list.map((g) => g.gameId)).toEqual(['new', 'old', 'a', 'z']);
  });

  it('opens what the Library tile opens: the active scheme, else the first', () => {
    expect(
      recentGames([game('x', 'X', undefined, 'x-b'), game('y', 'Y')], 'none').map(
        (g) => g.schemeId,
      ),
    ).toEqual(['x-b', 'y-a']);
  });

  it('shows a few at most', () => {
    const many = Array.from({ length: 6 }, (_, i) => game(`g${i}`, `Game ${i}`));
    expect(recentGames(many, 'none')).toHaveLength(RECENT_LIMIT);
  });
});
