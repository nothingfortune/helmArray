// The checks from docs/plans/01-features.md. Each came from a play session that went wrong;
// reference/legacy/CLAUDE.md ("Hard-won constraints") tells the story behind each.

import type {
  ActionId,
  AzeronDevice,
  ControlId,
  Device,
  Game,
  ModeId,
  PadControl,
  Role,
  Scheme,
  Signal,
} from './model';
import { PRESSES } from './model';
import type { Finding, PinPlan, Plan, UnitProfile } from './plan';
import { signalId } from './signal';

/** Every check, in the order its findings are listed. */
export const CHECK_RULES = [
  'key-collision',
  'sends-nothing',
  'missing-required',
  'menu-with-combat',
  'combat-tap-delayed',
  'hold-on-movement',
  'mixed-input',
  'stick-not-keyboard',
] as const;
export type CheckRule = (typeof CHECK_RULES)[number];

/** Roles of the buttons you mash: a menu action on one opens mid-fight. */
export const MASHED_ROLES: readonly Role[] = ['combat'];
/** Roles that need the tap the moment it lands: fire, targeting, consumables, boost. */
export const TAP_CRITICAL_ROLES: readonly Role[] = ['combat', 'movement'];
/** Roles that must let go when you do: a latched boost keeps boosting. */
export const NO_LATCH_ROLES: readonly Role[] = ['movement'];

/** The plan before the checks have run. */
export type Unchecked = Omit<Plan, 'findings'>;

interface KnownControl {
  /** Where it falls in device order. */
  order: number;
  /** What a fixed control sends. */
  sends?: Signal;
  azeron: boolean;
  button: boolean;
}

interface Context {
  scheme: Scheme;
  game: Game;
  plan: Unchecked;
  /** Findings the resolver already made: a slot it reported isn't reported again. */
  resolved: readonly Finding[];
  /** Every control the devices have, in device order, with what a fixed one sends. */
  known: Map<ControlId, KnownControl>;
  pins: Map<ControlId, PinPlan>;
}

const actionName = (game: Game, id: ActionId) => game.actions.find((a) => a.id === id)?.name ?? id;
const modeName = (game: Game, id: ModeId) => game.modes.find((m) => m.id === id)?.name ?? id;
const hasRole = (game: Game, id: ActionId, roles: readonly Role[]) => {
  const role = game.actions.find((a) => a.id === id)?.role;
  return role !== undefined && roles.includes(role);
};

function signalName(signal: Signal): string {
  switch (signal.kind) {
    case 'key':
      return [...(signal.mods ?? []), signal.code].join('+');
    case 'mouse':
      return `the ${signal.button} mouse button`;
    case 'scroll':
      return `scroll ${signal.dir}`;
    case 'pad':
      return `Xbox ${signal.control}`;
    case 'macro':
      return `the macro on ${signal.trigger}`;
  }
}

function knownControls(devices: readonly Device[]): Context['known'] {
  const known: Context['known'] = new Map();
  const azerons = devices
    .filter((d): d is AzeronDevice => d.kind === 'azeron')
    .sort((a, b) => (a.hand === b.hand ? 0 : a.hand === 'left' ? -1 : 1));
  for (const unit of azerons) {
    const prefix = unit.hand === 'left' ? 'L' : 'R';
    for (const p of unit.positions) {
      known.set(`${prefix}.${p.name}`, {
        order: known.size,
        azeron: true,
        button: p.name !== 'stick',
      });
    }
  }
  for (const device of devices) {
    if (device.kind === 'azeron') continue;
    for (const c of device.controls) {
      const entry: KnownControl = {
        order: known.size,
        azeron: false,
        button: c.kind === 'button',
      };
      if (c.sends) entry.sends = c.sends;
      known.set(c.id, entry);
    }
  }
  return known;
}

