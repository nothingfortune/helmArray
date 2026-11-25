// The fix gate is complete: when it withholds a fix that has a choice (of a button, of a signal, of
// what a stick does), no choice would have settled the finding. Each withheld finding is checked by
// brute force over every empty control and every signal the setup allows, with nothing taken from
// fixes.ts but `offerFor` itself. "Settles": the finding is gone and no new error appears.
import { describe, expect, it } from 'vitest';
import type {
  Action,
  ControlId,
  Finding,
  Game,
  PadControl,
  Plan,
  Scheme,
  StickBehaviour,
} from '@helmarray/core';
import {
  AZERONS_ONLY,
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  PAD_CONTROLS,
  PRESSES,
  blankKeysScheme,
  gameKeysPreset,
  helldivers2,
  inSetup,
  resolve,
  setupOf,
  stickKeysOf,
  xboxControllerPreset,
} from '@helmarray/core';
import { assign, clear, setLatch, setOutput, setPadControl, shownAction } from './editor-model';
import { game as liteGame } from './editor-fixture';
import { offerFor } from './fixes';

const planOf = (scheme: Scheme, g: Game): Plan => resolve(scheme, g, BUILT_IN_DEVICES);
const same = (a: Finding, b: Finding) =>
  a.rule === b.rule && a.control === b.control && a.action === b.action && a.mode === b.mode;
const openErrors = (plan: Plan) =>
  plan.findings.filter((f) => f.severity === 'error' && f.accepted === undefined);

/** The finding is gone from `after`, and `after` has no error `before` didn't. */
function settles(finding: Finding, before: Plan, after: Plan): boolean {
  if (after.findings.some((f) => same(f, finding))) return false;
  return openErrors(after).every((e) => openErrors(before).some((b) => same(b, e)));
}

const UNIT_BUTTONS: ControlId[] = [CYBORG2_LEFT, CYBORG2_RIGHT].flatMap((u) =>
  u.positions
    .filter((p) => p.name !== 'stick')
    .map((p) => `${u.hand === 'left' ? 'L' : 'R'}.${p.name}`),
);
const FIXED: ControlId[] = BUILT_IN_DEVICES.filter((d) => d.kind === 'kbm' || d.kind === 'pad')
  .flatMap((d) => d.controls)
  .filter((c) => c.sends !== undefined)
  .map((c) => c.id);

/** The actions a mode shows on some control. */
function shownIn(scheme: Scheme, mode: string): Set<string> {
  const controls = new Set([
    ...Object.keys(scheme.map[mode] ?? {}),
    ...Object.keys(scheme.padMap),
    ...UNIT_BUTTONS,
    ...FIXED,
  ]);
  return new Set(
    [...controls].flatMap((c) => {
      const id = shownAction(scheme, mode, c)?.id;
      return id === undefined ? [] : [id];
    }),
  );
}

/** The rules whose fix has a choice: of a control and its signal, or of what a stick does. */
const CHOICE_RULES = [
  'missing-required',
  'stick-no-directions',
  'stick-not-keyboard',
  'mixed-input',
];

/** Every scheme one choice of the finding's fix could make, by brute force. */
function* everyChoice(finding: Finding, scheme: Scheme, game: Game): Generator<Scheme> {
  const setup = setupOf(scheme.devices);
  if (finding.rule === 'missing-required') {
    const { action, mode } = finding;
    if (action === undefined || mode === undefined) return;
    // Putting an action on never takes another off: a choice that does isn't one.
    const before = shownIn(scheme, mode);
    const keeps = (next: Scheme) => {
      const after = shownIn(next, mode);
      return [...before].every((id) => after.has(id));
    };
    for (const control of [...UNIT_BUTTONS, ...FIXED]) {
      if (!inSetup(setup, control) || shownAction(scheme, mode, control) !== undefined) continue;
      const placed = assign(scheme, { mode, control, press: 'tap' }, action, game);
      if (keeps(placed)) yield placed;
      const unit = control.startsWith('L.') || control.startsWith('R.');
      if (unit && scheme.output === 'pad') {
        for (const pad of PAD_CONTROLS) {
          const other = setPadControl(placed, control, pad, game);
          if (keeps(other)) yield other;
        }
      }
    }
    return;
  }
  const control = finding.control;
  if (control !== 'L.stick' && control !== 'R.stick') return;
  const hand = control === 'L.stick' ? 'left' : 'right';
  const keys = stickKeysOf(game, hand);
  const modes: StickBehaviour[] = [
    ...(Object.keys(keys).length > 0 ? [{ mode: 'keys' as const, directions: keys }] : []),
    { mode: 'mouse' },
    { mode: 'pad-left' },
    { mode: 'pad-right' },
  ];
  for (const stick of modes) {
    yield { ...scheme, behaviour: { ...scheme.behaviour, [control]: { stick } } };
  }
}

/** Whether any choice settles the finding. */
function anySettles(finding: Finding, scheme: Scheme, game: Game, plan: Plan): boolean {
  for (const choice of everyChoice(finding, scheme, game)) {
    if (choice !== scheme && settles(finding, plan, planOf(choice, game))) return true;
  }
  return false;
}

// ---- The table ----

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
const required = (i: number, pad?: PadControl): Action => ({
  id: `a${i}`,
  name: `Action ${i}`,
  mode: 'default',
  role: 'combat',
  required: true,
  native: {
    key: { kind: 'key', code: 'ABCDEFGHIJKLMNOPQR'.charAt(i) as 'A' },
    ...(pad === undefined ? {} : { pad }),
  },
});
const crowded: Game = {
  id: 'crowded',
  name: 'Crowded',
  modes: [{ id: 'default', name: 'Default' }],
  actions: [...PADS.map((pad, i) => required(i, pad)), required(16), required(17)],
};

