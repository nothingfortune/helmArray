import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game, Plan, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, gameKeysPreset, resolve } from '@helmarray/core';
import { Command, FakeUnit, parseHostReport } from '@helmarray/azeron';
import { planFingerprint } from './plan-fingerprint';
import { createApplyService } from './apply-service';
import type { ApplyServiceDeps } from './apply-service';
import type { ClosableTransport } from './devices';
import { Devices, POLL_MS } from './devices';
import { verifyUnits } from './apply-units';
import { pendingChanges } from './sync-state';
import { heldUnits } from './app-state';
import { handsFor } from './hands';

const game: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    { id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true },
    { id: 'fire', name: 'Fire', mode: 'ship', role: 'combat', required: true },
  ],
  file: { format: 'elite-binds' },
};
const scheme: Scheme = {
  ...gameKeysPreset(game),
  name: 'Main',
  writeGameFile: false,
  // The sticks send nothing here, which the checks call an error until it is accepted.
  accepted: [
    { rule: 'stick-no-directions', control: 'L.stick', reason: 'No stick' },
    { rule: 'stick-no-directions', control: 'R.stick', reason: 'No stick' },
  ],
  map: {
    ship: {
      'L.index_1': { tap: 'boost' },
      'L.middle_1': { tap: 'fire', long: 'boost' },
      'R.index_1': { tap: 'fire' },
    },
  },
};
const plan: Plan = resolve(scheme, game, BUILT_IN_DEVICES);
/** What a preview of the scheme would have given: the layout the person agreed to. */
const fp = (s: Scheme) => planFingerprint(resolve(s, game, BUILT_IN_DEVICES));

const LEFT = 49229;
const RIGHT = 29993;
const HANDS = { [LEFT]: 'left', [RIGHT]: 'right' } as const;

const WRITES: number[] = [
  Command.CHECK_PROFILE,
  Command.PROFILE_NAME,
  Command.OBM_COPY,
  Command.SWITCH_PROFILE,
  Command.DELETE_PROFILE,
];
const writesTo = (unit: FakeUnit) =>
  unit.received.map((r) => parseHostReport(r).command).filter((c) => WRITES.includes(c));

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

/** Two fake units behind a real devices service, and an apply service over them. */
async function rig(
  over: {
    scheme?: Scheme;
    right?: boolean;
    azeron?: () => Promise<boolean>;
    saveApplied?: ApplyServiceDeps['saveApplied'];
    setActive?: ApplyServiceDeps['setActive'];
    saveScheme?: ApplyServiceDeps['saveScheme'];
    trace?: (line: string) => void;
    settled?: () => void | Promise<void>;
    gameHolds?: ApplyServiceDeps['gameHolds'];
  } = {},
) {
  const units = new Map<string, FakeUnit>([
    [
      'left-path',
      new FakeUnit({
        deviceId: LEFT,
        slots: { 0: { name: 'Default' }, 2: { name: 'Old' } },
        running: 0,
      }),
    ],
  ]);
  if (over.right !== false) {
    units.set(
      'right-path',
      new FakeUnit({ deviceId: RIGHT, slots: { 0: { name: 'Default' } }, running: 0 }),
    );
  }
  const bench = { listed: 0, opened: [] as string[], closed: [] as string[] };
  // What the devices service asks: not open while the units connect, then what the test says.
  const look = { fn: (): Promise<boolean> => Promise.resolve(false) };
  const devices = new Devices({
    azeronAppRunning: () => look.fn(),
    findUnits: () => {
      bench.listed++;
      return Promise.resolve([...units.keys()].map((path) => ({ path })));
    },
    openUnit: (path): Promise<ClosableTransport> => {
      bench.opened.push(path);
      const unit = units.get(path);
      if (!unit) return Promise.reject(new Error('nothing there'));
      return Promise.resolve({
        send: (report) => unit.send(report),
        receive: () => unit.receive(),
        close: () => {
          bench.closed.push(path);
          return Promise.resolve();
        },
      });
    },
  });
  devices.start();
  await vi.advanceTimersByTimeAsync(0);

  look.fn = over.azeron ?? (() => Promise.resolve(false));
  const saveApplied = vi.fn(over.saveApplied ?? (() => Promise.resolve()));
  const setActive = vi.fn(over.setActive ?? (() => Promise.resolve()));
  const settled = vi.fn(over.settled);
  const recordUnits = vi.fn(() => Promise.resolve());
  // The store, as far as Apply sees it: the scheme as saved, which a save replaces.
  const store = { scheme: over.scheme ?? scheme };
  const saveScheme = vi.fn(
    over.saveScheme ??
      ((next: Scheme) => {
        store.scheme = next;
      }),
  );
  const service = createApplyService({
    plans: {
      getScheme: (id) => Promise.resolve(id === store.scheme.id ? store.scheme : null),
      getGame: (id) => Promise.resolve(id === game.id ? game : undefined),
    },
    devices,
    hands: { get: (id) => HANDS[id as keyof typeof HANDS] },
    azeronAppRunning: (): Promise<boolean> => look.fn(),
    saveApplied,
    setActive,
    saveScheme,
    settled,
    recordUnits,
    now: () => 1234,
    ...(over.trace ? { trace: over.trace } : {}),
    ...(over.gameHolds ? { gameHolds: over.gameHolds } : {}),
  });
  const reports = () => [...units.values()].reduce((n, u) => n + u.received.length, 0);
  return {
    service,
    devices,
    units,
    bench,
    saveApplied,
    setActive,
    saveScheme,
    store,
    settled,
    recordUnits,
    reports,
    left: units.get('left-path') as FakeUnit,
    right: units.get('right-path'),
  };
}

