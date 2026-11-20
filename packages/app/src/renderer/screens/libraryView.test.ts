import { describe, expect, it } from 'vitest';
import { entry } from './libraryFixtures';
import { AZERONS_ONLY } from '@helmarray/core';
import type { LibrarySchemeRef } from '../../shared/api';
import {
  chosenScheme,
  currentCard,
  defaultChoices,
  filterEntries,
  setupWords,
  statusLine,
  summary,
} from './libraryView';

const XBOX: LibrarySchemeRef = {
  id: 'hd2-xbox',
  name: 'Xbox controller',
  output: 'pad',
  devices: { ...AZERONS_ONLY },
};
const KEYS: LibrarySchemeRef = {
  id: 'hd2-keys',
  name: "Game's own keys",
  output: 'keys',
  devices: { ...AZERONS_ONLY },
};
const COUCH: LibrarySchemeRef = {
  id: 'hd2-couch',
  name: 'Couch',
  output: 'pad',
  devices: { azerons: 'none', keyboard: false, mouse: false, controller: true },
};
const applied = (schemeId: string, changes = 0, at = 100) => ({ schemeId, at, changes });

describe('what a setup plays with, in a few words', () => {
  const words = (devices: Partial<LibrarySchemeRef['devices']>, output: 'pad' | 'keys' = 'pad') =>
    setupWords({ output, devices: { ...AZERONS_ONLY, ...devices } });

  it('both Azerons: what they send, as the canvas says it', () => {
    expect([words({}), words({}, 'keys'), words({ keyboard: true }, 'keys')]).toEqual([
      'Controller',
      'Keys',
      'Keys',
    ]);
  });

  it('the left Azeron, which always brings the mouse', () => {
    expect(words({ azerons: 'left' })).toBe('Left Azeron + mouse');
  });

  it('no Azeron: the devices themselves', () => {
    expect([
      words({ azerons: 'none', keyboard: true, mouse: true }),
      words({ azerons: 'none', keyboard: true }),
      words({ azerons: 'none', controller: true }),
      words({ azerons: 'none', keyboard: true, mouse: true, controller: true }),
      words({ azerons: 'none', keyboard: true, controller: true }),
      words({ azerons: 'none', mouse: true, controller: true }),
      words({ azerons: 'none', mouse: true }),
      words({ azerons: 'none' }),
    ]).toEqual([
      'Keyboard and mouse',
      'Keyboard',
      'Xbox controller',
      'Keyboard and mouse + controller',
      'Keyboard + controller',
      'Mouse + controller',
      'Mouse',
      'No devices',
    ]);
  });
});

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

  it('a setup applied and unchanged since is Ready, with what it plays with', () => {
    const line = statusLine(entry({ schemes: [XBOX], applied: applied(XBOX.id) }), null);
    expect(line).toEqual({ text: 'Ready · Controller', tone: 'ok' });
  });

  it('a setup changed since it was applied counts the changes', () => {
    expect([
      statusLine(entry({ schemes: [KEYS], applied: applied(KEYS.id, 2) }), null),
      statusLine(entry({ schemes: [KEYS], applied: applied(KEYS.id, 1) }), null).text,
    ]).toEqual([{ text: '2 changes · Keys', tone: 'warning' }, '1 change · Keys']);
  });

  it('the game the Azerons hold now is On the units', () => {
    const e = entry({ schemes: [XBOX], applied: applied(XBOX.id) });
    expect([statusLine(e, 'helldivers2'), statusLine(e, 'other').text]).toEqual([
      { text: 'On the units · Controller', tone: 'units' },
      'Ready · Controller',
    ]);
  });

  it('a setup with no Azeron is never On the units: it wrote nothing to them', () => {
    const e = entry({ schemes: [COUCH], applied: applied(COUCH.id) });
    expect(statusLine(e, 'helldivers2').text).toBe('Ready · Xbox controller');
  });

  it('names the setup when the game has several: the name tells them apart', () => {
    const e = entry({
      schemes: [COUCH, XBOX],
      activeSchemeId: XBOX.id,
      applied: applied(COUCH.id),
    });
    expect(statusLine(e, null).text).toBe('Ready · Couch');
  });

  it('a game never applied names the setup picked, as not applied', () => {
    expect([
      statusLine(entry({ schemes: [XBOX], activeSchemeId: XBOX.id }), null).text,
      statusLine(entry({ schemes: [XBOX, KEYS], activeSchemeId: KEYS.id }), null).text,
    ]).toEqual(['Not applied · Controller', "Not applied · Game's own keys"]);
  });

  it('counts the setups when none is picked and none applied, naming none', () => {
    expect([
      statusLine(entry({ schemes: [XBOX, KEYS] }), null),
      statusLine(entry({ schemes: [XBOX] }), null).text,
    ]).toEqual([{ text: '2 schemes', tone: 'plain' }, '1 scheme']);
  });

  it('an applied setup that is no longer the game’s says nothing about it', () => {
    const e = entry({ schemes: [KEYS], activeSchemeId: KEYS.id, applied: applied('gone') });
    expect(statusLine(e, 'helldivers2').text).toBe('Not applied · Keys');
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
    expect(card?.applied).toBe(false);
    expect(card?.detail).toBe('Not applied yet · Keys');
    expect(
      currentCard([entry({ schemes: [XBOX], activeSchemeId: XBOX.id })], {
        activeGameId: 'helldivers2',
      })?.detail,
    ).toBe('Not applied yet · Controller');
  });

  describe('once something has been applied', () => {
    const picked = entry({
      schemes: [XBOX, KEYS],
      activeSchemeId: KEYS.id,
      applied: applied(XBOX.id),
    });

    it('shows the scheme applied, not the one picked since', () => {
      const card = currentCard([picked], { activeGameId: 'helldivers2' });
      expect(card?.scheme).toBe(XBOX);
      expect(card?.applied).toBe(true);
      expect(card?.detail).toBe('Applied · Controller');
    });

    it('shows it with no active game at all', () => {
      expect(currentCard([picked], null)?.scheme).toBe(XBOX);
    });

    it('follows the most recent apply over all games, not the active game', () => {
      const older = entry({
        gameId: 'older',
        name: 'Older',
        schemes: [KEYS],
        activeSchemeId: KEYS.id,
        applied: applied(KEYS.id, 0, 50),
      });
      const card = currentCard([older, picked], { activeGameId: 'older' });
      expect(card?.entry.gameId).toBe('helldivers2');
      expect(currentCard([picked, older], { activeGameId: 'older' })?.entry.gameId).toBe(
        'helldivers2',
      );
    });

    it('falls back to the picked scheme, as not applied, when the applied one is not listed', () => {
      const lost = entry({
        schemes: [KEYS],
        activeSchemeId: KEYS.id,
        applied: applied('gone', 0, 1),
      });
      const card = currentCard([lost], { activeGameId: 'helldivers2' });
      expect(card?.applied).toBe(false);
      expect(card?.detail).toBe('Not applied yet · Keys');
    });
  });

  it('says what to do when the active game has no scheme', () => {
    const card = currentCard([entry()], { activeGameId: 'helldivers2' });
    expect(card?.scheme).toBeNull();
    expect(card?.detail).toBe('No scheme picked');
  });

  it('shows no scheme when the game has schemes but none is active, though a click opens the first', () => {
    const noneActive = entry({ schemes: [XBOX, KEYS], activeSchemeId: null });
    const card = currentCard([noneActive], { activeGameId: 'helldivers2' });
    expect(card?.scheme).toBeNull();
    expect(card?.detail).toBe('No scheme picked');
    expect(card?.entry.name).toBe('Helldivers 2');
    expect(chosenScheme(noneActive)).toBe(XBOX);
  });

  it('is never a setup with no Azeron: the units still hold what was there before', () => {
    const keys = entry({ schemes: [KEYS], applied: applied(KEYS.id, 0, 50) });
    const couch = entry({
      gameId: 'couch',
      name: 'Couch game',
      schemes: [COUCH],
      applied: applied(COUCH.id, 0, 90),
    });
    const card = currentCard([couch, keys], null);
    expect([card?.entry.gameId, card?.detail]).toEqual(['helldivers2', 'Applied · Keys']);
  });
});
