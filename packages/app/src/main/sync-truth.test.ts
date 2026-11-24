// The sync pill's truth, end to end below the windows: the units as read, against the plan last
// applied, and the scheme as it is now against that plan.

import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game, Hand, Plan, Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  gameKeysPreset,
  helldivers2,
  resolve,
  unitOf,
  xboxControllerPreset,
} from '@helmarray/core';
import {
  FakeUnit,
  UnitSession,
  encodeRecord,
  storedFromWritten,
  unitRecords,
} from '@helmarray/azeron';
import type { AppState } from '../shared/api';
import { createActivePlans } from './active-plans';
import type { ActivePlans } from './active-plans';
import { composeAppState } from './app-state';
import { createCoordinator } from './coordinator';
import type { DevicesSnapshot, UnitSnapshot } from './devices';
import { handsFor } from './hands';
import { DataStore } from './store';

const game: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    { id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true },
    { id: 'fire', name: 'Fire', mode: 'ship', role: 'combat', required: true },
    { id: 'map', name: 'Map', mode: 'ship', role: 'menu', required: false },
  ],
  file: { format: 'elite-binds' },
};
const base: Scheme = {
  ...gameKeysPreset(game),
  writeGameFile: false,
  accepted: [
    { rule: 'stick-no-directions', control: 'L.stick', reason: 'No stick' },
    { rule: 'stick-no-directions', control: 'R.stick', reason: 'No stick' },
  ],
  map: {
    ship: {
      'L.index_1': { tap: 'boost' },
      'L.middle_1': { tap: 'fire' },
      'R.index_1': { tap: 'fire', long: 'map' },
    },
  },
};
const edited: Scheme = {
  ...base,
  map: { ship: { ...base.map['ship'], 'L.index_1': { tap: 'map' } } },
};
const planOf = (scheme: Scheme): Plan => resolve(scheme, game, BUILT_IN_DEVICES);
const APPLIED = planOf(base);

const LEFT = 49229;
const RIGHT = 29993;
const DEVICE = { left: CYBORG2_LEFT, right: CYBORG2_RIGHT } as const;
const ids = { left: LEFT, right: RIGHT };

/** A unit snapshot holding `plan`'s layout for `hand` in slot 1, as a real read of it would say. */
async function holding(hand: Hand, plan: Plan, running = 1): Promise<UnitSnapshot> {
  const records = unitRecords(unitOf(plan, hand), DEVICE[hand]).map((r) =>
    storedFromWritten(encodeRecord(1, r)),
  );
  const session = new UnitSession(
    new FakeUnit({ deviceId: ids[hand], slots: { 1: { name: 'Main', records } }, running }),
  );
  const identity = await session.identify();
  return {
    path: hand,
    state: 'ready',
    identity,
    slots: await session.readSlots(),
    readAt: Date.now(),
  };
}

const KNOWN = { get: (id: number) => (id === LEFT ? ('left' as const) : ('right' as const)) };

function pill(devices: UnitSnapshot[], plans: ActivePlans | undefined): AppState['sync'] {
  const snapshot: DevicesSnapshot = { units: devices };
  const unitIds = devices.flatMap((u) => (u.identity ? [u.identity.deviceId] : []));
  return composeAppState({
    devices: snapshot,
    hands: handsFor(unitIds, KNOWN),
    writeBlock: null,
    plans,
  }).sync;
}

const active = (applied: Plan | null, current: Plan | null): ActivePlans => ({
  active: true,
  applied,
  current,
});

