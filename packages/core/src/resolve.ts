import type {
  Action,
  ActionId,
  AzeronDevice,
  ControlId,
  Device,
  Game,
  Hand,
  ModeId,
  Press,
  Scheme,
  Signal,
} from './model';
import { PRESSES, STICK_DIRECTIONS } from './model';
import type {
  Binding,
  BindingSet,
  Finding,
  GameBinding,
  Ledger,
  PinPlan,
  Plan,
  UnitProfile,
} from './plan';
import { clone } from './clone';
import { KEY_POOL, formatCanName } from './pool';
import { signalId } from './signal';
import { runChecks } from './checks';
import type { Setup } from './setup';
import { bindingSetOf, inSetup, setsUsed, setupOf, stickModeOf, stickSends } from './setup';

export { signalId };

export class ResolveError extends Error {}

function azeron(devices: readonly Device[], hand: 'left' | 'right'): AzeronDevice {
  const unit = devices.find((d): d is AzeronDevice => d.kind === 'azeron' && d.hand === hand);
  if (!unit) throw new ResolveError(`No ${hand} Azeron among the devices`);
  return unit;
}

const prefixOf = (unit: AzeronDevice) => (unit.hand === 'left' ? 'L' : 'R');

/** Every button control on the units, in device order: left then right, each in its own order. */
function buttonControls(units: readonly AzeronDevice[]): string[] {
  return units.flatMap((unit) =>
    unit.positions.filter((p) => p.name !== 'stick').map((p) => `${prefixOf(unit)}.${p.name}`),
  );
}

const slot = (control: string, press: Press) => `${control}|${press}`;

interface Dealt {
  signals: Map<string, Signal>;
  ledger: Ledger;
  findings: Finding[];
}

/** Which actions a control-press carries, in the game's mode order. */
function carried(scheme: Scheme, game: Game, control: string, press: Press) {
  const out: { mode: ModeId; action: ActionId }[] = [];
  for (const mode of game.modes) {
    const action = scheme.map[mode.id]?.[control]?.[press];
    if (action !== undefined) out.push({ mode: mode.id, action });
  }
  return out;
}

/**
 * Whether a unit can send the signal on this press. Scroll was only seen written on a tap
 * (reference/guides/unit-protocol.md), and a unit is sent only what the Azeron app was seen to send.
 */
function canSend(signal: Signal, press: Press): boolean {
  return signal.kind !== 'scroll' || press === 'tap';
}

function dealPad(scheme: Scheme, controls: readonly string[]): Dealt {
  const signals = new Map<string, Signal>();
  for (const control of controls) {
    const pad = scheme.padMap[control];
    // A pad button has no long or double press of its own: only the tap sends.
    if (pad !== undefined) signals.set(slot(control, 'tap'), { kind: 'pad', control: pad });
  }
  return { signals, ledger: clone(scheme.ledger), findings: [] };
}

/*
 * STICK DIRECTION KEYS: the rules, in one place. Every reader of them (dealKeys here, and
 * keyCollision and missingRequired in checks.ts) follows these.
 *
 * 1. Only a stick in keys mode sends its directions, in every game mode. A stick in any other
 *    mode sends nothing: its directions are not reserved, not collided, not counted, and not in
 *    the plan.
 * 2. A direction's key never comes from the pool: it is taken before any button is dealt one.
 * 3. A direction reaches the actions the game ships on its key (an action's native key). A button
 *    carrying such an action may send that same key: two ways to do one thing, with no finding
 *    and no bind sheet row. This holds with the game's file written too, for a key it can name.
 * 4. Different actions on one key is a key-collision error on the stick, in each mode where the
 *    other action is on a button or a fixed control. The same key on a button in another mode
 *    is judged in that mode.
 * 5. A bind sheet row, or a rewritten game file, never moves an action off a key a stick sends
 *    for it: it would break the stick. The resolver says so (`stick-key-rebind`) instead. The
 *    same holds for an Xbox stick and the stick directions it sends (`gameBindings`).
 * 6. missing-required counts an action a stick direction reaches.
 * 7. The ledger holds button keys only. A stick's keys are never written into it.
 */

/** Every key a key-mode stick sends, by signal id, with the hand that sends it. */
function stickKeySignals(scheme: Scheme): Map<string, 'left' | 'right'> {
  const out = new Map<string, 'left' | 'right'>();
  for (const [prefix, hand] of [
    ['L', 'left'],
    ['R', 'right'],
  ] as const) {
    const stick = scheme.behaviour[`${prefix}.stick`]?.stick;
    if (stick?.mode !== 'keys') continue;
    for (const direction of STICK_DIRECTIONS) {
      const signal = stick.directions?.[direction];
      if (signal && !out.has(signalId(signal))) out.set(signalId(signal), hand);
    }
  }
  return out;
}

