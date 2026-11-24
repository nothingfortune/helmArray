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

import type { StoredRecord, StoredSlot, Verdict } from '@helmarray/azeron';
import {
  BLOCK_TYPES,
  INPUT_ID_BY_PIN,
  MAX_PROFILE_NAME,
  UnitError,
  encodeRecord,
  lowestFree,
  unitRecords,
  verify,
} from '@helmarray/azeron';
import type { UnitRecord } from '@helmarray/azeron';
import type { Hand, Plan, UnitProfile } from '@helmarray/core';
import type { ApplyButtonChange } from '../shared/api';
import type { UnitOps } from './gated-session';
import { CYBORG2_LEFT, CYBORG2_RIGHT, handsOf, unitOf } from '@helmarray/core';

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
  /** The game's name for an action, for the buttons a preview lists. Its id without it. */
  actionName?(mode: string, action: string): string;
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
      reason: `The unit has room for ${limit} layout${limit === 1 ? '' : 's'} and is running the only one, so there is nowhere to write without overwriting it.`,
    };
  }
  return { ok: true, slot: pick.slot, overwrites: pick };
}

// ---------------------------------------------------------------------------------- preview

export interface UnitPreview {
  hand: Hand;
  /**
   * The setup uses this unit. One it doesn't (the right one, for *left Azeron + mouse*) is never
   * written, switched or cleaned up, and nothing else here says anything about it.
   */
  used: boolean;
  connected: boolean;
  /** The layout differs from what the unit runs now (`verify()` against the running slot). */
  differs: boolean;
  /** How many of the unit's inputs differ. */
  inputsChanged: number;
  /** The buttons that change, for the person: see `ApplyUnitChange.buttons`. */
  buttons: ApplyButtonChange[];
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
  return unitRecords(unitOf(plan, hand), DEVICE[hand]);
}

/**
 * The records a unit is written, every one encoded as a write would encode it (the slot is only
 * its first byte), so a layout a record can't hold is refused here and not part way through.
 */
function writableRecordsFor(plan: Plan, hand: Hand): UnitRecord[] {
  const records = recordsFor(plan, hand);
  for (const record of records) encodeRecord(0, record);
  return records;
}

/** Block type bytes that send nothing: none, disabled, and 0 (never written). */
const SILENT = new Set<number>([0, BLOCK_TYPES.none, BLOCK_TYPES.disabled]);

/** The unit held nothing on this input: no record, or a button whose every press sends nothing. */
function heldNothing(stored: StoredRecord | undefined): boolean {
  if (stored === undefined) return true;
  if (stored.kind !== 'button') return false;
  return [stored.tap, stored.long, stored.double].every(
    (block) => SILENT.has(block.typeByte) && block.wheel === undefined,
  );
}

/**
 * The buttons (and the stick) whose inputs differ, as the person knows them: the position, the
 * actions on it once applied, and whether it was empty before or is empty after. A button that
 * was empty and stays empty is no change to anyone, and is left out.
 */
function changedButtons(
  plan: Plan,
  hand: Hand,
  verdict: Verdict,
  running: readonly StoredRecord[],
  actionName: (mode: string, action: string) => string,
): ApplyButtonChange[] {
  const profile = unitOf(plan, hand);
  const ids = new Set([
    ...verdict.differences.map((d) => d.id),
    ...verdict.unchecked.map((u) => u.id),
  ]);
  const stickId = recordsFor(plan, hand).find((r) => r.kind === 'stick')?.id;
  const out: ApplyButtonChange[] = [];
  for (const pin of profile.pins) {
    const id = INPUT_ID_BY_PIN.get(pin.pin);
    if (id === undefined || !ids.has(id)) continue;
    const wasEmpty = heldNothing(running.find((r) => r.id === id));
    const nowEmpty = Object.keys(pin.presses).length === 0;
    if (wasEmpty && nowEmpty) continue;
    const actions: string[] = [];
    for (const b of plan.bindings) {
      if (b.control !== pin.control) continue;
      const words = actionName(b.mode, b.action);
      if (!actions.includes(words)) actions.push(words);
    }
    out.push({
      position: pin.position,
      actions,
      sends: pin.presses.tap ?? null,
      stick: null,
      wasEmpty,
      nowEmpty,
    });
  }
  if (stickId !== undefined && ids.has(stickId)) {
    out.push({
      position: 'stick',
      actions: [],
      sends: null,
      stick: structuredClone(profile.stick),
      wasEmpty: false,
      nowEmpty: false,
    });
  }
  return out;
}

