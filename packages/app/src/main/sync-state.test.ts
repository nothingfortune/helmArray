import type { Verdict } from '@helmarray/azeron';
import { describe, expect, it } from 'vitest';
import type { Plan, Press, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, helldivers2, resolve, xboxControllerPreset } from '@helmarray/core';
import { pendingChanges, syncDetail, syncState, type HandSync } from './sync-state';

const clean: Verdict = { differences: [], unchecked: [] };
const differing: Verdict = {
  differences: [{ id: 3, what: 'tap keys', meant: '[4]', stored: '[5]' }],
  unchecked: [],
};
const unreadable: Verdict = { differences: [], unchecked: [{ id: 9, raw: new Uint8Array([1]) }] };

const matching: HandSync = { connected: true, verdict: clean };
const away: HandSync = { connected: false, verdict: null };
const unread: HandSync = { connected: true, verdict: null };
const wrong: HandSync = { connected: true, verdict: differing };

describe('syncState, for a unit the setup does not use', () => {
  const unused = (sync: HandSync): HandSync => ({ ...sync, used: false });

  it('does not judge what it holds, however it differs', () => {
    expect(syncState({ left: matching, right: unused(wrong), pendingChanges: 0 }).kind).toBe(
      'in-sync',
    );
  });

  it('does not ask for it to be connected or read', () => {
    expect([
      syncState({ left: matching, right: unused(away), pendingChanges: 0 }).kind,
      syncState({ left: matching, right: unused(unread), pendingChanges: 0 }).kind,
    ]).toEqual(['in-sync', 'in-sync']);
  });

  it('still judges the unit the setup does use', () => {
    expect(syncState({ left: away, right: unused(matching), pendingChanges: 0 }).label).toBe(
      'Left unit not connected',
    );
  });
});

describe('syncState', () => {
  it('is in sync only when both units are connected, read, matching and nothing is pending', () => {
    expect(syncState({ left: matching, right: matching, pendingChanges: 0 })).toEqual({
      kind: 'in-sync',
      label: 'In sync',
      tone: 'ok',
    });
  });

  it('says how many changes are not applied, in the singular for one', () => {
    const one = syncState({ left: matching, right: matching, pendingChanges: 1 });
    expect(one).toMatchObject({ kind: 'not-applied', count: 1, label: '1 change not applied' });
    expect(one.tone).toBe('warning');
    const many = syncState({ left: matching, right: matching, pendingChanges: 12 });
    expect(many).toMatchObject({ count: 12, label: '12 changes not applied', tone: 'warning' });
  });

  it('names the one unit that differs', () => {
    expect(syncState({ left: matching, right: wrong, pendingChanges: 0 })).toEqual({
      kind: 'differs',
      hands: ['right'],
      label: 'Right unit differs',
      tone: 'error',
    });
    expect(syncState({ left: wrong, right: matching, pendingChanges: 0 })).toMatchObject({
      hands: ['left'],
      label: 'Left unit differs',
    });
  });

  it('says the units differ when both do', () => {
    expect(syncState({ left: wrong, right: wrong, pendingChanges: 0 })).toMatchObject({
      kind: 'differs',
      hands: ['left', 'right'],
      label: 'Units differ',
      tone: 'error',
    });
  });

  it('counts a record that could not be read back as a difference, never as in sync', () => {
    const state = syncState({
      left: matching,
      right: { connected: true, verdict: unreadable },
      pendingChanges: 0,
    });
    expect(state).toMatchObject({ kind: 'differs', hands: ['right'] });
  });

  it('puts a unit that differs above pending changes', () => {
    expect(syncState({ left: wrong, right: matching, pendingChanges: 4 })).toMatchObject({
      kind: 'differs',
      label: 'Left unit differs',
    });
  });

  it('puts pending changes above a unit that is away or unread', () => {
    expect(syncState({ left: matching, right: away, pendingChanges: 2 })).toMatchObject({
      kind: 'not-applied',
      count: 2,
    });
    expect(syncState({ left: unread, right: unread, pendingChanges: 2 })).toMatchObject({
      kind: 'not-applied',
    });
  });

  it('never says in sync about a unit that is not connected', () => {
    expect(syncState({ left: matching, right: away, pendingChanges: 0 })).toEqual({
      kind: 'unknown',
      reason: 'not-connected',
      hands: ['right'],
      label: 'Right unit not connected',
      tone: 'warning',
    });
    expect(syncState({ left: away, right: away, pendingChanges: 0 })).toMatchObject({
      reason: 'not-connected',
      hands: ['left', 'right'],
      label: 'Units not connected',
    });
  });

  it('ignores what a disconnected unit last held, which is stale', () => {
    const stale: HandSync = { connected: false, verdict: differing };
    expect(syncState({ left: matching, right: stale, pendingChanges: 0 })).toMatchObject({
      kind: 'unknown',
      reason: 'not-connected',
    });
  });

  it('is unknown, not in sync, while a unit is unread or nothing was applied', () => {
    expect(syncState({ left: matching, right: unread, pendingChanges: 0 })).toEqual({
      kind: 'unknown',
      reason: 'not-read',
      hands: ['right'],
      label: 'Not checked yet',
      tone: 'plain',
    });
  });

  it('says a disconnected unit before an unread one', () => {
    expect(syncState({ left: unread, right: away, pendingChanges: 0 })).toMatchObject({
      reason: 'not-connected',
    });
  });

  it.each([-3, Number.NaN, 0.4])('treats %s pending changes as none', (pendingChanges) => {
    expect(syncState({ left: matching, right: matching, pendingChanges }).kind).toBe('in-sync');
  });
});

