// What a slot holds, against what was written into it: input by input, in plain words. A
// difference is never inferred away; a record that can't be read back is said to be unchecked.

import type { Block, ButtonRecord, StickRecord, UnitRecord, WheelTap } from './records';
import { BLOCK_TYPES, STICK_DIRECTIONS, STICK_TYPES } from './records';
import type { StoredBlock, StoredButton, StoredRecord, StoredStick } from './stored';

export interface Difference {
  id: number;
  /** What differs, for a person: "tap keys", "stick angle". */
  what: string;
  meant: string;
  stored: string;
}

export interface Verdict {
  differences: Difference[];
  /**
   * Inputs the unit holds in a layout that can't be read back (a type the app runs itself),
   * with their raw bytes as held. helmArray writes none of those, so this is a surprise.
   */
  unchecked: { id: number; raw: Uint8Array }[];
}

const show = (value: unknown) => JSON.stringify(value);
const padded = (values: readonly number[], count: number) =>
  Array.from({ length: count }, (_, i) => values[i] ?? 0);

function compareBlock(
  out: Difference[],
  id: number,
  press: string,
  meant: Block,
  stored: StoredBlock,
) {
  const fields: [string, unknown, unknown][] = [
    ['type', BLOCK_TYPES[meant.type], stored.typeByte],
    ['keys', padded(meant.keys, 4), stored.keys],
    ['modifiers', padded(meant.mods, 3), stored.mods],
    ['hold', meant.hold, stored.hold],
    ['hold time', meant.holdTime, stored.holdTime],
    ['turbo', meant.turbo, stored.turbo],
    ['turbo interval', meant.turboInterval, stored.turboInterval],
  ];
  for (const [what, a, b] of fields) {
    if (show(a) !== show(b))
      out.push({ id, what: `${press} ${what}`, meant: show(a), stored: show(b) });
  }
}

/** A scrolling tap: its type, direction and intervals; it has no hold or turbo of its own. */
function compareWheel(out: Difference[], id: number, meant: WheelTap, stored: StoredBlock) {
  const { x, y, interval, yInterval } = meant;
  const fields: [string, unknown, unknown][] = [
    ['type', 0x23, stored.typeByte],
    ['scroll', { x, y, interval, yInterval }, stored.wheel],
    ['hold', false, stored.hold],
    ['turbo', false, stored.turbo],
  ];
  for (const [what, a, b] of fields) {
    if (show(a) !== show(b)) out.push({ id, what: `tap ${what}`, meant: show(a), stored: show(b) });
  }
}

function compareButton(out: Difference[], meant: ButtonRecord, stored: StoredButton) {
  const tap = meant.tap as Block | WheelTap;
  if (tap.type === 'wheel') compareWheel(out, meant.id, tap, stored.tap);
  else compareBlock(out, meant.id, 'tap', tap, stored.tap);
  compareBlock(out, meant.id, 'long press', meant.long, stored.long);
  compareBlock(out, meant.id, 'double tap', meant.double, stored.double);
  if (meant.longDelay !== stored.longDelay) {
    out.push({
      id: meant.id,
      what: 'long press delay',
      meant: show(meant.longDelay),
      stored: show(stored.longDelay),
    });
  }
  if (meant.doubleDelay !== stored.doubleDelay) {
    out.push({
      id: meant.id,
      what: 'double tap delay',
      meant: show(meant.doubleDelay),
      stored: show(stored.doubleDelay),
    });
  }
}

function compareStick(out: Difference[], meant: StickRecord, stored: StoredStick) {
  const t = meant.tuning;
  // The three switches whose bits aren't known: compare how many are set.
  const others = [t.isCombinedAnalog, t.isHoldTrigger, t.isAngleLock].filter(Boolean).length;
  const storedOthers = [0, 1, 2].filter((bit) => (stored.switches & (1 << bit)) !== 0).length;
  const fields: [string, unknown, unknown][] = [
    ['mode', STICK_TYPES[meant.mode], stored.typeByte],
    ['upper limit', t.upperLimit, stored.upperLimit],
    ['lower limit', t.lowerLimit, stored.lowerLimit],
    ['angle', t.angle, stored.angle],
    ['sensitivity', t.sensitivity, stored.sensitivity],
    ['cones', [t.verticalCone, t.horizontalCone], stored.cones],
    ['eight directions', t.isEightDirectionalTrigger, stored.isEightDirectionalTrigger],
    ['mouse sensitivity', t.mouseSensitivity, stored.mouseSensitivity],
    ['throttle', t.analogThrottle, stored.analogThrottle],
    ['smoothing', t.isAnalogSmoothing, stored.isAnalogSmoothing],
    ['trigger magnitude', t.triggerMagnitude, stored.triggerMagnitude],
    ['combined, hold trigger and angle lock', others, storedOthers],
    ['invert X', t.invertXAxis, stored.invertXAxis],
    ['invert Y', t.invertYAxis, stored.invertYAxis],
    ['combined magnitude', t.combinedAnalogMagnitude, stored.combinedAnalogMagnitude],
    ['hold magnitude', t.holdMagnitude, stored.holdMagnitude],
    ['hold type', t.holdType, stored.holdType],
    ['hold keys', padded(t.holdKeys, 3), stored.holdKeys],
    ['rotate button', t.rotateStickButtonId, stored.rotateStickButtonId],
    ['lock zone angle', t.lockZoneAngle, stored.lockZoneAngle],
    ['lock zone size', t.lockZoneSize, stored.lockZoneSize],
    ['right stick', t.isRightAnalog, stored.isRightAnalog],
    ...STICK_DIRECTIONS.map((d): [string, unknown, unknown] => [
      `direction ${d}`,
      padded(meant.directions[d] ?? [], 3),
      stored.directions[d],
    ]),
  ];
  for (const [what, a, b] of fields) {
    if (show(a) !== show(b))
      out.push({ id: meant.id, what: `stick ${what}`, meant: show(a), stored: show(b) });
  }
}

/** Compares every record written with what the slot holds. Empty differences is success. */
export function verify(written: readonly UnitRecord[], held: readonly StoredRecord[]): Verdict {
  const differences: Difference[] = [];
  const unchecked: Verdict['unchecked'] = [];
  for (const meant of written) {
    const stored = held.find((r) => r.id === meant.id);
    if (!stored) {
      differences.push({ id: meant.id, what: 'input', meant: 'written', stored: 'missing' });
      continue;
    }
    if (stored.pinOne !== meant.pinOne || stored.pinTwo !== meant.pinTwo) {
      differences.push({
        id: meant.id,
        what: 'pins',
        meant: show([meant.pinOne, meant.pinTwo]),
        stored: show([stored.pinOne, stored.pinTwo]),
      });
    }
    if (stored.kind === 'undecoded') {
      unchecked.push({ id: meant.id, raw: stored.raw });
      differences.push({ id: meant.id, what: 'kind', meant: meant.kind, stored: 'unreadable' });
    } else if (meant.kind === 'button' && stored.kind === 'button') {
      compareButton(differences, meant, stored);
    } else if (meant.kind === 'stick' && stored.kind === 'stick') {
      compareStick(differences, meant, stored);
    } else {
      differences.push({ id: meant.id, what: 'kind', meant: meant.kind, stored: stored.kind });
    }
  }
  return { differences, unchecked };
}