describe('the sync pill is the units against what was applied', () => {
  it('says In sync only when both units hold the applied plan and the scheme says the same', async () => {
    const both = [await holding('left', APPLIED), await holding('right', APPLIED)];
    expect(pill(both, active(APPLIED, planOf(base)))).toEqual({ label: 'In sync', tone: 'ok' });
  });

  it('says Changes not applied when the scheme was edited after it was applied', async () => {
    const both = [await holding('left', APPLIED), await holding('right', APPLIED)];
    expect(pill(both, active(APPLIED, planOf(edited)))).toEqual({
      label: '1 change not applied',
      tone: 'warning',
      changes: 1,
    });
  });

  it('counts a position cleared and a position given as one change each', async () => {
    const both = [await holding('left', APPLIED), await holding('right', APPLIED)];
    const more: Scheme = {
      ...edited,
      map: { ship: { ...edited.map['ship'], 'R.index_1': { tap: 'boost' } } },
    };
    expect(pill(both, active(APPLIED, planOf(more))).label).toBe('2 changes not applied');
  });

  it('names the unit that differs, and how much of it, when the running slot is not the plan', async () => {
    const both = [await holding('left', APPLIED), await holding('right', planOf(edited))];
    // The right unit's R.index_1 is the same in both plans, so lay a different layout on it.
    const other: Scheme = { ...base, map: { ship: { 'R.index_1': { tap: 'boost' } } } };
    const wrong = [await holding('left', APPLIED), await holding('right', planOf(other))];
    expect(pill(both, active(APPLIED, planOf(base))).label).toBe('In sync');
    const sync = pill(wrong, active(APPLIED, planOf(base)));
    expect(sync.label).toBe('Right unit differs');
    expect(sync.tone).toBe('error');
    expect(sync.detail).toMatch(/^Right unit: \d+ inputs? not as applied\.$/);
  });

  it('names the left unit when it is the left that differs', async () => {
    const other: Scheme = { ...base, map: { ship: { 'L.index_1': { tap: 'map' } } } };
    const wrong = [await holding('left', planOf(other)), await holding('right', APPLIED)];
    expect(pill(wrong, active(APPLIED, planOf(base))).label).toBe('Left unit differs');
  });

  it('says a unit differs when the profile button moved it to a slot that is not the layout', async () => {
    const moved = await holding('left', APPLIED, 5);
    const sync = pill([moved, await holding('right', APPLIED)], active(APPLIED, planOf(base)));
    expect(sync.label).toBe('Left unit differs');
  });

  it('lets a unit that differs outrank edits not applied', async () => {
    const other: Scheme = { ...base, map: { ship: { 'R.index_1': { tap: 'boost' } } } };
    const wrong = [await holding('left', APPLIED), await holding('right', planOf(other))];
    expect(pill(wrong, active(APPLIED, planOf(edited))).label).toBe('Right unit differs');
  });

  it('never says In sync about a unit that is not connected, or not read yet', async () => {
    const left = await holding('left', APPLIED);
    expect(pill([left], active(APPLIED, planOf(base))).label).toBe('Right unit not connected');
    const unread: UnitSnapshot = {
      ...(await holding('right', APPLIED)),
      state: 'connecting',
    };
    delete unread.slots;
    expect(pill([left, unread], active(APPLIED, planOf(base))).label).toBe('Not checked yet');
  });

  it('says nothing was applied when a scheme is active that never was', async () => {
    const both = [await holding('left', APPLIED), await holding('right', APPLIED)];
    const none = { ...base, map: { ship: {} } };
    expect(pill(both, active(null, planOf(none))).label).toBe('Nothing applied yet');
    // With positions set but never applied, they are the changes.
    expect(pill(both, active(null, planOf(base))).label).toBe('3 changes not applied');
  });

  it('counts a scheme that cannot be worked out as a change, never as in sync', async () => {
    const both = [await holding('left', APPLIED), await holding('right', APPLIED)];
    expect(pill(both, active(APPLIED, null)).label).toBe('1 change not applied');
  });

  it('has nothing to compare with no active scheme, and says it has not checked', async () => {
    const both = [await holding('left', APPLIED), await holding('right', APPLIED)];
    expect(pill(both, undefined).label).toBe('Not checked yet');
    expect(pill(both, { active: false, applied: null, current: null }).label).toBe(
      'Not checked yet',
    );
  });
});

