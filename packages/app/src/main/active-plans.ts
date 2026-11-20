// What the sync pill compares: for the active scheme, the plan last applied and the plan the
// scheme says now (edits not yet saved included). Pure: the store is handed in.

import type { Plan } from '@helmarray/core';
import type { PlanSource } from './scheme-plan';
import { planFor } from './scheme-plan';

export interface ActivePlans {
  /** There is an active scheme. */
  active: boolean;
  /** The plan last applied for it, or null when none was. */
  applied: Plan | null;
  /** What it resolves to now, or null when it can't be resolved (or there is no active scheme). */
  current: Plan | null;
}

export const NO_PLANS: ActivePlans = { active: false, applied: null, current: null };

export interface ActivePlansDeps extends PlanSource {
  active(): { gameId: string | null; schemeId: string | null };
  getApplied(schemeId: string): Promise<Plan | null>;
}

export function createActivePlans(deps: ActivePlansDeps): () => Promise<ActivePlans> {
  return async () => {
    const { schemeId } = deps.active();
    if (schemeId === null) return NO_PLANS;
    const [applied, resolved] = await Promise.all([
      deps.getApplied(schemeId),
      planFor(schemeId, deps),
    ]);
    return { active: true, applied, current: resolved.ok ? resolved.plan : null };
  };
}
