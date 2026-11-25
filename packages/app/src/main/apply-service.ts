// Apply, as the windows ask for it: `preview(schemeId)` says what is ready and what would change,
// `apply(schemeId)` does it. Two targets write: the units the setup uses (apply-units.ts), then the
// game's file, for a game whose file helmArray writes (game-file.ts), stopping at the first
// failure. The game's half is previewed (`game`: the bindings that change); where helmArray doesn't
// write the game's file, they are set by hand from a bind sheet.
//
// What this adds to the target:
//   - The scheme is resolved here, from the store as it is now (edits not yet written included).
//   - Readiness is worked out in main, again, by `apply`: a window's disabled button is not a
//     guard. Nothing is written unless the Azeron app is closed (asked afresh), the units the
//     setup uses are connected and known by hand, and the scheme has no error that wasn't
//     accepted. A setup with no Azeron needs neither. Where the game's file is written, the game
//     must be closed and its file found and able to take the bindings, before any unit is written.
//   - The game's file written (or found holding the bindings already) moves the game's baseline
//     to them (`settleBaseline`): nothing is left to set by hand. A file not written leaves it.
//     A file gone between the drawer and the write is no failure: as for one missing from the
//     start, the game's bindings are all set by hand (`ApplyResult.game`), and the apply is done.
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

import type { ApplyWho, Game, GameBinding, Hand, Plan, Scheme, UnitsHeld } from '@helmarray/core';
import { handsOf, pendingRows } from '@helmarray/core';
import type {
  ApplyGame,
  ApplyGameRow,
  ApplyPreview,
  ApplyResult,
  ApplyUnitChange,
  ApplyUnitResult,
  ReadyCheck,
} from '../shared/api';
import { NO_UNIT_SENTENCE, applyUnits, previewUnits, verifyProfile } from './apply-units';
import type { HeldUnits, UnitsDeps, UnitsOptions } from './apply-units';
import { heldUnits } from './app-state';
import type { DevicesSnapshot, HoldTools } from './devices';
import type { FileOutcome, GameFileTarget } from './game-file';
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
   * The bindings the game holds as far as helmArray knows: its baseline, moved only when the
   * person says they set what was left to set (*Done*). Null: what it ships, as without it.
   */
  gameHolds?(gameId: string): Promise<Pick<Plan, 'gameBindings'> | null>;
  /**
   * Notes what each unit now holds, after the units are written: every unit that came out holding
   * the plan holds this scheme (`recordApply`). Called whatever came of the others.
   */
  recordUnits?(
    plan: Plan,
    outcomes: readonly { hand: Hand; status: string }[],
    who: ApplyWho,
  ): Promise<void>;
  /**
   * What each unit was last written with (units.json): the identity of the layout it runs. Without
   * it no layout Apply removes is taken for the scheme's own earlier copy, so every one is said.
   */
  unitsHeld?(): Promise<UnitsHeld>;
  /**
   * The game's file, for a game whose file helmArray writes. Without it, every game's bindings are
   * set by hand.
   */
  gameFile?: GameFileTarget;
  /** The game now holds these bindings: its file was written. Moves its baseline. */
  settleBaseline?(gameId: string, bindings: readonly GameBinding[]): Promise<void>;
  /** The clock, for when an apply was. Defaults to `Date.now`. */
  now?(): number;
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
  buttons: [],
  write: null,
  deletes: [],
  changes: [],
  problem,
});

/** What is known of the layouts on a unit, for what Apply removes: see `RemovedLayout`. */
type LayoutOf = NonNullable<UnitsOptions['layoutOf']>;

/**
 * Identity, never a name: a layout is this scheme's own earlier copy only when the units' record
 * says this scheme was last written to that unit, and the unit, read now, runs that very layout in
 * this slot. The record's game is known of the slot the unit runs when the read agrees with it;
 * of any other slot nothing is known but its name.
 */
export function layoutIdentity(
  schemeId: string,
  held: HeldUnits,
  record: UnitsHeld | null,
  gameName: (gameId: string) => string | null,
): LayoutOf {
  return (hand, slot) => {
    const unit = held[hand];
    const write = record?.[hand] ?? null;
    if (unit === undefined || write === null || slot.slot !== unit.running) {
      return { ownCopy: false, game: null };
    }
    const verdict = verifyProfile(write.profile, unit);
    const runs =
      verdict !== null && verdict.differences.length === 0 && verdict.unchecked.length === 0;
    if (!runs) return { ownCopy: false, game: null };
    return { ownCopy: write.schemeId === schemeId, game: gameName(write.gameId) };
  };
}

