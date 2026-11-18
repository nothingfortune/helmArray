import type { AzeronDevice, Device, Game, Press, Scheme, Signal, StickBehaviour } from './model';
import { PRESSES } from './model';
import type { Binding, Plan, PinPlan, UnitProfile } from './plan';

export class ResolveError extends Error {}

function azeron(devices: readonly Device[], hand: 'left' | 'right'): AzeronDevice {
  const unit = devices.find((d): d is AzeronDevice => d.kind === 'azeron' && d.hand === hand);
  if (!unit) throw new ResolveError(`No ${hand} Azeron among the devices`);
  return unit;
}

function defaultStick(scheme: Scheme, unit: AzeronDevice): StickBehaviour {
  if (scheme.output === 'pad') return { mode: unit.hand === 'left' ? 'pad-left' : 'pad-right' };
  return { mode: 'keys' };
}

/**
 * What a control-press sends. Pad output: the pad control from the scheme's pad map, on a tap
 * only (a pad button has no long or double press of its own).
 */
function signalFor(scheme: Scheme, control: string, press: Press): Signal | undefined {
  if (scheme.output === 'pad') {
    const pad = scheme.padMap[control];
    return pad !== undefined && press === 'tap' ? { kind: 'pad', control: pad } : undefined;
  }
  throw new ResolveError('Key output is not built yet');
}

function unitProfile(scheme: Scheme, unit: AzeronDevice): UnitProfile {
  const prefix = unit.hand === 'left' ? 'L' : 'R';
  // The device's own order, never the scheme's key order: the same inputs give the same plan.
  const pins: PinPlan[] = unit.positions
    .filter((p) => p.name !== 'stick')
    .map((p) => {
      const control = `${prefix}.${p.name}`;
      const behaviour = scheme.behaviour[control] ?? {};
      const presses: PinPlan['presses'] = {};
      for (const press of PRESSES) {
        const signal = signalFor(scheme, control, press);
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
function bindings(scheme: Scheme, game: Game, units: readonly UnitProfile[]): Binding[] {
  const sent = new Map<string, Signal>();
  for (const unit of units) {
    for (const pin of unit.pins) {
      for (const press of PRESSES) {
        const signal = pin.presses[press];
        if (signal) sent.set(`${pin.control}|${press}`, signal);
      }
    }
  }
  const out: Binding[] = [];
  const controls = units.flatMap((u) => u.pins.map((p) => p.control));
  for (const mode of game.modes) {
    const byControl = scheme.map[mode.id] ?? {};
    for (const control of controls) {
      for (const press of PRESSES) {
        const action = byControl[control]?.[press];
        const signal = sent.get(`${control}|${press}`);
        if (action !== undefined && signal)
          out.push({ mode: mode.id, control, press, action, signal });
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
  const left = unitProfile(scheme, azeron(devices, 'left'));
  const right = unitProfile(scheme, azeron(devices, 'right'));
  return {
    units: { left, right },
    bindings: bindings(scheme, game, [left, right]),
    ledger: scheme.ledger,
    findings: [],
  };
}
