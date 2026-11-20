// The Units target of Apply: what it would change (for the drawer), doing it, and reading the
// units against the plan (for the sync pill). Pure: the sessions and the fresh "is the Azeron app
// running" check come in, so tests run it over fake units. Nothing here sends a command a
// UnitSession does not already send.
//
// Per unit, in this order, and never a step out of order:
//   1. read it afresh (who it is, which slots it holds, which it runs): the profile button moves
//      the running slot unannounced, so nothing earlier is trusted;
//   2. choose the slot (see `chooseSlot`): the slot it runs is never written over;
//   3. write the plan into it and read it back; only a clean read-back goes on;
//   4. switch to it, then delete every other slot;
//   5. read every slot back and compare the running one with the plan.
// The Azeron app is checked, freshly, before the write, before the switch and before each delete.
// The first failure stops everything and says, in one sentence, what failed, on which unit, and
// what is left as it was. The units' profile button is never part of any of it.

import type { StoredSlot, UnitSession, Verdict } from '@helmarray/azeron';
import { MAX_PROFILE_NAME, UnitError, lowestFree, unitRecords, verify } from '@helmarray/azeron';
import type { UnitRecord } from '@helmarray/azeron';
import type { Hand, Plan } from '@helmarray/core';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from '@helmarray/core';

const HANDS: readonly Hand[] = ['left', 'right'];
const DEVICE = { left: CYBORG2_LEFT, right: CYBORG2_RIGHT } as const;

/** What the slot is called when nothing better is given. */
export const DEFAULT_PROFILE_NAME = 'helmArray';

/** What one unit holds now: the slots read from it, the one it runs, and how many it has room for. */
export interface HeldUnit {
  /** The id the unit reported; the only thing that says which unit it is. */
  deviceId: number;
  slots: StoredSlot[];
  running: number;
  slotLimit: number;
}

/** Each hand's unit as last read, or nothing for a hand whose unit is not connected. */
export type HeldUnits = Partial<Record<Hand, HeldUnit | undefined>>;

export interface UnitsOptions {
  /** The slot's name on the unit; plain ASCII, cut to the 19 characters a unit keeps. */
  name?: string;
}

const handName = (hand: Hand) => (hand === 'left' ? 'left' : 'right');
const slotLabel = (slot: Pick<StoredSlot, 'slot' | 'name'>) =>
  slot.name === '' ? `slot ${slot.slot}` : `slot ${slot.slot} ("${slot.name}")`;
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const isClean = (verdict: Verdict) =>
  verdict.differences.length === 0 && verdict.unchecked.length === 0;
const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);
const withoutPeriod = (text: string) => text.replace(/\.$/, '');

/** A name a unit will keep: printable ASCII, trimmed, at most 19 characters, never empty. */
export function unitSlotName(name: string | undefined): string {
  const plain = Array.from(name ?? '')
    .filter((ch) => ch >= ' ' && ch <= '~')
    .join('')
    .trim()
    .slice(0, MAX_PROFILE_NAME)
    .trim();
  return plain === '' ? DEFAULT_PROFILE_NAME : plain;
}

export type SlotChoice =
  { ok: true; slot: number; overwrites: StoredSlot | null } | { ok: false; reason: string };

/**
 * Which slot the layout goes into.
 *  1. The lowest free slot, when the unit has one: nothing it holds is touched, so a failure
 *     leaves everything as it was. (Reusing one of ours would risk the slot being run.)
 *  2. When every slot is in use: a slot the unit is NOT running, preferring one that already has
 *     our name, else the lowest-numbered. The slot is deleted afterwards anyway; it is named in
 *     the preview as written over.
 *  3. Never the slot the unit runs. If that is the only slot there is no other place: refused.
 */
export function chooseSlot(
  slots: readonly StoredSlot[],
  running: number,
  limit: number,
  name: string,
): SlotChoice {
  const free = lowestFree(slots, limit);
  if (free !== undefined) return { ok: true, slot: free, overwrites: null };
  const others = slots.filter((s) => s.slot !== running).sort((a, b) => a.slot - b.slot);
  const pick = others.find((s) => s.name === name) ?? others[0];
  if (!pick) {
    return {
      ok: false,
      reason: `The unit has room for ${limit} slot${limit === 1 ? '' : 's'} and is running the only one, so there is nowhere to write without overwriting it.`,
    };
  }
  return { ok: true, slot: pick.slot, overwrites: pick };
}

// ---------------------------------------------------------------------------------- preview

