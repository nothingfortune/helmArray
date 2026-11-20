import { describe, expect, it } from 'vitest';
import { FakeUnit, UnitError, UnitSession } from '@helmarray/azeron';
import { AZERON_OPEN_SENTENCE, gatedSession, isGateRefusal } from './gated-session';
import type { UnitOps } from './gated-session';

const OPERATIONS: [string, (s: UnitOps) => Promise<unknown>][] = [
  ['identify', (s) => s.identify()],
  ['readSlots', (s) => s.readSlots()],
  ['runningSlot', (s) => s.runningSlot()],
  ['write', (s) => s.write(1, 'Main', [], 49229)],
  ['switchTo', (s) => s.switchTo(2)],
  ['deleteSlot', (s) => s.deleteSlot(2)],
];

const gatedWith = (look: () => Promise<boolean>) => {
  const lines: string[] = [];
  const session = gatedSession(new UnitSession(new FakeUnit()), {
    look,
    trace: (line) => lines.push(line),
  });
  return { session, lines };
};

describe('what the gate traces when it refuses', () => {
  it.each(OPERATIONS)('%s, with the Azeron app open, by name', async (name, operation) => {
    const { session, lines } = gatedWith(() => Promise.resolve(true));
    await expect(operation(session)).rejects.toThrow(AZERON_OPEN_SENTENCE);
    expect(lines).toEqual([`${name} refused: the Azeron app is open`]);
  });

  it.each(OPERATIONS)('%s, with a look that failed, by name and cause', async (name, operation) => {
    const { session, lines } = gatedWith(() => Promise.reject(new Error('no process list')));
    await expect(operation(session)).rejects.toThrow(AZERON_OPEN_SENTENCE);
    expect(lines).toEqual([
      `${name} refused: couldn't tell whether the Azeron app is open (no process list)`,
      `${name} refused: the Azeron app is open`,
    ]);
  });
});

describe('what is the gate’s own refusal', () => {
  it.each<[string, unknown, boolean]>([
    ['the gate’s refusal', new UnitError('refused', AZERON_OPEN_SENTENCE), true],
    [
      'another kind of UnitError with its sentence',
      new UnitError('no-answer', AZERON_OPEN_SENTENCE),
      false,
    ],
    ['a refusal with another sentence', new UnitError('refused', 'Not that.'), false],
    ['an Error with its sentence', new Error(AZERON_OPEN_SENTENCE), false],
  ])('%s', (_, error, expected) => {
    expect(isGateRefusal(error)).toBe(expected);
  });
});
