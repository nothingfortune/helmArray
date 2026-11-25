// The fix gate: a fix button is offered only when applying it removes its finding and adds no new
// error. Every fix shares one shape (`fixCandidate`: a pure run that gives the new scheme, or null
// when it can't act); `offerFor` runs it and re-resolves before offering it. When none can act, the
// finding says why in one plain sentence.
import { describe, expect, it } from 'vitest';
import type { Action, ControlId, Finding, Game, PadControl, Plan, Scheme } from '@helmarray/core';
import {
  AZERONS_ONLY,
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  PRESSES,
  blankKeysScheme,
  gameKeysPreset,
  helldivers2,
  resolve,
  xboxControllerPreset,
} from '@helmarray/core';
import { assign, clear, setLatch, setOutput } from './editor-model';
import { game as liteGame } from './editor-fixture';
import { FIXABLE_RULES, fixCandidate, offerFor } from './fixes';

// ---- A game that fills the controller: 17 required actions, 16 on every Xbox control a button
// can send (the sticks' directions are the sticks'), and one more on none of them. ----

const PADS: readonly PadControl[] = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'BACK',
  'START',
  'LS',
  'RS',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
];
const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const required = (i: number, pad?: PadControl): Action => ({
  id: `a${i}`,
  name: `Action ${i}`,
  mode: 'default',
  role: 'combat',
  required: true,
  native: { key: { kind: 'key', code: KEYS[i] as 'A' }, ...(pad === undefined ? {} : { pad }) },
});

const crowded: Game = {
  id: 'crowded',
  name: 'Crowded',
  modes: [{ id: 'default', name: 'Default' }],
  actions: [...PADS.map((pad, i) => required(i, pad)), required(16), required(17)],
};

const planOf = (scheme: Scheme, g: Game): Plan => resolve(scheme, g, BUILT_IN_DEVICES);
const same = (a: Finding, b: Finding) =>
  a.rule === b.rule && a.control === b.control && a.action === b.action && a.mode === b.mode;
const missing = (plan: Plan, action: string) =>
  plan.findings.find((f) => f.rule === 'missing-required' && f.action === action) as Finding;

describe('the near-full controller (Codex, #106)', () => {
  const scheme = xboxControllerPreset(crowded);
  const plan = planOf(scheme, crowded);

  it('fills all sixteen controls a button may send, and leaves two required actions off', () => {
    expect(plan.findings.filter((f) => f.rule === 'missing-required').map((f) => f.action)).toEqual(
      ['a16', 'a17'],
    );
  });

  it('offers no "Put it on a button", and says why in one sentence', () => {
    const offer = offerFor(missing(plan, 'a16'), scheme, crowded, plan);
    expect(offer).toEqual({ why: 'Every controller button is in use; clear one first.' });
  });

  it('has no way of the fix that settles: each place it may go breaks something or does nothing', () => {
    // Was: its one run gave null. Fixes now try every place in order, so the claim is that none
    // of them settles, which is stronger.
    const finding = missing(plan, 'a16');
    const candidate = fixCandidate(finding, scheme, crowded, plan);
    const settling = [...(candidate?.tries(scheme) ?? [])].filter((t) => {
      const after = planOf(t.scheme, crowded);
      return (
        !after.findings.some((f) => same(f, finding)) &&
        errorsOf(after).every((e) => errorsOf(plan).some((b) => same(b, e)))
      );
    });
    expect(settling.map((t) => t.select)).toEqual([]);
  });

  it('offers it again once a button is cleared, and then it removes the finding', () => {
    const freed = clear(scheme, { mode: 'default', control: 'L.index_1', press: 'tap' });
    const freedPlan = planOf(freed, crowded);
    const finding = missing(freedPlan, 'a16');
    const offer = offerFor(finding, freed, crowded, freedPlan);
    const after = offer !== null && 'fix' in offer ? offer.fix.apply(freed) : freed;
    expect({
      label: offer !== null && 'fix' in offer ? offer.fix.label : null,
      gone: !planOf(after, crowded).findings.some((f) => same(f, finding)),
    }).toEqual({ label: 'Put it on a button', gone: true });
  });
});

describe('seventeen required actions and more, with keys', () => {
  it('puts every one on a button, one fix after another, and nothing is left missing', () => {
    let scheme = blankKeysScheme(crowded);
    for (let guard = 0; guard < 40; guard++) {
      const plan = planOf(scheme, crowded);
      const next = plan.findings.find((f) => f.rule === 'missing-required');
      if (next === undefined) break;
      const offer = offerFor(next, scheme, crowded, plan);
      if (offer === null || !('fix' in offer)) break;
      scheme = offer.fix.apply(scheme);
    }
    expect(planOf(scheme, crowded).findings.filter((f) => f.rule === 'missing-required')).toEqual(
      [],
    );
  });
});

describe('a fix that can’t act says so', () => {
  it('a stick the game ships no keys for is never offered keys', () => {
    const keysOnly: Game = { ...helldivers2, needsKeyStick: true };
    const scheme: Scheme = {
      ...gameKeysPreset(helldivers2),
      behaviour: {
        ...gameKeysPreset(helldivers2).behaviour,
        'R.stick': { stick: { mode: 'pad-right' } },
      },
    };
    const plan = planOf(scheme, keysOnly);
    const finding = plan.findings.find(
      (f) => f.rule === 'stick-not-keyboard' && f.control === 'R.stick',
    ) as Finding;
    expect(offerFor(finding, scheme, keysOnly, plan)).toEqual({
      why: 'Helldivers 2 has no keys for this stick’s directions.',
    });
  });

  it('a finding no single edit settles has no fix and no sentence', () => {
    const plan = planOf(xboxControllerPreset(helldivers2), helldivers2);
    const collision: Finding = {
      rule: 'key-collision',
      severity: 'error',
      control: 'L.index_1',
      mode: 'default',
      message: 'x',
    };
    expect(offerFor(collision, xboxControllerPreset(helldivers2), helldivers2, plan)).toBeNull();
  });
});