export interface UnitPreview {
  hand: Hand;
  connected: boolean;
  /** The layout differs from what the unit runs now (`verify()` against the running slot). */
  differs: boolean;
  /** How many of the unit's inputs differ. */
  inputsChanged: number;
  /** The slot that gets written, or null when the unit already holds the layout. */
  write: { slot: number; name: string; overwrites: { slot: number; name: string } | null } | null;
  /** Slots that go, by name, so the drawer can say what is lost. */
  deletes: { slot: number; name: string }[];
  /** The above in plain words, one line each. */
  changes: string[];
  /** Why Apply can't do this unit at all, in one sentence; null when it can. */
  problem: string | null;
}

export interface UnitsPreview {
  left: UnitPreview;
  right: UnitPreview;
  /** Every unit's lines, in order. */
  changes: string[];
  /** Anything to do at all: a write or a deletion on either unit. */
  anyChange: boolean;
  problems: string[];
}

function recordsFor(plan: Plan, hand: Hand): UnitRecord[] {
  return unitRecords(plan.units[hand], DEVICE[hand]);
}

function previewUnit(
  plan: Plan,
  hand: Hand,
  held: HeldUnit | undefined,
  name: string,
): UnitPreview {
  const base: UnitPreview = {
    hand,
    connected: held !== undefined,
    differs: false,
    inputsChanged: 0,
    write: null,
    deletes: [],
    changes: [],
    problem: null,
  };
  const unit = handName(hand);
  if (!held) return { ...base, problem: `The ${unit} unit is not connected.` };
  let records: UnitRecord[];
  try {
    records = recordsFor(plan, hand);
  } catch (error) {
    return { ...base, problem: sentence(messageOf(error)) };
  }
  const verdict = verify(records, held.slots.find((s) => s.slot === held.running)?.records ?? []);
  const differs = !isClean(verdict);
  const inputsChanged = new Set([
    ...verdict.differences.map((d) => d.id),
    ...verdict.unchecked.map((u) => u.id),
  ]).size;
  let target = held.running;
  let write: UnitPreview['write'] = null;
  const changes: string[] = [];
  if (differs) {
    const choice = chooseSlot(held.slots, held.running, held.slotLimit, name);
    if (!choice.ok) return { ...base, differs, inputsChanged, problem: choice.reason };
    target = choice.slot;
    write = {
      slot: choice.slot,
      name,
      overwrites: choice.overwrites
        ? { slot: choice.overwrites.slot, name: choice.overwrites.name }
        : null,
    };
    changes.push(
      choice.overwrites
        ? `Write the layout over ${slotLabel(choice.overwrites)} on the ${unit} unit (it has no free slot) and switch to it.`
        : `Write the layout into a new slot ${choice.slot} ("${name}") on the ${unit} unit and switch to it.`,
    );
  }
  const deletes = held.slots
    .filter((s) => s.slot !== target)
    .map((s) => ({ slot: s.slot, name: s.name }));
  if (deletes.length > 0) {
    changes.push(`Delete ${deletes.map((s) => slotLabel(s)).join(', ')} from the ${unit} unit.`);
  }
  return { ...base, differs, inputsChanged, write, deletes, changes };
}

/** What Apply would do to the units, in words. `held` is what each unit holds now. */
export function previewUnits(
  plan: Plan,
  held: HeldUnits,
  options: UnitsOptions = {},
): UnitsPreview {
  const name = unitSlotName(options.name);
  const left = previewUnit(plan, 'left', held.left, name);
  const right = previewUnit(plan, 'right', held.right, name);
  const units = [left, right];
  return {
    left,
    right,
    changes: units.flatMap((u) => u.changes),
    anyChange: units.some((u) => u.write !== null || u.deletes.length > 0),
    problems: units.flatMap((u) => (u.problem === null ? [] : [u.problem])),
  };
}

// ---------------------------------------------------------------------------------- verify

/**
 * Each unit against the plan, for the sync pill: `verify()` of the slot it runs. Null for a unit
 * that is not connected, or whose layout can't be worked out from the plan.
 */
export function verifyUnits(plan: Plan, held: HeldUnits): Record<Hand, Verdict | null> {
  const one = (hand: Hand): Verdict | null => {
    const unit = held[hand];
    if (!unit) return null;
    try {
      // A running slot the unit doesn't list holds nothing: every input then shows as missing.
      return verify(
        recordsFor(plan, hand),
        unit.slots.find((s) => s.slot === unit.running)?.records ?? [],
      );
    } catch {
      return null;
    }
  };
  return { left: one('left'), right: one('right') };
}

// ------------------------------------------------------------------------------------ apply

export interface UnitsDeps {
  /** A fresh look at the running programs, every call. Never a cached poll. */
  azeronAppRunning(): Promise<boolean>;
  /** The connected unit that is this hand, with the id it is expected to report. */
  unit(hand: Hand): { session: UnitSession; deviceId: number } | undefined;
  /** The slot's name on the unit. */
  name?: string;
  trace?(line: string): void;
}

