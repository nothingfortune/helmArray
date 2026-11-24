// Apply, as the windows ask for it: `preview(schemeId)` says what is ready and what would change,
// `apply(schemeId)` does it. Only the Units target writes so far (apply-units.ts), and only the
// units the setup uses. The game's half is previewed (`game`: the bindings that change, set by
// hand from a bind sheet until M5 writes game files, after the units, stopping at the first
// failure).
//
// What this adds to the target:
//   - The scheme is resolved here, from the store as it is now (edits not yet written included).
//   - Readiness is worked out in main, again, by `apply`: a window's disabled button is not a
//     guard. Nothing is written unless the Azeron app is closed (asked afresh), the units the
//     setup uses are connected and known by hand, and the scheme has no error that wasn't
//     accepted. A setup with no Azeron needs neither.
//   - One apply at a time. A second is refused, in a sentence, and never queued behind the first.
//   - While it runs the devices service is held (`Devices.exclusive`): it neither polls nor opens
//     nor reads a unit, so nothing else talks to a unit mid-write; afterwards it reads both units
//     again, so what the pill compares is what they hold now, whatever came of the apply.
//   - Only a successful apply is remembered (`saveApplied`), makes the scheme the active one, and
//     writes the keys the plan dealt (`plan.ledger`) into the scheme, so a later edit never gives a
//     button another key: a key once given never moves. The scheme is written only if it still
//     resolves to the plan that was previewed, so what is saved is what was applied.
//
// Nothing here throws at a caller: every refusal and failure comes back as a sentence.
// Pure: the store, the units and the running programs are handed in.

import type { Game, GameBinding, Hand, Plan, Scheme } from '@helmarray/core';
import { gameRowsChanged, handsOf } from '@helmarray/core';
import type {
  ApplyGame,
  ApplyGameRow,
  ApplyPreview,
  ApplyResult,
  ApplyUnitChange,
  ApplyUnitResult,
  ReadyCheck,
} from '../shared/api';
import { NO_UNIT_SENTENCE, applyUnits, previewUnits } from './apply-units';
import type { UnitsDeps } from './apply-units';
import { heldUnits } from './app-state';
import type { DevicesSnapshot, HoldTools } from './devices';
import type { UnitOps } from './gated-session';
import type { HandStore } from './hands';
import { handsFor } from './hands';
import type { PlanSource } from './scheme-plan';
import { canonical, planFingerprint } from './plan-fingerprint';
import { planFor } from './scheme-plan';

/** A look at the units no older than this is used as it is when the drawer opens. */
export const PREVIEW_MAX_AGE_MS = 3000;

export const CHANGED_SENTENCE = 'The layout changed since the preview: look again.';
export const BUSY_SENTENCE = 'An apply is already running. Wait for it to finish.';
const APP_OPEN_SENTENCE = 'Close the Azeron app first: it talks to the units too.';
const APP_UNKNOWN_SENTENCE = "helmArray couldn't tell whether the Azeron app is open.";

/** The part of the devices service Apply uses. */
export interface ApplyDevices {
  snapshot(): DevicesSnapshot;
  session(deviceId: number): UnitOps | undefined;
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
  /** Saves the scheme as it is now (through the store, like an edit). */
  saveScheme(scheme: Scheme): void | Promise<void>;
  /** Makes the scheme the game's active one, and the game the active one. */
  setActive(gameId: string, schemeId: string): Promise<void>;
  /**
   * The plan applied to this game last, of any of its schemes: the game holds its bindings. Null
   * when none was; without it, the game is taken to hold what it ships.
   */
  gameHolds?(gameId: string): Promise<Plan | null>;
  /** An apply ended, however it ended: the state is to be worked out again. */
  settled?(): void | Promise<void>;
  trace?(line: string): void;
  maxReadAgeMs?: number;
}

export interface ApplyService {
  preview(schemeId: string): Promise<ApplyPreview>;
  apply(schemeId: string, fingerprint: string): Promise<ApplyResult>;
  /** An apply is running. */
  busy(): boolean;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);

/** What a successful write did, for a sentence that goes on to what else went wrong. */
function doneWords(plan: Plan): string {
  const hands = handsOf(plan);
  if (hands.length === 2) return 'Both units now run the layout';
  if (hands.length === 1)
    return `The ${hands[0] === 'left' ? 'left' : 'right'} unit now runs the layout`;
  return 'The scheme is applied';
}
const unitWord = (hand: Hand) => (hand === 'left' ? 'left' : 'right');

