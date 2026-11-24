import { describe, expect, it } from 'vitest';
import { entry } from './libraryFixtures';
import { AZERONS_ONLY, NOTHING_HELD, recordApply, setupOf } from '@helmarray/core';
import type { UnitProfile, UnitWrite, UnitsHeld } from '@helmarray/core';
import type { LibrarySchemeRef, UnitHolds } from '../../shared/api';
import {
  chosenScheme,
  currentCard,
  defaultChoices,
  heldSchemes,
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
const NONE = new Set<string>();
/** What a unit holds by its record: a scheme of Helldivers 2 unless told. */
const holds = (scheme: LibrarySchemeRef, at = 100, over: Partial<UnitHolds> = {}): UnitHolds => ({
  schemeId: scheme.id,
  gameId: 'helldivers2',
  schemeName: scheme.name,
  devices: scheme.devices,
  output: scheme.output,
  at,
  check: 'unknown',
  ...over,
});
const units = (left: UnitHolds | null, right: UnitHolds | null = left) => ({ left, right });
const NOTHING = units(null, null);

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
    expect(statusLine(entry({ gameId: null, appId: '1', nativeKeys: false }), NONE)).toEqual({
      text: 'Not supported yet',
      tone: 'unsupported',
    });
  });

  it('says a known game with no scheme is not set up', () => {
    expect(statusLine(entry(), NONE)).toEqual({ text: 'Not set up', tone: 'plain' });
  });

  it('a setup applied and unchanged since is Ready, with what it plays with', () => {
    const line = statusLine(entry({ schemes: [XBOX], applied: applied(XBOX.id) }), NONE);
    expect(line).toEqual({ text: 'Ready · Controller', tone: 'ok' });
  });

  it('a setup changed since it was applied counts the changes', () => {
    expect([
      statusLine(entry({ schemes: [KEYS], applied: applied(KEYS.id, 2) }), NONE),
      statusLine(entry({ schemes: [KEYS], applied: applied(KEYS.id, 1) }), NONE).text,
    ]).toEqual([{ text: '2 changes · Keys', tone: 'warning' }, '1 change · Keys']);
  });

  it('the setup a unit holds by its own record is On the units', () => {
    const e = entry({ schemes: [XBOX], applied: applied(XBOX.id) });
    expect([statusLine(e, new Set([XBOX.id])), statusLine(e, new Set(['other'])).text]).toEqual([
      { text: 'On the units · Controller', tone: 'units' },
      'Ready · Controller',
    ]);
  });

  it('a game whose last apply wrote no unit is Ready, though a unit holds an older setup of it', () => {
    // Couch (the controller only) was applied after Xbox controller, which the units still hold.
    const e = entry({ schemes: [COUCH, XBOX], applied: applied(COUCH.id) });
    expect(statusLine(e, new Set([XBOX.id])).text).toBe('Ready · Couch');
  });

  it('the units held by record, bar one read as running something else', () => {
    expect([
      ...heldSchemes({ onUnits: units(holds(XBOX), holds(KEYS, 90, { check: 'differs' })) }),
    ]).toEqual([XBOX.id]);
  });

  it('names the setup when the game has several: the name tells them apart', () => {
    const e = entry({
      schemes: [COUCH, XBOX],
      activeSchemeId: XBOX.id,
      applied: applied(COUCH.id),
    });
    expect(statusLine(e, NONE).text).toBe('Ready · Couch');
  });

  it('a game never applied names the setup picked, as not applied', () => {
    expect([
      statusLine(entry({ schemes: [XBOX], activeSchemeId: XBOX.id }), NONE).text,
      statusLine(entry({ schemes: [XBOX, KEYS], activeSchemeId: KEYS.id }), NONE).text,
    ]).toEqual(['Not applied · Controller', "Not applied · Game's own keys"]);
  });

  it('counts the setups when none is picked and none applied, naming none', () => {
    expect([
      statusLine(entry({ schemes: [XBOX, KEYS] }), NONE),
      statusLine(entry({ schemes: [XBOX] }), NONE).text,
    ]).toEqual([{ text: '2 schemes', tone: 'plain' }, '1 scheme']);
  });

  it('an applied setup that is no longer the game’s says nothing about it', () => {
    const e = entry({ schemes: [KEYS], activeSchemeId: KEYS.id, applied: applied('gone') });
    expect(statusLine(e, new Set(['gone'])).text).toBe('Not applied · Keys');
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
    expect(currentCard(entries, { activeGameId: null, onUnits: NOTHING })).toBeNull();
    expect(currentCard(entries, { activeGameId: 'gone', onUnits: NOTHING })).toBeNull();
  });

  it('shows the active game and its active scheme', () => {
    const card = currentCard(entries, { activeGameId: 'helldivers2', onUnits: NOTHING });
    expect(card?.scheme).toBe(KEYS);
    expect(card?.applied).toBe(false);
    expect(card?.detail).toBe('Not applied yet · Keys');
    expect(
      currentCard([entry({ schemes: [XBOX], activeSchemeId: XBOX.id })], {
        activeGameId: 'helldivers2',
        onUnits: NOTHING,
      })?.detail,
    ).toBe('Not applied yet · Controller');
  });

  describe('once a unit has been written', () => {
    const picked = entry({
      schemes: [XBOX, KEYS],
      activeSchemeId: KEYS.id,
      applied: applied(XBOX.id),
    });
    const state = (left: UnitHolds | null, right: UnitHolds | null = left) => ({
      activeGameId: 'helldivers2',
      onUnits: units(left, right),
    });

    it('shows the scheme the units hold, not the one picked since', () => {
      const card = currentCard([picked], state(holds(XBOX)));
      expect([card?.scheme, card?.applied, card?.title, card?.detail, card?.held]).toEqual([
        XBOX,
        true,
        'Helldivers 2 · Xbox controller',
        'Applied · Controller',
        { left: XBOX.id, right: XBOX.id },
      ]);
    });

    it('words it as applied, though the scheme has been edited since to drop its Azerons', () => {
      // The record says what was applied; the scheme's devices are the edit.
      const edited = entry({
        schemes: [{ ...XBOX, devices: COUCH.devices }],
        applied: applied(XBOX.id),
      });
      expect(currentCard([edited], state(holds(XBOX)))?.detail).toBe('Applied · Controller');
    });

    it('follows the latest write over all games, not the active game nor each game’s last apply', () => {
      const older = entry({
        gameId: 'older',
        name: 'Older',
        schemes: [KEYS],
        applied: applied(KEYS.id),
      });
      const card = currentCard([older, picked], {
        activeGameId: 'older',
        onUnits: units(holds(XBOX, 100)),
      });
      expect(card?.entry.gameId).toBe('helldivers2');
    });

    it('says the right unit holds another scheme after a left Azeron + mouse apply', () => {
      const left = { ...KEYS, devices: { ...KEYS.devices, azerons: 'left' as const } };
      const both = entry({ schemes: [XBOX, left] });
      const card = currentCard([both], state(holds(left, 200), holds(XBOX, 100)));
      expect([card?.title, card?.detail, card?.held]).toEqual([
        "Helldivers 2 · Game's own keys",
        'Applied · Left Azeron + mouse · Right unit: Helldivers 2 · Xbox controller',
        { left: KEYS.id, right: XBOX.id },
      ]);
    });

    it('says a unit read as running something else differs', () => {
      const card = currentCard(
        [picked],
        state(holds(XBOX), holds(XBOX, 100, { check: 'differs' })),
      );
      expect(card?.detail).toBe('Applied · Controller · Right unit differs');
    });

    it('names a scheme deleted since by the name it was applied with', () => {
      const card = currentCard(
        [entry({ schemes: [KEYS] })],
        state(holds({ ...XBOX, id: 'gone', name: 'Old desk' })),
      );
      expect([card?.scheme, card?.title]).toEqual([null, 'Helldivers 2 · Old desk']);
    });

    it('falls back to the active scheme, as not applied, when no unit has ever been written', () => {
      const card = currentCard([picked], state(null));
      expect([card?.applied, card?.detail]).toEqual([false, 'Not applied yet · Keys']);
    });
  });

  it('says what to do when the active game has no scheme', () => {
    const card = currentCard([entry()], { activeGameId: 'helldivers2', onUnits: NOTHING });
    expect(card?.scheme).toBeNull();
    expect(card?.detail).toBe('No scheme picked');
  });

  it('shows no scheme when the game has schemes but none is active, though a click opens the first', () => {
    const noneActive = entry({ schemes: [XBOX, KEYS], activeSchemeId: null });
    const card = currentCard([noneActive], { activeGameId: 'helldivers2', onUnits: NOTHING });
    expect(card?.scheme).toBeNull();
    expect(card?.detail).toBe('No scheme picked');
    expect(card?.entry.name).toBe('Helldivers 2');
    expect(chosenScheme(noneActive)).toBe(XBOX);
  });
});