describe('Apply as the windows ask for it', () => {
  let r: Awaited<ReturnType<typeof rig>> | undefined;
  beforeEach(() => void vi.useFakeTimers());
  afterEach(async () => {
    await r?.devices.stop();
    r = undefined;
    vi.useRealTimers();
  });

  it('previews what is ready and what changes on each unit, writing nothing', async () => {
    r = await rig();
    const before = writesTo(r.left).length;
    const preview = await r.service.preview(scheme.id);
    expect(preview).toMatchObject({
      ready: true,
      schemeName: 'Main',
      gameName: 'Skiff',
      azeronOpen: false,
      busy: false,
      anyChange: true,
    });
    expect(preview.checks.every((c) => c.ok)).toBe(true);
    expect(preview.checks.map((c) => c.text)).toEqual([
      'The Azeron app is closed.',
      'The left Azeron is connected.',
      'The right Azeron is connected.',
      'The scheme has no errors.',
    ]);
    // The lowest free slot, named for the scheme; the others go, by name.
    expect(preview.left.write).toEqual({ slot: 1, name: 'Main', overwrites: null });
    expect(preview.left.deletes).toEqual([
      { slot: 0, name: 'Default' },
      { slot: 2, name: 'Old' },
    ]);
    expect(preview.right.write).toMatchObject({ slot: 1, name: 'Main' });
    expect(structuredClone(preview)).toEqual(preview);
    expect(writesTo(r.left).length).toBe(before);
  });

  it('applies: both units hold the layout, and only then is it remembered and made active', async () => {
    r = await rig();
    const result = await r.service.apply(scheme.id, fp(scheme));
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Both units now run the layout.');
    expect(result.units.map((u) => [u.hand, u.status])).toEqual([
      ['left', 'applied'],
      ['right', 'applied'],
    ]);
    expect(r.saveApplied).toHaveBeenCalledTimes(1);
    expect(r.saveApplied).toHaveBeenCalledWith(scheme.id, plan);
    expect(r.setActive).toHaveBeenCalledWith('skiff', scheme.id);
    expect(r.settled).toHaveBeenCalledTimes(1);

    // The service was read again before the hold was let go: what the pill compares is real.
    const snapshot = r.devices.snapshot();
    const held = heldUnits(snapshot, handsFor([LEFT, RIGHT], { get: (id) => HANDS[id as 49229] }));
    expect(held.left?.slots.map((s) => s.slot)).toEqual([1]);
    expect(held.left?.running).toBe(1);
    const verdicts = verifyUnits(plan, held);
    expect(verdicts.left).toEqual({ differences: [], unchecked: [] });
    expect(verdicts.right).toEqual({ differences: [], unchecked: [] });
    expect(result.units[0]?.slot).toBe(1);
  });

  it('is nothing to do on a second apply of the same scheme, and still remembers it', async () => {
    r = await rig();
    await r.service.apply(scheme.id, fp(scheme));
    const again = await r.service.apply(scheme.id, fp(scheme));
    expect(again).toMatchObject({ ok: true, message: 'Both units already held the layout.' });
    expect(r.saveApplied).toHaveBeenCalledTimes(2);
    expect((await r.service.preview(scheme.id)).anyChange).toBe(false);
  });

  describe('when the Azeron app is open', () => {
    it('says so, looks at no unit, and refuses to write', async () => {
      r = await rig({ azeron: () => Promise.resolve(true) });
      const reports = r.reports();
      const preview = await r.service.preview(scheme.id);
      expect(preview).toMatchObject({ ready: false, azeronOpen: true });
      expect(preview.checks).toEqual(
        expect.arrayContaining([
          {
            ok: false,
            kind: 'azeron-app',
            text: 'Close the Azeron app first: it talks to the units too.',
          },
        ]),
      );
      // Not "unplugged": the units were not looked at.
      expect(preview.checks.some((c) => /isn't connected/.test(c.text))).toBe(false);

      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result).toEqual({
        ok: false,
        message: 'Close the Azeron app first: it talks to the units too.',
        units: [],
      });
      expect(r.reports()).toBe(reports);
      expect(r.saveApplied).not.toHaveBeenCalled();
      expect(r.setActive).not.toHaveBeenCalled();
    });

    it('the preview leaves the units alone when the app opens just after its own look', async () => {
      let looks = 0;
      r = await rig({ azeron: () => Promise.resolve(++looks > 1) });
      await vi.advanceTimersByTimeAsync(10_000); // what the service read is old enough to be read again
      looks = 0;
      const reports = r.reports();
      const preview = await r.service.preview(scheme.id);
      expect(r.reports()).toBe(reports);
      expect(preview.ready).toBe(false);
      expect(preview.checks.some((c) => /hasn't been read yet/.test(c.text))).toBe(true);
    });

    it('never calls a unit let go for the Azeron app connected, when the app has just closed', async () => {
      r = await rig();
      // Paused (the app was open), and the preview's look finds it closed before the units are back.
      await r.devices.pause();
      const preview = await r.service.preview(scheme.id);
      expect([preview.ready, preview.checks.filter((c) => /Azeron/.test(c.text))]).toEqual([
        false,
        [
          { ok: true, kind: 'azeron-app', text: 'The Azeron app is closed.' },
          { ok: false, kind: 'unit', text: "The left Azeron hasn't been read yet." },
          { ok: false, kind: 'unit', text: "The right Azeron hasn't been read yet." },
        ],
      ]);
    });

    it('does not trust a look at the programs that failed', async () => {
      r = await rig({ azeron: () => Promise.reject(new Error('tasklist failed')) });
      const preview = await r.service.preview(scheme.id);
      expect(preview.ready).toBe(false);
      expect(preview.checks[0]?.text).toBe(
        "helmArray couldn't tell whether the Azeron app is open.",
      );
      expect((await r.service.apply(scheme.id, fp(scheme))).ok).toBe(false);
      expect(r.saveApplied).not.toHaveBeenCalled();
    });

    /**
     * One apply with a look that never says open, to find where things fall: how many looks the
     * whole apply made, and the number of the look that came first from the right unit's flow
     * (its own guard, then the gate's look before its first command).
     */
    async function dryRun() {
      const seen: { right: number; at: number }[] = [];
      let total = 0;
      const dry = await rig({
        azeron: () => {
          seen.push({ right: dry.right?.received.length ?? 0, at: ++total });
          return Promise.resolve(false);
        },
      });
      const before = dry.right?.received.length ?? 0;
      await dry.service.apply(scheme.id, fp(scheme));
      const first = seen.find((x) => x.right > before);
      await dry.devices.stop();
      return { total, rightsFirstReport: first?.at ?? total };
    }

    it.each([
      ['at its own check', 2],
      ['at the session look before its first command', 1],
    ])(
      'opening between the units, %s: no unit is sent another command, nothing is remembered',
      async (_which, back) => {
        const { rightsFirstReport } = await dryRun();
        const opens = rightsFirstReport - back;
        let looks = 0;
        let atOpening: number[] | undefined;
        const rigged = await rig({
          azeron: () => {
            const open = ++looks >= opens;
            if (open && !atOpening)
              atOpening = [...rigged.units.values()].map((u) => u.received.length);
            return Promise.resolve(open);
          },
        });
        r = rigged;
        const result = await rigged.service.apply(scheme.id, fp(scheme));
        expect(result.ok).toBe(false);
        expect(result.units.map((u) => u.status)).toEqual(['applied', 'failed']);
        expect(result.message).toMatch(/right unit failed: .*Azeron app/);
        expect(rigged.saveApplied).not.toHaveBeenCalled();
        expect(rigged.setActive).not.toHaveBeenCalled();
        expect(rigged.right && writesTo(rigged.right)).toEqual([]);
        // Not one command to either unit after the Azeron app appeared, the read afterwards included.
        expect(atOpening).toBeDefined();
        expect([...rigged.units.values()].map((u) => u.received.length)).toEqual(atOpening);
        // What the units hold is no longer known, and the pill is not told it is.
        expect(rigged.devices.snapshot().units.map((u) => u.slots)).toEqual([undefined, undefined]);
        expect((await rigged.service.preview(scheme.id)).ready).toBe(false);
      },
    );

    it('does not read the units again after an apply when the app cannot be ruled out', async () => {
      const { total } = await dryRun();
      let looks = 0;
      let atFailure: number[] | undefined;
      const rigged = await rig({
        azeron: () => {
          // Everything of the apply itself looks fine; the looks of the read afterwards fail.
          if (++looks > total - 6) {
            atFailure ??= [...rigged.units.values()].map((u) => u.received.length);
            return Promise.reject(new Error('tasklist failed'));
          }
          return Promise.resolve(false);
        },
      });
      r = rigged;
      const result = await rigged.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(true);
      expect([...rigged.units.values()].map((u) => u.received.length)).toEqual(atFailure);
      expect(rigged.devices.snapshot().units.every((u) => u.slots === undefined)).toBe(true);
    });

    it('reads the units again after a good apply only while the app is still closed, operation by operation', async () => {
      const { total } = await dryRun();
      let looks = 0;
      let atOpening: number[] | undefined;
      const rigged = await rig({
        azeron: () => {
          // The read afterwards makes six looks, three a unit; the app opens at the right unit's first.
          const open = ++looks > total - 3;
          if (open) atOpening ??= [...rigged.units.values()].map((u) => u.received.length);
          return Promise.resolve(open);
        },
      });
      r = rigged;
      const result = await rigged.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(true);
      const [left, right] = rigged.devices.snapshot().units;
      expect(left?.slots?.map((x) => x.slot)).toEqual([1]);
      expect(right?.slots).toBeUndefined();
      expect([...rigged.units.values()].map((u) => u.received.length)).toEqual(atOpening);
    });
  });

  describe('keeping the keys that were dealt', () => {
    const planOf = (s: Scheme) => resolve(s, game, BUILT_IN_DEVICES);
    const keyOf = (p: Plan, control: string) => {
      const pin = [...(p.units.left?.pins ?? []), ...(p.units.right?.pins ?? [])].find(
        (x) => x.control === control,
      );
      return JSON.stringify(pin?.presses);
    };

    it('writes the plan ledger into the scheme, and nothing else of it, after a good apply', async () => {
      r = await rig();
      expect(plan.ledger).not.toEqual({});
      expect(scheme.ledger).toEqual({});
      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(true);
      expect(r.saveScheme).toHaveBeenCalledTimes(1);
      expect(r.saveScheme).toHaveBeenCalledWith({ ...scheme, ledger: plan.ledger });
      expect(r.store.scheme.ledger).toEqual(plan.ledger);
    });

    it('leaves nothing to apply: the scheme with its ledger resolves to the plan that was applied', async () => {
      r = await rig();
      const before = (await r.service.preview(scheme.id)).fingerprint;
      await r.service.apply(scheme.id, fp(scheme));
      const after = planOf(r.store.scheme);
      expect(planFingerprint(after)).toBe(planFingerprint(plan));
      expect(after).toEqual(plan);
      // So the pill has no change to report, and the next preview is of the same layout.
      expect(pendingChanges(plan, after)).toBe(0);
      expect((await r.service.preview(scheme.id)).fingerprint).toBe(before);
    });

    it('gives a button the key it has, whatever is added on an earlier button afterwards', async () => {
      const two: Scheme = {
        ...scheme,
        map: { ship: { 'L.index_1': { tap: 'boost' }, 'R.index_1': { tap: 'fire' } } },
      };
      const added: Scheme['map'] = {
        ship: { ...two.map['ship'], 'L.middle_1': { tap: 'map' } },
      };
      const withMap: Game = {
        ...game,
        actions: [
          ...game.actions,
          { id: 'map', name: 'Map', mode: 'ship', role: 'menu', required: false },
        ],
      };
      const resolveWith = (s: Scheme) => resolve(s, withMap, BUILT_IN_DEVICES);
      r = await rig({ scheme: two });
      const applied = planOf(two);
      await r.service.apply(two.id, fp(two));

      // Without the ledger in the scheme, an earlier button takes the first key and the others move.
      const moved = resolveWith({ ...two, map: added });
      expect(keyOf(moved, 'L.index_1')).not.toBe(keyOf(applied, 'L.index_1'));
      // With it, the two that were dealt keys keep them, and the new button gets a new one.
      const kept = resolveWith({ ...r.store.scheme, map: added });
      expect(keyOf(kept, 'L.index_1')).toBe(keyOf(applied, 'L.index_1'));
      expect(keyOf(kept, 'R.index_1')).toBe(keyOf(applied, 'R.index_1'));
      expect(keyOf(kept, 'L.middle_1')).not.toBe(keyOf(applied, 'L.index_1'));
      expect(keyOf(kept, 'L.middle_1')).not.toBe(keyOf(applied, 'R.index_1'));
    });

    it('does not touch the scheme when the apply failed, in part or whole, or was refused', async () => {
      let looks = 0;
      r = await rig({ azeron: () => Promise.resolve(++looks === 2) });
      expect((await r.service.apply(scheme.id, fp(scheme))).ok).toBe(false);
      expect((await r.service.apply(scheme.id, 'another layout')).ok).toBe(false);
      expect(r.saveScheme).not.toHaveBeenCalled();
      expect(r.store.scheme.ledger).toEqual({});
    });

    it('writes nothing when the units already held the layout and the scheme already has its keys', async () => {
      r = await rig();
      await r.service.apply(scheme.id, fp(scheme));
      await r.service.apply(scheme.id, fp(scheme));
      expect(r.saveScheme).toHaveBeenCalledTimes(1);
    });

    it('does not write over an edit that landed while it was writing, and says so', async () => {
      const held: { rig?: Awaited<ReturnType<typeof rig>> } = {};
      const edited: Scheme = {
        ...scheme,
        map: { ship: { ...scheme.map['ship'], 'R.index_1': { tap: 'boost' } } },
      };
      r = await rig({
        saveApplied: () => {
          if (held.rig) held.rig.store.scheme = edited;
          return Promise.resolve();
        },
      });
      held.rig = r;
      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/the scheme was edited meanwhile/);
      expect(r.saveScheme).not.toHaveBeenCalled();
      expect(r.store.scheme).toBe(edited);
    });

    it('says so when the scheme could not be saved, the units being set', async () => {
      r = await rig({ saveScheme: () => Promise.reject(new Error('disk full')) });
      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(
        /keys it was given couldn't be kept in the scheme \(disk full\)/,
      );
      expect(result.units.map((u) => u.status)).toEqual(['applied', 'applied']);
      expect(r.saveApplied).toHaveBeenCalledTimes(1);
    });

    it('keeps the keys even when the note of the apply could not be saved', async () => {
      r = await rig({ saveApplied: () => Promise.reject(new Error('disk full')) });
      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(false);
      expect(r.saveScheme).toHaveBeenCalledTimes(1);
    });
  });

  describe('writing exactly what was previewed', () => {
    it('gives a fingerprint with the preview, the same for the same layout and another for another', async () => {
      r = await rig();
      const preview = await r.service.preview(scheme.id);
      expect(preview.fingerprint).toMatch(/^[0-9a-f]{32}$/);
      expect(preview.fingerprint).toBe(fp(scheme));
      expect(fp({ ...scheme, map: { ship: { 'L.index_1': { tap: 'boost' } } } })).not.toBe(
        preview.fingerprint,
      );
      expect((await r.service.preview('nope')).fingerprint).toBe('');
    });

    it('refuses, in one sentence, a layout other than the one previewed, and writes nothing', async () => {
      r = await rig();
      const reports = r.reports();
      const result = await r.service.apply(scheme.id, 'a fingerprint of some other layout');
      expect(result).toEqual({
        ok: false,
        changed: true,
        message: 'The layout changed since the preview: look again.',
        units: [],
      });
      expect(r.reports()).toBe(reports);
      expect(r.saveApplied).not.toHaveBeenCalled();
      expect(r.setActive).not.toHaveBeenCalled();
      expect(r.service.busy()).toBe(false);
    });

    it('refuses a scheme edited after the preview, and applies it after a new preview', async () => {
      let current = scheme;
      r = await rig();
      // The store hands back whatever the scheme is now: an undo under the drawer changes it.
      const live = createApplyService({
        plans: {
          getScheme: () => Promise.resolve(current),
          getGame: () => Promise.resolve(game),
        },
        devices: r.devices,
        hands: { get: (id) => HANDS[id as keyof typeof HANDS] },
        azeronAppRunning: () => Promise.resolve(false),
        saveApplied: r.saveApplied,
        setActive: r.setActive,
        saveScheme: r.saveScheme,
      });
      const seen = await live.preview(scheme.id);
      current = {
        ...scheme,
        map: { ship: { ...scheme.map['ship'], 'L.index_1': { tap: 'fire' } } },
      };
      const stale = await live.apply(scheme.id, seen.fingerprint);
      expect(stale).toMatchObject({ ok: false, changed: true });
      expect(r.saveApplied).not.toHaveBeenCalled();
      const again = await live.preview(scheme.id);
      expect(again.fingerprint).not.toBe(seen.fingerprint);
      expect((await live.apply(scheme.id, again.fingerprint)).ok).toBe(true);
    });
  });

  describe('when a unit is missing', () => {
    it('says which, and refuses to write the other one either', async () => {
      r = await rig({ right: false });
      const preview = await r.service.preview(scheme.id);
      expect(preview.ready).toBe(false);
      expect(preview.checks).toContainEqual({
        ok: false,
        kind: 'unit',
        text: "The right Azeron isn't connected.",
      });
      expect(preview.checks).toContainEqual({
        ok: true,
        kind: 'unit',
        text: 'The left Azeron is connected.',
      });
      expect(preview.right.connected).toBe(false);

      const before = writesTo(r.left).length;
      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result).toEqual({
        ok: false,
        message: "The right Azeron isn't connected.",
        units: [],
      });
      expect(writesTo(r.left).length).toBe(before);
      expect(r.saveApplied).not.toHaveBeenCalled();
    });
  });

  describe('the scheme itself', () => {
    it('refuses a scheme that is not there, in a sentence', async () => {
      r = await rig();
      expect(await r.service.apply('nope', 'whatever')).toEqual({
        ok: false,
        message: 'There is no such scheme.',
        units: [],
      });
      expect((await r.service.preview('nope')).checks).toEqual([
        { ok: false, text: 'There is no such scheme.' },
      ]);
    });

    const unplaced: Scheme = {
      ...scheme,
      map: { ship: { 'L.index_1': { tap: 'boost' }, 'R.index_1': { tap: 'boost' } } },
    };

    it('blocks on an error the player has not accepted, naming it, and writes nothing', async () => {
      r = await rig({ scheme: unplaced });
      const preview = await r.service.preview(unplaced.id);
      expect(preview.ready).toBe(false);
      expect(preview.checks).toContainEqual({
        ok: false,
        kind: 'scheme',
        text: 'Fire is needed to play Ship, and it is on no button.',
      });
      const reports = r.reports();
      const result = await r.service.apply(unplaced.id, fp(unplaced));
      expect(result.ok).toBe(false);
      expect(result.message).toBe('Fire is needed to play Ship, and it is on no button.');
      expect(r.saveApplied).not.toHaveBeenCalled();
      expect(r.reports()).toBe(reports);
    });

    it('does not block on an error the player accepted', async () => {
      const accepted: Scheme = {
        ...unplaced,
        accepted: [
          ...scheme.accepted,
          { rule: 'missing-required', action: 'fire', reason: 'Not needed' },
        ],
      };
      r = await rig({ scheme: accepted });
      expect((await r.service.preview(accepted.id)).ready).toBe(true);
      expect((await r.service.apply(accepted.id, fp(accepted))).ok).toBe(true);
    });
  });

  describe('one apply at a time', () => {
    it('refuses a second request while one runs, in a sentence, and the first is unharmed', async () => {
      const gate = deferred();
      let first = true;
      r = await rig({
        azeron: async () => {
          if (first) {
            first = false;
            await gate.promise;
          }
          return false;
        },
      });
      const running = r.service.apply(scheme.id, fp(scheme));
      await vi.advanceTimersByTimeAsync(0);
      expect(r.service.busy()).toBe(true);

      const second = await r.service.apply(scheme.id, fp(scheme));
      expect(second).toEqual({
        ok: false,
        message: 'An apply is already running. Wait for it to finish.',
        units: [],
      });
      const preview = await r.service.preview(scheme.id);
      expect(preview).toMatchObject({ ready: false, busy: true });

      gate.release();
      expect((await running).ok).toBe(true);
      expect(r.saveApplied).toHaveBeenCalledTimes(1);
      expect(r.service.busy()).toBe(false);
    });

    it('two requests in the same moment: one runs, one is refused', async () => {
      r = await rig();
      const [a, b] = await Promise.all([
        r.service.apply(scheme.id, fp(scheme)),
        r.service.apply(scheme.id, fp(scheme)),
      ]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      expect(r.saveApplied).toHaveBeenCalledTimes(1);
    });

    it('is free again after a failed one', async () => {
      let look = 0;
      r = await rig({ azeron: () => Promise.resolve(++look === 2) });
      const failed = await r.service.apply(scheme.id, fp(scheme));
      expect(failed.ok).toBe(false);
      expect(r.service.busy()).toBe(false);
      const next = await r.service.apply(scheme.id, fp(scheme));
      expect(next.ok).toBe(true);
    });

    it('is free again, and the devices service released, after something throws', async () => {
      r = await rig({ saveApplied: () => Promise.reject(new Error('disk full')) });
      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(false);
      expect(r.service.busy()).toBe(false);
      const listed = r.bench.listed;
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(r.bench.listed).toBeGreaterThan(listed);
    });
  });

  describe('remembering', () => {
    it('says so when the units are set but the note could not be kept, and does not make it active', async () => {
      r = await rig({ saveApplied: () => Promise.reject(new Error('disk full')) });
      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(false);
      expect(result.message).toBe(
        "Both units now run the layout, but helmArray couldn't keep a note of it (disk full), so it can't say they are in sync.",
      );
      expect(result.units.map((u) => u.status)).toEqual(['applied', 'applied']);
      expect(r.setActive).not.toHaveBeenCalled();
    });

    it('says so when it could not be made the current scheme', async () => {
      r = await rig({ setActive: () => Promise.reject(new Error('no such game')) });
      const result = await r.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/couldn't be made the current scheme \(no such game\)/);
      expect(r.saveApplied).toHaveBeenCalledTimes(1);
    });
  });

  describe('the devices service during an apply', () => {
    it('neither lists, opens, closes nor reads while the units are written', async () => {
      const probes: { listed: number; opened: string[]; closed: string[] }[] = [];
      const held: { rig?: Awaited<ReturnType<typeof rig>> } = {};
      let looks = 0;
      const service = await rig({
        azeron: async () => {
          // The first look is the readiness check, before the units are held.
          if (++looks === 1) return false;
          const bench = held.rig?.bench;
          // Every step of the apply asks this; time passes meanwhile, and a third unit appears.
          held.rig?.units.set('third-path', new FakeUnit({ deviceId: 1234 }));
          await vi.advanceTimersByTimeAsync(POLL_MS * 3);
          if (bench) {
            probes.push({
              listed: bench.listed,
              opened: [...bench.opened],
              closed: [...bench.closed],
            });
          }
          return false;
        },
      });
      held.rig = service;
      r = service;
      const listedBefore = service.bench.listed;
      const result = await service.service.apply(scheme.id, fp(scheme));
      expect(result.ok).toBe(true);
      expect(probes.length).toBeGreaterThan(5);
      for (const probe of probes) {
        expect(probe.listed).toBe(probes[0]?.listed);
        expect(probe.opened).toEqual(['left-path', 'right-path']);
        expect(probe.closed).toEqual([]);
      }
      expect(probes[0]?.listed).toBeGreaterThanOrEqual(listedBefore);
      // Once the apply is over, polling is back and the new unit is found.
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(service.bench.opened).toContain('third-path');
    });
  });

  it('survives its units being read for the preview just as the apply wants them', async () => {
    r = await rig();
    const [preview, applied] = await Promise.all([
      r.service.preview(scheme.id),
      r.service.apply(scheme.id, fp(scheme)),
    ]);
    expect(applied.ok).toBe(true);
    expect(preview.schemeName).toBe('Main');
  });
});

describe('Apply says what it did, to the log', () => {
  let r: Awaited<ReturnType<typeof rig>> | undefined;
  beforeEach(() => void vi.useFakeTimers());
  afterEach(async () => {
    await r?.devices.stop();
    r = undefined;
    vi.useRealTimers();
  });

  it('prefixes what the units flow says with apply:, so the log shows whose line it is', async () => {
    const lines: string[] = [];
    r = await rig({ trace: (line) => lines.push(line) });
    await r.service.apply(scheme.id, fp(scheme));
    expect(lines).toContain('apply: left: writing the layout into slot 1');
  });

  it('says when the keys it was dealt were not kept, because the scheme was edited meanwhile', async () => {
    const lines: string[] = [];
    const held: { rig?: Awaited<ReturnType<typeof rig>> } = {};
    const edited: Scheme = {
      ...scheme,
      map: { ship: { ...scheme.map['ship'], 'R.index_1': { tap: 'boost' } } },
    };
    r = await rig({
      trace: (line) => lines.push(line),
      saveApplied: () => {
        if (held.rig) held.rig.store.scheme = edited;
        return Promise.resolve();
      },
    });
    held.rig = r;
    await r.service.apply(scheme.id, fp(scheme));
    expect(lines).toContain(
      "ledger: Both units now run the layout, but the scheme was edited meanwhile, so the keys it was given weren't kept: apply again.",
    );
  });

  it('says nothing of the ledger when the keys were kept', async () => {
    const lines: string[] = [];
    r = await rig({ trace: (line) => lines.push(line) });
    await r.service.apply(scheme.id, fp(scheme));
    expect(lines.filter((line) => line.startsWith('ledger:'))).toEqual([]);
  });

  it('survives what is to run after an apply failing, and says so', async () => {
    const lines: string[] = [];
    r = await rig({
      trace: (line) => lines.push(line),
      settled: () => Promise.reject(new Error('state could not be worked out')),
    });
    const result = await r.service.apply(scheme.id, fp(scheme));
    expect(result.ok).toBe(true);
    expect(lines).toContain('after an apply: state could not be worked out');
  });

  it('survives a log that throws', async () => {
    r = await rig({
      trace: () => {
        throw new Error('the log is full');
      },
    });
    expect((await r.service.apply(scheme.id, fp(scheme))).ok).toBe(true);
  });
});

describe('Apply for a setup that uses some of the units, or none', () => {
  let r: Awaited<ReturnType<typeof rig>> | undefined;
  beforeEach(() => void vi.useFakeTimers());
  afterEach(async () => {
    await r?.devices.stop();
    r = undefined;
    vi.useRealTimers();
  });

  const leftOnly: Scheme = {
    ...scheme,
    devices: { azerons: 'left', keyboard: false, mouse: true, controller: false },
    accepted: [{ rule: 'stick-no-directions', control: 'L.stick', reason: 'No stick' }],
    map: { ship: { 'L.index_1': { tap: 'boost' }, 'L.middle_1': { tap: 'fire' } } },
  };
  const noUnit: Scheme = {
    ...scheme,
    devices: { azerons: 'none', keyboard: true, mouse: true, controller: false },
    accepted: [],
    map: { ship: { 'key.B': { tap: 'boost' }, 'mouse.left': { tap: 'fire' } } },
  };

  it('is ready with the right unit unplugged, and asks only about the left', async () => {
    r = await rig({ scheme: leftOnly, right: false });
    const preview = await r.service.preview(leftOnly.id);
    expect([preview.ready, preview.checks.map((c) => c.text), preview.right.used]).toEqual([
      true,
      ['The Azeron app is closed.', 'The left Azeron is connected.', 'The scheme has no errors.'],
      false,
    ]);
  });

  it('writes the left unit and nothing to the right one, which keeps what it holds', async () => {
    r = await rig({ scheme: leftOnly });
    const right = r.right as FakeUnit;
    const slotsBefore = [...right.slots.keys()];
    const result = await r.service.apply(leftOnly.id, fp(leftOnly));
    expect({
      ok: result.ok,
      message: result.message,
      units: result.units.map((u) => u.hand),
      rightWrites: writesTo(right),
      rightSlots: [...right.slots.keys()],
      leftWrote: writesTo(r.left).length > 0,
    }).toEqual({
      ok: true,
      message: 'The left unit now runs the layout.',
      units: ['left'],
      rightWrites: [],
      rightSlots: slotsBefore,
      leftWrote: true,
    });
  });

  it('notes that the left unit, and only it, now holds the scheme', async () => {
    r = await rig({ scheme: leftOnly });
    await r.service.apply(leftOnly.id, fp(leftOnly));
    expect(
      r.recordUnits.mock.calls.map((call: unknown[]) => {
        const [plan, outcomes, who] = call as [
          { units: Record<string, unknown> },
          { hand: string; status: string }[],
          { schemeId: string; at: number; devices: unknown },
        ];
        return [
          Object.keys(plan.units),
          outcomes.map((o) => [o.hand, o.status]),
          who.schemeId,
          who.at,
          who.devices,
        ];
      }),
    ).toEqual([[['left'], [['left', 'applied']], leftOnly.id, 1234, leftOnly.devices]]);
  });

  it('needs no unit, and not the Azeron app closed, for a setup with no Azeron', async () => {
    r = await rig({ scheme: noUnit, azeron: () => Promise.resolve(true) });
    const preview = await r.service.preview(noUnit.id);
    expect([preview.ready, preview.checks.map((c) => c.text)]).toEqual([
      true,
      ['The scheme has no errors.'],
    ]);
  });

  it('applies a setup with no Azeron without a word to either unit, and remembers it', async () => {
    r = await rig({ scheme: noUnit, azeron: () => Promise.resolve(true) });
    const before = r.reports();
    const result = await r.service.apply(noUnit.id, fp(noUnit));
    expect([
      result,
      r.reports() - before,
      r.saveApplied.mock.calls.length,
      r.recordUnits.mock.calls.length,
    ]).toEqual([
      { ok: true, message: 'Applied. This scheme uses no Azeron, so none was written.', units: [] },
      0,
      1,
      0,
    ]);
  });
});

describe('the game half of the Apply drawer', () => {
  let r: Awaited<ReturnType<typeof rig>> | undefined;
  beforeEach(() => void vi.useFakeTimers());
  afterEach(async () => {
    await r?.devices.stop();
    r = undefined;
    vi.useRealTimers();
  });

  // Skiff ships Boost and Fire on no key, so the game's own keys hand each a key of the pool:
  // two of the game's keyboard bindings change, and the file isn't written, so by hand.
  const single: Scheme = {
    ...scheme,
    map: { ship: { 'L.index_1': { tap: 'boost' }, 'L.middle_1': { tap: 'fire' } } },
  };
  const singlePlan = resolve(single, game, BUILT_IN_DEVICES);

  it('lists each game binding that changes, in the game’s words, from what the game ships', async () => {
    r = await rig({ scheme: single });
    const preview = await r.service.preview(single.id);
    expect(preview.game).toEqual({
      via: 'sheet',
      rows: [
        {
          set: 'keyboard',
          mode: 'ship',
          modeName: 'Ship',
          action: 'boost',
          actionName: 'Boost',
          to: { kind: 'key', code: 'Home' },
          from: null,
        },
        {
          set: 'keyboard',
          mode: 'ship',
          modeName: 'Ship',
          action: 'fire',
          actionName: 'Fire',
          to: { kind: 'key', code: 'Insert' },
          from: null,
        },
      ],
    });
  });

  it('lists nothing the game already holds from the setup applied to it last', async () => {
    r = await rig({ scheme: single, gameHolds: () => Promise.resolve(singlePlan) });
    expect((await r.service.preview(single.id)).game.rows).toEqual([]);
  });

  it('lists a binding back to where the game ships it, when the setup applied last moved it', async () => {
    const moved: Plan = {
      ...singlePlan,
      gameBindings: singlePlan.gameBindings.map((b) =>
        b.action === 'boost' ? { ...b, signal: { kind: 'key', code: 'End' } } : b,
      ),
    };
    r = await rig({ scheme: single, gameHolds: () => Promise.resolve(moved) });
    expect(
      (await r.service.preview(single.id)).game.rows.map((row) => [row.action, row.from, row.to]),
    ).toEqual([['boost', { kind: 'key', code: 'End' }, { kind: 'key', code: 'Home' }]]);
  });
});

describe('what Apply says when the note of a setup could not be kept, by which units it used', () => {
  let r: Awaited<ReturnType<typeof rig>> | undefined;
  beforeEach(() => void vi.useFakeTimers());
  afterEach(async () => {
    await r?.devices.stop();
    r = undefined;
    vi.useRealTimers();
  });

  const leftOnly: Scheme = {
    ...scheme,
    devices: { azerons: 'left', keyboard: false, mouse: true, controller: false },
    accepted: [{ rule: 'stick-no-directions', control: 'L.stick', reason: 'No stick' }],
    map: { ship: { 'L.index_1': { tap: 'boost' }, 'L.middle_1': { tap: 'fire' } } },
  };
  it.each<[string, () => Scheme, string]>([
    ['both units', () => scheme, 'Both units now run the layout'],
    ['the left unit', () => leftOnly, 'The left unit now runs the layout'],
  ])('%s', async (_, pick, words) => {
    const used = pick();
    r = await rig({
      scheme: used,
      saveApplied: () => Promise.reject(new Error('disk full')),
    });
    const result = await r.service.apply(used.id, fp(used));
    expect(result.message).toBe(
      `${words}, but helmArray couldn't keep a note of it (disk full), so it can't say they are in sync.`,
    );
  });
});