export type UnitStatus = 'applied' | 'unchanged' | 'failed' | 'not-attempted';

export interface UnitOutcome {
  hand: Hand;
  status: UnitStatus;
  /** One plain sentence: what happened, or what failed and what is left as it was. */
  message: string;
  /** The slot the layout is in, once known. */
  slot: number | null;
  wrote: boolean;
  switched: boolean;
  deleted: { slot: number; name: string }[];
  /** The slot the unit runs, read back at the end, against the plan. Null if never read back. */
  verdict: Verdict | null;
}

export interface ApplyUnitsResult {
  /** Both units hold the plan. */
  ok: boolean;
  /** Left, then right. */
  units: UnitOutcome[];
  /** The first failure's sentence, or the summary. */
  message: string;
}

/** Stops the unit's flow with a sentence's reason; `applyUnit` adds what is left as it was. */
class Stop extends Error {}

const blank = (hand: Hand, status: UnitStatus, message: string): UnitOutcome => ({
  hand,
  status,
  message,
  slot: null,
  wrote: false,
  switched: false,
  deleted: [],
  verdict: null,
});

async function applyUnit(
  hand: Hand,
  records: readonly UnitRecord[],
  deps: UnitsDeps,
  name: string,
): Promise<UnitOutcome> {
  const unit = handName(hand);
  const outcome = blank(hand, 'failed', '');
  const trace = (line: string) => deps.trace?.(`${unit}: ${line}`);
  let left = 'nothing on it was changed';
  const stop = (reason: string): never => {
    throw new Stop(`The ${unit} unit failed: ${withoutPeriod(reason)}; ${left}.`);
  };

  // A fresh look, right before the step. Anything but a plain "no" is a no.
  const guard = async () => {
    let running: boolean;
    try {
      running = await deps.azeronAppRunning();
    } catch (error) {
      trace(`couldn't look for the Azeron app: ${messageOf(error)}`);
      return stop('helmArray could not tell whether the Azeron app is running');
    }
    if (running)
      return stop('the Azeron app is open, and it talks to the units too: close it first');
  };

  try {
    const target = deps.unit(hand);
    if (!target) return stop('it is not connected');
    const { session, deviceId } = target;

    // The Azeron app first: even the reads wait until it is closed, and a unit not needing a
    // write (below) is read only after the app is known to be closed.
    await guard();
    let identity;
    let slots: StoredSlot[];
    try {
      identity = await session.identify();
      slots = await session.readSlots();
    } catch (error) {
      return stop(messageOf(error));
    }
    if (identity.deviceId !== deviceId) {
      return stop(`this is not the unit the ${unit} layout is for`);
    }

    const runningSlot = slots.find((s) => s.slot === identity.runningSlot);
    const verdict = verify(records, runningSlot?.records ?? []);
    let slot = identity.runningSlot;

    if (isClean(verdict)) {
      trace(`already holds the layout in slot ${slot}`);
    } else {
      const choice = chooseSlot(slots, identity.runningSlot, identity.slotLimit, name);
      if (!choice.ok) return stop(choice.reason);
      slot = choice.slot;
      const into = choice.overwrites ? slotLabel(choice.overwrites) : `slot ${slot}`;
      trace(`writing the layout into ${into}`);

      await guard();
      if (choice.overwrites) {
        // The button may have moved the running slot since it was read: never write over it.
        let now: number;
        try {
          now = await session.runningSlot();
        } catch (error) {
          return stop(messageOf(error));
        }
        if (now === slot) {
          return stop(`it now runs ${into}, which was about to be written over`);
        }
      }
      left = choice.overwrites
        ? `${into} may be part-written, and the unit still runs slot ${identity.runningSlot} with its other slots as they were`
        : `a new slot ${slot} may be part-written, and the unit still runs slot ${identity.runningSlot} with its other slots as they were`;
      let result;
      try {
        result = await session.write(slot, name, records, deviceId);
      } catch (error) {
        if (error instanceof UnitError && error.written === 0 && error.kind === 'refused') {
          // Refused before anything was sent (another unit's layout): nothing changed.
          left = 'nothing on it was changed';
        }
        return stop(messageOf(error));
      }
      outcome.wrote = true;
      outcome.slot = slot;
      // The gate: a slot that does not read back as the layout is never run, and nothing is deleted.
      if (!isClean(result)) {
        const first = [...result.differences, ...result.unchecked.map(unreadable)][0];
        const count = new Set([
          ...result.differences.map((d) => d.id),
          ...result.unchecked.map((u) => u.id),
        ]).size;
        left = `slot ${slot} is not in use, the unit still runs slot ${identity.runningSlot}, and nothing was deleted`;
        return stop(
          `slot ${slot} read back differently from the layout (${count} input${count === 1 ? '' : 's'}${first ? `, first: input ${first.id} ${first.what}` : ''})`,
        );
      }
      left = `slot ${slot} holds the layout, the unit still runs slot ${identity.runningSlot}, and nothing was deleted`;
      await guard();
      try {
        await session.switchTo(slot);
      } catch (error) {
        return stop(messageOf(error));
      }
      outcome.switched = true;
      left = `the unit runs the layout in slot ${slot}, and the slots it had before are still there`;
    }
    outcome.slot = slot;

    // Every other slot, read afresh: only now, with the layout read back clean and running.
    let others: StoredSlot[];
    try {
      others = (await session.readSlots()).filter((s) => s.slot !== slot);
    } catch (error) {
      return stop(messageOf(error));
    }
    for (const [index, other] of others.entries()) {
      const remaining = others.slice(index).map(slotLabel);
      left = `the unit runs the layout in slot ${slot}, and ${remaining.join(' and ')} ${remaining.length === 1 ? 'is' : 'are'} still there`;
      await guard();
      try {
        await session.deleteSlot(other.slot);
      } catch (error) {
        return stop(
          `${slotLabel(other)} could not be deleted (${withoutPeriod(messageOf(error))})`,
        );
      }
      outcome.deleted.push({ slot: other.slot, name: other.name });
    }

    // Read every slot back and compare what the unit runs with the plan.
    left = `the unit runs slot ${slot}`;
    let finalVerdict: Verdict;
    try {
      const after = await session.readSlots();
      const running = await session.runningSlot();
      finalVerdict = verify(records, after.find((s) => s.slot === running)?.records ?? []);
      outcome.verdict = finalVerdict;
      if (running !== slot) return stop(`it runs slot ${running}, not slot ${slot}`);
    } catch (error) {
      if (error instanceof Stop) throw error;
      return stop(messageOf(error));
    }
    if (!isClean(finalVerdict)) {
      return stop('it read back differently from the layout after cleaning up');
    }

    const wrote = outcome.wrote;
    const n = outcome.deleted.length;
    outcome.status = wrote ? 'applied' : 'unchanged';
    outcome.message = wrote
      ? `The ${unit} unit runs the layout in slot ${slot}${n > 0 ? `; ${n} other slot${n === 1 ? ' was' : 's were'} deleted` : ''}.`
      : n > 0
        ? `The ${unit} unit already held the layout; ${n} other slot${n === 1 ? ' was' : 's were'} deleted.`
        : `The ${unit} unit already held the layout.`;
    return outcome;
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    outcome.message = error.message;
    return outcome;
  }
}

