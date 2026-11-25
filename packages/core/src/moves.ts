// An action of yours that took the id (and the mode) of the game file's own action, followed into
// everything that names it (docs/plans/02-architecture.md, *Harvesting a game's defaults*): a
// setup's placements, its key labels and the findings it keeps, the plans applied, and what the
// game holds. Pure: the store reads and writes the files, this decides what each one becomes.
//
// A placement under the action's old mode moves to its new mode, on the same control and press;
// one under any other mode keeps its mode and takes the new id. A press the move would land on that
// already holds another action keeps it, and the moved one isn't placed (the first move wins
// between two). A key label goes with the action when nothing is left on its control in the old
// mode and the new one has no label there. The ledger is per control and press and names no action,
// so it never changes. Each function gives back the very object it was handed when nothing in it
// names a moved action, so a second pass changes nothing and nothing needs writing.

import type { ActionMove } from './harvest';
import type { ActionId, ControlId, ModeId, Press, Scheme } from './model';
import type { Plan } from './plan';
import type { Baselines } from './sheets';

const moveOf = (moves: readonly ActionMove[], action: ActionId | undefined) =>
  moves.find((m) => m.action === action);

/** A row naming an action, in a mode or none: its new id, and its new mode when it was the old one. */
function moveRow<T extends { action?: ActionId; mode?: ModeId }>(
  row: T,
  moves: readonly ActionMove[],
): T {
  const move = moveOf(moves, row.action);
  if (move === undefined) return row;
  return {
    ...row,
    action: move.to,
    ...(row.mode === move.mode ? { mode: move.toMode } : {}),
  };
}

/** Each row moved; the very list when none was. */
function moveRows<T extends { action?: ActionId; mode?: ModeId }>(
  rows: T[],
  moves: readonly ActionMove[],
): T[] {
  const next = rows.map((row) => moveRow(row, moves));
  return next.some((row, i) => row !== rows[i]) ? next : rows;
}

/** A record of records as nested maps, and back: every key an own one, `__proto__` included. */
type Nested<T> = Map<string, Map<string, T>>;
const nested = <T>(record: Readonly<Record<string, Readonly<Record<string, T>>>>): Nested<T> =>
  new Map(Object.entries(record).map(([k, inner]) => [k, new Map(Object.entries(inner))]));
const unnested = <T>(maps: Nested<T>): Record<string, Record<string, T>> =>
  Object.fromEntries(
    [...maps]
      .filter(([, inner]) => inner.size > 0)
      .map(([k, inner]) => [k, Object.fromEntries(inner)]),
  );

/** A setup with every placement, key label and kept finding of a moved action following it. */
export function moveInScheme(scheme: Scheme, moves: readonly ActionMove[]): Scheme {
  const map: Nested<Map<Press, ActionId>> = new Map();
  const at = (mode: ModeId, control: ControlId) => map.get(mode)?.get(control);
  const set = (mode: ModeId, control: ControlId, press: Press, action: ActionId) => {
    const controls = map.get(mode) ?? new Map<ControlId, Map<Press, ActionId>>();
    map.set(mode, controls);
    const presses = controls.get(control) ?? new Map<Press, ActionId>();
    controls.set(control, presses);
    presses.set(press, action);
  };
  const leaving: {
    mode: ModeId;
    to: ModeId;
    control: ControlId;
    press: Press;
    action: ActionId;
  }[] = [];
  let changed = false;
  for (const [mode, controls] of Object.entries(scheme.map)) {
    for (const [control, presses] of Object.entries(controls)) {
      for (const [press, action] of Object.entries(presses) as [Press, ActionId | undefined][]) {
        if (action === undefined) continue;
        const move = moveOf(moves, action);
        if (move === undefined) {
          set(mode, control, press, action);
          continue;
        }
        changed = true;
        // Under its own mode it goes to the new one (the same press, which may be taken there).
        if (mode === move.mode)
          leaving.push({ mode, to: move.toMode, control, press, action: move.to });
        else set(mode, control, press, move.to);
      }
    }
  }
  if (!changed && !scheme.accepted.some((a) => moveOf(moves, a.action) !== undefined))
    return scheme;
  // What moves to another mode, on a press nothing holds there.
  const landed = new Set<(typeof leaving)[number]>();
  for (const l of leaving) {
    if (at(l.to, l.control)?.has(l.press) === true) continue;
    set(l.to, l.control, l.press, l.action);
    landed.add(l);
  }
  // A key label goes with what moved off its control, when nothing is left there.
  let keyLabels = scheme.keyLabels;
  if (keyLabels !== undefined) {
    const labels = nested(keyLabels);
    for (const l of leaving) {
      const label = labels.get(l.mode)?.get(l.control);
      if (label === undefined || at(l.mode, l.control) !== undefined) continue;
      labels.get(l.mode)?.delete(l.control);
      if (!landed.has(l) || labels.get(l.to)?.has(l.control) === true) continue;
      const there = labels.get(l.to) ?? new Map<ControlId, string>();
      labels.set(l.to, there);
      there.set(l.control, label);
    }
    keyLabels = unnested(labels);
  }
  const placements: Scheme['map'] = Object.fromEntries(
    [...map].map(([mode, controls]) => [
      mode,
      Object.fromEntries(
        [...controls].map(([control, presses]) => [control, Object.fromEntries(presses)]),
      ),
    ]),
  );
  return {
    ...scheme,
    map: placements,
    accepted: moveRows(scheme.accepted, moves),
    ...(keyLabels === undefined ? {} : { keyLabels }),
  };
}

/** An applied plan with every binding, game binding, sheet row and finding of a moved action following it. */
export function moveInPlan(plan: Plan, moves: readonly ActionMove[]): Plan {
  const bindings = moveRows(plan.bindings, moves);
  const gameBindings = moveRows(plan.gameBindings, moves);
  const bindSheet = moveRows(plan.bindSheet, moves);
  const findings = moveRows(plan.findings, moves);
  if (
    bindings === plan.bindings &&
    gameBindings === plan.gameBindings &&
    bindSheet === plan.bindSheet &&
    findings === plan.findings
  )
    return plan;
  return { ...plan, bindings, gameBindings, bindSheet, findings };
}

/** Every game's baseline, with what this game holds of a moved action following it. */
export function moveInBaselines(
  baselines: Baselines,
  gameId: string,
  moves: readonly ActionMove[],
): Baselines {
  const games = baselines.games.map((g) => {
    if (g.gameId !== gameId) return g;
    const held = moveRows(g.held, moves);
    return held === g.held ? g : { ...g, held };
  });
  return games.some((g, i) => g !== baselines.games[i]) ? { ...baselines, games } : baselines;
}
