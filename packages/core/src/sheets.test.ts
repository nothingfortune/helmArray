import { describe, expect, it } from 'vitest';
import type { Signal } from './model';
import type { GameBinding } from './plan';
import type { Baselines, SheetRow } from './sheets';
import { NO_BASELINES, heldBy, pendingRows, settleBaseline } from './sheets';

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const id = (s: Signal | null) => (s === null ? 'none' : JSON.stringify(s));
const keyOf = (b: { set: string; mode: string; action: string }) =>
  `${b.set}|${b.mode}|${b.action}`;

/** An action's binding in the keyboard set: on `to` (null: on nothing), shipped on `native`. */
const binding = (action: string, to: Signal | null, native: Signal | null): GameBinding => ({
  set: 'keyboard',
  mode: 'default',
  action,
  signal: to,
  native,
});

type Row = Pick<SheetRow, 'set' | 'mode' | 'action' | 'to' | 'from'>;
/** The game as the person's own controls menu has it: each action's signals, by set|mode|action. */
type Game = Map<string, string[]>;

/** The rows of a reminder, followed in the game's menu, the way they read. */
function follow(game: Game, rows: readonly Row[]): Game {
  const next: Game = new Map(game);
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  for (const [k, group] of groups) {
    if (group.every((r) => r.to === null)) {
      // "Take Jump off Space": that binding comes off; any other stays.
      const off = new Set(group.map((r) => id(r.from)));
      next.set(
        k,
        (next.get(k) ?? []).filter((s) => !off.has(s)),
      );
    } else {
      // "Set Jump to J" (and K): the action is on these, and only these.
      next.set(
        k,
        group.flatMap((r) => (r.to === null ? [] : [id(r.to)])),
      );
    }
  }
  return next;
}

/** What a plan's bindings put each action on. */
const wanted = (bindings: readonly GameBinding[]): Game => {
  const out: Game = new Map();
  for (const b of bindings) {
    out.set(keyOf(b), [...(out.get(keyOf(b)) ?? []), ...(b.signal === null ? [] : [id(b.signal)])]);
  }
  return out;
};

/** A small seeded generator, so a failure names the run that found it. */
function random(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    s ^= s >>> 13;
    return s % n;
  };
}

const ACTIONS = ['jump', 'fire', 'map'] as const;
const NATIVE: Record<(typeof ACTIONS)[number], Signal | null> = {
  jump: key('Space'),
  fire: key('F'),
  map: null,
};
const CODES = ['Space', 'F', 'J', 'K', 'L'];

/** The bindings of one apply: every action on nothing, one key or two. */
function bindingsOf(pick: (n: number) => number): GameBinding[] {
  return ACTIONS.flatMap((action) => {
    const count = pick(3);
    if (count === 0) return [binding(action, null, NATIVE[action])];
    return Array.from({ length: count }, () =>
      binding(action, key(CODES[pick(CODES.length)] ?? 'J'), NATIVE[action]),
    );
  });
}

// The reminder as the app shows it, after each apply and each Done: worked out afresh from the
// game's baseline and the bindings applied last.
function model() {
  let baselines: Baselines = NO_BASELINES;
  let last: GameBinding[] | null = null;
  return {
    apply(bindings: GameBinding[]) {
      last = bindings;
    },
    done() {
      if (last !== null) baselines = settleBaseline(baselines, 'g', last);
    },
    shown: (): Row[] => (last === null ? [] : pendingRows(last, heldBy(baselines, 'g'))),
  };
}

describe('the reminder of what to set in the game', () => {
  it("says to take an action off what the game still has it on (Codex's case)", () => {
    // Jump: Space → J, then J → nothing, before the person touched the game.
    const app = model();
    app.apply([binding('jump', key('J'), key('Space'))]);
    app.apply([binding('jump', null, key('Space'))]);
    expect(app.shown().map((r) => [r.action, r.from, r.to])).toEqual([
      ['jump', key('Space'), null],
    ]);
  });

  it('for any run of applies and Dones, following the reminder shown yields exactly the bindings applied last', () => {
    const faults: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const pick = random(seed);
      const app = model();
      // The game, as the person has set it: what it ships, until they follow a reminder.
      let game: Game = new Map(
        ACTIONS.map((a) => [`keyboard|default|${a}`, NATIVE[a] === null ? [] : [id(NATIVE[a])]]),
      );
      let latest: GameBinding[] | null = null;
      const steps = 1 + pick(8);
      for (let n = 0; n < steps; n++) {
        if (latest !== null && pick(3) === 0) {
          // Done: the person followed the reminder in the game's menu.
          game = follow(game, app.shown());
          app.done();
        } else {
          latest = bindingsOf(pick);
          app.apply(latest);
        }
        if (latest === null) continue;
        const after = follow(game, app.shown());
        const wrong = [...wanted(latest)].filter(
          ([k, v]) => JSON.stringify(after.get(k) ?? []) !== JSON.stringify(v),
        );
        if (wrong.length > 0) {
          faults.push(`seed ${seed}, step ${n}`);
          break;
        }
      }
    }
    expect(faults).toEqual([]);
  });

  it('shows nothing once Done, until another apply changes something', () => {
    const app = model();
    app.apply([binding('jump', key('J'), key('Space'))]);
    app.done();
    const afterDone = app.shown();
    app.apply([binding('jump', key('J'), key('Space'))]);
    const same = app.shown();
    app.apply([binding('jump', key('K'), key('Space'))]);
    expect([afterDone, same, app.shown()]).toEqual([
      [],
      [],
      [{ set: 'keyboard', mode: 'default', action: 'jump', to: key('K'), from: key('J') }],
    ]);
  });

  it('keeps the baseline of actions an apply does not cover when Done moves it', () => {
    const moved = settleBaseline(NO_BASELINES, 'g', [binding('jump', key('J'), key('Space'))]);
    const again = settleBaseline(moved, 'g', [binding('fire', key('G'), key('F'))]);
    expect(heldBy(again, 'g')?.map((b) => [b.action, b.signal])).toEqual([
      ['jump', key('J')],
      ['fire', key('G')],
    ]);
  });
});
