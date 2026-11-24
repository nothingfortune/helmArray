// The checks from docs/plans/01-features.md. Each came from a play session that went wrong;
// reference/legacy/CLAUDE.md ("Hard-won constraints") tells the story behind each.

import type {
  ActionId,
  AzeronDevice,
  ControlId,
  Device,
  Game,
  ModeId,
  Role,
  Scheme,
  Signal,
  StickDirection,
} from './model';
import { PRESSES, STICK_DIRECTIONS } from './model';
import type { Finding, GameBinding, PinPlan, Plan, UnitProfile } from './plan';
import { hasAction } from './game-data';
import { own } from './own';
import { signalId } from './signal';
import type { Setup } from './setup';
import { isPlaced } from './placed';
import { inSetup, setupOf, setupSends, stickModeOf } from './setup';

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
  'stick-no-directions',
  'action-deleted',
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
  setup: Setup;
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
  return Object.keys(own(ctx.scheme.map, mode) ?? {}).sort(
    (a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** Every control-press with an action, in game mode order, then device order, then press. */
function* placed(ctx: Context) {
  for (const mode of ctx.game.modes) {
    for (const control of controlsIn(ctx, mode.id)) {
      for (const press of PRESSES) {
        const action = ctx.scheme.map[mode.id]?.[control]?.[press];
        // One the game no longer has here is on nothing: only action-deleted speaks of it.
        if (action !== undefined && hasAction(ctx.game, mode.id, action))
          yield { mode: mode.id, control, press, action };
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

/** The pins of the units the setup uses, left first. */
const pinsInOrder = (plan: Unchecked) => [
  ...(plan.units.left?.pins ?? []),
  ...(plan.units.right?.pins ?? []),
];
/** The sticks of the units the setup uses, left first. */
const sticks = (plan: Unchecked): [ControlId, UnitProfile['stick']][] => [
  ...(plan.units.left
    ? [['L.stick', plan.units.left.stick] as [ControlId, UnitProfile['stick']]]
    : []),
  ...(plan.units.right
    ? [['R.stick', plan.units.right.stick] as [ControlId, UnitProfile['stick']]]
    : []),
];

/** Every key a stick in key mode sends, with the stick and direction that sends it. */
function stickKeys(plan: Unchecked) {
  const out: { control: ControlId; direction: StickDirection; signal: Signal }[] = [];
  for (const [control, stick] of sticks(plan)) {
    if (stick.mode !== 'keys') continue;
    for (const direction of STICK_DIRECTIONS) {
      const signal = stick.directions?.[direction];
      if (signal) out.push({ control, direction, signal });
    }
  }
  return out;
}

/** Two actions live at once on the same signal: the game does both. Modes are never live together. */
function keyCollision(ctx: Context): Finding[] {
  const out: Finding[] = [];
  /** Signals already reported in a mode, by `mode|signal id`: one finding is enough. */
  const said = new Set<string>();
  for (const mode of ctx.game.modes) {
    const bySignal = new Map<string, { control: ControlId; action: ActionId; signal: Signal }[]>();
    const add = (control: ControlId, action: ActionId, signal: Signal) => {
      const id = signalId(signal);
      bySignal.set(id, [...(bySignal.get(id) ?? []), { control, action, signal }]);
    };
    // The units' control-presses and the setup's fixed controls (a key, a mouse button, a
    // controller button): a controller button and an Azeron button sending the same pad control
    // are one live control in the game's shared controller set.
    for (const b of ctx.plan.bindings) if (b.mode === mode.id) add(b.control, b.action, b.signal);
    const reported = new Set<ControlId>();
    for (const control of [...ctx.known.keys()]) {
      for (const group of bySignal.values()) {
        const actions = [...new Set(group.map((g) => g.action))];
        const mine = group.find((g) => g.control === control);
        if (!mine || actions.length < 2 || reported.has(control)) continue;
        reported.add(control);
        said.add(`${mode.id}|${signalId(mine.signal)}`);
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
  // A stick direction is live in every mode (rules in resolve.ts: STICK DIRECTION KEYS). A button
  // or fixed control sending its key does both at once, unless it is the same action: a second
  // way to do one thing. The stick reaches the actions the game ships on its key.
  for (const { control, direction, signal } of stickKeys(ctx.plan)) {
    for (const mode of ctx.game.modes) {
      const reached = new Set(
        ctx.game.actions
          .filter(
            (a) =>
              a.mode === mode.id &&
              a.native?.key !== undefined &&
              signalId(a.native.key) === signalId(signal),
          )
          .map((a) => a.id),
      );
      const live: { action: ActionId; signal: Signal }[] = ctx.plan.bindings.filter(
        (b) => b.mode === mode.id,
      );
      const clash = live.find(
        (b) => signalId(b.signal) === signalId(signal) && !reached.has(b.action),
      );
      if (!clash) continue;
      said.add(`${mode.id}|${signalId(signal)}`);
      out.push({
        rule: 'key-collision',
        severity: 'error',
        control,
        mode: mode.id,
        message: `In ${modeName(ctx.game, mode.id)}, the ${control.startsWith('L.') ? 'left' : 'right'} stick's ${direction} and ${actionName(ctx.game, clash.action)} are both on ${signalName(signal)}: the game does them at once.`,
      });
    }
  }
  // Whatever put them there (a stick, a button, the controller's button, a key kept where the game
  // ships it), two actions the game ends up binding to one signal in one mode are done at once.
  // The game's own second use of a control (it ships both there: Climb on a held A beside Interact)
  // is not one. Named on the control of the setup that put an action there.
  for (const mode of ctx.game.modes) {
    const bySignal = new Map<string, GameBinding[]>();
    for (const b of ctx.plan.gameBindings) {
      if (b.mode !== mode.id || b.signal === null) continue;
      const id = `${b.set}|${signalId(b.signal)}`;
      bySignal.set(id, [...(bySignal.get(id) ?? []), b]);
    }
    for (const rows of bySignal.values()) {
      const first = rows[0];
      if (first === undefined || first.signal === null) continue;
      const signal = first.signal;
      const id = signalId(signal);
      const actions = [...new Set(rows.map((r) => r.action))];
      const moved = rows.filter((r) => r.native === null || signalId(r.native) !== id);
      if (actions.length < 2 || moved.length === 0 || said.has(`${mode.id}|${id}`)) continue;
      const by = ctx.plan.bindings.find(
        (b) =>
          b.mode === mode.id &&
          signalId(b.signal) === id &&
          moved.some((r) => r.action === b.action),
      );
      if (by === undefined) continue;
      said.add(`${mode.id}|${id}`);
      const names = actions.map((a) => actionName(ctx.game, a));
      const listed = `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
      out.push({
        rule: 'key-collision',
        severity: 'error',
        control: by.control,
        mode: mode.id,
        message: `In ${modeName(ctx.game, mode.id)}, ${listed} are ${names.length === 2 ? 'both' : 'all'} on ${signalName(signal)}: the game does them at once.`,
      });
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
    } else if (!inSetup(ctx.setup, control)) {
      why = "is on a control this scheme doesn't use";
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

/**
 * A required action that is on no button in its mode. The game is rebound to the setup, so an
 * action is reached only by a control of the setup carrying it, or by a stick of the setup that the
 * game's bindings put it on (a key stick's direction keys; an Xbox stick, the Azerons' or the
 * controller's, and its four directions). What a button happens to send is never enough: the
 * game's controller bindings follow the setup, not the other way round. Whether it is placed is
 * `isPlaced`'s to say, the one place every view asks.
 */
function missingRequired(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const mode of ctx.game.modes) {
    for (const action of ctx.game.actions) {
      if (action.mode !== mode.id || !action.required) continue;
      if (isPlaced(ctx.scheme, ctx.game, ctx.plan, mode.id, action.id)) continue;
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

/**
 * Xbox output and keys mixed in one setup: a stick that sends keyboard or mouse while the buttons
 * send Xbox, or the other way round; and a setup whose devices send both (a controller, or Azerons
 * as one, with a keyboard, a mouse, or Azerons sending keys).
 */
function mixedInput(ctx: Context): Finding[] {
  const out: Finding[] = [];
  // The setup's own mix: what isn't a stick sends into both sets. A stick's own mix is said below.
  const sends = setupSends(ctx.scheme);
  const notSticks = (set: 'keyboard' | 'controller') =>
    sends[set].some((s) => !s.endsWith('.stick'));
  if (notSticks('keyboard') && notSticks('controller')) {
    out.push({
      rule: 'mixed-input',
      severity: 'warning',
      message:
        'This scheme mixes an Xbox controller with keyboard and mouse. Some games stutter switching between the two.',
    });
  }
  // A stick sending into the other set from the units' buttons (`setupSends`, the one place).
  const buttons = sends.controller.includes('buttons') ? 'controller' : 'keyboard';
  const other = buttons === 'controller' ? 'keyboard' : 'controller';
  if (sends[buttons].includes('buttons')) {
    for (const control of sends[other].filter((s) => s.endsWith('.stick'))) {
      const mode = stickModeOf(ctx.scheme, control.startsWith('L.') ? 'left' : 'right');
      out.push({
        rule: 'mixed-input',
        severity: 'warning',
        control,
        message:
          other === 'controller'
            ? 'This stick is an Xbox stick while the buttons send keys. Some games stutter switching between the two.'
            : `This stick sends ${mode === 'mouse' ? 'the mouse' : 'keys'} while the buttons are an Xbox controller. Some games stutter switching between the two.`,
      });
    }
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

/** A stick in key mode with no direction keys: it is set to send keys and sends none. */
function stickNoDirections(ctx: Context): Finding[] {
  return sticks(ctx.plan)
    .filter(
      ([, stick]) =>
        stick.mode === 'keys' &&
        !STICK_DIRECTIONS.some((direction) => stick.directions?.[direction] !== undefined),
    )
    .map(([control]) => ({
      rule: 'stick-no-directions',
      severity: 'error' as const,
      control,
      message: `The ${control.startsWith('L.') ? 'left' : 'right'} stick sends nothing: give its directions keys or set it to a controller stick.`,
    }));
}

/**
 * An action the game no longer has, still on a control: deleted from the game, gone with its mode,
 * or moved to another mode. Editing a game never rewrites a setup, so the setup keeps naming it;
 * the resolver puts it on nothing, and the control does nothing for it. A warning, not an error:
 * nothing is sent wrong, and Apply can go ahead. Every mode the setup has is read, not only the
 * game's, so an action that went with its mode is found too (with no mode to show it in).
 */
function actionDeleted(ctx: Context): Finding[] {
  const out: Finding[] = [];
  const gameModes = ctx.game.modes.map((m) => m.id);
  const setupModes = Object.keys(ctx.scheme.map);
  const modes = [
    ...gameModes.filter((m) => setupModes.includes(m)),
    ...setupModes.filter((m) => !gameModes.includes(m)),
  ];
  for (const mode of modes) {
    const byControl = own(ctx.scheme.map, mode) ?? {};
    for (const control of controlsIn(ctx, mode)) {
      const presses = own(byControl, control) ?? {};
      const gone = PRESSES.map((p) => presses[p]).find(
        (a): a is ActionId => a !== undefined && !hasAction(ctx.game, mode, a),
      );
      if (gone === undefined) continue;
      out.push({
        rule: 'action-deleted',
        severity: 'warning',
        control,
        ...(gameModes.includes(mode) ? { mode } : {}),
        action: gone,
        message: `The action on this ${control.startsWith('key.') ? 'key' : 'button'} was deleted from ${ctx.game.name}, so pressing it does nothing.`,
      });
    }
  }
  return out;
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
  'stick-no-directions': stickNoDirections,
  'action-deleted': actionDeleted,
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
    setup: setupOf(scheme.devices),
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
