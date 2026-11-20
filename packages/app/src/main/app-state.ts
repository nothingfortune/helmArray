// Puts the pieces together into the one `AppState` the windows are told: which units are plugged
// in and what each says, which hand each is, whether writing is blocked, and the sync pill.
// Pure: every input is handed in, so tests build them by hand.

import type { AppState, DeviceChip, HandQuestion as ApiQuestion } from '../shared/api';
import type { Hand } from '@helmarray/core';
import type { ActivePlans } from './active-plans';
import { NO_PLANS } from './active-plans';
import { verifyUnits } from './apply-units';
import type { HeldUnits } from './apply-units';
import type { DevicesSnapshot, UnitSnapshot } from './devices';
import type { HandQuestion, HandsResult } from './hands';
import { pendingChanges, syncDetail, syncState } from './sync-state';
import type { SyncInput } from './sync-state';

/**
 * The question to put to the person now, or null. Nothing is asked while a unit is still
 * connecting: a unit that has yet to answer could be the second one, and a single unit asked
 * about "outright" would then be asked about twice.
 */
export function pendingAsk(devices: DevicesSnapshot, hands: HandsResult): HandQuestion | null {
  return devices.units.some((unit) => unit.state === 'connecting') ? null : hands.ask;
}

const RANK = { left: 0, right: 1, unknown: 2 } as const;

function chipOf(unit: UnitSnapshot, hands: HandsResult): DeviceChip {
  const id = unit.identity?.deviceId;
  const hand = (id !== undefined && hands.units.find((held) => held.id === id)?.hand) || 'unknown';
  return {
    hand,
    unitId: id ?? null,
    state: unit.state,
    firmware: unit.identity?.firmware ?? null,
    error: unit.error ?? null,
  };
}

function questionOf(ask: HandQuestion | null): ApiQuestion {
  if (!ask) return null;
  return ask.kind === 'press'
    ? { kind: 'press', prompt: ask.prompt }
    : { kind: 'choose', unitId: ask.id, prompt: ask.prompt };
}

/**
 * What each hand's unit holds as last read: only units that are ready, and only those whose hand
 * is known. A unit that is still connecting, failed, or not yet told apart holds nothing here.
 */
export function heldUnits(
  devices: DevicesSnapshot,
  hands: HandsResult,
  /** With it, a unit read longer ago than `maxAgeMs` (or not dated) holds nothing here. */
  freshness?: { now: number; maxAgeMs: number },
): HeldUnits {
  const held: HeldUnits = {};
  for (const unit of devices.units) {
    const { identity, slots } = unit;
    if (unit.state !== 'ready' || !identity || !slots) continue;
    if (
      freshness !== undefined &&
      (unit.readAt === undefined || freshness.now - unit.readAt > freshness.maxAgeMs)
    ) {
      continue;
    }
    const hand: Hand | 'unknown' | undefined = hands.units.find(
      (u) => u.id === identity.deviceId,
    )?.hand;
    if (hand !== 'left' && hand !== 'right') continue;
    held[hand] = {
      deviceId: identity.deviceId,
      slots,
      running: identity.runningSlot,
      slotLimit: identity.slotLimit,
    };
  }
  return held;
}

/**
 * The pill never says In sync from a reading older than this: the slot a unit runs is asked every
 * few seconds, and a reading that is not renewed is not a reading of the unit now.
 */
export const MAX_READING_AGE_MS = 10_000;

export interface AppStateInput {
  devices: DevicesSnapshot;
  /** `settleHands` over the ids of the units that have identified themselves. */
  hands: HandsResult;
  /** Why writing is blocked (the Azeron app is open), or null. */
  writeBlock: string | null;
  /** The active game and scheme; none until the store says. */
  active?: { gameId: string | null; schemeId: string | null } | undefined;
  /**
   * The active scheme's applied plan and what it resolves to now. The pill is the units against
   * the applied plan, and the scheme against the applied plan; nothing else. Without it the pill
   * has nothing to compare, and says so.
   */
  plans?: ActivePlans | undefined;
  /**
   * The time now (ms since 1970). With it, a unit read longer ago than `MAX_READING_AGE_MS` counts
   * as not read: the pill says it has not checked. Without it, no reading is too old.
   */
  now?: number | undefined;
}

export function composeAppState(input: AppStateInput): AppState {
  const { devices, hands, writeBlock, active } = input;
  const plans = input.plans ?? NO_PLANS;
  // `sort` is stable: units of one rank stay in the order the service lists them.
  const chips = devices.units
    .map((unit) => chipOf(unit, hands))
    .sort((a, b) => RANK[a.hand] - RANK[b.hand]);
  const there = (hand: 'left' | 'right') => chips.some((chip) => chip.hand === hand);
  // Read from the units, never from what the app last did: each unit's running slot against the
  // plan last applied for the active scheme, and the scheme as it is now against that same plan.
  const verdicts = plans.applied
    ? verifyUnits(
        plans.applied,
        heldUnits(
          devices,
          hands,
          input.now === undefined ? undefined : { now: input.now, maxAgeMs: MAX_READING_AGE_MS },
        ),
      )
    : { left: null, right: null };
  const syncInput: SyncInput = {
    left: { connected: there('left'), verdict: verdicts.left },
    right: { connected: there('right'), verdict: verdicts.right },
    pendingChanges: plans.active ? pendingChanges(plans.applied, plans.current) : 0,
    nothingApplied: plans.active && plans.applied === null,
  };
  const { label, tone } = syncState(syncInput);
  const detail = syncDetail(syncInput);
  return {
    devices: chips,
    sync: { label, tone, ...(detail !== undefined && { detail }) },
    writeBlock,
    question: questionOf(pendingAsk(devices, hands)),
    activeGameId: active?.gameId ?? null,
    activeSchemeId: active?.schemeId ?? null,
  };
}
