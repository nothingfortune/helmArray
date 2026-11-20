import { describe, expect, it } from 'vitest';
import { own, withOwn } from './own';

describe('own', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not find %s on a record that has no such key',
    (key) => {
      expect(own({ a: 1 }, key)).toBeUndefined();
    },
  );

  it('finds a key the record has, even one named constructor', () => {
    expect(
      own(
        JSON.parse('{"constructor": 3, "__proto__": 4}') as Record<string, number>,
        'constructor',
      ),
    ).toBe(3);
  });

  it('finds an own __proto__ key', () => {
    expect(own(JSON.parse('{"__proto__": 4}') as Record<string, number>, '__proto__')).toBe(4);
  });
});

describe('withOwn', () => {
  it('returns a copy with the key set as an own property, __proto__ included', () => {
    const next = withOwn({ a: 1 }, '__proto__', 2);
    expect(Object.keys(next)).toEqual(['a', '__proto__']);
  });

  it('leaves the record it was given as it was', () => {
    const before = { a: 1 };
    withOwn(before, 'b', 2);
    expect(Object.keys(before)).toEqual(['a']);
  });

  it('replaces an existing key', () => {
    expect(withOwn({ a: 1, b: 2 }, 'a', 3)).toEqual({ a: 3, b: 2 });
  });
});