describe('syncState with nothing applied', () => {
  it('says nothing has been applied, when both units are there and nothing is pending', () => {
    expect(
      syncState({ left: unread, right: unread, pendingChanges: 0, nothingApplied: true }),
    ).toEqual({
      kind: 'unknown',
      reason: 'nothing-applied',
      hands: ['left', 'right'],
      label: 'Nothing applied yet',
      tone: 'warning',
    });
  });

  it('puts a unit that is not connected, and edits waiting, before it', () => {
    expect(
      syncState({ left: unread, right: away, pendingChanges: 0, nothingApplied: true }).label,
    ).toBe('Right unit not connected');
    expect(
      syncState({ left: unread, right: unread, pendingChanges: 4, nothingApplied: true }).label,
    ).toBe('4 changes not applied');
  });
});

describe('syncDetail', () => {
  it('says which unit and how many inputs, counting an input once', () => {
    const both: Verdict = {
      differences: [
        { id: 3, what: 'tap keys', meant: '[4]', stored: '[5]' },
        { id: 3, what: 'turbo', meant: '0', stored: '1' },
      ],
      unchecked: [{ id: 9, raw: new Uint8Array([1]) }],
    };
    expect(
      syncDetail({
        left: matching,
        right: { connected: true, verdict: both },
        pendingChanges: 0,
      }),
    ).toBe('Right unit: 2 buttons not as applied.');
    expect(syncDetail({ left: wrong, right: matching, pendingChanges: 0 })).toBe(
      'Left unit: 1 button not as applied.',
    );
  });

  it('has nothing to say when no unit differs, or the one that does is not connected', () => {
    expect(syncDetail({ left: matching, right: matching, pendingChanges: 3 })).toBeUndefined();
    expect(
      syncDetail({
        left: matching,
        right: { connected: false, verdict: differing },
        pendingChanges: 0,
      }),
    ).toBeUndefined();
  });
});

describe('syncState while the Azeron app is open', () => {
  it('says the Azeron app is open, not that the units are away', () => {
    expect(syncState({ left: away, right: away, pendingChanges: 0, azeronOpen: true })).toEqual({
      kind: 'paused',
      label: 'Azeron app is open',
      tone: 'warning',
    });
  });

  it('says the Azeron app is open over changes not applied: they wait for it to close', () => {
    expect(
      syncState({ left: unread, right: unread, pendingChanges: 3, azeronOpen: true }).label,
    ).toBe('Azeron app is open');
  });

  it('still says a unit differs first', () => {
    expect(
      syncState({ left: wrong, right: matching, pendingChanges: 0, azeronOpen: true }).kind,
    ).toBe('differs');
  });
});

describe('syncState, before anything is read', () => {
  it('says Not checked yet in a plain tone: there is nothing to act on', () => {
    expect(syncState({ left: unread, right: unread, pendingChanges: 0 })).toMatchObject({
      label: 'Not checked yet',
      tone: 'plain',
    });
  });
});

describe('pendingChanges', () => {
  it('counts one change for a scheme that did not resolve', () => {
    expect(pendingChanges(null, null)).toBe(1);
  });
});

