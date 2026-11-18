import type {
  ActionId,
  AzeronDevice,
  Device,
  Game,
  ModeId,
  Press,
  Scheme,
  Signal,
  StickBehaviour,
} from './model';
import { PRESSES } from './model';
import type { BindSheetRow, Binding, Finding, Ledger, PinPlan, Plan, UnitProfile } from './plan';
import { clone } from './clone';
import { KEY_POOL, formatCanName } from './pool';

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

/** A signal as a comparable string. Two control-presses may never send the same one. */
export function signalId(signal: Signal): string {
  switch (signal.kind) {
    case 'key':
      return `key:${[...(signal.mods ?? [])].sort().join('+')}+${signal.code}`;
    case 'mouse':
      return `mouse:${signal.button}`;
    case 'scroll':
      return `scroll:${signal.dir}`;
    case 'pad':
      return `pad:${signal.control}`;
    case 'macro':
      return `macro:${signal.trigger}`;
  }
}

const slot = (control: string, press: Press) => `${control}|${press}`;

interface Dealt {
  signals: Map<string, Signal>;
  ledger: Ledger;
  bindSheet: BindSheetRow[];
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

function dealPad(scheme: Scheme, controls: readonly string[]): Dealt {
  const signals = new Map<string, Signal>();
  for (const control of controls) {
    const pad = scheme.padMap[control];
    // A pad button has no long or double press of its own: only the tap sends.
    if (pad !== undefined) signals.set(slot(control, 'tap'), { kind: 'pad', control: pad });
  }
  return { signals, ledger: clone(scheme.ledger), bindSheet: [], findings: [] };
}

/**
 * Key output. In device order, each control-press that carries an action gets one signal for
 * every mode: its ledger entry if it has one; otherwise, with the game's file written, the next
 * free key from the pool the file can name; otherwise the game's own key for the action, or a
 * pool key and a bind sheet row when that key can't be used.
 */
function dealKeys(scheme: Scheme, game: Game, controls: readonly string[]): Dealt {
  const ledger: Ledger = clone(scheme.ledger);
  const signals = new Map<string, Signal>();
  const bindSheet: BindSheetRow[] = [];
  const findings: Finding[] = [];
  const format = scheme.writeGameFile ? game.file?.format : undefined;
  const actions = new Map(game.actions.map((a) => [a.id, a]));

  // Every key the ledger holds is taken, mapped or not: a key once given is never re-dealt.
  const taken = new Set<string>();
  for (const control of Object.keys(ledger).sort()) {
    for (const press of PRESSES) {
      const signal = ledger[control]?.[press];
      if (signal) taken.add(signalId(signal));
    }
  }

  const fromPool = (): Signal | undefined => {
    const code = KEY_POOL.find(
      (key) =>
        !taken.has(signalId({ kind: 'key', code: key })) &&
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
          message: `This button sends ${signal.code}, which the game's file has no name for. Give it a new key.`,
        });
      }
      if (!signal && format === undefined) {
        // The game's own key, from the first mode that has a usable one.
        signal = carriedHere
          .map((c) => actions.get(c.action)?.native?.key)
          .find((s): s is Signal => s !== undefined && !taken.has(signalId(s)));
      }
      signal ??= fromPool();
      if (!signal) {
        findings.push({
          rule: 'pool-spent',
          severity: 'error',
          control,
          message: 'No free key is left to send this button. Take an action off another button.',
        });
        continue;
      }
      taken.add(signalId(signal));
      (ledger[control] ??= {})[press] = signal;
      signals.set(slot(control, press), signal);
      if (format === undefined) {
        for (const c of carriedHere) {
          const native = actions.get(c.action)?.native?.key;
          if (!native || signalId(native) !== signalId(signal)) {
            bindSheet.push({ mode: c.mode, action: c.action, signal });
          }
        }
      }
    }
  }
  return { signals, ledger, bindSheet, findings };
}

function defaultStick(scheme: Scheme, unit: AzeronDevice): StickBehaviour {
  if (scheme.output === 'pad') return { mode: unit.hand === 'left' ? 'pad-left' : 'pad-right' };
  return { mode: 'keys' };
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
        turbo: behaviour.turbo === true,
        latch: behaviour.latch === true,
      };
      if (p.pinTwo !== undefined) pin.pinTwo = p.pinTwo;
      return pin;
    });
  const stickBehaviour = scheme.behaviour[`${prefix}.stick`]?.stick ?? defaultStick(scheme, unit);
  return {
    deviceId: unit.id,
    hand: unit.hand,
    pins,
    stick: {
      ...stickBehaviour,
      angle: unit.stick.angle,
      invertX: stickBehaviour.invertX ?? unit.stick.invertX,
    },
  };
}

/** Every mapped action, with the signal that reaches it, in the game's mode order. */
function bindings(
  scheme: Scheme,
  game: Game,
  controls: readonly string[],
  signals: Map<string, Signal>,
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
  }
  return out;
}

/** resolve(scheme, game, devices) → Plan. Pure and deterministic. */
export function resolve(scheme: Scheme, game: Game, devices: readonly Device[]): Plan {
  if (scheme.gameId !== game.id) {
    throw new ResolveError(`Scheme ${scheme.id} is for ${scheme.gameId}, not ${game.id}`);
  }
  const units = [azeron(devices, 'left'), azeron(devices, 'right')] as const;
  const controls = buttonControls(units);
  const dealt =
    scheme.output === 'pad' ? dealPad(scheme, controls) : dealKeys(scheme, game, controls);
  const plan: Plan = {
    units: {
      left: unitProfile(scheme, units[0], dealt.signals),
      right: unitProfile(scheme, units[1], dealt.signals),
    },
    bindings: bindings(scheme, game, controls, dealt.signals),
    bindSheet: dealt.bindSheet,
    ledger: dealt.ledger,
    findings: dealt.findings,
  };
  if (scheme.output === 'keys' && scheme.writeGameFile && game.file) {
    plan.gameFile = { format: game.file.format };
  }
  return plan;
}
