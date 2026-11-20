// Apply, as the windows ask for it: `preview(schemeId)` says what is ready and what would change,
// `apply(schemeId)` does it. Only the Units target exists so far (apply-units.ts); the game's
// file comes later and will run after the units, stopping at the first failure.
//
// What this adds to the target:
//   - The scheme is resolved here, from the store as it is now (edits not yet written included).
//   - Readiness is worked out in main, again, by `apply`: a window's disabled button is not a
//     guard. Nothing is written unless the Azeron app is closed (asked afresh), both units are
//     connected and known by hand, and the scheme has no error that wasn't accepted.
//   - One apply at a time. A second is refused, in a sentence, and never queued behind the first.
//   - While it runs the devices service is held (`Devices.exclusive`): it neither polls nor opens
//     nor reads a unit, so nothing else talks to a unit mid-write; afterwards it reads both units
//     again, so what the pill compares is what they hold now, whatever came of the apply.
//   - Only a successful apply is remembered (`saveApplied`) and makes the scheme the active one.
//
// Nothing here throws at a caller: every refusal and failure comes back as a sentence.
// Pure: the store, the units and the running programs are handed in.

import type { UnitSession } from '@helmarray/azeron';
import type { Hand, Plan } from '@helmarray/core';
import type {
  ApplyPreview,
  ApplyResult,
  ApplyUnitChange,
  ApplyUnitResult,
  ReadyCheck,
} from '../shared/api';
import { applyUnits, previewUnits } from './apply-units';
import type { UnitsDeps } from './apply-units';
import { heldUnits } from './app-state';
import type { DevicesSnapshot, HoldTools } from './devices';
import type { HandStore } from './hands';
import { handsFor } from './hands';
import type { PlanSource } from './scheme-plan';
import { planFor } from './scheme-plan';

/** A look at the units no older than this is used as it is when the drawer opens. */
export const PREVIEW_MAX_AGE_MS = 3000;

export const BUSY_SENTENCE = 'An apply is already running. Wait for it to finish.';
const APP_OPEN_SENTENCE = 'Close the Azeron app first: it talks to the units too.';
const APP_UNKNOWN_SENTENCE = "helmArray couldn't tell whether the Azeron app is open.";

/** The part of the devices service Apply uses. */
export interface ApplyDevices {
  snapshot(): DevicesSnapshot;
  session(deviceId: number): UnitSession | undefined;
  refresh(options?: { olderThanMs?: number }): Promise<void>;
  exclusive<T>(job: (tools: HoldTools) => Promise<T>): Promise<T>;
}

export interface ApplyServiceDeps {
  plans: PlanSource;
  devices: ApplyDevices;
  hands: Pick<HandStore, 'get'>;
  /** A fresh look at the running programs, every call; a look that fails throws. */
  azeronAppRunning(): Promise<boolean>;
  /** Remembers the plan just applied for the scheme. Called only after a successful apply. */
  saveApplied(schemeId: string, plan: Plan): Promise<void>;
  /** Makes the scheme the game's active one, and the game the active one. */
  setActive(gameId: string, schemeId: string): Promise<void>;
  /** An apply ended, however it ended: the state is to be worked out again. */
  settled?(): void | Promise<void>;
  trace?(line: string): void;
  maxReadAgeMs?: number;
}

export interface ApplyService {
  preview(schemeId: string): Promise<ApplyPreview>;
  apply(schemeId: string): Promise<ApplyResult>;
  /** An apply is running. */
  busy(): boolean;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);
const unitWord = (hand: Hand) => (hand === 'left' ? 'left' : 'right');

const emptyUnit = (hand: Hand, problem: string | null): ApplyUnitChange => ({
  hand,
  connected: false,
  differs: false,
  inputsChanged: 0,
  write: null,
  deletes: [],
  changes: [],
  problem,
});