describe('the sync pill for a setup of the left Azeron and the mouse', () => {
  const left: Scheme = {
    ...base,
    devices: { azerons: 'left', keyboard: false, mouse: true, controller: false },
    map: { ship: { 'L.index_1': { tap: 'boost' }, 'L.middle_1': { tap: 'fire' } } },
    accepted: [{ rule: 'stick-no-directions', control: 'L.stick', reason: 'No stick' }],
  };
  const LEFT_PLAN = planOf(left);
  // The right unit holds a layout of its own, which a setup of both units would call a difference.
  const other: Scheme = { ...base, map: { ship: { 'R.index_1': { tap: 'boost' } } } };

  it('says In sync with the left unit holding it, whatever the right unit holds', async () => {
    const units = [await holding('left', LEFT_PLAN), await holding('right', planOf(other))];
    expect(pill(units, active(LEFT_PLAN, LEFT_PLAN))).toEqual({ label: 'In sync', tone: 'ok' });
  });

  it('says In sync with the right unit unplugged', async () => {
    expect(pill([await holding('left', LEFT_PLAN)], active(LEFT_PLAN, LEFT_PLAN))).toEqual({
      label: 'In sync',
      tone: 'ok',
    });
  });

  it('still says the left unit is not connected when it is the one unplugged', async () => {
    expect(pill([await holding('right', APPLIED)], active(LEFT_PLAN, LEFT_PLAN)).label).toBe(
      'Left unit not connected',
    );
  });

  it('says In sync for a setup with no Azeron, with no unit plugged in', () => {
    const none = planOf({
      ...base,
      devices: { azerons: 'none', keyboard: true, mouse: true, controller: false },
      map: { ship: { 'key.Tab': { tap: 'boost' }, 'mouse.left': { tap: 'fire' } } },
    });
    expect(pill([], active(none, none))).toEqual({ label: 'In sync', tone: 'ok' });
  });
});

describe('the sync pill counts the game’s bindings', () => {
  // Helldivers 2 from the Xbox controller preset, applied; then the mouse joins the setup with
  // nothing put on it. The units' layout doesn't change, but the game's keyboard bindings do: the
  // mouse's buttons are the setup's now, empty, so Fire and Aim come off them.
  const preset = xboxControllerPreset(helldivers2);
  const withMouse: Scheme = { ...preset, devices: { ...preset.devices, mouse: true } };
  const hd = (scheme: Scheme): Plan => resolve(scheme, helldivers2, BUILT_IN_DEVICES);

  it('says the game rows are not applied, though both units hold the layout', async () => {
    const applied = hd(preset);
    const units = [await holding('left', applied), await holding('right', applied)];
    expect([
      unitOf(hd(withMouse), 'left').pins,
      pill(units, active(applied, hd(withMouse))),
    ]).toEqual([
      unitOf(applied, 'left').pins,
      { label: '2 changes not applied', tone: 'warning', changes: 2 },
    ]);
  });

  it('is In sync again once those rows are what was applied', async () => {
    const applied = hd(withMouse);
    const units = [await holding('left', applied), await holding('right', applied)];
    expect(pill(units, active(applied, hd(withMouse)))).toEqual({ label: 'In sync', tone: 'ok' });
  });
});

describe('the active plans', () => {
  it('reads the applied plan and resolves the scheme as it is now', async () => {
    const read = createActivePlans({
      active: () => ({ gameId: 'skiff', schemeId: base.id }),
      getApplied: () => Promise.resolve(APPLIED),
      getScheme: () => Promise.resolve(edited),
      getGame: () => Promise.resolve(game),
    });
    const plans = await read();
    expect(plans.active).toBe(true);
    expect(plans.applied).toBe(APPLIED);
    expect(plans.current).toEqual(planOf(edited));
  });

  it('has none without an active scheme, and no current plan when it will not resolve', async () => {
    const deps = {
      getApplied: () => Promise.resolve(null),
      getScheme: () => Promise.resolve(null),
      getGame: () => Promise.resolve(game),
    };
    expect(
      await createActivePlans({ ...deps, active: () => ({ gameId: null, schemeId: null }) })(),
    ).toEqual({
      active: false,
      applied: null,
      current: null,
    });
    expect(
      await createActivePlans({ ...deps, active: () => ({ gameId: 'skiff', schemeId: 'gone' }) })(),
    ).toEqual({ active: true, applied: null, current: null });
  });
});

