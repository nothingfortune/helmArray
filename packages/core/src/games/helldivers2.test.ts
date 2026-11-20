import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '../devices/index';
import { isKeyCode } from '../keys';
import type { Role, Signal, StickDirections } from '../model';
import type { Plan } from '../plan';
import { xboxControllerPreset } from '../presets/xbox';
import { gameKeysPreset } from '../presets/keys';
import { resolve } from '../resolve';
import { helldivers2 } from './helldivers2';

const ROLES: readonly Role[] = ['combat', 'movement', 'ability', 'travel', 'menu'];

describe('the Helldivers 2 definition', () => {
  const ids = helldivers2.actions.map((a) => a.id);
  const modeIds = helldivers2.modes.map((m) => m.id);

  it('is Helldivers 2 on Steam, with one mode, "default"', () => {
    expect(helldivers2.steamAppId).toBe(553850);
    expect(modeIds).toEqual(['default']);
  });

  it('has unique action ids and names', () => {
    expect(new Set(ids).size).toBe(ids.length);
    const names = helldivers2.actions.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('puts every action in a mode that exists, with a valid role', () => {
    for (const a of helldivers2.actions) {
      expect(modeIds, a.id).toContain(a.mode);
      expect(ROLES, a.id).toContain(a.role);
    }
  });

  it('names only real keys, and no key twice', () => {
    const seen = new Map<string, string>();
    for (const a of helldivers2.actions) {
      const signal: Signal | undefined = a.native?.key;
      if (!signal) continue;
      if (signal.kind === 'key') expect(isKeyCode(signal.code), a.id).toBe(true);
      const id =
        signal.kind === 'key'
          ? signal.code
          : `mouse:${signal.kind === 'mouse' ? signal.button : ''}`;
      expect(seen.get(id), `${a.id} and ${seen.get(id)} share ${id}`).toBeUndefined();
      seen.set(id, a.id);
    }
  });

  it('requires only what cannot be played without: moving, firing and calling stratagems', () => {
    expect(helldivers2.actions.filter((a) => a.required).map((a) => a.id)).toEqual([
      'move_forward',
      'move_back',
      'strafe_left',
      'strafe_right',
      'fire_primary',
      'stratagem',
    ]);
  });

  it('claims no Xbox default: none is stated by any source, and the owner confirms them', () => {
    for (const a of helldivers2.actions) expect(a.native?.pad, a.id).toBeUndefined();
  });
});

describe('Helldivers 2 through the presets and the resolver', () => {
  it('resolves the Xbox controller preset; the only errors are the required actions with no pad default', () => {
    const plan = resolve(xboxControllerPreset(helldivers2), helldivers2, BUILT_IN_DEVICES);
    const errors = plan.findings.filter((f) => f.severity === 'error');
    // With no pad default known, no action lands on a button, so each required one is reported.
    expect(errors.every((f) => f.rule === 'missing-required')).toBe(true);
    expect(errors.map((f) => f.action)).toEqual([
      'move_forward',
      'move_back',
      'strafe_left',
      'strafe_right',
      'fire_primary',
      'stratagem',
    ]);
    expect(plan.units.left.stick.mode).toBe('pad-left');
    expect(plan.units.right.stick.mode).toBe('pad-right');
  });

  it("resolves a scheme on the game's own keys, sending each action's own key", () => {
    const scheme = gameKeysPreset(helldivers2);
    scheme.map['default'] = { 'L.index_1': { tap: 'sprint' }, 'L.index_2': { tap: 'dive' } };
    const plan = resolve(scheme, helldivers2, BUILT_IN_DEVICES);
    expect(plan.bindings.map((b) => [b.action, b.signal])).toEqual([
      ['sprint', { kind: 'key', code: 'LShift' }],
      ['dive', { kind: 'key', code: 'LAlt' }],
    ]);
    expect(plan.findings.filter((f) => f.rule === 'key-collision')).toEqual([]);
  });

  describe('with a key stick sending W, A, S and D', () => {
    const directions = {
      up: { kind: 'key', code: 'W' },
      down: { kind: 'key', code: 'S' },
      left: { kind: 'key', code: 'A' },
      right: { kind: 'key', code: 'D' },
    } satisfies StickDirections;
    const play = (stick: StickDirections) => {
      const scheme = gameKeysPreset(helldivers2);
      scheme.map['default'] = {
        'L.index_1': { tap: 'fire_primary' },
        'L.index_2': { tap: 'stratagem' },
      };
      scheme.behaviour['L.stick'] = { stick: { mode: 'keys', directions: stick } };
      return resolve(scheme, helldivers2, BUILT_IN_DEVICES);
    };
    const missing = (plan: Plan) =>
      plan.findings.filter((f) => f.rule === 'missing-required').map((f) => f.action);

    it('counts movement as reachable: the stick sends the keys the game ships it on', () => {
      expect(missing(play(directions))).toEqual([]);
    });

    it('still reports a movement action no direction sends', () => {
      const three: StickDirections = {
        up: directions.up,
        down: directions.down,
        left: directions.left,
      };
      expect(missing(play(three))).toEqual(['strafe_right']);
    });
  });
});