function previewUnit(
  plan: Plan,
  hand: Hand,
  held: HeldUnit | undefined,
  name: string,
  actionName: (mode: string, action: string) => string,
): UnitPreview {
  const base: UnitPreview = {
    hand,
    used: plan.units[hand] !== undefined,
    connected: held !== undefined,
    differs: false,
    inputsChanged: 0,
    buttons: [],
    write: null,
    deletes: [],
    changes: [],
    problem: null,
  };
  const unit = handName(hand);
  if (!base.used) return base;
  if (!held) return { ...base, problem: `The ${unit} unit is not connected.` };
  let records: UnitRecord[];
  try {
    records = writableRecordsFor(plan, hand);
  } catch (error) {
    return { ...base, problem: sentence(messageOf(error)) };
  }
  const runningRecords = held.slots.find((s) => s.slot === held.running)?.records ?? [];
  const verdict = verify(records, runningRecords);
  const differs = !isClean(verdict);
  const inputsChanged = new Set([
    ...verdict.differences.map((d) => d.id),
    ...verdict.unchecked.map((u) => u.id),
  ]).size;
  const buttons = changedButtons(plan, hand, verdict, runningRecords, actionName);
  let target = held.running;
  let write: UnitPreview['write'] = null;
  const changes: string[] = [];
  if (differs) {
    const choice = chooseSlot(held.slots, held.running, held.slotLimit, name);
    if (!choice.ok) return { ...base, differs, inputsChanged, buttons, problem: choice.reason };
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
  return { ...base, differs, inputsChanged, buttons, write, deletes, changes };
}

/** What Apply would do to the units, in words. `held` is what each unit holds now. */
export function previewUnits(
  plan: Plan,
  held: HeldUnits,
  options: UnitsOptions = {},
): UnitsPreview {
  const name = unitSlotName(options.name);
  const actionName = options.actionName ?? ((_mode: string, action: string) => action);
  const left = previewUnit(plan, 'left', held.left, name, actionName);
  const right = previewUnit(plan, 'right', held.right, name, actionName);
  // A unit the setup doesn't use has nothing to do, so it adds no line, no change and no problem.
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
 * the setup doesn't use, one that is not connected, or one whose layout can't be worked out.
 */
export function verifyUnits(plan: Plan, held: HeldUnits): Record<Hand, Verdict | null> {
  const one = (hand: Hand): Verdict | null => {
    const unit = held[hand];
    if (!unit) return null;
    // Stryker disable next-line ConditionalExpression: recordsFor throws for a unit the plan lacks and the catch below returns null: the same answer
    if (plan.units[hand] === undefined) return null;
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

/**
 * One unit's running slot against the profile it was last written with (`units.json`): what the
 * unit reports, never what the app last did. Null when the unit isn't read, or the profile can't
 * be turned into records.
 */
export function verifyProfile(profile: UnitProfile, held: HeldUnit | undefined): Verdict | null {
  if (!held) return null;
  try {
    return verify(
      unitRecords(profile, DEVICE[profile.hand]),
      held.slots.find((s) => s.slot === held.running)?.records ?? [],
    );
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------ apply

export interface UnitsDeps {
  /** A fresh look at the running programs, every call. Never a cached poll. */
  azeronAppRunning(): Promise<boolean>;
  /** The connected unit that is this hand, with the id it is expected to report. */
  unit(hand: Hand): { session: UnitOps; deviceId: number } | undefined;
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
  /** Every unit the setup uses holds the plan. */
  ok: boolean;
  /** Left, then right: the units the setup uses, and only those. */
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
  // Stryker disable next-line StringLiteral: the message is always set before an outcome leaves, by the Stop handler or by the success path
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

    // The profile button moves the running slot unannounced, also while the slots are being
    // read: what the unit runs is asked again now, after them, and that is what is decided on.
    let running: number;
    try {
      running = await session.runningSlot();
    } catch (error) {
      return stop(messageOf(error));
    }
    const runningSlot = slots.find((s) => s.slot === running);
    const verdict = verify(records, runningSlot?.records ?? []);
    let slot = running;

    if (isClean(verdict)) {
      trace(`already holds the layout in slot ${slot}`);
    } else {
      const choice = chooseSlot(slots, running, identity.slotLimit, name);
      if (!choice.ok) return stop(choice.reason);
      slot = choice.slot;
      const into = choice.overwrites ? slotLabel(choice.overwrites) : `slot ${slot}`;
      // A slot written over has lost what it held, whatever happens next: say so.
      const overwritten = (clause: string) =>
        choice.overwrites
          ? `${clause} and what it held before${choice.overwrites.name === '' ? '' : ` ("${choice.overwrites.name}")`} is gone`
          : clause;
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
        ? `${into} may be part-written, and the unit still runs slot ${running} with its other slots as they were`
        : `a new slot ${slot} may be part-written, and the unit still runs slot ${running} with its other slots as they were`;
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
        const unreadable = (u: { id: number }) => ({ id: u.id, what: 'could not be read back' });
        const first = [...result.differences, ...result.unchecked.map(unreadable)][0];
        const count = new Set([
          ...result.differences.map((d) => d.id),
          ...result.unchecked.map((u) => u.id),
        ]).size;
        left = `${overwritten(`slot ${slot} is not in use`)}, the unit still runs slot ${running}, and nothing was deleted`;
        return stop(
          `slot ${slot} read back differently from the layout (${count} input${count === 1 ? '' : 's'}${first ? `, first: input ${first.id} ${first.what}` : ''})`,
        );
      }
      left = `${overwritten(`slot ${slot} holds the layout`)}, the unit still runs slot ${running}, and nothing was deleted`;
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
    // A read is traffic to the unit too: the Azeron app is looked for again before it.
    await guard();
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
      // Every deletion rests on the unit running the layout: asked again each time, because the
      // button can move it, and a slot is then deleted on a false premise.
      let now: number;
      try {
        now = await session.runningSlot();
      } catch (error) {
        return stop(messageOf(error));
      }
      if (now !== slot) {
        return stop(`it now runs slot ${now}, not slot ${slot} where the layout is`);
      }
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
    left = 'the other slots are deleted';
    await guard();
    let finalVerdict: Verdict;
    try {
      const after = await session.readSlots();
      const running = await session.runningSlot();
      finalVerdict = verify(records, after.find((s) => s.slot === running)?.records ?? []);
      outcome.verdict = finalVerdict;
      left = `the unit runs slot ${running} and the other slots are deleted`;
      if (running !== slot) return stop(`it is not running slot ${slot}, where the layout is`);
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
    // In the person's words: their layouts, not the unit's numbered slots.
    const removed =
      n === 1 ? 'its other layout was removed' : `its other ${n} layouts were removed`;
    outcome.message = wrote
      ? `The ${unit} unit runs the layout${n > 0 ? `; ${removed}` : ''}.`
      : n > 0
        ? `The ${unit} unit already held the layout; ${removed}.`
        : `The ${unit} unit already held the layout.`;
    return outcome;
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    outcome.message = error.message;
    return outcome;
  }
}

/** What the units the setup uses are called in a sentence: "Both units", "The left unit". */
function unitsWord(hands: readonly Hand[]): string {
  return hands.length === 2 ? 'Both units' : `The ${handName(hands[0] ?? 'left')} unit`;
}

/**
 * Applies the plan to the units its setup uses, the left one first, stopping at the first
 * failure. A unit the setup doesn't use is never sent anything, not even a read.
 */
export async function applyUnits(plan: Plan, deps: UnitsDeps): Promise<ApplyUnitsResult> {
  const name = unitSlotName(deps.name);
  const hands = handsOf(plan);
  if (hands.length === 0) return { ok: true, units: [], message: NO_UNIT_SENTENCE };
  // Everything that needs no unit is worked out first, so a layout that can't be written
  // refuses before either unit has been touched.
  const records = {} as Record<Hand, UnitRecord[]>;
  for (const hand of hands) {
    try {
      // keyed-write-ok: the key is a hand, left or right, never data
      records[hand] = writableRecordsFor(plan, hand);
    } catch (error) {
      const message = `The ${handName(hand)} unit failed: ${withoutPeriod(messageOf(error))}; nothing on it was changed.`;
      return refused(hands, hand, message);
    }
  }
  const units: UnitOutcome[] = [];
  let failed: UnitOutcome | undefined;
  for (const hand of hands) {
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
    ? `${unitsWord(hands)} already held the layout.`
    : `${unitsWord(hands)} now run${hands.length === 2 ? '' : 's'} the layout.`;
  return { ok: true, units, message };
}

/** What Apply says of the units for a setup that uses none. */
export const NO_UNIT_SENTENCE = 'Applied. This scheme uses no Azeron, so none was written.';

function refused(hands: readonly Hand[], hand: Hand, message: string): ApplyUnitsResult {
  return {
    ok: false,
    units: hands.map((h) =>
      h === hand
        ? blank(h, 'failed', message)
        : blank(h, 'not-attempted', `The ${handName(h)} unit was not touched.`),
    ),
    message,
  };
}
