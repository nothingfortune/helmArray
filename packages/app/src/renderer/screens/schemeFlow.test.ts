import { describe, expect, it, vi } from 'vitest';
import type { HelmApi } from '../../shared/api';
import { keysScheme, padScheme } from './editor-fixture';
import { runCopy, runDelete } from './schemeFlow';

describe('copying the setup open', () => {
  it('copies it, makes the copy the active one, and opens the copy', async () => {
    const copyScheme = vi.fn<HelmApi['copyScheme']>(() =>
      Promise.resolve({ ...keysScheme(), id: 'lite-copy-1' }),
    );
    const setActive = vi.fn<HelmApi['setActive']>(() => Promise.resolve());
    expect([
      await runCopy({ copyScheme, setActive }, 'lite', 'lite-main'),
      copyScheme.mock.calls,
      setActive.mock.calls,
    ]).toEqual([{ ok: true, schemeId: 'lite-copy-1' }, [['lite-main']], [['lite', 'lite-copy-1']]]);
  });

  it('says so in one sentence when it can’t, and sets nothing active', async () => {
    const setActive = vi.fn<HelmApi['setActive']>(() => Promise.resolve());
    const failed = await runCopy(
      { copyScheme: () => Promise.reject(new Error('Disk full.')), setActive },
      'lite',
      'lite-main',
    );
    expect([failed, setActive.mock.calls]).toEqual([
      { ok: false, message: "Couldn't copy this scheme. Disk full." },
      [],
    ]);
  });

  it('says the copy was made when only setting it active failed', async () => {
    expect(
      await runCopy(
        {
          copyScheme: () => Promise.resolve({ ...keysScheme(), id: 'c' }),
          setActive: () => Promise.reject(new Error('No.')),
        },
        'lite',
        'lite-main',
      ),
    ).toEqual({
      ok: false,
      message: "The copy was made, but couldn't be set as the current one. No.",
    });
  });
});

describe('deleting the setup open', () => {
  const api = (left: string[]) => ({
    deleteScheme: vi.fn<HelmApi['deleteScheme']>(() => Promise.resolve()),
    listSchemes: vi.fn<HelmApi['listSchemes']>(() =>
      Promise.resolve(left.map((id) => ({ ...padScheme(), id }))),
    ),
    setActive: vi.fn<HelmApi['setActive']>(() => Promise.resolve()),
  });

  it('opens the game’s next setup, as its active one', async () => {
    const a = api(['lite-desk']);
    expect([await runDelete(a, 'lite', 'lite-main'), a.setActive.mock.calls]).toEqual([
      { ok: true, next: 'lite-desk' },
      [['lite', 'lite-desk']],
    ]);
  });

  it('goes back to the Library when it was the game’s last one', async () => {
    const a = api([]);
    expect([await runDelete(a, 'lite', 'lite-main'), a.setActive.mock.calls]).toEqual([
      { ok: true, next: null },
      [],
    ]);
  });

  it('never opens the one just deleted, should the list still name it', async () => {
    expect(await runDelete(api(['lite-main']), 'lite', 'lite-main')).toEqual({
      ok: true,
      next: null,
    });
  });

  it('says so in one sentence when it can’t delete, and goes nowhere', async () => {
    const a = { ...api(['x']), deleteScheme: () => Promise.reject(new Error('Locked.')) };
    expect(await runDelete(a, 'lite', 'lite-main')).toEqual({
      ok: false,
      message: "Couldn't delete this scheme. Locked.",
    });
  });

  it('goes to the Library when the next one can’t be opened: it was deleted all the same', async () => {
    const a = { ...api(['x']), setActive: () => Promise.reject(new Error('No.')) };
    expect(await runDelete(a, 'lite', 'lite-main')).toEqual({ ok: true, next: null });
  });
});