/**
 * Key output. In device order, each control-press that carries an action gets one signal for
 * every mode: its ledger entry if it has one; otherwise, with the game's file written, the next
 * free key from the pool the file can name; otherwise the game's own key for the action, or a
 * pool key (and so a changed game binding) when that key can't be used. A key the setup's
 * keyboard or mouse already carries an action on is taken, as a stick's is.
 */
function dealKeys(
  scheme: Scheme,
  game: Game,
  controls: readonly string[],
  fixedTaken: ReadonlySet<string>,
): Dealt {
  const ledger: Ledger = clone(scheme.ledger);
  const signals = new Map<string, Signal>();
  const findings: Finding[] = [];
  const format = scheme.writeGameFile ? game.file?.format : undefined;
  const actions = new Map(game.actions.map((a) => [a.id, a]));

  // Every key the ledger holds is taken, mapped or not: a key once given is never re-dealt. So is
  // a key the keyboard or the mouse already does something with.
  const taken = new Set<string>(fixedTaken);
  for (const control of Object.keys(ledger).sort()) {
    for (const press of PRESSES) {
      const signal = ledger[control]?.[press];
      if (signal) taken.add(signalId(signal));
    }
  }

  // Rule 2: a key a stick direction sends is not the pool's to give.
  const stickKeys = stickKeySignals(scheme);

  const fromPool = (): Signal | undefined => {
    const code = KEY_POOL.find(
      (key) =>
        !taken.has(signalId({ kind: 'key', code: key })) &&
        !stickKeys.has(signalId({ kind: 'key', code: key })) &&
        (format === undefined || formatCanName(format, key)),
    );
    return code === undefined ? undefined : { kind: 'key', code };
  };

  for (const control of controls) {
    for (const press of PRESSES) {
      const carriedHere = carried(scheme, game, control, press);
      if (carriedHere.length === 0) continue;
      let signal = ledger[control]?.[press];
      if (signal?.kind === 'key' && format !== undefined && !formatCanName(format, signal.code)) {
        // A key dealt while the game kept its own keys can be one this file has no name for.
        // The ledger keeps it: say so rather than hand back a file that can't be written.
        findings.push({
          rule: 'key-unnamable',
          severity: 'error',
          control,
          message: `This button sends ${signal.code}, which the game's file has no name for. Move its action to another button.`,
        });
      }
      if (!signal) {
        // The game's own key, from the first mode that has a usable one. With the game's file
        // written only a key a stick already sends for the action counts (rule 3).
        signal = carriedHere
          .map((c) => actions.get(c.action)?.native?.key)
          .find(
            (s): s is Signal =>
              s !== undefined &&
              canSend(s, press) &&
              !taken.has(signalId(s)) &&
              (format === undefined ||
                (stickKeys.has(signalId(s)) && s.kind === 'key' && formatCanName(format, s.code))),
          );
      }
      signal ??= fromPool();
      if (!signal) {
        findings.push({
          rule: 'pool-spent',
          severity: 'error',
          control,
          // Keys are never re-dealt, so taking an action off a button frees no key. What works is
          // moving this action to a button that was emptied: that button keeps its key.
          message:
            'Every key is taken. Move this action to a button you have emptied: it still has its key.',
        });
        continue;
      }
      taken.add(signalId(signal));
      (ledger[control] ??= {})[press] = signal;
      signals.set(slot(control, press), signal);
    }
  }
  return { signals, ledger, findings };
}

function unitProfile(
  scheme: Scheme,
  unit: AzeronDevice,
  signals: Map<string, Signal>,
): UnitProfile {
  const prefix = prefixOf(unit);
  const pins: PinPlan[] = unit.positions
    .filter((p) => p.name !== 'stick')
    .map((p) => {
      const control = `${prefix}.${p.name}`;
      const behaviour = scheme.behaviour[control] ?? {};
      const presses: PinPlan['presses'] = {};
      for (const press of PRESSES) {
        const signal = signals.get(slot(control, press));
        if (signal) presses[press] = signal;
      }
      const pin: PinPlan = {
        control,
        position: p.name,
        pin: p.pin,
        presses,
        turbo: behaviour.turbo ? { interval: behaviour.turbo.interval } : false,
        latch: behaviour.latch === true,
      };
      if (p.pinTwo !== undefined) pin.pinTwo = p.pinTwo;
      return pin;
    });
  const stickBehaviour = scheme.behaviour[`${prefix}.stick`]?.stick ?? {
    mode: stickModeOf(scheme, unit.hand),
  };
  // Rule 1: directions belong to key mode only.
  const { directions, ...rest } = stickBehaviour;
  return {
    deviceId: unit.id,
    hand: unit.hand,
    pins,
    stick: {
      ...rest,
      ...(stickBehaviour.mode === 'keys' && directions ? { directions } : {}),
      angle: unit.stick.angle,
      invertX: stickBehaviour.invertX ?? unit.stick.invertX,
    },
  };
}

