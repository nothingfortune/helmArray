// Apply's readiness texts and its failure paths, each in a state the real devices service cannot
// be put in on demand (a unit still being read, a read that throws). The units are a snapshot
// the test writes; nothing here talks to a unit. Found by mutation testing: these are the
// sentences and branches no other test noticed.
import { describe, expect, it } from 'vitest';
import type { Game, Hand, Plan, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, gameKeysPreset, resolve } from '@helmarray/core';
import { BUSY_SENTENCE, changedRows, createApplyService } from './apply-service';
import type { ApplyDevices, ApplyServiceDeps } from './apply-service';
import type { UnitSnapshot } from './devices';

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
  accepted: [
    { rule: 'stick-no-directions', control: 'L.stick', reason: 'No stick' },
    { rule: 'stick-no-directions', control: 'R.stick', reason: 'No stick' },
  ],
  map: { ship: { 'L.index_1': { tap: 'boost' }, 'R.index_1': { tap: 'fire' } } },
};

const LEFT = 49229;
const RIGHT = 29993;
const THIRD = 11111;
const HANDS: Record<number, Hand> = { [LEFT]: 'left', [RIGHT]: 'right' };

const unit = (id: number, over: Partial<UnitSnapshot> = {}): UnitSnapshot => ({
  path: `path-${id}`,
  state: 'ready',
  identity: { firmware: 112, deviceId: id, slotLimit: 6, runningSlot: 0 },
  slots: [{ slot: 0, name: 'Default', settings: null, records: [] }],
  ...over,
});

/** A unit that is ready but whose slots are not known (the Azeron app was open since). */
const unslotted = (u: UnitSnapshot): UnitSnapshot => {
  const copy = { ...u };
  delete copy.slots;
  return copy;
};

interface Bench {
  devices: ApplyDevices;
  refreshed: unknown[];
}
const bench = (units: () => UnitSnapshot[], over: Partial<ApplyDevices> = {}): Bench => {
  const refreshed: unknown[] = [];
  return {
    refreshed,
    devices: {
      snapshot: () => ({ units: units() }),
      session: () => undefined,
      refresh: async (options) => {
        refreshed.push(options);
      },
      exclusive: (job) => job({ refresh: async () => undefined }),
      ...over,
    },
  };
};

const serviceOver = (
  b: Bench,
  over: Partial<ApplyServiceDeps> & { scheme?: Scheme | Error } = {},
) => {
  const lines: string[] = [];
  const service = createApplyService({
    plans: {
      getScheme: async (id) => {
        if (over.scheme instanceof Error) throw over.scheme;
        const s = over.scheme ?? scheme;
        return id === s.id ? s : null;
      },
      getGame: async () => game,
    },
    devices: b.devices,
    hands: { get: (id) => HANDS[id] },
    azeronAppRunning: async () => false,
    saveApplied: async () => undefined,
    saveScheme: () => undefined,
    setActive: async () => undefined,
    trace: (line) => lines.push(line),
    ...over,
  });
  return { service, lines };
};

/** What the readiness checks say of the two units, with the Azeron app closed. */
const unitTexts = async (units: UnitSnapshot[]) => {
  const { service } = serviceOver(bench(() => units));
  const preview = await service.preview(scheme.id);
  return preview.checks.map((c) => [c.ok, c.text]).slice(1, 3);
};

