import { describe, expect, it } from 'vitest';
import { tabKeyTarget } from './mode-tabs';

describe('the mode tabs’ keys', () => {
  it.each([
    ['ArrowRight', 0, 1],
    ['ArrowRight', 1, 2],
    ['ArrowLeft', 2, 1],
    ['ArrowLeft', 1, 0],
    ['Home', 2, 0],
    ['Home', 0, 0],
    ['End', 0, 2],
    ['End', 2, 2],
  ] as const)('%s from tab %i of three goes to tab %i', (key, from, to) => {
    expect(tabKeyTarget(key, from, 3)).toBe(to);
  });

  it('go round: right from the last is the first, left from the first is the last', () => {
    expect([tabKeyTarget('ArrowRight', 13, 14), tabKeyTarget('ArrowLeft', 0, 14)]).toEqual([0, 13]);
  });

  it.each(['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' ', 'a', 'PageDown'])(
    '%j is not the tabs’: the key does what it does anywhere',
    (key) => {
      expect(tabKeyTarget(key, 1, 3)).toBeNull();
    },
  );

  it('with no tabs, nothing to go to', () => {
    expect(['ArrowRight', 'ArrowLeft', 'Home', 'End'].map((k) => tabKeyTarget(k, 0, 0))).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('from a tab not among them, right goes to the first and left to the last', () => {
    expect([tabKeyTarget('ArrowRight', -1, 4), tabKeyTarget('ArrowLeft', -1, 4)]).toEqual([0, 3]);
  });
});