/** The fixed controls the setup uses (keys, mouse buttons, the controller's), in device order. */
function fixedControls(devices: readonly Device[], setup: Setup): Map<ControlId, Signal> {
  const out = new Map<ControlId, Signal>();
  for (const device of devices) {
    if (device.kind !== 'kbm' && device.kind !== 'pad') continue;
    for (const control of device.controls) {
      if (control.sends && inSetup(setup, control.id)) out.set(control.id, control.sends);
    }
  }
  return out;
}

/**
 * Every mapped action, with the signal that reaches it, in the game's mode order: the units'
 * control-presses in device order, then the fixed controls' (a key, a mouse button or a controller
 * button only taps).
 */
function bindings(
  scheme: Scheme,
  game: Game,
  controls: readonly string[],
  signals: Map<string, Signal>,
  fixed: ReadonlyMap<ControlId, Signal>,
): Binding[] {
  const out: Binding[] = [];
  for (const mode of game.modes) {
    const byControl = scheme.map[mode.id] ?? {};
    for (const control of controls) {
      for (const press of PRESSES) {
        const action = byControl[control]?.[press];
        const signal = signals.get(slot(control, press));
        if (action !== undefined && signal) {
          out.push({ mode: mode.id, control, press, action, signal });
        }
      }
    }
    for (const [control, signal] of fixed) {
      const action = Object.hasOwn(byControl, control) ? byControl[control]?.tap : undefined;
      if (action !== undefined) out.push({ mode: mode.id, control, press: 'tap', action, signal });
    }
  }
  return out;
}

/** What the game ships an action on in one binding set. */
export function nativeIn(action: Action, set: BindingSet): Signal | null {
  if (set === 'controller') {
    return action.native?.pad === undefined ? null : { kind: 'pad', control: action.native.pad };
  }
  return action.native?.key ?? null;
}

const signalWords = (signal: Signal): string =>
  signal.kind === 'key'
    ? signal.code
    : signal.kind === 'pad'
      ? `Xbox ${signal.control}`
      : signal.kind === 'mouse'
        ? `the ${signal.button} mouse button`
        : 'its own control';

/*
 * GAME BINDINGS: the rules, in one place. For each binding set the setup uses, every action of the
 * game, in its own mode, is on exactly one of these (the first that applies):
 *
 * 1. Reached by a stick: a stick of the setup sends what the game ships the action on. It stays
 *    there. A control-press carrying it that sends anything else is `stick-key-rebind` (rule 5 of
 *    STICK DIRECTION KEYS, now for Xbox sticks too): rebinding it would break the stick.
 * 2. Placed: on what each control-press of the setup carrying it sends. A pad control is one live
 *    control on the controller and on every Azeron button sending it: one shared controller set.
 *    In the controller set an action on two different pad controls is `pad-bound-twice`.
 * 3. Shipped on nothing in this set: on nothing.
 * 4. Shipped on something that carries, in this mode, an action the game also ships there: kept,
 *    as the game's own second use of one control (Helldivers 2: Climb on a held A, Interact on
 *    the tap).
 * 5. Shipped on something that carries, in this mode, another action put there: on nothing. It is
 *    displaced: the control now does what the setup put on it, and only that.
 * 6. Shipped on something the setup sends that carries nothing in this mode, when it is an Xbox
 *    control (from the controller or an Azeron button), or a key or mouse button of the setup's own
 *    keyboard or mouse: on nothing. The controller set is the setup's to the last control, and so
 *    is a device the setup names: a control shown empty does nothing.
 * 7. Otherwise: kept where the game ships it. Nothing of the setup's sends it, or only an Azeron
 *    button sending keys, for an action of another mode (J4 with the game's own keys: one key, a
 *    job per mode, and the game's own job for it in the modes the button is empty in).
 */