export function createApplyService(deps: ApplyServiceDeps): ApplyService {
  let running = false;
  const trace = (line: string) => {
    try {
      deps.trace?.(line);
    } catch {
      // The log must never take Apply down.
    }
  };

  /** Whether the Azeron app is open: true, false, or null when that can't be told. */
  const azeronOpen = async (): Promise<boolean | null> => {
    try {
      return await deps.azeronAppRunning();
    } catch (error) {
      trace(`couldn't look for the Azeron app: ${messageOf(error)}`);
      return null;
    }
  };

  /** Which unit is which hand, and why a hand has none, as readiness checks. */
  const unitChecks = (): ReadyCheck[] => {
    const snapshot = deps.devices.snapshot();
    const ids = snapshot.units.flatMap((u) => (u.identity ? [u.identity.deviceId] : []));
    const hands = handsFor(ids, deps.hands);
    const strangers = hands.units.some((u) => u.hand === 'unknown');
    return (['left', 'right'] as const).map((hand): ReadyCheck => {
      const id = hands.units.find((u) => u.hand === hand)?.id;
      const unit = snapshot.units.find((u) => id !== undefined && u.identity?.deviceId === id);
      const word = unitWord(hand);
      if (!unit) {
        return {
          ok: false,
          text: strangers
            ? `helmArray doesn't know yet which Azeron is the ${word} one.`
            : `The ${word} Azeron isn't connected.`,
        };
      }
      if (unit.state === 'connecting') {
        return { ok: false, text: `The ${word} Azeron is still being read.` };
      }
      if (unit.state === 'failed') {
        return {
          ok: false,
          text: `The ${word} Azeron couldn't be read${unit.error ? `: ${sentence(unit.error)}` : '.'}`,
        };
      }
      return { ok: true, text: `The ${word} Azeron is connected.` };
    });
  };

  /** What blocks, and what doesn't, as checks. Errors the player accepted don't block. */
  const findingChecks = (plan: Plan): ReadyCheck[] => {
    const errors = plan.findings.filter((f) => f.severity === 'error' && f.accepted === undefined);
    return errors.length === 0
      ? [{ ok: true, text: 'The scheme has no errors.' }]
      : errors.map((f) => ({ ok: false, text: sentence(f.message) }));
  };

  const readiness = (open: boolean | null, plan: Plan): ReadyCheck[] => [
    open === null
      ? { ok: false, text: APP_UNKNOWN_SENTENCE }
      : open
        ? { ok: false, text: APP_OPEN_SENTENCE }
        : { ok: true, text: 'The Azeron app is closed.' },
    // With the Azeron app open the units are not talked to, so the service lists none: that is
    // not "unplugged", and is not said.
    ...(open === false ? unitChecks() : []),
    ...findingChecks(plan),
  ];

  const preview = async (schemeId: string): Promise<ApplyPreview> => {
    const base = {
      schemeId,
      schemeName: '',
      gameName: '',
      azeronOpen: false,
      busy: false,
      anyChange: false,
      left: emptyUnit('left', null),
      right: emptyUnit('right', null),
    };
    const resolved = await planFor(schemeId, deps.plans);
    if (!resolved.ok) {
      return { ...base, ready: false, checks: [{ ok: false, text: sentence(resolved.reason) }] };
    }
    const names = { schemeName: resolved.scheme.name, gameName: resolved.game.name };
    if (running) {
      return {
        ...base,
        ...names,
        busy: true,
        ready: false,
        checks: [{ ok: false, text: BUSY_SENTENCE }],
      };
    }
    const open = await azeronOpen();
    // The units are read only while the Azeron app is known to be closed.
    if (open === false) {
      try {
        await deps.devices.refresh({ olderThanMs: deps.maxReadAgeMs ?? PREVIEW_MAX_AGE_MS });
      } catch (error) {
        trace(`reading the units for the preview failed: ${messageOf(error)}`);
      }
    }
    const checks = readiness(open, resolved.plan);
    if (open !== false) {
      return {
        ...base,
        ...names,
        azeronOpen: open === true,
        ready: false,
        checks,
        left: emptyUnit('left', null),
        right: emptyUnit('right', null),
      };
    }
    const snapshot = deps.devices.snapshot();
    const ids = snapshot.units.flatMap((u) => (u.identity ? [u.identity.deviceId] : []));
    const held = heldUnits(snapshot, handsFor(ids, deps.hands));
    const units = previewUnits(resolved.plan, held, { name: resolved.scheme.name });
    // A unit that isn't there already has its own check above.
    for (const unit of [units.left, units.right]) {
      if (unit.connected && unit.problem !== null) checks.push({ ok: false, text: unit.problem });
    }
    return {
      ...base,
      ...names,
      ready: checks.every((c) => c.ok),
      checks,
      anyChange: units.anyChange,
      left: units.left,
      right: units.right,
    };
  };

  const refused = (message: string): ApplyResult => ({ ok: false, message, units: [] });

  /** Remembers the plan and makes the scheme active, after units that now hold it. */
  const remember = async (schemeId: string, gameId: string, plan: Plan): Promise<string | null> => {
    try {
      await deps.saveApplied(schemeId, plan);
    } catch (error) {
      return `Both units now run the layout, but helmArray couldn't keep a note of it (${messageOf(error)}), so it can't say they are in sync.`;
    }
    try {
      await deps.setActive(gameId, schemeId);
    } catch (error) {
      return `Both units now run the layout, but it couldn't be made the current scheme (${messageOf(error)}).`;
    }
    return null;
  };

  const apply = async (schemeId: string): Promise<ApplyResult> => {
    // Claimed before anything is awaited: a second request in the same moment is refused.
    if (running) return refused(BUSY_SENTENCE);
    running = true;
    try {
      const resolved = await planFor(schemeId, deps.plans);
      if (!resolved.ok) return refused(sentence(resolved.reason));
      const { plan, scheme, game } = resolved;

      const open = await azeronOpen();
      const blocking = readiness(open, plan).find((c) => !c.ok);
      if (blocking) return refused(blocking.text);

      const snapshot = deps.devices.snapshot();
      const ids = snapshot.units.flatMap((u) => (u.identity ? [u.identity.deviceId] : []));
      const hands = handsFor(ids, deps.hands);
      const unitDeps: UnitsDeps = {
        azeronAppRunning: () => deps.azeronAppRunning(),
        unit: (hand) => {
          const id = hands.units.find((u) => u.hand === hand)?.id;
          const session = id === undefined ? undefined : deps.devices.session(id);
          return id === undefined || !session ? undefined : { session, deviceId: id };
        },
        name: scheme.name,
        trace: (line) => trace(`apply: ${line}`),
      };

      const outcome = await deps.devices.exclusive(async (tools) => {
        let result;
        try {
          result = await applyUnits(plan, unitDeps);
        } finally {
          // Whatever came of it, what the units hold now is read, before the hold is let go.
          await tools.refresh();
        }
        const problem = result.ok ? await remember(schemeId, game.id, plan) : null;
        return { result, problem };
      });

      const units: ApplyUnitResult[] = outcome.result.units.map((u) => ({
        hand: u.hand,
        status: u.status,
        message: u.message,
        slot: u.slot,
      }));
      if (outcome.problem !== null) return { ok: false, message: outcome.problem, units };
      return { ok: outcome.result.ok, message: outcome.result.message, units };
    } catch (error) {
      trace(`apply failed unexpectedly: ${messageOf(error)}`);
      return refused(`helmArray couldn't apply: ${sentence(messageOf(error))}`);
    } finally {
      running = false;
      try {
        await deps.settled?.();
      } catch (error) {
        trace(`after an apply: ${messageOf(error)}`);
      }
    }
  };

  return {
    preview: async (schemeId) => {
      try {
        return await preview(schemeId);
      } catch (error) {
        trace(`preview failed unexpectedly: ${messageOf(error)}`);
        return {
          schemeId,
          schemeName: '',
          gameName: '',
          ready: false,
          busy: false,
          azeronOpen: false,
          anyChange: false,
          checks: [{ ok: false, text: `helmArray couldn't check: ${sentence(messageOf(error))}` }],
          left: emptyUnit('left', null),
          right: emptyUnit('right', null),
        };
      }
    },
    apply,
    busy: () => running,
  };
}