const unreadable = (u: { id: number }) => ({ id: u.id, what: 'could not be read back' });

/** Applies the plan to the left unit, then the right one, stopping at the first failure. */
export async function applyUnits(plan: Plan, deps: UnitsDeps): Promise<ApplyUnitsResult> {
  const name = unitSlotName(deps.name);
  // Everything that needs no unit is worked out first, so a layout that can't be written
  // refuses before either unit has been touched.
  const records = {} as Record<Hand, UnitRecord[]>;
  for (const hand of HANDS) {
    try {
      records[hand] = recordsFor(plan, hand);
    } catch (error) {
      const message = `The ${handName(hand)} unit failed: ${withoutPeriod(messageOf(error))}; nothing on it was changed.`;
      return refused(hand, message);
    }
  }
  const units: UnitOutcome[] = [];
  let failed: UnitOutcome | undefined;
  for (const hand of HANDS) {
    if (failed) {
      units.push(
        blank(
          hand,
          'not-attempted',
          `The ${handName(hand)} unit was not touched, because the ${handName(failed.hand)} unit failed.`,
        ),
      );
      continue;
    }
    const outcome = await applyUnit(hand, records[hand], deps, name);
    units.push(outcome);
    if (outcome.status === 'failed') failed = outcome;
  }
  if (failed) return { ok: false, units, message: failed.message };
  const message = units.every((u) => u.status === 'unchanged')
    ? 'Both units already held the layout.'
    : 'Both units now run the layout.';
  return { ok: true, units, message };
}

function refused(hand: Hand, message: string): ApplyUnitsResult {
  return {
    ok: false,
    units: HANDS.map((h) =>
      h === hand
        ? blank(h, 'failed', message)
        : blank(h, 'not-attempted', `The ${handName(h)} unit was not touched.`),
    ),
    message,
  };
}