/** What a good apply says of the layouts it removed: each that wasn't the scheme's own copy. */
export function removedWords(
  gone: readonly { name: string; game: string | null }[],
): string | null {
  if (gone.length === 0) return null;
  const one = ({ name, game }: { name: string; game: string | null }) =>
    `${name === '' ? 'a layout with no name' : `your layout “${name}”`}${game === null ? '' : ` from ${game}`}`;
  return `${gone.map(one).join(' and ')} ${gone.length === 1 ? 'was' : 'were'} removed`;
}

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
          kind: 'unit',
          text: strangers
            ? `helmArray doesn't know yet which Azeron is the ${word} one.`
            : `The ${word} Azeron isn't connected.`,
        };
      }
      if (unit.state === 'connecting') {
        return { ok: false, kind: 'unit', text: `The ${word} Azeron is still being read.` };
      }
      if (unit.state === 'paused' || (unit.state === 'ready' && unit.slots === undefined)) {
        // Let go of while the Azeron app was open, not looked at since it was, or could not be
        // ruled out.
        return { ok: false, kind: 'unit', text: `The ${word} Azeron hasn't been read yet.` };
      }
      if (unit.state === 'failed') {
        return {
          ok: false,
          kind: 'unit',
          text: `The ${word} Azeron couldn't be read${unit.error ? `: ${sentence(unit.error)}` : '.'}`,
        };
      }
      return { ok: true, kind: 'unit', text: `The ${word} Azeron is connected.` };
    });
  };

  /** What is known of the layouts on the units, by identity (`layoutIdentity`). */
  const identityOf = async (schemeId: string, held: HeldUnits): Promise<LayoutOf> => {
    let record: UnitsHeld | null = null;
    try {
      record = (await deps.unitsHeld?.()) ?? null;
    } catch (error) {
      trace(`couldn't read what the units were last written with: ${messageOf(error)}`);
    }
    const names = new Map<string, string>();
    for (const write of [record?.left, record?.right]) {
      if (!write || names.has(write.gameId)) continue;
      const known = await deps.plans.getGame(write.gameId).catch(() => undefined);
      if (known) names.set(write.gameId, known.name);
    }
    return layoutIdentity(schemeId, held, record, (id) => names.get(id) ?? null);
  };

  /** What blocks, and what doesn't, as checks. Errors the player accepted don't block. */
  const findingChecks = (plan: Plan): ReadyCheck[] => {
    const errors = plan.findings.filter((f) => f.severity === 'error' && f.accepted === undefined);
    return errors.length === 0
      ? [{ ok: true, kind: 'scheme', text: 'The scheme has no errors.' }]
      : errors.map((f): ReadyCheck => ({ ok: false, kind: 'scheme', text: sentence(f.message) }));
  };

  /** What must hold before Apply. A setup with no Azeron talks to no unit: nothing about them. */
  const readiness = (open: boolean | null, plan: Plan): ReadyCheck[] => {
    const used = handsOf(plan);
    if (used.length === 0) return findingChecks(plan);
    return [
      open === null
        ? { ok: false, kind: 'azeron-app', text: APP_UNKNOWN_SENTENCE }
        : open
          ? { ok: false, kind: 'azeron-app', text: APP_OPEN_SENTENCE }
          : { ok: true, kind: 'azeron-app', text: 'The Azeron app is closed.' },
      // With the Azeron app open the units are not talked to, so the service lists none: that is
      // not "unplugged", and is not said.
      ...(open === false ? unitChecks(used) : []),
      ...findingChecks(plan),
    ];
  };

  /** What the game's file target says of the plan: null when the plan doesn't write a file. */
  const fileLook = async (plan: Plan, game: Game) =>
    plan.gameFile !== undefined && deps.gameFile !== undefined
      ? await deps.gameFile.look(game, plan)
      : null;

  /**
   * The game's bindings that change, the plan's against what the game holds now, and how they
   * reach it, with the file's own checks (the game closed, the file able to take them).
   */
  /** The game's bindings the plan changes, against what the game holds now. */
  const changingRows = async (plan: Plan, game: Game): Promise<ApplyGameRow[]> => {
    let holds: Pick<Plan, 'gameBindings'> | null = null;
    try {
      holds = (await deps.gameHolds?.(game.id)) ?? null;
    } catch (error) {
      trace(`couldn't read what ${game.id} holds: ${messageOf(error)}`);
    }
    return changedRows(plan, game, holds);
  };

  const gameHalf = async (
    plan: Plan,
    game: Game,
  ): Promise<{ game: ApplyGame; checks: ReadyCheck[] }> => {
    const rows = await changingRows(plan, game);
    const look = await fileLook(plan, game);
    if (look === null || look.via === 'sheet') {
      const note = look?.note ?? null;
      return { game: { via: 'sheet', rows, ...(note === null ? {} : { note }) }, checks: [] };
    }
    // An action the file doesn't have is set by hand: its rows are listed apart.
    const byHand = rows.filter((r) => look.byHand.includes(r.action));
    const inFile = rows.filter((r) => !look.byHand.includes(r.action));
    return {
      game: {
        via: 'file',
        rows: look.same ? [] : inFile,
        // A file the target makes (the game has none of its own) says so, in one sentence.
        file: { name: look.name, same: look.same, ...(look.note === null ? {} : { made: true }) },
        ...(look.note === null ? {} : { note: look.note }),
        ...(byHand.length === 0 ? {} : { byHand }),
      },
      checks: look.checks,
    };
  };

  /** The file's checks go after the Azeron app's, as the drawer lists them: first what to close. */
  const withFileChecks = (checks: ReadyCheck[], file: readonly ReadyCheck[]): ReadyCheck[] => {
    const at = checks.findIndex((c) => c.kind === 'azeron-app') + 1;
    return [...checks.slice(0, at), ...file, ...checks.slice(at)];
  };

  const preview = async (schemeId: string): Promise<ApplyPreview> => {
    const base = {
      schemeId,
      schemeName: '',
      gameId: '',
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
    const half = await gameHalf(resolved.plan, resolved.game);
    const names = {
      schemeName: resolved.scheme.name,
      gameId: resolved.game.id,
      gameName: resolved.game.name,
      fingerprint: planFingerprint(resolved.plan),
      game: half.game,
      left: emptyUnit('left', null, used.includes('left')),
      right: emptyUnit('right', null, used.includes('right')),
    };
    if (running) {
      return {
        ...base,
        ...names,
        busy: true,
        ready: false,
        checks: [{ ok: false, kind: 'busy', text: BUSY_SENTENCE }],
      };
    }
    // A setup with no Azeron has nothing to ask of the units or of the Azeron app.
    if (used.length === 0) {
      const checks = withFileChecks(findingChecks(resolved.plan), half.checks);
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
    const checks = withFileChecks(readiness(open, resolved.plan), half.checks);
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
    const { game } = resolved;
    const units = previewUnits(resolved.plan, held, {
      name: resolved.scheme.name,
      layoutOf: await identityOf(schemeId, held),
      actionName: (mode, action) =>
        game.actions.find((a) => a.mode === mode && a.id === action)?.name ?? action,
    });
    // A unit that isn't there already has its own check above; one not used has no problem.
    for (const unit of [units.left, units.right]) {
      if (unit.connected && unit.problem !== null) {
        checks.push({ ok: false, kind: 'unit', text: unit.problem });
      }
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
   * The game's half when its file is gone by the time it is written: every binding that changes is
   * set by hand, with the sentence saying why, as when the file was missing from the start.
   */
  const bySheet = async (plan: Plan, game: Game, note: string): Promise<ApplyGame> => ({
    via: 'sheet',
    rows: await changingRows(plan, game),
    note,
  });

  /**
   * Writes the game's file. Once it holds the bindings (written, or already), the game's baseline
   * moves to them, but for the actions the file doesn't have (`byHand`): those are still to set by
   * hand. A baseline that can't be moved is the problem said.
   */
  const writeFile = async (
    target: GameFileTarget,
    game: Game,
    plan: Plan,
    byHand: readonly string[],
  ): Promise<{ outcome: FileOutcome; problem: string | null }> => {
    const outcome = await target.write(game, plan);
    if (!outcome.ok) return { outcome, problem: null };
    try {
      await deps.settleBaseline?.(
        game.id,
        plan.gameBindings.filter((r) => !byHand.includes(r.action)),
      );
    } catch (error) {
      trace(`couldn't move what ${game.id} holds: ${messageOf(error)}`);
      return {
        outcome,
        problem: `${outcome.message} helmArray couldn't note it (${messageOf(error)}), so the Library may still list them to set by hand.`,
      };
    }
    return { outcome, problem: null };
  };

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
      // What is left to set by hand in the game is worked out afresh from what is applied and
      // what the game holds (sheets.json), never kept from here; the game's file written moves
      // what it holds.
      const look = await fileLook(plan, game);
      // The target, when it writes this game's file.
      const target = look?.via === 'file' ? deps.gameFile : undefined;
      // The game closed and its file able to take the bindings, before anything is written.
      const fileBlocked = look?.via === 'file' ? look.checks.find((c) => !c.ok) : undefined;

      // A setup with no Azeron writes no unit: it is remembered, and the game's half is the
      // game's file, or the player's, from the drawer.
      if (handsOf(plan).length === 0) {
        const blocked = findingChecks(plan).find((c) => !c.ok) ?? fileBlocked;
        if (blocked) return refused(blocked.text);
        if (target !== undefined) {
          const file = await writeFile(target, game, plan, look?.byHand ?? []);
          if (file.outcome.missing === true) {
            const sheet = await bySheet(plan, game, file.outcome.message);
            const problem = await remember(schemeId, game.id, plan, fingerprint);
            return {
              ok: problem === null,
              message: problem ?? NO_UNIT_SENTENCE,
              units: [],
              game: sheet,
            };
          }
          const gameFile = { ok: file.outcome.ok, message: file.outcome.message };
          if (!file.outcome.ok)
            return { ok: false, message: file.outcome.message, units: [], gameFile };
          const problem = (await remember(schemeId, game.id, plan, fingerprint)) ?? file.problem;
          return {
            ok: problem === null,
            message: problem ?? file.outcome.message,
            units: [],
            gameFile,
          };
        }
        const problem = await remember(schemeId, game.id, plan, fingerprint);
        return { ok: problem === null, message: problem ?? NO_UNIT_SENTENCE, units: [] };
      }

      const open = await azeronOpen();
      const blocking = readiness(open, plan).find((c) => !c.ok) ?? fileBlocked;
      if (blocking) return refused(blocking.text);

      const snapshot = deps.devices.snapshot();
      const ids = snapshot.units.flatMap((u) => (u.identity ? [u.identity.deviceId] : []));
      const hands = handsFor(ids, deps.hands);
      // Whose each layout is, as the units are now, before anything is written.
      const layoutOf = await identityOf(schemeId, heldUnits(snapshot, hands));
      const unitDeps: UnitsDeps = {
        removed: (hand, gone) =>
          removedWords(
            gone.flatMap((slot) => {
              const known = layoutOf(hand, slot);
              return known.ownCopy ? [] : [{ name: slot.name, game: known.game }];
            }),
          ),
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
        // Each unit that now holds the plan holds this scheme, whatever became of the other.
        try {
          await deps.recordUnits?.(plan, result.units, {
            schemeId,
            gameId: game.id,
            schemeName: scheme.name,
            gameName: game.name,
            devices: { ...scheme.devices },
            output: scheme.output,
            at: (deps.now ?? Date.now)(),
          });
        } catch (error) {
          trace(`couldn't note what the units hold: ${messageOf(error)}`);
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
      // Then the game's file, once every unit holds the layout: the first failure stops Apply.
      let gameFile: ApplyResult['gameFile'];
      let sheet: ApplyGame | undefined;
      let fileProblem: string | null = null;
      if (outcome.result.ok && target !== undefined) {
        const file = await writeFile(target, game, plan, look?.byHand ?? []);
        if (file.outcome.missing === true) {
          sheet = await bySheet(plan, game, file.outcome.message);
        } else {
          gameFile = { ok: file.outcome.ok, message: file.outcome.message };
          fileProblem = file.outcome.ok ? file.problem : file.outcome.message;
        }
      }
      const withFile = {
        ...(gameFile === undefined ? {} : { gameFile }),
        ...(sheet === undefined ? {} : { game: sheet }),
      };
      const problem = outcome.problem ?? fileProblem;
      if (problem !== null) return { ok: false, message: problem, units, ...withFile };
      return { ok: outcome.result.ok, message: outcome.result.message, units, ...withFile };
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
          gameId: '',
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

/**
 * The game's bindings the plan changes, in the drawer's words: against what the game holds as far
 * as helmArray knows (its baseline; null: what it ships). Also what the Library's reminder shows.
 */
export function changedRows(
  plan: Pick<Plan, 'gameBindings'>,
  game: Game,
  holds: Pick<Plan, 'gameBindings'> | null,
): ApplyGameRow[] {
  return pendingRows(plan.gameBindings, holds === null ? null : holds.gameBindings).map((row) => ({
    ...row,
    modeName: game.modes.find((m) => m.id === row.mode)?.name ?? row.mode,
    actionName: game.actions.find((a) => a.id === row.action)?.name ?? row.action,
  }));
}