/** A mode's mapped controls in device order; ids no device has come last, by name. */
function controlsIn(ctx: Context, mode: ModeId): ControlId[] {
  const order = (c: ControlId) => ctx.known.get(c)?.order ?? Number.MAX_SAFE_INTEGER;
  return Object.keys(ctx.scheme.map[mode] ?? {}).sort(
    (a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** Every control-press with an action, in game mode order, then device order, then press. */
function* placed(ctx: Context) {
  for (const mode of ctx.game.modes) {
    for (const control of controlsIn(ctx, mode.id)) {
      for (const press of PRESSES) {
        const action = ctx.scheme.map[mode.id]?.[control]?.[press];
        if (action !== undefined) yield { mode: mode.id, control, press, action };
      }
    }
  }
}

/** The actions a control carries, in any mode. */
function actionsOn(ctx: Context, control: ControlId): ActionId[] {
  const out: ActionId[] = [];
  for (const mode of ctx.game.modes) {
    for (const press of PRESSES) {
      const action = ctx.scheme.map[mode.id]?.[control]?.[press];
      if (action !== undefined && !out.includes(action)) out.push(action);
    }
  }
  return out;
}

const pinsInOrder = (plan: Unchecked) => [...plan.units.left.pins, ...plan.units.right.pins];
const sticks = (plan: Unchecked): [ControlId, UnitProfile['stick']][] => [
  ['L.stick', plan.units.left.stick],
  ['R.stick', plan.units.right.stick],
];

/** Two actions live at once on the same signal: the game does both. Modes are never live together. */
function keyCollision(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const mode of ctx.game.modes) {
    const bySignal = new Map<string, { control: ControlId; action: ActionId; signal: Signal }[]>();
    const add = (control: ControlId, action: ActionId, signal: Signal) => {
      const id = signalId(signal);
      bySignal.set(id, [...(bySignal.get(id) ?? []), { control, action, signal }]);
    };
    for (const b of ctx.plan.bindings) if (b.mode === mode.id) add(b.control, b.action, b.signal);
    for (const control of controlsIn(ctx, mode.id)) {
      const sends = ctx.known.get(control)?.sends;
      const action = ctx.scheme.map[mode.id]?.[control]?.tap;
      if (sends && action !== undefined) add(control, action, sends);
    }
    const reported = new Set<ControlId>();
    for (const control of [...ctx.known.keys()]) {
      for (const group of bySignal.values()) {
        const actions = [...new Set(group.map((g) => g.action))];
        const mine = group.find((g) => g.control === control);
        if (!mine || actions.length < 2 || reported.has(control)) continue;
        reported.add(control);
        const names = actions.map((a) => actionName(ctx.game, a));
        const listed = `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
        out.push({
          rule: 'key-collision',
          severity: 'error',
          control,
          mode: mode.id,
          message: `In ${modeName(ctx.game, mode.id)}, ${listed} are ${names.length === 2 ? 'both' : 'all'} on ${signalName(mine.signal)}: the game does them at once.`,
        });
      }
    }
  }
  return out;
}

/** An action on a control-press that sends nothing. */
function sendsNothing(ctx: Context): Finding[] {
  const out: Finding[] = [];
  const flagged = new Set(ctx.resolved.map((f) => f.control));
  for (const { mode, control, press, action } of placed(ctx)) {
    const known = ctx.known.get(control);
    let why: string | undefined;
    if (!known) {
      why = 'is on a control none of your devices has';
    } else if (known.azeron && known.button) {
      if (ctx.pins.get(control)?.presses[press] || flagged.has(control)) continue;
      why =
        ctx.scheme.output === 'pad' && press !== 'tap'
          ? "is on a long press or double tap, which an Xbox button doesn't have"
          : ctx.scheme.output === 'pad'
            ? 'is on a button that sends no Xbox control'
            : 'is on a button that sends nothing';
    } else if (press !== 'tap') {
      // Only a unit's buttons have long presses and double taps. Keys, mouse buttons, the
      // pad's buttons and triggers, and the sticks only press.
      why = "is on a long press or double tap, which this control doesn't have";
    } else {
      continue; // a fixed control sends what it is; a stick or axis carries it through its mode
    }
    out.push({
      rule: 'sends-nothing',
      severity: 'error',
      control,
      mode,
      message: `${actionName(ctx.game, action)} ${why}, so pressing it does nothing.`,
    });
  }
  return out;
}

const LEFT_STICK: readonly PadControl[] = ['LS_UP', 'LS_DOWN', 'LS_LEFT', 'LS_RIGHT'];
const RIGHT_STICK: readonly PadControl[] = ['RS_UP', 'RS_DOWN', 'RS_LEFT', 'RS_RIGHT'];

/** A required action that is on no button in its mode. */
function missingRequired(ctx: Context): Finding[] {
  const onButton = new Set<string>();
  for (const p of placed(ctx)) onButton.add(`${p.mode}|${p.action}`);
  // With Xbox output the game listens to its own pad layout: an action is reachable when a
  // button or a stick sends the pad control it ships on.
  const padSent = new Set<PadControl>();
  if (ctx.scheme.output === 'pad') {
    for (const pin of pinsInOrder(ctx.plan)) {
      const tap = pin.presses.tap;
      if (tap?.kind === 'pad') padSent.add(tap.control);
    }
    for (const [, stick] of sticks(ctx.plan)) {
      if (stick.mode === 'pad-left') LEFT_STICK.forEach((c) => padSent.add(c));
      if (stick.mode === 'pad-right') RIGHT_STICK.forEach((c) => padSent.add(c));
    }
  }
  const out: Finding[] = [];
  for (const mode of ctx.game.modes) {
    for (const action of ctx.game.actions) {
      if (action.mode !== mode.id || !action.required) continue;
      if (onButton.has(`${mode.id}|${action.id}`)) continue;
      if (action.native?.pad !== undefined && padSent.has(action.native.pad)) continue;
      out.push({
        rule: 'missing-required',
        severity: 'error',
        action: action.id,
        mode: mode.id,
        message: `${action.name} is needed to play ${modeName(ctx.game, mode.id)}, and it is on no button.`,
      });
    }
  }
  return out;
}

/** A menu action on a button that, in the same mode, carries one you mash. */
function menuWithCombat(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const mode of ctx.game.modes) {
    for (const control of controlsIn(ctx, mode.id)) {
      const presses = ctx.scheme.map[mode.id]?.[control] ?? {};
      const actions = PRESSES.map((p) => presses[p]).filter((a): a is ActionId => a !== undefined);
      const mashed = actions.find((a) => hasRole(ctx.game, a, MASHED_ROLES));
      const menu = actions.find((a) => hasRole(ctx.game, a, ['menu']));
      if (mashed === undefined || menu === undefined) continue;
      out.push({
        rule: 'menu-with-combat',
        severity: 'error',
        control,
        mode: mode.id,
        message: `${actionName(ctx.game, menu)} shares a button with ${actionName(ctx.game, mashed)}: mashing it mid-fight opens ${actionName(ctx.game, menu)}.`,
      });
    }
  }
  return out;
}

/**
 * A long press or double tap on a button that carries an action needing a quick tap. The unit
 * holds one setting per button for every mode, so a long press in any mode delays the tap in all.
 */
function combatTapDelayed(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const pin of pinsInOrder(ctx.plan)) {
    if (!pin.presses.long && !pin.presses.double) continue;
    const critical = actionsOn(ctx, pin.control).find((a) =>
      hasRole(ctx.game, a, TAP_CRITICAL_ROLES),
    );
    if (critical === undefined) continue;
    out.push({
      rule: 'combat-tap-delayed',
      severity: 'warning',
      control: pin.control,
      message: `This button has a long press or double tap, so its tap waits to see which you meant. ${actionName(ctx.game, critical)} needs the tap at once.`,
    });
  }
  return out;
}

/** Hold-to-latch on a button that moves you: it keeps moving after you let go. */
function holdOnMovement(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const pin of pinsInOrder(ctx.plan)) {
    if (!pin.latch) continue;
    const moving = actionsOn(ctx, pin.control).find((a) => hasRole(ctx.game, a, NO_LATCH_ROLES));
    if (moving === undefined) continue;
    out.push({
      rule: 'hold-on-movement',
      severity: 'warning',
      control: pin.control,
      message: `This button stays down until pressed again, so ${actionName(ctx.game, moving)} keeps going after you let go.`,
    });
  }
  return out;
}

/** A stick that sends keyboard or mouse while the buttons send Xbox, or the other way round. */
function mixedInput(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const [control, stick] of sticks(ctx.plan)) {
    const padStick = stick.mode === 'pad-left' || stick.mode === 'pad-right';
    if ((ctx.scheme.output === 'pad') === padStick) continue;
    out.push({
      rule: 'mixed-input',
      severity: 'warning',
      control,
      message: padStick
        ? 'This stick is an Xbox stick while the buttons send keys. Some games stutter switching between the two.'
        : `This stick sends ${stick.mode === 'mouse' ? 'the mouse' : 'keys'} while the buttons are an Xbox controller. Some games stutter switching between the two.`,
    });
  }
  return out;
}

/** A stick not sending keys, for a game that needs it to. */
function stickNotKeyboard(ctx: Context): Finding[] {
  if (ctx.game.needsKeyStick !== true) return [];
  return sticks(ctx.plan)
    .filter(([, stick]) => stick.mode !== 'keys')
    .map(([control]) => ({
      rule: 'stick-not-keyboard',
      severity: 'error' as const,
      control,
      message: `${ctx.game.name} needs this stick to send keys: as an Xbox stick it stutters, and as a mouse it spins.`,
    }));
}

const CHECKS: Record<CheckRule, (ctx: Context) => Finding[]> = {
  'key-collision': keyCollision,
  'sends-nothing': sendsNothing,
  'missing-required': missingRequired,
  'menu-with-combat': menuWithCombat,
  'combat-tap-delayed': combatTapDelayed,
  'hold-on-movement': holdOnMovement,
  'mixed-input': mixedInput,
  'stick-not-keyboard': stickNotKeyboard,
};

/**
 * Run every check on a plan, in CHECK_RULES order. A finding the scheme accepted stays in the
 * list, marked with the player's reason.
 */
export function runChecks(
  scheme: Scheme,
  game: Game,
  devices: readonly Device[],
  plan: Unchecked,
  resolved: readonly Finding[],
): Finding[] {
  const ctx: Context = {
    scheme,
    game,
    plan,
    resolved,
    known: knownControls(devices),
    pins: new Map(pinsInOrder(plan).map((p) => [p.control, p])),
  };
  return CHECK_RULES.flatMap((rule) => CHECKS[rule](ctx)).map((finding) => {
    const accepted = scheme.accepted.find(
      (a) =>
        a.rule === finding.rule && a.control === finding.control && a.action === finding.action,
    );
    return accepted ? { ...finding, accepted: accepted.reason } : finding;
  });
}
