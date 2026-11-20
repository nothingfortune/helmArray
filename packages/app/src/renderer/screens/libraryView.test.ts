import { describe, expect, it } from 'vitest';
import { entry } from './libraryFixtures';
import {
  chosenScheme,
  currentCard,
  defaultChoices,
  filterEntries,
  statusLine,
  summary,
} from './libraryView';

const XBOX = { id: 'hd2-xbox', name: 'Xbox controller', output: 'pad' as const };
const KEYS = { id: 'hd2-keys', name: "Game's own keys", output: 'keys' as const };

describe('the status line', () => {
  it('says plainly that a game helmArray has no definition for is not supported yet', () => {
    expect(statusLine(entry({ gameId: null, appId: '1', nativeKeys: false }), null)).toEqual({
      text: 'Not supported yet',
      tone: 'unsupported',
    });
  });

  it('says a known game with no scheme is not set up', () => {
    expect(statusLine(entry(), null)).toEqual({ text: 'Not set up', tone: 'plain' });
  });

  it("names the game's scheme", () => {
    expect(statusLine(entry({ schemes: [XBOX], activeSchemeId: XBOX.id }), null)).toEqual({
      text: 'Xbox controller',
      tone: 'plain',
    });
  });

  it("counts the schemes when there are several, naming the game's own active one", () => {
    const line = statusLine(entry({ schemes: [XBOX, KEYS], activeSchemeId: KEYS.id }), null);
    expect(line.text).toBe("Game's own keys · 2 schemes");
  });

  it('marks the current game, and never claims it is on the units or ready', () => {
    const line = statusLine(entry({ schemes: [XBOX], activeSchemeId: XBOX.id }), {
      activeGameId: 'helldivers2',
    });
    expect(line).toEqual({ text: 'Current · Xbox controller', tone: 'current' });
    for (const bad of ['units', 'Ready', 'sync'])
      expect(line.text.toLowerCase()).not.toContain(bad.toLowerCase());
  });

  it('does not mark another game as current', () => {
    const line = statusLine(entry({ schemes: [XBOX] }), { activeGameId: 'other' });
    expect(line.tone).toBe('plain');
  });

  it('opens the first scheme when the game has none active', () => {
    expect(chosenScheme(entry({ schemes: [XBOX, KEYS] }))).toBe(XBOX);
    expect(chosenScheme(entry())).toBeNull();
  });
});

describe('the defaults offered', () => {
  it('is Xbox controller alone for a game with no keys of its own', () => {
    expect(defaultChoices(entry({ nativeKeys: false }))).toEqual([
      { preset: 'xbox', label: 'Xbox controller' },
    ]);
  });

  it("adds the game's own keys when the game has them", () => {
    expect(defaultChoices(entry()).map((c) => [c.preset, c.label])).toEqual([
      ['xbox', 'Xbox controller'],
      ['keys', "Game's own keys"],
    ]);
  });
});

describe('searching and counting', () => {
  const all = [
    entry(),
    entry({ name: 'Everspace 2', appId: '1', gameId: null, nativeKeys: false }),
  ];

  it('keeps every game for an empty search and matches names in any case', () => {
    expect(filterEntries(all, '  ')).toHaveLength(2);
    expect(filterEntries(all, 'EVER').map((e) => e.name)).toEqual(['Everspace 2']);
    expect(filterEntries(all, 'zzz')).toEqual([]);
  });

  it('counts the games with a scheme', () => {
    expect(summary(all)).toBe('From Steam · 0 with a scheme');
    expect(summary([entry({ schemes: [XBOX] }), ...all])).toBe('From Steam · 1 with a scheme');
  });
});

describe('the card of what is current', () => {
  const entries = [entry({ schemes: [XBOX, KEYS], activeSchemeId: KEYS.id })];

  it('has nothing without an active game, or when the game is not in the library', () => {
    expect(currentCard(entries, null)).toBeNull();
    expect(currentCard(entries, { activeGameId: null })).toBeNull();
    expect(currentCard(entries, { activeGameId: 'gone' })).toBeNull();
  });

  it('shows the active game and its active scheme', () => {
    const card = currentCard(entries, { activeGameId: 'helldivers2' });
    expect(card?.scheme).toBe(KEYS);
    expect(card?.detail).toBe('Keys');
    expect(currentCard([entry({ schemes: [XBOX] })], { activeGameId: 'helldivers2' })?.detail).toBe(
      'Controller buttons',
    );
  });

  it('says what to do when the active game has no scheme', () => {
    const card = currentCard([entry()], { activeGameId: 'helldivers2' });
    expect(card?.scheme).toBeNull();
    expect(card?.detail).toBe('No scheme yet. Pick a default below.');
  });
});