describe('the coordinator works the pill out from the plans', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  async function rig() {
    const units: UnitSnapshot[] = [await holding('left', APPLIED), await holding('right', APPLIED)];
    const listeners = new Set<() => void>();
    const plans: { value: ActivePlans } = { value: active(APPLIED, planOf(base)) };
    const suspended = { value: false };
    const reads = { count: 0 };
    const states: AppState[] = [];
    const helm = createCoordinator({
      devices: {
        snapshot: () => ({ units: structuredClone(units) }),
        onChange: (l) => {
          listeners.add(l);
          return () => void listeners.delete(l);
        },
      },
      hands: KNOWN as never,
      gate: { azeronRunning: () => Promise.resolve(), shutdown: () => Promise.resolve() },
      readLog: () => Promise.resolve([]),
      active: () => ({ gameId: 'skiff', schemeId: base.id }),
      plans: () => {
        reads.count++;
        return Promise.resolve(plans.value);
      },
      suspended: () => suspended.value,
    });
    helm.onState((s) => states.push(s));
    helm.start();
    await vi.advanceTimersByTimeAsync(0);
    return { helm, units, plans, suspended, reads, states, listeners };
  }

  it('shows In sync from the units and the plans on start', async () => {
    const r = await rig();
    expect(r.helm.state().sync.label).toBe('In sync');
  });

  it('works the pill out again after an edit, and after an apply changes what a unit holds', async () => {
    const r = await rig();
    r.plans.value = active(APPLIED, planOf(edited));
    await r.helm.plansChanged();
    expect(r.helm.state().sync).toEqual({
      label: '1 change not applied',
      tone: 'warning',
      changes: 1,
    });

    // An apply: the units hold the edited layout and it is the applied plan now.
    const next = planOf(edited);
    r.units[0] = await holding('left', next);
    r.units[1] = await holding('right', next);
    r.plans.value = active(next, next);
    for (const l of r.listeners) l();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.helm.state().sync.label).toBe('In sync');
  });

  it('works out nothing while something is writing to the units, and once it is done', async () => {
    const r = await rig();
    r.suspended.value = true;
    r.plans.value = active(APPLIED, planOf(edited));
    for (const l of r.listeners) l();
    await r.helm.plansChanged();
    expect(r.helm.state().sync.label).toBe('In sync'); // not a half-written state
    r.suspended.value = false;
    await r.helm.plansChanged();
    expect(r.helm.state().sync.label).toBe('1 change not applied');
  });

  it('works a run of edits out once, not once each', async () => {
    const r = await rig();
    const before = r.reads.count;
    r.plans.value = active(APPLIED, planOf(edited));
    await Promise.all([r.helm.plansChanged(), r.helm.plansChanged(), r.helm.plansChanged()]);
    expect(r.reads.count - before).toBeLessThanOrEqual(2);
    expect(r.helm.state().sync.label).toBe('1 change not applied');
  });
});

