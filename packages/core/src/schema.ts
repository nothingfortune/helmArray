// Stored files carry a schema version; migrations bring an older file up to date on load, one
// function per version (docs/plans/02-architecture.md, "Storage"). Pure: the app reads and
// writes the files, this only turns what it read into the current shape.

import { clone } from './clone';
import type { AppSettings, Game, Scheme } from './model';
import type { Plan, UnitsHeld } from './plan';
import type { Baselines } from './sheets';
import { AZERONS_ONLY, DEFAULT_TURBO_INTERVAL } from './model';

/** Rules that no longer exist: the editor's findings about the game's fixed pad bindings (M4). */
const RETIRED_RULES: readonly string[] = ['pad-mismatch', 'pad-default-unknown'];

/** What a stored file holds, by kind. */
export interface StoredKinds {
  scheme: Scheme;
  game: Game;
  /** settings.json. */
  settings: AppSettings;
  /** The plan last applied for one scheme (applied/<schemeId>.json). */
  applied: Plan;
  /** What each unit was last written with (units.json). */
  units: UnitsHeld;
  /**
   * The bindings each game holds as far as helmArray knows, where they differ from what it ships
   * (sheets.json). What is still to set by hand is worked out from them.
   */
  sheets: Baselines;
}
export type StoredKind = keyof StoredKinds;

/** A document as it is written to disk: the document plus the version of its shape. */
export type Stored<K extends StoredKind> = StoredKinds[K] & { schemaVersion: number };

/** Takes a document of one version and returns it in the next. Must not change its input. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Every migration, by kind. `MIGRATIONS[kind][i]` takes version i + 1 to i + 2, so the current
 * version is always one more than the number of migrations. Add one here, at the end, whenever
 * a stored shape changes; never edit or remove one a released app has run.
 */
export const MIGRATIONS: Readonly<Record<StoredKind, readonly Migration[]>> = {
  scheme: [
    // 1 → 2: turbo carries its rate. `turbo: true` repeats at helmArray's default; false is
    // left out, as a scheme with no turbo leaves it.
    (doc) => {
      const behaviour = (doc['behaviour'] ?? {}) as Record<string, Record<string, unknown>>;
      for (const control of Object.values(behaviour)) {
        if (control['turbo'] === true) control['turbo'] = { interval: DEFAULT_TURBO_INTERVAL };
        else if (control['turbo'] === false) delete control['turbo'];
      }
      return doc;
    },
    // 2 → 3: setups. A scheme saved before them always meant both Azerons and nothing else. The
    // editor's two findings about the game's fixed pad bindings are gone with that model, so what
    // was kept of them is dropped.
    (doc) => {
      const accepted = (doc['accepted'] ?? []) as { rule?: unknown }[];
      return {
        ...doc,
        devices: { ...AZERONS_ONLY },
        accepted: accepted.filter((a) => !RETIRED_RULES.includes(String(a.rule))),
      };
    },
    // 3 → 4: key labels, the player's short labels for keys. A scheme saved before them has none.
    (doc) => ({ ...doc, keyLabels: {} }),
  ],
  game: [],
  settings: [],
  units: [],
  sheets: [
    // 1 → 2: a baseline per game, not the reminders themselves. A version-1 file held reminder
    // rows merged apply by apply; what the game holds can't be told from them faithfully (their
    // `from` was the apply before, not the game), so they are dropped, and counted for the log.
    // With no baseline a game holds what it ships, so nothing still to set is ever hidden.
    (doc) => {
      const games = Array.isArray(doc['games']) ? doc['games'] : [];
      return { games: [], droppedReminders: games.length };
    },
  ],
  applied: [
    // 1 → 2: game bindings. A plan saved before them claims none; its bind sheet rows (key output
    // only, so keys) say which set they are in, and that the shipped binding wasn't recorded.
    (doc) => {
      const rows = (doc['bindSheet'] ?? []) as Record<string, unknown>[];
      return {
        ...doc,
        gameBindings: [],
        bindSheet: rows.map((row) => ({
          set:
            (row['signal'] as { kind?: unknown } | undefined)?.kind === 'pad'
              ? 'controller'
              : 'keyboard',
          ...row,
          native: null,
        })),
      };
    },
  ],
};

/** The version this app writes, by kind. */
export const currentVersion = (kind: StoredKind): number => MIGRATIONS[kind].length + 1;

export class SchemaError extends Error {}

const NAMES: Record<StoredKind, string> = {
  scheme: 'scheme',
  game: 'game',
  settings: 'settings file',
  applied: 'applied plan',
  units: 'record of what the units hold',
  sheets: 'list of bindings to set in the game',
};

/** Run the migrations from `version` up to the current one. Exposed for tests. */
export function runMigrations(
  raw: unknown,
  kind: StoredKind,
  migrations: readonly Migration[],
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SchemaError(`This file isn't a ${NAMES[kind]} helmArray can read.`);
  }
  const { schemaVersion: version, ...rest } = raw as Record<string, unknown>;
  const current = migrations.length + 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SchemaError(
      `This file isn't a ${NAMES[kind]} helmArray can read: it has no version.`,
    );
  }
  if (version > current) {
    throw new SchemaError(
      `This ${NAMES[kind]} was saved by a newer helmArray. Update helmArray to open it.`,
    );
  }
  let doc: Record<string, unknown> = clone(rest);
  for (let v = version; v < current; v++) {
    const step = migrations[v - 1];
    if (!step) throw new SchemaError(`No migration from version ${v}.`);
    doc = step(clone(doc));
  }
  return doc;
}

/** Bring a stored file up to date. The caller checks its shape before using it. */
export function load<K extends StoredKind>(kind: K, raw: unknown): StoredKinds[K] {
  return runMigrations(raw, kind, MIGRATIONS[kind]) as unknown as StoredKinds[K];
}

/** What to write to disk: the document, stamped with the current version first. */
export function store<K extends StoredKind>(kind: K, doc: StoredKinds[K]): Stored<K> {
  return { schemaVersion: currentVersion(kind), ...clone(doc) } as Stored<K>;
}