describe('what a unit that is not ready is called', () => {
  it('a unit that is not there is not connected', async () => {
    expect(await unitTexts([])).toEqual([
      [false, "The left Azeron isn't connected."],
      [false, "The right Azeron isn't connected."],
    ]);
  });

  it('a unit that is there but whose hand is not known is asked about, not called unplugged', async () => {
    expect(await unitTexts([unit(THIRD)])).toEqual([
      [false, "helmArray doesn't know yet which Azeron is the left one."],
      [false, "helmArray doesn't know yet which Azeron is the right one."],
    ]);
  });

  it('only some units of unknown hand are enough to ask', async () => {
    expect(await unitTexts([unit(LEFT), unit(THIRD), unit(22222)])).toEqual([
      [true, 'The left Azeron is connected.'],
      [false, "helmArray doesn't know yet which Azeron is the right one."],
    ]);
  });

  it('a unit still being opened is not taken for the hand that has none', async () => {
    const opening = { path: 'path-opening', state: 'connecting' } as const;
    expect(await unitTexts([unit(LEFT), opening])).toEqual([
      [true, 'The left Azeron is connected.'],
      [false, "The right Azeron isn't connected."],
    ]);
  });

  it('a unit being read is said to be, by hand', async () => {
    expect(await unitTexts([unit(LEFT), unit(RIGHT, { state: 'connecting' })])).toEqual([
      [true, 'The left Azeron is connected.'],
      [false, 'The right Azeron is still being read.'],
    ]);
  });

  it('a ready unit whose slots are not known is said not to be read yet', async () => {
    expect(await unitTexts([unslotted(unit(LEFT)), unit(RIGHT)])).toEqual([
      [false, "The left Azeron hasn't been read yet."],
      [true, 'The right Azeron is connected.'],
    ]);
  });

  it('a unit that failed is said so, with why, and the right hand is judged on its own state', async () => {
    const failed = unit(RIGHT, { state: 'failed', error: 'It would not answer' });
    expect(await unitTexts([unit(LEFT), failed])).toEqual([
      [true, 'The left Azeron is connected.'],
      [false, "The right Azeron couldn't be read: It would not answer."],
    ]);
  });

  it('a unit that failed with a full stop of its own does not get a second', async () => {
    const failed = unit(LEFT, { state: 'failed', error: 'It would not answer.' });
    expect((await unitTexts([failed, unit(RIGHT)]))[0]).toEqual([
      false,
      "The left Azeron couldn't be read: It would not answer.",
    ]);
  });

  it('a unit that failed with no reason is still said to have', async () => {
    const failed = unit(LEFT, { state: 'failed' });
    expect((await unitTexts([failed, unit(RIGHT)]))[0]).toEqual([
      false,
      "The left Azeron couldn't be read.",
    ]);
  });
});

describe('a preview of a scheme that cannot be worked out', () => {
  it.each<[string, Scheme | Error, string]>([
    ['one that is not there', { ...scheme, id: 'other' }, 'There is no such scheme.'],
    [
      'one the store could not read',
      new Error('disk gone'),
      "The scheme couldn't be read: disk gone.",
    ],
  ])('%s says why, and nothing else', async (_, source, text) => {
    const { service } = serviceOver(
      bench(() => []),
      { scheme: source },
    );
    expect(await service.preview(scheme.id)).toEqual({
      schemeId: scheme.id,
      schemeName: '',
      gameId: '',
      gameName: '',
      fingerprint: '',
      ready: false,
      busy: false,
      azeronOpen: false,
      anyChange: false,
      checks: [{ ok: false, text }],
      game: { rows: [], via: 'sheet' },
      left: {
        hand: 'left',
        used: true,
        connected: false,
        differs: false,
        inputsChanged: 0,
        buttons: [],
        write: null,
        deletes: [],
        changes: [],
        problem: null,
      },
      right: {
        hand: 'right',
        used: true,
        connected: false,
        differs: false,
        inputsChanged: 0,
        buttons: [],
        write: null,
        deletes: [],
        changes: [],
        problem: null,
      },
    });
  });
});

describe('when the Azeron app cannot be told about', () => {
  it('the units are not read, and the preview says it could not tell, not that it is open', async () => {
    const b = bench(() => [unit(LEFT), unit(RIGHT)]);
    const { service, lines } = serviceOver(b, {
      azeronAppRunning: async () => {
        throw new Error('no process list');
      },
    });
    const preview = await service.preview(scheme.id);
    expect(preview).toMatchObject({ ready: false, azeronOpen: false });
    expect(preview.checks[0]).toEqual({
      ok: false,
      kind: 'azeron-app',
      text: "helmArray couldn't tell whether the Azeron app is open.",
    });
    expect(b.refreshed).toEqual([]);
    expect(lines).toContain("couldn't look for the Azeron app: no process list");
  });

  it('when it is open, the units are not read either', async () => {
    const b = bench(() => [unit(LEFT), unit(RIGHT)]);
    const { service } = serviceOver(b, { azeronAppRunning: async () => true });
    await service.preview(scheme.id);
    expect(b.refreshed).toEqual([]);
  });

  it('when it is closed, the units are read if the last look is older than three seconds', async () => {
    const b = bench(() => [unit(LEFT), unit(RIGHT)]);
    const { service } = serviceOver(b);
    await service.preview(scheme.id);
    expect(b.refreshed).toEqual([{ olderThanMs: 3000 }]);
  });

  it('a read of the units that fails is logged and the preview goes on with what it has', async () => {
    const b = bench(() => [unit(LEFT), unit(RIGHT)], {
      refresh: async () => {
        throw new Error('bus gone');
      },
    });
    const { service, lines } = serviceOver(b);
    expect((await service.preview(scheme.id)).ready).toBe(true);
    expect(lines).toContain('reading the units for the preview failed: bus gone');
  });
});

