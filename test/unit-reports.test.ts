// The report layer against every report in reference/: what the Azeron app sent must be
// rebuilt byte for byte (or refused, when helmArray never sends that command), and everything
// a unit sent must parse.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommandName } from '@helmarray/azeron';
import {
  Command,
  ProtocolError,
  SENDABLE,
  fromHex,
  hostReports,
  parseUnitReport,
  toHex,
} from '@helmarray/azeron';

const ref = (path: string) => new URL(`../reference/${path}`, import.meta.url);
const json = (path: string): unknown => JSON.parse(readFileSync(ref(path), 'utf8'));

/** Every hex report string anywhere in a JSON fixture, by the key path it sits under. */
function reportsIn(value: unknown, path = ''): { path: string; hex: string }[] {
  if (typeof value === 'string') {
    return /^[0-9a-f]{128}$/.test(value) ? [{ path, hex: value }] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => reportsIn(v, `${path}[${i}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => reportsIn(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/** The capture logs' reports on the configuration endpoints, in order. */
function captured(direction: 'out' | 'in'): { file: string; hex: string }[] {
  const dir = ref('captures/');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .flatMap((file) =>
      readFileSync(new URL(file, dir), 'utf8')
        .split('\n')
        .filter((line) => line.includes(`interrupt-${direction}`) && line.includes('64 B'))
        .map((line) => ({ file, hex: (line.split('64 B')[1] ?? '').replace(/\s+/g, '') })),
    );
}

const NAMES = new Map<number, CommandName>(
  Object.entries(Command).map(([name, code]) => [code, name as CommandName]),
);

/** Host reports grouped into commands: a multi-part payload is its parts in order. */
function commands(hexes: readonly string[]) {
  const out: { name: CommandName | undefined; code: number; seq: number; reports: string[] }[] = [];
  for (const hex of hexes) {
    const bytes = fromHex(hex);
    const [, , code = 0, seq = 0, , part = 1] = bytes;
    const last = out.at(-1);
    if (part > 1 && last && last.code === code && last.reports.length === part - 1) {
      last.reports.push(hex);
    } else {
      out.push({ name: NAMES.get(code), code, seq, reports: [hex] });
    }
  }
  return out;
}

const payloadOf = (reports: readonly string[]) => {
  const chunks = reports.map((hex) => {
    const bytes = fromHex(hex);
    return bytes.slice(7, 7 + (bytes[6] ?? 0));
  });
  return Uint8Array.from(chunks.flatMap((c) => [...c]));
};

const FIXTURES = [
  'unit-protocol/write-slot3.json',
  'unit-protocol/write-112.json',
  'unit-protocol/session2.json',
];

describe('what the Azeron app sent', () => {
  const fromFixtures = FIXTURES.flatMap((f) =>
    reportsIn(json(f))
      .filter((r) => r.hex.startsWith('00') && !r.path.includes('.unit'))
      .map((r) => r.hex),
  );
  const fromCaptures = captured('out')
    .map((r) => r.hex)
    .filter((hex) => hex.startsWith('00'));
  const all = commands([...fromFixtures, ...fromCaptures]);
  const sendable = all.filter((c) => c.name !== undefined && SENDABLE.includes(c.name));
  const refused = all.filter((c) => c.name === undefined || !SENDABLE.includes(c.name));

  it('is a good sample: hundreds of reports, every command helmArray sends among them', () => {
    expect(sendable.length).toBeGreaterThan(300);
    const seen = new Set(sendable.map((c) => c.name));
    for (const name of [
      'OBM_COPY',
      'PROFILE_NAME',
      'CHECK_PROFILE',
      'SWITCH_PROFILE',
      'DELETE_PROFILE',
      'PROFILE_INPUT_PIECE',
      'HARDWARE_PROFILE_INDEX',
    ] as const) {
      expect(seen, name).toContain(name);
    }
  });

  it('is rebuilt byte for byte for every command helmArray sends', () => {
    for (const c of sendable) {
      const built = hostReports(c.name as CommandName, c.seq, payloadOf(c.reports)).map(toHex);
      expect(built).toEqual(c.reports);
    }
  });

  it('is refused for every other command it sent', () => {
    expect(refused.length).toBeGreaterThan(0);
    for (const c of refused) {
      if (c.name === undefined) continue; // a command byte the table doesn't name can't be asked for
      expect(() => hostReports(c.name as CommandName, c.seq, payloadOf(c.reports))).toThrow(
        ProtocolError,
      );
    }
  });
});

describe('what the units sent', () => {
  const fromFixtures = [
    'unit-protocol/handshake.json',
    'unit-protocol/read-all.json',
    'unit-protocol/read-slot3.json',
    'unit-protocol/session2.json',
  ].flatMap((f) => reportsIn(json(f)).filter((r) => !r.path.includes('.host')));
  const fromCaptures = captured('in');

  it('all parses, with each part inside its report', () => {
    const all = [...fromFixtures, ...fromCaptures];
    expect(all.length).toBeGreaterThan(500);
    for (const { hex } of all) {
      const report = parseUnitReport(fromHex(hex));
      expect(report.payload.length).toBe(fromHex(hex)[6]);
    }
  });

  it('reads the handshake the way the app did', () => {
    const fw = parseUnitReport(
      fromHex((json('unit-protocol/handshake.json') as { '05': string })['05']),
    );
    expect(fw.command).toBe(Command.FIRMWARE_VERSION);
    expect(fw.payload[0]).toBe(111);
    expect(fw.payload[1]).toBe(8);
    const limit = parseUnitReport(
      fromHex((json('unit-protocol/handshake.json') as { '1f': string })['1f']),
    );
    expect(limit.payload[0]).toBe(6);
  });
});
