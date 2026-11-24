// What the sync pill says. It is read from the units, never inferred: the input is what each
// unit was last seen to hold, compared against the layout last applied to it.
//
// Precedence, strongest first:
//   1. differs      A connected unit holds something other than what was applied (a
//                   difference, or a record the app can't read back, which counts as one:
//                   never "in sync" about something not checked). Outranks pending changes,
//                   because it says the units aren't what the person thinks they are.
//   2. paused       The Azeron app is open, so helmArray has let go of the units: nothing can be
//                   read or written until it closes. The units are still plugged in (their chips
//                   stay); what they hold is not known, and edits wait for the app to close.
//   3. not-applied  Edits in the editor haven't been applied. True whatever the units show.
//   4. unknown      Nothing above, but the pill can't promise anything: a unit isn't
//                   connected, hasn't been read, or nothing was ever applied for the scheme
//                   to compare it with. A disconnected unit can't be in sync, and what it
//                   last held is stale, so it is ignored in step 1.
//   5. in-sync      Both units connected, both read, both match, nothing pending.
//
// Only the units the setup uses are judged: for *left Azeron + mouse* the right unit is neither
// connected nor not, and what it holds is nothing to the pill.

import type { Verdict } from '@helmarray/azeron';
import type { Hand, Plan } from '@helmarray/core';
import { gameRowsChanged } from '@helmarray/core';
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
  /** The Azeron app is open: helmArray has let go of the units until it closes. */
  azeronOpen?: boolean;
}

/** `plain`: nothing to act on (nothing has been asked of the person yet). */
export type SyncTone = 'ok' | 'warning' | 'error' | 'plain';

export type SyncKind =
  | { kind: 'in-sync' }
  | { kind: 'paused' }
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

  if (input.azeronOpen === true) {
    return { kind: 'paused', label: 'Azeron app is open', tone: 'warning' };
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
      tone: 'plain',
    };
  }

  return { kind: 'in-sync', label: 'In sync', tone: 'ok' };
}

// ------------------------------------------------------------------- what the pill is built from

const distinctInputs = (verdict: Verdict): number =>
  new Set([...verdict.differences.map((d) => d.id), ...verdict.unchecked.map((u) => u.id)]).size;

/** A unit's inputs are its buttons and its stick: a button, to the person. */
const buttons = (count: number) => (count === 1 ? '1 button' : `${count} buttons`);

/**
 * The words behind the label when a unit differs: which unit, and how much of it. For a tooltip.
 * Undefined for every other state.
 */
export function syncDetail(input: SyncInput): string | undefined {
  const lines = HANDS.filter((hand) => differs(input[hand])).map((hand) => {
    const verdict = input[hand].verdict;
    return `${name(hand)} unit: ${buttons(verdict ? distinctInputs(verdict) : 0)} not as applied.`;
  });
  return lines.length > 0 ? lines.join(' ') : undefined;
}

const STICK = { left: 'L.stick', right: 'R.stick' } as const;

/** The unit a control id is on (`L.index_1`, `R.stick`), or undefined for a key, a mouse button or the controller. */
const unitOfControl = (control: string): Hand | undefined =>
  control.startsWith('L.') ? 'left' : control.startsWith('R.') ? 'right' : undefined;

/**
 * Every unit position (and stick) a plan says something about, by control id, with what it says.
 * Only the units' own controls: a key, a mouse button or the controller's own button is written
 * nowhere, so what changes for one is what the game is told, counted from the game's rows.
 */
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
  for (const binding of plan.bindings) {
    if (unitOfControl(binding.control) !== undefined) add(binding.control, binding);
  }
  return out;
}

/** The actions a control carries in a plan, each as `mode|action`. */
const carried = (plan: Plan | null, control: string): string[] =>
  (plan?.bindings ?? []).filter((b) => b.control === control).map((b) => `${b.mode}|${b.action}`);

/**
 * How many changes the scheme has that aren't applied: the unit buttons (a stick counts as one)
 * the person edited, each once, and each action the game is to be told differently that no edited
 * button accounts for.
 *
 * A drag is one change. A button whose only change is that its action left for another edited
 * button is the far end of that move, not an edit of its own (whatever it then stops sending
 * comes with the move), and an action the game is told about because it came or went with an
 * edited button is that edit, not another. A button with no action before or after counts only
 * when nothing else changed (it changed as part of an edit elsewhere otherwise).
 *
 * Only what Apply would change counts. A unit the setup no longer uses is not written, so nothing
 * on it is an edit (the actions it carried still count, through the game). A key, a mouse button
 * or the controller's own button is written nowhere: what changes for one is what the game is
 * told, so a device that only takes the game's own bindings counts nothing.
 *
 * With nothing applied yet, it is the buttons the scheme puts an action on and the game's
 * bindings it changes: a stick's behaviour, and a button sending something with no action on it,
 * are nothing the person put there. A scheme that did not resolve (`current` null) counts as one
 * change: whatever it says, it can't be said to be applied.
 */
export function pendingChanges(applied: Plan | null, current: Plan | null): number {
  if (current === null) return 1;
  const before = says(applied);
  const now = says(current);
  const changed: string[] = [];
  for (const control of new Set([...before.keys(), ...now.keys()])) {
    const hand = unitOfControl(control);
    if (hand === undefined || current.units[hand] === undefined) continue;
    if ((before.get(control) ?? []).join('|') === (now.get(control) ?? []).join('|')) continue;
    if (applied === null && carried(current, control).length === 0) continue;
    changed.push(control);
  }
  // Where each action is now, among the edited buttons.
  const landed = new Set(changed.flatMap((control) => carried(current, control)));
  const bare = (control: string) =>
    carried(applied, control).length === 0 && carried(current, control).length === 0;
  const edits = changed.filter((control) => {
    const was = carried(applied, control);
    const moveSource =
      carried(current, control).length === 0 &&
      was.length > 0 &&
      was.every((action) => landed.has(action));
    return !moveSource && !bare(control);
  });
  const explained = new Set(
    changed.flatMap((control) => [...carried(applied, control), ...carried(current, control)]),
  );
  const rows = new Set(
    gameRowsChanged(current, applied)
      .map((b) => `${b.mode}|${b.action}`)
      .filter((action) => !explained.has(action)),
  );
  // A button with no action on it, before or after, that changed anyway (it gave its Xbox control
  // to a button an action was put on) is part of that edit. Alone (turbo on an empty button), it
  // is a change of its own: never 0 while Apply would write something.
  const count = edits.length + rows.size;
  return count > 0 ? count : changed.filter(bare).length;
}
