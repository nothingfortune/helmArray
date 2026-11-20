// What a setup plays with, worked out from `Scheme.devices`: which units, which fixed devices,
// which of the game's two binding sets it rebinds, and what pad control a control sends. The
// resolver, the checks and the editor all read a setup through these, so they never disagree.

import type { ControlId, Hand, PadControl, Scheme, SetupDevices, Signal } from './model';
import { PAD_CONTROLS, STICK_DIRECTIONS } from './model';
import type { BindingSet, Plan, UnitProfile } from './plan';
import { signalId } from './signal';

export interface Setup {
  /** The units the setup uses, left first. */
  hands: readonly Hand[];
  keyboard: boolean;
  mouse: boolean;
  controller: boolean;
}

/**
 * The setup a scheme's devices make. The one place `left` is read: the left unit, and the mouse
 * with it, whatever `mouse` says.
 */
export function setupOf(devices: SetupDevices): Setup {
  const hands: Hand[] =
    devices.azerons === 'both' ? ['left', 'right'] : devices.azerons === 'left' ? ['left'] : [];
  return {
    hands,
    keyboard: devices.keyboard,
    mouse: devices.mouse || devices.azerons === 'left',
    controller: devices.controller,
  };
}

/** Whether a control belongs to a device the setup uses. The pedals are always there. */
export function inSetup(setup: Setup, control: ControlId): boolean {
  const prefix = control.slice(0, control.indexOf('.') + 1);
  switch (prefix) {
    case 'L.':
      return setup.hands.includes('left');
    case 'R.':
      return setup.hands.includes('right');
    case 'key.':
      return setup.keyboard;
    case 'mouse.':
      return setup.mouse;
    case 'pad.':
      return setup.controller;
    case 'pedal.':
      return true;
    default:
      return false;
  }
}

const PAD_SET = new Set<string>(PAD_CONTROLS);

/**
 * The pad control a control sends in the setup: an Azeron button's entry in the pad map with pad
 * output, or a controller button's own. Undefined for anything else (a key, a stick, a control the
 * setup doesn't use). Two controls with the same pad control are one live control in the game.
 */
export function padSignalOf(scheme: Scheme, control: ControlId): PadControl | undefined {
  const setup = setupOf(scheme.devices);
  if (!inSetup(setup, control)) return undefined;
  if (control.startsWith('pad.')) {
    const own = control.slice(4);
    return PAD_SET.has(own) ? (own as PadControl) : undefined;
  }
  if (scheme.output !== 'pad') return undefined;
  if (!control.startsWith('L.') && !control.startsWith('R.')) return undefined;
  return Object.hasOwn(scheme.padMap, control) ? scheme.padMap[control] : undefined;
}

/** Which of the game's binding sets a signal is bound in: Xbox controls in the controller set. */
export const bindingSetOf = (signal: Signal): BindingSet =>
  signal.kind === 'pad' ? 'controller' : 'keyboard';

/** The binding sets a scheme rebinds, keyboard first: only those its devices send into. */
export function setsUsed(scheme: Scheme): BindingSet[] {
  const setup = setupOf(scheme.devices);
  const azerons = setup.hands.length > 0;
  const out: BindingSet[] = [];
  if (setup.keyboard || setup.mouse || (azerons && scheme.output === 'keys')) out.push('keyboard');
  if (setup.controller || (azerons && scheme.output === 'pad')) out.push('controller');
  return out;
}

const STICK_PADS: Record<'pad-left' | 'pad-right', readonly PadControl[]> = {
  'pad-left': ['LS_UP', 'LS_DOWN', 'LS_LEFT', 'LS_RIGHT'],
  'pad-right': ['RS_UP', 'RS_DOWN', 'RS_LEFT', 'RS_RIGHT'],
};

/**
 * What the setup's sticks send, by signal id, with the stick's name: an Azeron stick's direction
 * keys (key mode) or an Xbox stick's directions, and the controller's two sticks. A stick reaches
 * the actions the game ships on what it sends (STICK DIRECTION KEYS, rule 3).
 */
export function stickSends(plan: Pick<Plan, 'units'>, setup: Setup): Map<string, string> {
  const out = new Map<string, string>();
  const add = (signal: Signal, who: string) => {
    if (!out.has(signalId(signal))) out.set(signalId(signal), who);
  };
  for (const hand of ['left', 'right'] as const) {
    const stick = plan.units[hand]?.stick;
    if (!stick) continue;
    if (stick.mode === 'keys') {
      for (const direction of STICK_DIRECTIONS) {
        const signal = stick.directions?.[direction];
        if (signal) add(signal, `the ${hand} stick`);
      }
    } else if (stick.mode === 'pad-left' || stick.mode === 'pad-right') {
      for (const control of STICK_PADS[stick.mode])
        add({ kind: 'pad', control }, `the ${hand} stick`);
    }
  }
  if (setup.controller) {
    for (const control of STICK_PADS['pad-left'])
      add({ kind: 'pad', control }, "the controller's left stick");
    for (const control of STICK_PADS['pad-right'])
      add({ kind: 'pad', control }, "the controller's right stick");
  }
  return out;
}

/** The units a plan writes, left first: only the ones its setup uses. */
export const handsOf = (plan: Pick<Plan, 'units'>): Hand[] =>
  (['left', 'right'] as const).filter((hand) => plan.units[hand] !== undefined);

/** The plan's profile for one unit. Throws for a unit its setup doesn't use. */
export function unitOf(plan: Pick<Plan, 'units'>, hand: Hand): UnitProfile {
  const unit = plan.units[hand];
  if (unit === undefined) throw new Error(`This setup doesn't use the ${hand} unit.`);
  return unit;
}

/**
 * The binding set a control of the setup is bound through: an Azeron button with pad output and
 * the controller's controls in the controller set; keys, mouse buttons and an Azeron button with
 * key output in the keyboard set. Undefined for anything else (a stick, the pedals, an unknown id).
 */
export function controlSet(scheme: Scheme, control: ControlId): BindingSet | undefined {
  if (control.endsWith('.stick')) return undefined;
  if (control.startsWith('L.') || control.startsWith('R.')) {
    return scheme.output === 'pad' ? 'controller' : 'keyboard';
  }
  if (control.startsWith('key.') || control.startsWith('mouse.')) return 'keyboard';
  if (control.startsWith('pad.')) return 'controller';
  return undefined;
}
