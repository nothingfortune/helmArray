// THE ONE PLACE that says whether an action is placed: on a control of the setup, or on a stick
// direction. The missing-required check, the editor's lists ("Not on a button"), the stick's chips
// and the controller's stick rows all ask here, so a stick that does Move forward is never also
// listed as not doing it.

import type { ActionId, ControlId, Game, ModeId, Scheme, StickDirection } from './model';
import { PRESSES } from './model';
import type { BindingSet, Plan } from './plan';
import { hasAction } from './game-data';
import { own } from './own';
import { controlSet, inSetup, setsUsed, setupOf, stickDirections } from './setup';
import { signalId } from './signal';

/** An action a stick direction of the setup does, as the plan binds the game. */
export interface StickAction {
  /** `L.stick`, `R.stick`, `pad.left_stick` or `pad.right_stick`. */
  stick: ControlId;
  direction: StickDirection;
  mode: ModeId;
  action: ActionId;
  set: BindingSet;
}

/**
 * What each stick direction of the setup does: every game binding the plan resolves (its
 * `gameBindings`, the bindings the game is given) that is on what the direction sends. A stick in
 * key mode does what the game binds to its keys, an Xbox stick what the game binds to its
 * directions. In stick order, each in up, down, left, right order, then the game's mode and action
 * order. A stick moving the mouse does none.
 */
export function stickActions(scheme: Scheme, plan: Pick<Plan, 'gameBindings'>): StickAction[] {
  const out: StickAction[] = [];
  for (const { stick, direction, signal } of stickDirections(scheme)) {
    const id = signalId(signal);
    for (const row of plan.gameBindings) {
      if (row.signal === null || signalId(row.signal) !== id) continue;
      out.push({ stick, direction, mode: row.mode, action: row.action, set: row.set });
    }
  }
  return out;
}

/**
 * Where each action of a mode is placed in one of the game's binding sets: the first control of the
 * setup bound through that set that carries it (any press), else the stick that does it
 * (`stickActions`). An action on neither is not in the map.
 */
export function placedIn(
  scheme: Scheme,
  game: Game,
  plan: Pick<Plan, 'gameBindings'>,
  mode: ModeId,
  set: BindingSet,
): Map<ActionId, ControlId> {
  const setup = setupOf(scheme.devices);
  const on = new Map<ActionId, ControlId>();
  for (const [control, presses] of Object.entries(own(scheme.map, mode) ?? {})) {
    if (!inSetup(setup, control) || controlSet(scheme, control) !== set) continue;
    for (const press of PRESSES) {
      const action = presses[press];
      if (action !== undefined && hasAction(game, mode, action) && !on.has(action))
        on.set(action, control);
    }
  }
  for (const s of stickActions(scheme, plan)) {
    if (s.mode === mode && s.set === set && !on.has(s.action)) on.set(s.action, s.stick);
  }
  return on;
}

/** Whether an action is placed, in its mode, in any binding set the setup uses. */
export function isPlaced(
  scheme: Scheme,
  game: Game,
  plan: Pick<Plan, 'gameBindings'>,
  mode: ModeId,
  action: ActionId,
): boolean {
  return setsUsed(scheme).some((set) => placedIn(scheme, game, plan, mode, set).has(action));
}