describe('a layout that cannot be written to a unit that is there', () => {
  it('is a failing check, as the unit’s own sentence, and the preview is not ready', async () => {
    const unwritable: Scheme = {
      ...scheme,
      behaviour: { 'R.index_1': { turbo: { interval: 256 } } },
    };
    const { service } = serviceOver(
      bench(() => [unit(LEFT), unit(RIGHT)]),
      { scheme: unwritable },
    );
    const preview = await service.preview(scheme.id);
    expect(preview.ready).toBe(false);
    expect(preview.checks.at(-1)).toEqual({
      ok: false,
      kind: 'unit',
      text: "input 17: tap turbo interval is 256, which doesn't fit.",
    });
  });
});

describe('an apply or a preview that goes wrong in a way nobody planned for', () => {
  it('an apply says it could not, with the reason as a sentence, and logs it', async () => {
    const b = bench(() => [unit(LEFT), unit(RIGHT)], {
      exclusive: async () => {
        throw new Error('hold failed');
      },
    });
    const { service, lines } = serviceOver(b);
    const preview = await service.preview(scheme.id);
    expect(await service.apply(scheme.id, preview.fingerprint)).toEqual({
      ok: false,
      message: "helmArray couldn't apply: hold failed.",
      units: [],
    });
    expect(lines).toContain('apply failed unexpectedly: hold failed');
  });

  it('a preview says it could not check, and logs it', async () => {
    let calls = 0;
    const b = bench(() => {
      if (++calls > 0) throw new Error('snapshot failed');
      return [];
    });
    const { service, lines } = serviceOver(b);
    const preview = await service.preview(scheme.id);
    expect(preview.checks).toEqual([
      { ok: false, text: "helmArray couldn't check: snapshot failed." },
    ]);
    expect(lines).toContain('preview failed unexpectedly: snapshot failed');
    expect(preview).toMatchObject({
      schemeId: scheme.id,
      schemeName: '',
      gameId: '',
      gameName: '',
      fingerprint: '',
      ready: false,
      busy: false,
      azeronOpen: false,
      anyChange: false,
    });
  });
});

describe('a preview while an apply runs', () => {
  it('says so, and nothing else, and is not ready', async () => {
    let release: () => void = () => undefined;
    const b = bench(() => [unit(LEFT), unit(RIGHT)], {
      exclusive: () => new Promise((resolve) => (release = () => resolve(undefined as never))),
    });
    const { service } = serviceOver(b);
    const first = await service.preview(scheme.id);
    const applying = service.apply(scheme.id, first.fingerprint);
    await Promise.resolve();
    await new Promise((done) => setTimeout(done, 0));
    const during = await service.preview(scheme.id);
    release();
    await applying;
    expect([during.busy, during.ready, during.checks]).toEqual([
      true,
      false,
      [{ ok: false, kind: 'busy', text: BUSY_SENTENCE }],
    ]);
  });
});

describe('what is said of units depends on whether the Azeron app is known to be closed', () => {
  it.each<[string, () => Promise<boolean>, string]>([
    ['open', async () => true, 'Close the Azeron app first: it talks to the units too.'],
    [
      'unknown',
      async () => {
        throw new Error('no process list');
      },
      "helmArray couldn't tell whether the Azeron app is open.",
    ],
  ])('with it %s, no unit is spoken of', async (_, look, text) => {
    const { service } = serviceOver(
      bench(() => [unit(LEFT), unit(RIGHT)]),
      { azeronAppRunning: look },
    );
    const preview = await service.preview(scheme.id);
    expect(preview.checks).toEqual([
      { ok: false, kind: 'azeron-app', text },
      { ok: true, kind: 'scheme', text: 'The scheme has no errors.' },
    ]);
  });

  it('a failed unit with no slots is a failed unit, not one not read yet', async () => {
    const failed = unslotted(unit(LEFT, { state: 'failed', error: 'It would not answer' }));
    expect((await unitTexts([failed, unit(RIGHT)]))[0]).toEqual([
      false,
      "The left Azeron couldn't be read: It would not answer.",
    ]);
  });
});

