// A scheme made before its game had a file format, once a read gives it one (`writingFile`): it
// writes the game's file from then on, and still sends what it sends now.

import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '../devices/index';
import type { Game, Scheme } from '../model';
import { resolve } from '../resolve';
import { writingFile } from './file';
import { gameKeysPreset } from './keys';
import { xboxControllerPreset } from './xbox';

const typed: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    {
      id: 'boost',
      name: 'Boost',
      mode: 'ship',
      role: 'movement',
      required: true,
      native: { key: { kind: 'key', code: 'Tab' }, pad: 'A' },
    },
    {
      id: 'map',
      name: 'Galaxy map',
      mode: 'ship',
      role: 'menu',
      required: false,
      native: { key: { kind: 'key', code: 'M' }, pad: 'Y' },
    },
    // No key of its own: the pool deals it one.
    { id: 'wave', name: 'Wave', mode: 'ship', required: false },
  ],
};
const read: Game = { ...typed, file: { format: 'unreal-ini' } };

/** What each unit button sends, by control. */
const pins = (scheme: Scheme, game: Game) => {
  const plan = resolve(scheme, game, BUILT_IN_DEVICES);
  return [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])].flatMap((p) =>
    p.presses.tap === undefined ? [] : [[p.control, p.presses.tap]],
  );
};

/** The first button the scheme puts an action on. */
const carrying = (scheme: Scheme): string => {
  const control = Object.keys(scheme.map['ship'] ?? {})[0];
  if (control === undefined) throw new Error('The preset placed nothing.');
  return control;
};

describe('a scheme made before the read, once its game has a file format', () => {
  it('writes the file from then on', () => {
    const before = gameKeysPreset(typed);
    expect([
      before.writeGameFile,
      writingFile(before, read, BUILT_IN_DEVICES).writeGameFile,
    ]).toEqual([false, true]);
  });

  it('still sends what it sends now: the game’s own keys, and what the pool dealt', () => {
    const before = gameKeysPreset(typed);
    expect(pins(writingFile(before, read, BUILT_IN_DEVICES), read)).toEqual(pins(before, read));
  });

  it('would deal other keys with the file written and nothing kept: why its keys go in the ledger', () => {
    const before = gameKeysPreset(typed);
    expect(pins({ ...before, writeGameFile: true }, read)).not.toEqual(pins(before, read));
  });

  it('keeps every key it was given already, and adds what it deals now', () => {
    const before = gameKeysPreset(typed);
    const control = carrying(before);
    const given = {
      ...before,
      ledger: { [control]: { tap: { kind: 'key' as const, code: 'J' as const } } },
    };
    const after = writingFile(given, read, BUILT_IN_DEVICES);
    expect([after.ledger, after.ledger[control]]).toEqual([
      resolve(given, read, BUILT_IN_DEVICES).ledger,
      { tap: { kind: 'key', code: 'J' } },
    ]);
  });

  it('changes nothing else of the scheme', () => {
    const before = gameKeysPreset(typed);
    const after = writingFile(before, read, BUILT_IN_DEVICES);
    expect({ ...after, writeGameFile: false, ledger: before.ledger }).toEqual(before);
  });

  it('turns on the file for controller output, its ledger as it was', () => {
    const before = xboxControllerPreset(typed);
    const after = writingFile(before, read, BUILT_IN_DEVICES);
    expect([after.writeGameFile, after.ledger, pins(after, read)]).toEqual([
      true,
      before.ledger,
      pins(before, read),
    ]);
  });

  it('is the scheme itself when it writes the file already, or the game still has no format', () => {
    const writes = gameKeysPreset(read);
    const before = gameKeysPreset(typed);
    expect([
      writingFile(writes, read, BUILT_IN_DEVICES) === writes,
      writingFile(before, typed, BUILT_IN_DEVICES) === before,
    ]).toEqual([true, true]);
  });

  it('never changes the scheme it is given', () => {
    const before = gameKeysPreset(typed);
    const copy = JSON.parse(JSON.stringify(before)) as Scheme;
    writingFile(before, read, BUILT_IN_DEVICES);
    expect(before).toEqual(copy);
  });

  it('then says so of a key the file has no name for: the ledger keeps it, so it is to be moved', () => {
    const preset = gameKeysPreset(typed);
    const control = carrying(preset);
    const before = {
      ...preset,
      ledger: { [control]: { tap: { kind: 'key' as const, code: 'F13' as const } } },
    };
    const plan = resolve(writingFile(before, read, BUILT_IN_DEVICES), read, BUILT_IN_DEVICES);
    expect(plan.findings.filter((f) => f.rule === 'key-unnamable').map((f) => f.control)).toEqual([
      control,
    ]);
  });
});