describe('the card names, for each unit, the scheme last written to it', () => {
  // Two games with two setups each. A run of applies (of whatever devices each setup has at the
  // time: both Azerons, the left one, none) and edits to the setups' devices that are not applied.
  // The Library's entries are what the main process lists (each game's latest apply, whatever it
  // wrote); the units' record is what the applies wrote (recordApply). After every step the card
  // names, for each unit, the scheme last written to it, whatever the schemes say now.
  const unitOf = (hand: 'left' | 'right'): UnitProfile => ({
    deviceId: 'cyborg2',
    hand,
    pins: [],
    stick: { mode: 'keys', angle: 0, invertX: false },
  });
  const DEVICES: LibrarySchemeRef['devices'][] = [
    { ...AZERONS_ONLY },
    { azerons: 'left', keyboard: false, mouse: true, controller: false },
    { azerons: 'none', keyboard: true, mouse: true, controller: false },
  ];
  const GAMES = ['alpha', 'beta'];

  it.each([3, 17, 29, 41])('holds through 150 applies and edits (seed %i)', (seed) => {
    let x = seed;
    const next = (n: number) => {
      x = (x * 1103515245 + 12345) % 2147483648;
      // The high bits: an LCG's low bits repeat in a short cycle.
      return Math.floor(x / 65536) % n;
    };
    const schemes = GAMES.flatMap((gameId) =>
      [1, 2].map((n) => ({
        gameId,
        ref: {
          ...XBOX,
          id: `${gameId}-${n}`,
          name: `${gameId} ${n}`,
          devices: { ...AZERONS_ONLY },
        },
      })),
    );
    let held: UnitsHeld = NOTHING_HELD;
    const lastApply = new Map<string, { schemeId: string; at: number }>();
    const truth: Record<'left' | 'right', string | null> = { left: null, right: null };
    const found: string[] = [];
    for (let at = 1; at <= 150; at++) {
      const s = schemes[next(schemes.length)];
      if (s === undefined) continue;
      if (next(2) === 0) {
        s.ref = { ...s.ref, devices: DEVICES[next(DEVICES.length)] ?? AZERONS_ONLY };
      } else {
        const hands = setupOf(s.ref.devices).hands;
        held = recordApply(
          held,
          { units: Object.fromEntries(hands.map((h) => [h, unitOf(h)])) },
          hands.map((hand) => ({ hand, status: 'applied' })),
          {
            schemeId: s.ref.id,
            gameId: s.gameId,
            schemeName: s.ref.name,
            devices: s.ref.devices,
            output: s.ref.output,
            at,
          },
        );
        for (const hand of hands) truth[hand] = s.ref.id;
        lastApply.set(s.gameId, { schemeId: s.ref.id, at });
      }
      const entries = GAMES.map((gameId) => {
        const last = lastApply.get(gameId);
        return entry({
          gameId,
          name: gameId,
          appId: gameId,
          schemes: schemes.filter((t) => t.gameId === gameId).map((t) => t.ref),
          applied: last === undefined ? null : { ...last, changes: 0 },
        });
      });
      const view = (h: UnitWrite | null): UnitHolds | null =>
        h === null
          ? null
          : {
              schemeId: h.schemeId,
              gameId: h.gameId,
              schemeName: h.schemeName,
              devices: h.devices,
              output: h.output,
              at: h.at,
              check: 'unknown',
            };
      const card = currentCard(entries, {
        activeGameId: null,
        onUnits: { left: view(held.left), right: view(held.right) },
      });
      const named = { left: card?.held.left ?? null, right: card?.held.right ?? null };
      if (JSON.stringify(named) !== JSON.stringify(truth))
        found.push(
          `step ${at}: names ${JSON.stringify(named)}, the units hold ${JSON.stringify(truth)}`,
        );
    }
    expect(found).toEqual([]);
  });
});
