import { describe, expect, it } from 'vitest';
import { entry } from './libraryFixtures';
import { gameTarget, needsSetUp } from './gameTile';

describe('needsSetUp', () => {
  it('is true for a Steam game helmArray doesn’t know', () => {
    expect(needsSetUp(entry({ gameId: null, actionCount: 0 }))).toBe(true);
  });

  it('is true for a game added and not given an action yet: a scheme of it would hold nothing', () => {
    expect(needsSetUp(entry({ gameId: 'rover', actionCount: 0 }))).toBe(true);
  });

  it('is false for a game with no actions left but schemes: they stay reachable from the tile', () => {
    const scheme = { id: 'rover-keys', name: "Game's own keys", output: 'keys' as const };
    expect(
      needsSetUp(
        entry({
          gameId: 'rover',
          actionCount: 0,
          schemes: [
            {
              ...scheme,
              devices: { azerons: 'both', keyboard: false, mouse: false, controller: false },
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('is false for a game with actions', () => {
    expect(needsSetUp(entry({ gameId: 'helldivers2', actionCount: 30 }))).toBe(false);
  });
});

describe('gameTarget', () => {
  it('makes a new game of a Steam game helmArray doesn’t know, with its name and app id', () => {
    expect(gameTarget(entry({ gameId: null, name: 'Everspace 2', appId: '1128920' }))).toEqual({
      kind: 'new',
      name: 'Everspace 2',
      steamAppId: 1128920,
    });
  });

  it("carries the sentence saying why the game's own file couldn't be used", () => {
    const note = "Everspace 2's controls file has nothing helmArray can read.";
    expect(
      gameTarget(entry({ gameId: null, name: 'Everspace 2', appId: '1128920', fileNote: note })),
    ).toEqual({ kind: 'new', name: 'Everspace 2', steamAppId: 1128920, note });
  });

  it('opens the game helmArray knows', () => {
    expect(gameTarget(entry({ gameId: 'helldivers2' }))).toEqual({
      kind: 'edit',
      gameId: 'helldivers2',
    });
  });

  it('leaves the app id out when Steam’s is not a whole number', () => {
    expect(gameTarget(entry({ gameId: null, name: 'Odd', appId: 'abc' }))).toEqual({
      kind: 'new',
      name: 'Odd',
    });
  });
});