describe('a setup with no Azeron', () => {
  const noUnit: Scheme = {
    ...scheme,
    devices: { azerons: 'none', keyboard: true, mouse: true, controller: false },
    accepted: [],
    map: { ship: { 'key.B': { tap: 'boost' }, 'mouse.left': { tap: 'fire' } } },
  };
  /** Counts what a unit-writing apply would have touched. */
  const counted = () => {
    const touched = { holds: 0, looks: 0 };
    const b = bench(() => [], {
      exclusive: async (job) => {
        touched.holds++;
        return job({ refresh: async () => undefined });
      },
    });
    return { b, touched };
  };

  it('is applied without holding the devices or looking for the Azeron app', async () => {
    const { b, touched } = counted();
    const { service } = serviceOver(b, {
      scheme: noUnit,
      azeronAppRunning: async () => {
        touched.looks++;
        return false;
      },
    });
    const { fingerprint } = await service.preview(noUnit.id);
    expect(await service.apply(noUnit.id, fingerprint)).toEqual({
      ok: true,
      message: 'Applied. This scheme uses no Azeron, so none was written.',
      units: [],
    });
    expect(touched).toEqual({ holds: 0, looks: 0 });
  });

  it('says what went wrong with the note of it, as a setup and not as units', async () => {
    const { service } = serviceOver(
      bench(() => []),
      {
        scheme: noUnit,
        saveApplied: async () => {
          throw new Error('disk full');
        },
      },
    );
    const { fingerprint } = await service.preview(noUnit.id);
    expect(await service.apply(noUnit.id, fingerprint)).toEqual({
      ok: false,
      message:
        "The scheme is applied, but helmArray couldn't keep a note of it (disk full), so it can't say they are in sync.",
      units: [],
    });
  });

  it('is refused for an error nobody accepted, in the error’s own words, and nothing is remembered', async () => {
    const unplaced: Scheme = { ...noUnit, map: { ship: { 'key.B': { tap: 'boost' } } } };
    let remembered = 0;
    const { service } = serviceOver(
      bench(() => []),
      {
        scheme: unplaced,
        saveApplied: async () => {
          remembered++;
        },
      },
    );
    const preview = await service.preview(unplaced.id);
    const result = await service.apply(unplaced.id, preview.fingerprint);
    expect([preview.ready, result.ok, result.message, remembered]).toEqual([
      false,
      false,
      preview.checks[0]?.text,
      0,
    ]);
    expect(preview.checks.every((c) => !c.ok)).toBe(true);
  });
});

describe('the game half of a preview, when what the game holds cannot be read', () => {
  it('is worked out from nothing held, and the failure is logged', async () => {
    const { service, lines } = serviceOver(
      bench(() => [unit(LEFT), unit(RIGHT)]),
      {
        gameHolds: async () => {
          throw new Error('no record');
        },
      },
    );
    const preview = await service.preview(scheme.id);
    expect(lines).toContain("couldn't read what skiff holds: no record");
    expect(preview.game.rows.length).toBeGreaterThan(0);
  });
});

describe('the game rows that change, in the game’s words', () => {
  const twoModes: Game = {
    ...game,
    modes: [
      { id: 'ship', name: 'Ship' },
      { id: 'ground', name: 'Ground' },
    ],
    actions: [
      { id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true },
      { id: 'jump', name: 'Jump', mode: 'ground', role: 'movement', required: true },
    ],
  };
  const planOf = (): Plan =>
    resolve(
      {
        ...gameKeysPreset(twoModes),
        writeGameFile: false,
        accepted: [
          { rule: 'stick-no-directions', control: 'L.stick', reason: 'x' },
          { rule: 'stick-no-directions', control: 'R.stick', reason: 'x' },
        ],
        map: {
          ship: { 'L.index_1': { tap: 'boost' } },
          ground: { 'L.index_1': { tap: 'jump' } },
        },
      },
      twoModes,
      BUILT_IN_DEVICES,
    );

  it('names the mode each row is in, not the first mode the game has', () => {
    const rows = changedRows(planOf(), twoModes, null);
    expect(rows.map((row) => [row.action, row.modeName])).toEqual([
      ['boost', 'Ship'],
      ['jump', 'Ground'],
    ]);
  });

  it('takes what the game held from the first of its rows for an action', () => {
    const now = planOf();
    const boost = now.gameBindings.filter((b) => b.action === 'boost');
    const earlier: Plan = {
      ...now,
      gameBindings: [
        ...boost.map((b) => ({ ...b, signal: { kind: 'key', code: 'End' } as const })),
        ...boost.map((b) => ({ ...b, signal: { kind: 'key', code: 'Del' } as const })),
      ],
    };
    expect(changedRows(now, twoModes, earlier)[0]?.from).toEqual({ kind: 'key', code: 'End' });
  });
});
