import { describe, expect, it } from 'vitest';
import type { Baselines, Game, GameBinding, Plan, Signal } from '@helmarray/core';
import { NO_BASELINES, heldBy, settleBaseline } from '@helmarray/core';
import { reminders, settleReminder } from './reminders';

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const game = (id: string, name: string): Game => ({
  id,
  name,
  modes: [{ id: 'default', name: 'Default' }],
  actions: [{ id: 'jump', name: 'Jump', mode: 'default', role: 'movement', required: false }],
});
const jumpOn = (signal: Signal | null): GameBinding => ({
  set: 'keyboard',
  mode: 'default',
  action: 'jump',
  signal,
  native: key('Space'),
});
const plan = (gameBindings: GameBinding[], gameFile = false): Plan => ({
  units: {},
  bindings: [],
  gameBindings,
  bindSheet: [],
  ledger: {},
  findings: [],
  ...(gameFile ? { gameFile: { format: 'elite-binds' } } : {}),
});

/** The store as the reminders read it: games, what was applied to each last, and baselines. */
function store(games: Game[]) {
  const applied = new Map<string, { plan: Plan; at: number }>();
  let baselines: Baselines = NO_BASELINES;
  return {
    apply(gameId: string, p: Plan, at: number) {
      applied.set(gameId, { plan: p, at });
    },
    listGames: () => Promise.resolve(games.map((g) => ({ game: g, builtIn: false }))),
    lastApplied: (gameId: string) => {
      const a = applied.get(gameId);
      return Promise.resolve(a === undefined ? null : { schemeId: gameId, at: a.at });
    },
    getApplied: (schemeId: string) => Promise.resolve(applied.get(schemeId)?.plan ?? null),
    heldBindings: (gameId: string) => Promise.resolve(heldBy(baselines, gameId)),
    settleBaseline: (gameId: string, bindings: readonly GameBinding[]) => {
      baselines = settleBaseline(baselines, gameId, bindings);
      return Promise.resolve();
    },
  };
}

const rowsOf = async (s: ReturnType<typeof store>) =>
  (await reminders(s)).map((sheet) => [
    sheet.gameId,
    sheet.rows.map((r) => [r.actionName, r.from, r.to]),
  ]);

describe('the reminder of what to set in the game', () => {
  it("says to take Jump off Space, where the game still has it, after Space → J → nothing (Codex's case)", async () => {
    const s = store([game('g', 'Game')]);
    s.apply('g', plan([jumpOn(key('J'))]), 1);
    const first = await rowsOf(s);
    s.apply('g', plan([jumpOn(null)]), 2);
    expect([first, await rowsOf(s)]).toEqual([
      [['g', [['Jump', key('Space'), key('J')]]]],
      [['g', [['Jump', key('Space'), null]]]],
    ]);
  });

  it('is gone once Done, and the next apply is said from what the game then holds', async () => {
    const s = store([game('g', 'Game')]);
    s.apply('g', plan([jumpOn(key('J'))]), 1);
    await settleReminder(s, 'g');
    const afterDone = await rowsOf(s);
    s.apply('g', plan([jumpOn(key('K'))]), 2);
    expect([afterDone, await rowsOf(s)]).toEqual([[], [['g', [['Jump', key('J'), key('K')]]]]]);
  });

  it('lists the game applied last first, and none whose file helmArray writes', async () => {
    const s = store([game('a', 'A'), game('b', 'B'), game('c', 'C')]);
    s.apply('a', plan([jumpOn(key('J'))]), 1);
    s.apply('b', plan([jumpOn(key('K'))]), 3);
    s.apply('c', plan([jumpOn(key('L'))], true), 5);
    expect((await reminders(s)).map((r) => r.gameId)).toEqual(['b', 'a']);
  });

  it('does nothing on Done for a game nothing was applied to', async () => {
    const s = store([game('g', 'Game')]);
    await settleReminder(s, 'g');
    expect(await s.heldBindings('g')).toBeNull();
  });
});
