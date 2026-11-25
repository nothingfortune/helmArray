import { describe, expect, it } from 'vitest';
import type { Game, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, blankKeysScheme, resolve } from '@helmarray/core';
import { planFor } from './scheme-plan';

const game: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [{ id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true }],
  file: { format: 'elite-binds' },
};
const scheme: Scheme = blankKeysScheme(game);

describe('a scheme worked out into its plan', () => {
  it('resolves the scheme against its game and the built-in devices', async () => {
    const result = await planFor(scheme.id, {
      getScheme: () => Promise.resolve(scheme),
      getGame: () => Promise.resolve(game),
    });
    expect(result).toEqual({
      ok: true,
      scheme,
      game,
      plan: resolve(scheme, game, BUILT_IN_DEVICES),
    });
  });

  it('says, in a sentence, when there is no scheme, no game, or the store fails', async () => {
    const got = { getScheme: () => Promise.resolve(scheme), getGame: () => Promise.resolve(game) };
    expect(await planFor('x', { ...got, getScheme: () => Promise.resolve(null) })).toEqual({
      ok: false,
      reason: 'There is no such scheme.',
    });
    expect(await planFor('x', { ...got, getGame: () => Promise.resolve(undefined) })).toEqual({
      ok: false,
      reason: "This scheme's game isn't one helmArray knows.",
    });
    expect(
      await planFor('x', { ...got, getScheme: () => Promise.reject(new Error('disk')) }),
    ).toEqual({ ok: false, reason: "The scheme couldn't be read: disk" });
  });

  it('says so when the scheme cannot be resolved', async () => {
    const broken = { ...scheme, map: null } as unknown as Scheme;
    const result = await planFor('x', {
      getScheme: () => Promise.resolve(broken),
      getGame: () => Promise.resolve(game),
    });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/^This scheme can't be worked out: /),
    });
  });
});
