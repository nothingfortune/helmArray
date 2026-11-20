// What the sync pill says. It is read from the units, never inferred: the input is what each
// unit was last seen to hold, compared against the layout last applied to it.
//
// Precedence, strongest first:
//   1. differs      A connected unit holds something other than what was applied (a
//                   difference, or a record the app can't read back, which counts as one:
//                   never "in sync" about something not checked). Outranks pending changes,
//                   because it says the units aren't what the person thinks they are.
//   2. not-applied  Edits in the editor haven't been applied. True whatever the units show.
//   3. unknown      Nothing above, but the pill can't promise anything: a unit isn't
//                   connected, hasn't been read, or nothing was ever applied for the scheme
//                   to compare it with. A disconnected unit can't be in sync, and what it
//                   last held is stale, so it is ignored in step 1.
//   4. in-sync      Both units connected, both read, both match, nothing pending.
//
// Only the units the setup uses are judged: for *left Azeron + mouse* the right unit is neither
// connected nor not, and what it holds is nothing to the pill.

import type { Verdict } from '@helmarray/azeron';
import type { Hand, Plan } from '@helmarray/core';
import { canonical } from './plan-fingerprint';

export interface HandSync {
  /** The setup uses this unit. One it doesn't is not judged at all. Defaults to true. */
  used?: boolean;
  connected: boolean;
  /**
   * `verify()` of what the unit holds against the last applied layout, or null when nothing
   * has been applied yet or the unit hasn't been read.
   */
  verdict: Verdict | null;
}

export interface SyncInput {
  left: HandSync;
  right: HandSync;
  /** Edits in the editor not yet applied. */
  pendingChanges: number;
  /** A scheme is active but nothing was ever applied for it: there is nothing to compare with. */
  nothingApplied?: boolean;
}

export type SyncTone = 'ok' | 'warning' | 'error';

export type SyncKind =
  | { kind: 'in-sync' }
  | { kind: 'not-applied'; count: number }
  | { kind: 'differs'; hands: Hand[] }
  | { kind: 'unknown'; reason: 'not-connected' | 'not-read' | 'nothing-applied'; hands: Hand[] };

export type SyncState = SyncKind & { label: string; tone: SyncTone };

const HANDS: Hand[] = ['left', 'right'];
const name = (hand: Hand | undefined) => (hand === 'right' ? 'Right' : 'Left');

const judged = (unit: HandSync) => unit.used !== false;

const differs = (unit: HandSync) =>
  judged(unit) &&
  unit.connected &&
  unit.verdict !== null &&
  (unit.verdict.differences.length > 0 || unit.verdict.unchecked.length > 0);

export function syncState(input: SyncInput): SyncState {
  const differing = HANDS.filter((hand) => differs(input[hand]));
  if (differing.length > 0) {
    return {
      kind: 'differs',
      hands: differing,
      label: differing.length === 2 ? 'Units differ' : `${name(differing[0])} unit differs`,
      tone: 'error',
    };
  }

  const count = Number.isFinite(input.pendingChanges) ? Math.trunc(input.pendingChanges) : 0;
  if (count > 0) {
    return {
      kind: 'not-applied',
      count,
      label: count === 1 ? '1 change not applied' : `${count} changes not applied`,
      tone: 'warning',
    };
  }

  const away = HANDS.filter((hand) => judged(input[hand]) && !input[hand].connected);
  if (away.length > 0) {
    return {
      kind: 'unknown',
      reason: 'not-connected',
      hands: away,
      label: away.length === 2 ? 'Units not connected' : `${name(away[0])} unit not connected`,
      tone: 'warning',
    };
  }
  if (input.nothingApplied === true) {
    return {
      kind: 'unknown',
      reason: 'nothing-applied',
      hands: [...HANDS],
      label: 'Nothing applied yet',
      tone: 'warning',
    };
  }
  const unread = HANDS.filter((hand) => judged(input[hand]) && input[hand].verdict === null);
  if (unread.length > 0) {
    return {
      kind: 'unknown',
      reason: 'not-read',
      hands: unread,
      label: 'Not checked yet',
      tone: 'warning',
    };
  }

  return { kind: 'in-sync', label: 'In sync', tone: 'ok' };
}

// ------------------------------------------------------------------- what the pill is built from

const distinctInputs = (verdict: Verdict): number =>
  new Set([...verdict.differences.map((d) => d.id), ...verdict.unchecked.map((u) => u.id)]).size;

const inputs = (count: number) => (count === 1 ? '1 input' : `${count} inputs`);

/**
 * The words behind the label when a unit differs: which unit, and how much of it. For a tooltip.
 * Undefined for every other state.
 */
export function syncDetail(input: SyncInput): string | undefined {
  const lines = HANDS.filter((hand) => differs(input[hand])).map((hand) => {
    const verdict = input[hand].verdict;
    return `${name(hand)} unit: ${inputs(verdict ? distinctInputs(verdict) : 0)} not as applied.`;
  });
  return lines.length > 0 ? lines.join(' ') : undefined;
}

const STICK = { left: 'L.stick', right: 'R.stick' } as const;

/** Every position (and stick) a plan says something about, by control id, with what it says. */
function says(plan: Plan | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (control: string, what: unknown) =>
    out.set(control, [...(out.get(control) ?? []), canonical(what)]);
  if (plan === null) return out;
  for (const hand of HANDS) {
    const unit = plan.units[hand];
    if (unit === undefined) continue;
    for (const pin of unit.pins) if (Object.keys(pin.presses).length > 0) add(pin.control, pin);
    add(STICK[hand], unit.stick);
  }
  for (const binding of plan.bindings) add(binding.control, binding);
  return out;
}

/**
 * How many buttons (a stick counts as one) the scheme now says differently from the plan last
 * applied: its positions on the units and what the game is told they do, each button once. With
 * nothing applied yet, it is how many say anything at all. A scheme that did not resolve
 * (`current` null) counts as one change: whatever it says, it can't be said to be applied.
 *
 * What the game's file will hold is part of the plan; writing it is not part of Apply yet.
 */
export function pendingChanges(applied: Plan | null, current: Plan | null): number {
  if (current === null) return 1;
  const before = says(applied);
  const now = says(current);
  let count = 0;
  for (const control of new Set([...before.keys(), ...now.keys()])) {
    const a = (before.get(control) ?? []).join('|');
    const b = (now.get(control) ?? []).join('|');
    if (a === b) continue;
    // Nothing applied: only what the scheme puts on a button counts, not a stick's default
    // behaviour, so a scheme with nothing on it has nothing to apply.
    if (applied === null && control.endsWith('.stick')) continue;
    count++;
  }
  return count;
}
