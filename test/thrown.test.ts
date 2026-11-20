import { describe, expect, it } from 'vitest';
import { thrown, thrownAsync } from './thrown';

describe('thrown', () => {
  it('hands back what was thrown', () => {
    const error = new RangeError('too far');
    expect(
      thrown(() => {
        throw error;
      }),
    ).toBe(error);
  });

  it('fails when nothing is thrown, so a test built on it cannot pass by not asserting', () => {
    // expect.unreachable throws an AssertionError that names the problem.
    expect(() => thrown(() => 1)).toThrow('expected the call to throw');
  });
});

describe('thrownAsync', () => {
  it('hands back the rejection reason', async () => {
    const error = new TypeError('refused');
    expect(await thrownAsync(() => Promise.reject(error))).toBe(error);
  });

  it('fails when the promise resolves', async () => {
    await expect(thrownAsync(() => Promise.resolve(1))).rejects.toThrow(
      'expected the call to reject',
    );
  });
});