const emptyUnit = (hand: Hand, problem: string | null, used = true): ApplyUnitChange => ({
  hand,
  used,
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

  /** Which unit is which hand, and why a hand has none, as readiness checks: the setup's units. */
  const unitChecks = (used: readonly Hand[]): ReadyCheck[] => {
    const snapshot = deps.devices.snapshot();
    const ids = snapshot.units.flatMap((u) => (u.identity ? [u.identity.deviceId] : []));
    const hands = handsFor(ids, deps.hands);
    const strangers = hands.units.some((u) => u.hand === 'unknown');
    return used.map((hand): ReadyCheck => {
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
      if (unit.state === 'ready' && unit.slots === undefined) {
        // Not looked at since the Azeron app was last open, or could not be ruled out.
        return { ok: false, text: `The ${word} Azeron hasn't been read yet.` };
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

  /** What must hold before Apply. A setup with no Azeron talks to no unit: nothing about them. */
  const readiness = (open: boolean | null, plan: Plan): ReadyCheck[] => {
    const used = handsOf(plan);
    if (used.length === 0) return findingChecks(plan);
    return [
      open === null
        ? { ok: false, text: APP_UNKNOWN_SENTENCE }
        : open
          ? { ok: false, text: APP_OPEN_SENTENCE }
          : { ok: true, text: 'The Azeron app is closed.' },
      // With the Azeron app open the units are not talked to, so the service lists none: that is
      // not "unplugged", and is not said.
      ...(open === false ? unitChecks(used) : []),
      ...findingChecks(plan),
    ];
  };

  /** The game's bindings that change: the plan's against what the game holds now. */
  const gameHalf = async (plan: Plan, game: Game): Promise<ApplyGame> => {
    let holds: Plan | null = null;
    try {
      holds = (await deps.gameHolds?.(game.id)) ?? null;
    } catch (error) {
      trace(`couldn't read what was applied to ${game.id} last: ${messageOf(error)}`);
    }
    return { via: plan.gameFile ? 'file' : 'sheet', rows: changedRows(plan, game, holds) };
  };

  const preview = async (schemeId: string): Promise<ApplyPreview> => {
    const base = {
      schemeId,
      schemeName: '',
      gameName: '',
      fingerprint: '',
      azeronOpen: false,
      busy: false,
      anyChange: false,
      left: emptyUnit('left', null),
      right: emptyUnit('right', null),
      game: NO_GAME_CHANGE,
    };
    const resolved = await planFor(schemeId, deps.plans);
    if (!resolved.ok) {
      return { ...base, ready: false, checks: [{ ok: false, text: sentence(resolved.reason) }] };
    }
    const used = handsOf(resolved.plan);
    const names = {
      schemeName: resolved.scheme.name,
      gameName: resolved.game.name,
      fingerprint: planFingerprint(resolved.plan),
      game: await gameHalf(resolved.plan, resolved.game),
      left: emptyUnit('left', null, used.includes('left')),
      right: emptyUnit('right', null, used.includes('right')),
    };
    if (running) {
      return {
        ...base,
        ...names,
        busy: true,
        ready: false,
        checks: [{ ok: false, text: BUSY_SENTENCE }],
      };
    }
    // A setup with no Azeron has nothing to ask of the units or of the Azeron app.
    if (used.length === 0) {
      const checks = findingChecks(resolved.plan);
      return { ...base, ...names, ready: checks.every((c) => c.ok), checks };
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
      };
    }
    const snapshot = deps.devices.snapshot();
    const ids = snapshot.units.flatMap((u) => (u.identity ? [u.identity.deviceId] : []));
    const held = heldUnits(snapshot, handsFor(ids, deps.hands));
    const units = previewUnits(resolved.plan, held, { name: resolved.scheme.name });
    // A unit that isn't there already has its own check above; one not used has no problem.
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

  /**
   * The keys the plan dealt go into the scheme, so they are never dealt again. Only when the
   * scheme, as it is now, still resolves to the layout that was previewed and applied: an edit
   * that got in meanwhile is not written over. The plan resolved from the scheme afterwards is
   * the plan applied, so nothing then reads as a change not applied.
   */
  const keepLedger = async (schemeId: string, fingerprint: string, plan: Plan) => {
    const now = await planFor(schemeId, deps.plans);
    if (!now.ok || planFingerprint(now.plan) !== fingerprint) {
      return `${doneWords(plan)}, but the scheme was edited meanwhile, so the keys it was given weren't kept: apply again.`;
    }
    if (canonical(now.scheme.ledger) === canonical(plan.ledger)) return null;
    await deps.saveScheme({ ...now.scheme, ledger: structuredClone(plan.ledger) });
    return null;
  };

  /**
   * After units that now hold the plan: remembers it, makes the scheme active, and keeps its keys
   * in the scheme. The keys are kept whatever became of the others (they were dealt on the units
   * either way); the first problem is said.
   */
  const remember = async (
    schemeId: string,
    gameId: string,
    plan: Plan,
    fingerprint: string,
  ): Promise<string | null> => {
    let problem: string | null = null;
    try {
      await deps.saveApplied(schemeId, plan);
    } catch (error) {
      problem = `${doneWords(plan)}, but helmArray couldn't keep a note of it (${messageOf(error)}), so it can't say they are in sync.`;
    }
    try {
      // Not made the active scheme when no note of it could be kept.
      if (problem === null) await deps.setActive(gameId, schemeId);
    } catch (error) {
      problem ??= `${doneWords(plan)}, but it couldn't be made the current scheme (${messageOf(error)}).`;
    }
    try {
      const kept = await keepLedger(schemeId, fingerprint, plan);
      if (kept !== null) trace(`ledger: ${kept}`);
      problem ??= kept;
    } catch (error) {
      problem ??= `${doneWords(plan)}, but the keys it was given couldn't be kept in the scheme (${messageOf(error)}), so a later edit may give a button another key.`;
    }
    return problem;
  };

  const apply = async (schemeId: string, fingerprint: string): Promise<ApplyResult> => {
    // Claimed before anything is awaited: a second request in the same moment is refused.
    if (running) return refused(BUSY_SENTENCE);
    running = true;
    try {
      const resolved = await planFor(schemeId, deps.plans);
      if (!resolved.ok) return refused(sentence(resolved.reason));
      const { plan, scheme, game } = resolved;
      // Exactly what was previewed: the scheme may have changed under the drawer since (an edit,
      // an undo), and the person agreed to the layout they were shown, not to another.
      if (planFingerprint(plan) !== fingerprint) {
        return { ok: false, changed: true, message: CHANGED_SENTENCE, units: [] };
      }

      // A setup with no Azeron writes no unit: it is remembered, and the game's half is the
      // player's, from the drawer.
      if (handsOf(plan).length === 0) {
        const blocked = findingChecks(plan).find((c) => !c.ok);
        if (blocked) return refused(blocked.text);
        const problem = await remember(schemeId, game.id, plan, fingerprint);
        return { ok: problem === null, message: problem ?? NO_UNIT_SENTENCE, units: [] };
      }

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
        const problem = result.ok ? await remember(schemeId, game.id, plan, fingerprint) : null;
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
          fingerprint: '',
          ready: false,
          busy: false,
          azeronOpen: false,
          anyChange: false,
          checks: [{ ok: false, text: `helmArray couldn't check: ${sentence(messageOf(error))}` }],
          left: emptyUnit('left', null),
          right: emptyUnit('right', null),
          game: NO_GAME_CHANGE,
        };
      }
    },
    apply,
    busy: () => running,
  };
}

/** The game's half when there is nothing to say: no binding changes. */
const NO_GAME_CHANGE: ApplyGame = { via: 'sheet', rows: [] };

export function changedRows(plan: Plan, game: Game, holds: Plan | null): ApplyGameRow[] {
  // What the game holds of each action: the first of its rows in the plan applied last.
  const held = new Map<string, GameBinding>();
  for (const b of holds?.gameBindings ?? []) {
    const k = `${b.set}|${b.mode}|${b.action}`;
    if (!held.has(k)) held.set(k, b);
  }
  return gameRowsChanged(plan, holds).map((b) => ({
    set: b.set,
    mode: b.mode,
    modeName: game.modes.find((m) => m.id === b.mode)?.name ?? b.mode,
    action: b.action,
    actionName: game.actions.find((a) => a.id === b.action)?.name ?? b.action,
    to: b.signal,
    from: held.has(`${b.set}|${b.mode}|${b.action}`)
      ? (held.get(`${b.set}|${b.mode}|${b.action}`)?.signal ?? null)
      : b.native,
  }));
}