function gameBindings(
  scheme: Scheme,
  game: Game,
  bound: readonly Binding[],
  sticks: ReadonlyMap<string, string>,
  fixed: ReadonlyMap<ControlId, Signal>,
  pins: readonly PinPlan[],
): { rows: GameBinding[]; findings: Finding[] } {
  const rows: GameBinding[] = [];
  const findings: Finding[] = [];
  const byId = new Map(game.actions.map((a) => [a.id, a]));
  // What a control shown empty must not do: the fixed devices' signals, and every Xbox control.
  const ownSent = new Set([...fixed.values()].map(signalId));
  for (const pin of pins) {
    const tap = pin.presses.tap;
    if (tap?.kind === 'pad') ownSent.add(signalId(tap));
  }
  for (const set of setsUsed(scheme)) {
    for (const mode of game.modes) {
      const here = bound.filter((b) => b.mode === mode.id && bindingSetOf(b.signal) === set);
      for (const action of game.actions) {
        if (action.mode !== mode.id) continue;
        const native = nativeIn(action, set);
        const row = (signal: Signal | null): GameBinding => ({
          set,
          mode: mode.id,
          action: action.id,
          signal,
          native,
        });
        const mine = here.filter((b) => b.action === action.id);
        const stick = native === null ? undefined : sticks.get(signalId(native));
        if (native !== null && stick !== undefined) {
          rows.push(row(native));
          for (const b of mine) {
            if (signalId(b.signal) === signalId(native)) continue;
            findings.push({
              rule: 'stick-key-rebind',
              severity: 'error',
              control: b.control,
              mode: mode.id,
              message:
                set === 'keyboard'
                  ? `${action.name} would move off ${signalWords(native)}, which ${stick} sends for it. Keep it on its own key, on one button.`
                  : `${action.name} would move off ${signalWords(native)}, which ${stick} sends for it. Keep it on the stick.`,
            });
          }
          continue;
        }
        const placed = [...new Map(mine.map((b) => [signalId(b.signal), b])).values()];
        if (placed.length > 0) {
          for (const b of placed) rows.push(row(b.signal));
          const second = placed[1];
          if (set === 'controller' && second !== undefined) {
            findings.push({
              rule: 'pad-bound-twice',
              severity: 'error',
              control: second.control,
              mode: mode.id,
              message: `${action.name} is on ${placed.map((b) => signalWords(b.signal)).join(' and ')}, and the game's controller settings give it one button: take it off one.`,
            });
          }
          continue;
        }
        if (native === null) {
          rows.push(row(null));
          continue;
        }
        const on = here.filter((b) => signalId(b.signal) === signalId(native));
        const shared = on.some((b) => {
          const other = byId.get(b.action);
          const otherNative = other === undefined ? null : nativeIn(other, set);
          return otherNative !== null && signalId(otherNative) === signalId(native);
        });
        const off = shared ? false : on.length > 0 || ownSent.has(signalId(native));
        rows.push(row(off ? null : native));
      }
    }
  }
  return { rows, findings };
}

/** Whether a game binding is not what the game ships. */
export function bindingChanged(binding: GameBinding): boolean {
  if (binding.signal === null || binding.native === null) return binding.signal !== binding.native;
  return signalId(binding.signal) !== signalId(binding.native);
}

/** resolve(scheme, game, devices) → Plan. Pure and deterministic. */
export function resolve(scheme: Scheme, game: Game, devices: readonly Device[]): Plan {
  if (scheme.gameId !== game.id) {
    throw new ResolveError(`Scheme ${scheme.id} is for ${scheme.gameId}, not ${game.id}`);
  }
  const setup = setupOf(scheme.devices);
  const units = setup.hands.map((hand) => azeron(devices, hand));
  const controls = buttonControls(units);
  const fixed = fixedControls(devices, setup);
  const dealt =
    scheme.output === 'pad'
      ? dealPad(scheme, controls)
      : dealKeys(scheme, game, controls, fixedTaken(scheme, game, fixed));
  const profiles: Partial<Record<Hand, UnitProfile>> = {};
  for (const unit of units) profiles[unit.hand] = unitProfile(scheme, unit, dealt.signals);
  const bound = bindings(scheme, game, controls, dealt.signals, fixed);
  const rebound = gameBindings(scheme, game, bound, stickSends(scheme), fixed, [
    ...(profiles.left?.pins ?? []),
    ...(profiles.right?.pins ?? []),
  ]);
  const written = scheme.writeGameFile && game.file !== undefined;
  const plan: Plan = {
    units: profiles,
    bindings: bound,
    gameBindings: rebound.rows,
    bindSheet: written ? [] : rebound.rows.filter(bindingChanged),
    ledger: dealt.ledger,
    findings: [],
  };
  if (written && game.file) plan.gameFile = { format: game.file.format };
  // The resolver's own findings come first and can't be accepted; then the checks.
  const own = [...dealt.findings, ...rebound.findings];
  plan.findings = [...own, ...runChecks(scheme, game, devices, plan, own)];
  return plan;
}

/** Keys the setup's keyboard or mouse carries an action on, in any mode: not the pool's to give. */
function fixedTaken(
  scheme: Scheme,
  game: Game,
  fixed: ReadonlyMap<ControlId, Signal>,
): Set<string> {
  const out = new Set<string>();
  for (const mode of game.modes) {
    const byControl = scheme.map[mode.id] ?? {};
    for (const [control, signal] of fixed) {
      if (Object.hasOwn(byControl, control) && byControl[control]?.tap !== undefined) {
        out.add(signalId(signal));
      }
    }
  }
  return out;
}