// The count is of the buttons the person edited: a drag is one change, wherever the action came
// from. A device that only takes the game's own bindings changes nothing anywhere, and counts
// nothing.
describe('pendingChanges, counting edits', () => {
  const game = helldivers2;
  const preset = xboxControllerPreset(game);
  const planOf = (scheme: Scheme): Plan => resolve(scheme, game, BUILT_IN_DEVICES);
  const applied = planOf(preset);
  const mode = game.modes[0]?.id ?? '';
  const withMap = (
    scheme: Scheme,
    edit: (map: Record<string, Partial<Record<Press, string>>>) => void,
  ): Scheme => {
    const map = structuredClone(scheme.map[mode] ?? {});
    edit(map);
    return { ...scheme, map: { ...scheme.map, [mode]: map } };
  };
  /** Reload off the left middle 1, which then sends nothing, as the editor's `clear` does. */
  const reloadOff = (scheme: Scheme): Scheme => {
    const out = withMap(scheme, (map) => delete map['L.middle_1']);
    const padMap = { ...out.padMap };
    delete padMap['L.middle_1'];
    return { ...out, padMap };
  };

  it('counts nothing for the scheme as it was applied', () => {
    expect(pendingChanges(applied, planOf(preset))).toBe(0);
  });

  it('counts an action dragged from the list onto an empty button once', () => {
    const next = withMap(preset, (map) => (map['L.middle_2'] = { tap: 'jump' }));
    expect(pendingChanges(applied, planOf(next))).toBe(1);
  });

  it('counts an action moved from one button to another once, not once per button', () => {
    const next = withMap(reloadOff(preset), (map) => (map['L.middle_2'] = { tap: 'reload' }));
    expect(pendingChanges(applied, planOf(next))).toBe(1);
  });

  it('counts an action dropped on a taken button once: the action it pushed off goes with it', () => {
    const next = withMap(preset, (map) => (map['L.middle_1'] = { tap: 'jump' }));
    expect(pendingChanges(applied, planOf(next))).toBe(1);
  });

  it('counts an action taken off a button once', () => {
    expect(pendingChanges(applied, planOf(reloadOff(preset)))).toBe(1);
  });

  it('counts turbo turned on for a button once', () => {
    const next: Scheme = {
      ...preset,
      behaviour: { ...preset.behaviour, 'L.middle_1': { turbo: { interval: 20 } } },
    };
    expect(pendingChanges(applied, planOf(next))).toBe(1);
  });

  it('counts a button with no action that stops sending its Xbox control once', () => {
    const padMap = { ...preset.padMap };
    delete padMap['L.middle_2'];
    expect(pendingChanges(applied, planOf({ ...preset, padMap }))).toBe(1);
  });

  /** The keyboard and mouse added, each action on the key or mouse button the game ships it on. */
  const withKeyboard = (scheme: Scheme): Scheme =>
    withMap({ ...scheme, devices: { ...scheme.devices, keyboard: true, mouse: true } }, (map) => {
      for (const action of game.actions) {
        const key = action.native?.key;
        if (key?.kind === 'key') map[`key.${key.code}`] = { tap: action.id };
        if (key?.kind === 'mouse') map[`mouse.${key.button}`] = { tap: action.id };
      }
    });

  it("counts nothing for the keyboard added with the game's own keys on it", () => {
    expect(pendingChanges(applied, planOf(withKeyboard(preset)))).toBe(0);
  });

  it('counts an action put on a key the game does not ship it on', () => {
    const next = withMap(withKeyboard(preset), (map) => {
      delete map['key.Space'];
      map['key.J'] = { tap: 'jump' };
    });
    expect(pendingChanges(applied, planOf(next))).toBe(1);
  });

  it("counts the right unit's actions, not its buttons, when the setup drops it", () => {
    // Melee and Menu were on the right unit; it is no longer written, and the game loses them.
    const left = withMap(
      { ...preset, devices: { ...preset.devices, azerons: 'left', mouse: true } },
      (map) => {
        delete map['R.stick_press'];
        delete map['R.thumb_aux_upper'];
      },
    );
    expect(pendingChanges(applied, planOf(left))).toBe(2);
  });

  it('with nothing applied, counts each action on a button, and no empty button', () => {
    // The preset's left middle 2 sends Xbox Y with no action on it: nothing the person put there.
    const keys: Scheme = { ...preset, output: 'keys', padMap: {} };
    expect([pendingChanges(null, applied), pendingChanges(null, planOf(keys))]).toEqual([15, 15]);
  });
});