// ---- The property: over seeded schemes, every fix offered works, and one not offered can't. ----

/** mulberry32: a small seeded generator, so every run makes the same schemes. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUTTONS: ControlId[] = [CYBORG2_LEFT, CYBORG2_RIGHT].flatMap((u) =>
  u.positions
    .filter((p) => p.name !== 'stick')
    .map((p) => `${u.hand === 'left' ? 'L' : 'R'}.${p.name}`),
);
const FIXED: ControlId[] = BUILT_IN_DEVICES.flatMap((d) => d.controls)
  .filter((c) => c.sends !== undefined)
  .map((c) => c.id);

const keysOnlyHd2: Game = { ...helldivers2, id: helldivers2.id, needsKeyStick: true };
const GAMES: Game[] = [helldivers2, crowded, liteGame, keysOnlyHd2];

const STICKS = [
  { mode: 'keys' },
  { mode: 'pad-left' },
  { mode: 'pad-right' },
  { mode: 'mouse' },
  {
    mode: 'keys',
    directions: { up: { kind: 'key', code: 'W' }, down: { kind: 'key', code: 'S' } },
  },
] as const;

/** One seeded scheme: a game, a starting point, a setup, and a dozen random edits. */
function schemeFor(seed: number): { game: Game; scheme: Scheme } {
  const rand = seeded(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const base = pick(GAMES);
  const starts = [xboxControllerPreset, gameKeysPreset, blankKeysScheme];
  let scheme = pick(starts)(base);
  scheme = {
    ...scheme,
    devices: pick([
      { ...AZERONS_ONLY },
      { ...AZERONS_ONLY, keyboard: true, mouse: true },
      { ...AZERONS_ONLY, controller: true },
      { azerons: 'left', keyboard: false, mouse: true, controller: false },
      { azerons: 'none', keyboard: true, mouse: true, controller: false },
      { azerons: 'none', keyboard: false, mouse: false, controller: true },
    ] as Scheme['devices'][]),
  };
  if (rand() < 0.3) scheme = setOutput(scheme, scheme.output === 'pad' ? 'keys' : 'pad', base);
  const modes = base.modes.map((m) => m.id);
  for (let i = 0; i < 12; i++) {
    const mode = pick(modes);
    const r = rand();
    if (r < 0.45) {
      const actions = base.actions.filter((a) => a.mode === mode);
      if (actions.length === 0) continue;
      const control = pick(rand() < 0.75 ? BUTTONS : FIXED);
      scheme = assign(scheme, { mode, control, press: pick(PRESSES) }, pick(actions).id, base);
    } else if (r < 0.7) {
      scheme = clear(scheme, { mode, control: pick(BUTTONS), press: pick(PRESSES) });
    } else if (r < 0.8) {
      scheme = setLatch(scheme, pick(BUTTONS), true);
    } else {
      const stick = rand() < 0.5 ? 'L.stick' : 'R.stick';
      scheme = {
        ...scheme,
        behaviour: { ...scheme.behaviour, [stick]: { stick: pick(STICKS) as never } },
      };
    }
  }
  // Now and then an action the game drops after the scheme was made: action-deleted.
  const game =
    rand() < 0.2 ? { ...base, actions: base.actions.filter((_, i) => i % 5 !== 0) } : base;
  return { game, scheme };
}

const errorsOf = (plan: Plan) =>
  plan.findings.filter((f) => f.severity === 'error' && f.accepted === undefined);

describe('the fix gate, over 400 seeded schemes', () => {
  const offered = new Set<string>();
  const refused = new Set<string>();
  const faults: string[] = [];
  for (let seed = 1; seed <= 400; seed++) {
    const { game, scheme } = schemeFor(seed);
    const plan = planOf(scheme, game);
    for (const finding of plan.findings) {
      const offer = offerFor(finding, scheme, game, plan);
      const candidate = fixCandidate(finding, scheme, game, plan);
      const where = `seed ${seed} ${finding.rule} ${finding.control ?? finding.action ?? ''}`;
      if (offer !== null && 'fix' in offer) {
        offered.add(finding.rule);
        const after = planOf(offer.fix.apply(scheme), game);
        if (after.findings.some((f) => same(f, finding))) faults.push(`${where}: still there`);
        const fresh = errorsOf(after).filter((e) => !errorsOf(plan).some((b) => same(b, e)));
        if (fresh.length > 0) faults.push(`${where}: adds ${fresh.map((f) => f.rule).join(', ')}`);
      } else if (candidate !== undefined) {
        refused.add(finding.rule);
        // Every way the fix may go: none settles (fixes-complete.test.ts goes further, past them).
        for (const tried of candidate.tries(scheme)) {
          const after = planOf(tried.scheme, game);
          const fresh = errorsOf(after).filter((e) => !errorsOf(plan).some((b) => same(b, e)));
          if (!after.findings.some((f) => same(f, finding)) && fresh.length === 0)
            faults.push(`${where}: not offered, though ${tried.label} works`);
        }
      }
    }
  }

  it('a fix offered removes its finding and adds no error; one not offered can’t', () => {
    expect(faults).toEqual([]);
  });

  it('reaches every rule that has a fix, offered at least once', () => {
    expect([...FIXABLE_RULES].filter((rule) => !offered.has(rule))).toEqual([]);
  });

  it('reaches a refusal too: the near-full controller among them', () => {
    expect(refused.has('missing-required')).toBe(true);
  });
});