describe('what is saved as applied is what is compared (a real store)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'helm-sync-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is In sync right after an apply: the plan read back from disk is the plan that was saved', async () => {
    const data = await DataStore.open({ root, builtInGames: [game] });
    data.saveScheme(base);
    await data.flush();
    await data.saveApplied(base.id, APPLIED);
    await data.setActive(game.id, base.id);

    const read = createActivePlans({
      active: () => data.active(),
      getApplied: (id) => data.getApplied(id),
      getScheme: (id) => data.getScheme(id),
      getGame: (id) => Promise.resolve(id === game.id ? game : undefined),
    });
    const plans = await read();
    const both = [await holding('left', APPLIED), await holding('right', APPLIED)];
    expect(plans.applied).not.toBeNull();
    expect(pill(both, plans)).toEqual({ label: 'In sync', tone: 'ok' });

    // An edit, not yet written to disk, is seen at once.
    data.saveScheme(edited);
    expect(pill(both, await read()).label).toBe('1 change not applied');
    await data.flush();
  });

  it('knows which scheme was applied last, by when each applied plan was written', async () => {
    const data = await DataStore.open({ root, builtInGames: [game] });
    const other: Scheme = { ...edited, id: 'skiff-other', name: 'Other' };
    data.saveScheme(base);
    data.saveScheme(other);
    await data.flush();
    expect(await data.lastApplied(game.id)).toBeNull();

    await data.saveApplied(base.id, APPLIED);
    await data.saveApplied(other.id, planOf(other));
    const at = (name: string, seconds: number) =>
      utimes(join(root, 'applied', `${name}.json`), seconds, seconds);
    await at(base.id, 2000);
    await at(other.id, 1000);
    expect(await data.lastApplied(game.id)).toEqual({ schemeId: base.id, at: 2_000_000 });
    await at(other.id, 3000);
    expect(await data.lastApplied(game.id)).toEqual({ schemeId: other.id, at: 3_000_000 });
    expect(await data.lastApplied('another-game')).toBeNull();
  });
});

describe('the pill never says In sync from an old reading', () => {
  const NOW = 1_000_000;
  const aged = async (ms: number) => ({
    ...(await holding('left', APPLIED)),
    readAt: NOW - ms,
  });
  const at = async (leftAge: number, rightAge: number, now?: number) => {
    const right = { ...(await holding('right', APPLIED)), readAt: NOW - rightAge };
    const unitIds = [LEFT, RIGHT];
    return composeAppState({
      devices: { units: [await aged(leftAge), right] },
      hands: handsFor(unitIds, KNOWN),
      writeBlock: null,
      plans: active(APPLIED, planOf(base)),
      ...(now !== undefined && { now }),
    }).sync;
  };

  it('is In sync from a reading at most 10 seconds old', async () => {
    expect((await at(0, 10_000, NOW)).label).toBe('In sync');
  });

  it('says it has not checked once a reading is older, until the next one lands', async () => {
    expect((await at(10_001, 0, NOW)).label).toBe('Not checked yet');
    expect((await at(0, 60_000, NOW)).label).toBe('Not checked yet');
  });

  it('counts a unit with no date as too old, once the age matters', async () => {
    const undated = await holding('left', APPLIED);
    delete undated.readAt;
    const sync = composeAppState({
      devices: { units: [undated, await holding('right', APPLIED)] },
      hands: handsFor([LEFT, RIGHT], KNOWN),
      writeBlock: null,
      plans: active(APPLIED, planOf(base)),
      now: Date.now(),
    }).sync;
    expect(sync.label).toBe('Not checked yet');
  });

  it('has no age limit when it is not told the time', async () => {
    expect((await at(10_000_000, 10_000_000)).label).toBe('In sync');
  });

  it('is re-worked by the coordinator on its own as a reading ages, with no event at all', async () => {
    vi.useFakeTimers();
    try {
      const units = [await holding('left', APPLIED), await holding('right', APPLIED)];
      const helm = createCoordinator({
        devices: {
          snapshot: () => ({ units: structuredClone(units) }),
          onChange: () => () => undefined,
        },
        hands: KNOWN as never,
        gate: { azeronRunning: () => Promise.resolve(), shutdown: () => Promise.resolve() },
        readLog: () => Promise.resolve([]),
        active: () => ({ gameId: 'skiff', schemeId: base.id }),
        plans: () => Promise.resolve(active(APPLIED, planOf(base))),
      });
      helm.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(helm.state().sync.label).toBe('In sync');
      await vi.advanceTimersByTimeAsync(12_000);
      expect(helm.state().sync.label).toBe('Not checked yet');
      // The next reading lands: in sync again.
      for (const unit of units) unit.readAt = Date.now();
      await vi.advanceTimersByTimeAsync(4000);
      expect(helm.state().sync.label).toBe('In sync');
      helm.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