/** Codex on #108: Fire's own button keeps W in its ledger, the key the left stick sends. */
const staleW = (): Scheme => {
  const cleared = clear(gameKeysPreset(helldivers2), {
    mode: 'default',
    control: 'L.index_2',
    press: 'tap',
  });
  return { ...cleared, ledger: { 'L.index_2': { tap: { kind: 'key', code: 'W' } } } };
};

const TABLE: {
  name: string;
  scheme: Scheme;
  game: Game;
  rule: string;
  about: string;
  offered: boolean;
}[] = [
  {
    name: 'Codex #108: a kept ledger key on the first empty button clashes; a later one works',
    scheme: staleW(),
    game: helldivers2,
    rule: 'missing-required',
    about: 'fire_primary',
    offered: true,
  },
  {
    name: 'Codex #106: every Xbox control a button may send is in use',
    scheme: xboxControllerPreset(crowded),
    game: crowded,
    rule: 'missing-required',
    about: 'a16',
    offered: false,
  },
  {
    name: 'one button freed among a full controller',
    scheme: clear(xboxControllerPreset(crowded), {
      mode: 'default',
      control: 'L.index_1',
      press: 'tap',
    }),
    game: crowded,
    rule: 'missing-required',
    about: 'a16',
    offered: true,
  },
  {
    name: 'a blank key scheme’s left stick',
    scheme: blankKeysScheme(helldivers2),
    game: helldivers2,
    rule: 'stick-no-directions',
    about: 'L.stick',
    offered: true,
  },
];

describe.each(TABLE)('$name', ({ scheme, game, rule, about, offered }) => {
  const plan = planOf(scheme, game);
  const finding = plan.findings.find(
    (f) => f.rule === rule && (f.action === about || f.control === about),
  ) as Finding;
  const offer = offerFor(finding, scheme, game, plan);

  it(offered ? 'offers a fix, and it settles' : 'withholds the fix, and no choice settles', () => {
    const fix = offer !== null && 'fix' in offer ? offer.fix : undefined;
    expect({
      offered: fix !== undefined,
      settles: fix === undefined ? false : settles(finding, plan, planOf(fix.apply(scheme), game)),
      any: anySettles(finding, scheme, game, plan),
    }).toEqual({ offered, settles: offered, any: offered });
  });
});

// ---- The property: over seeded schemes, every withheld fix with a choice had none that works ----

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

const GAMES: Game[] = [helldivers2, crowded, liteGame, { ...helldivers2, needsKeyStick: true }];

function schemeFor(seed: number): { game: Game; scheme: Scheme } {
  const rand = seeded(seed * 7919);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const game = pick(GAMES);
  let scheme = pick([xboxControllerPreset, gameKeysPreset, blankKeysScheme])(game);
  scheme = {
    ...scheme,
    devices: pick([
      { ...AZERONS_ONLY },
      { ...AZERONS_ONLY, keyboard: true, mouse: true },
      { ...AZERONS_ONLY, controller: true },
      { azerons: 'left', keyboard: false, mouse: true, controller: false },
      { azerons: 'none', keyboard: false, mouse: false, controller: true },
    ] as Scheme['devices'][]),
  };
  if (rand() < 0.3) scheme = setOutput(scheme, scheme.output === 'pad' ? 'keys' : 'pad', game);
  const modes = game.modes.map((m) => m.id);
  for (let i = 0; i < 12; i++) {
    const mode = pick(modes);
    const r = rand();
    if (r < 0.4) {
      const actions = game.actions.filter((a) => a.mode === mode);
      const control = pick(rand() < 0.75 ? UNIT_BUTTONS : FIXED);
      if (actions.length > 0)
        scheme = assign(scheme, { mode, control, press: pick(PRESSES) }, pick(actions).id, game);
    } else if (r < 0.65) {
      scheme = clear(scheme, { mode, control: pick(UNIT_BUTTONS), press: pick(PRESSES) });
    } else if (r < 0.75) {
      scheme = setLatch(scheme, pick(UNIT_BUTTONS), true);
    } else if (r < 0.85) {
      // A kept ledger key: a button that was given one and has been emptied since.
      const control = pick(UNIT_BUTTONS);
      const code = pick(['W', 'S', 'A', 'D', 'R', 'F13'] as const);
      scheme = {
        ...scheme,
        ledger: { ...scheme.ledger, [control]: { tap: { kind: 'key', code } } },
      };
    } else {
      const stick = rand() < 0.5 ? 'L.stick' : 'R.stick';
      const mode = pick(['keys', 'pad-left', 'pad-right', 'mouse'] as const);
      scheme = { ...scheme, behaviour: { ...scheme.behaviour, [stick]: { stick: { mode } } } };
    }
  }
  return { game, scheme };
}

describe('the fix gate is complete, over 300 seeded schemes', () => {
  const faults: string[] = [];
  let withheld = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { game, scheme } = schemeFor(seed);
    const plan = planOf(scheme, game);
    for (const finding of plan.findings) {
      if (!CHOICE_RULES.includes(finding.rule)) continue;
      const offer = offerFor(finding, scheme, game, plan);
      if (offer === null || 'fix' in offer) continue;
      withheld++;
      if (anySettles(finding, scheme, game, plan))
        faults.push(`seed ${seed} ${finding.rule} ${finding.action ?? finding.control ?? ''}`);
    }
  }

  it('withholds a fix only when no control, signal or stick mode would settle it', () => {
    expect(faults).toEqual([]);
  });

  it('withholds some: the check is not empty', () => {
    expect(withheld).toBeGreaterThan(0);
  });
});
