// Puts the pieces together into the one `AppState` the windows are told: which units are plugged
// in and what each says, which hand each is, whether writing is blocked, and the sync pill.
// Pure: every input is handed in, so tests build them by hand.

import type { AppState, DeviceChip, HandQuestion as ApiQuestion } from '../shared/api';
import type { DevicesSnapshot, UnitSnapshot } from './devices';
import type { HandQuestion, HandsResult } from './hands';
import { syncState } from './sync-state';

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

export interface AppStateInput {
  devices: DevicesSnapshot;
  /** `settleHands` over the ids of the units that have identified themselves. */
  hands: HandsResult;
  /** Why writing is blocked (the Azeron app is open), or null. */
  writeBlock: string | null;
  /** The active game and scheme; none until the store says. */
  active?: { gameId: string | null; schemeId: string | null } | undefined;
}

export function composeAppState(input: AppStateInput): AppState {
  const { devices, hands, writeBlock, active } = input;
  // `sort` is stable: units of one rank stay in the order the service lists them.
  const chips = devices.units
    .map((unit) => chipOf(unit, hands))
    .sort((a, b) => RANK[a.hand] - RANK[b.hand]);
  const there = (hand: 'left' | 'right') => chips.some((chip) => chip.hand === hand);
  // Nothing is applied to a unit until M4, so there is nothing to compare a unit against and no
  // edit to be waiting: the pill says, truthfully, that it hasn't checked.
  const { label, tone } = syncState({
    left: { connected: there('left'), verdict: null },
    right: { connected: there('right'), verdict: null },
    pendingChanges: 0,
  });
  return {
    devices: chips,
    sync: { label, tone },
    writeBlock,
    question: questionOf(pendingAsk(devices, hands)),
    activeGameId: active?.gameId ?? null,
    activeSchemeId: active?.schemeId ?? null,
  };
}
