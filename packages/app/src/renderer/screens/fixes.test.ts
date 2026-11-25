// Each fix: the finding it answers is gone once it is applied, and nothing new is flagged.
import { describe, expect, it } from 'vitest';
import type { Finding, Game, Plan, Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  blankKeysScheme,
  gameKeysPreset,
  helldivers2,
  resolve,
  xboxControllerPreset,
} from '@helmarray/core';
import { assign, clear, shownAction } from './editor-model';
import { fixFor, putOnButton, takeOff } from './fixes';
import { game, keysScheme } from './editor-fixture';

const planOf = (scheme: Scheme, g: Game = helldivers2): Plan =>
  resolve(scheme, g, BUILT_IN_DEVICES);
const rulesOf = (plan: Plan) =>
  plan.findings.map((f) => `${f.rule} ${f.action ?? f.control ?? ''}`);

/** The finding of a rule (on a control or about an action), its fix, and the scheme it makes. */
function fixing(scheme: Scheme, rule: string, about?: string, g: Game = helldivers2) {
  const plan = planOf(scheme, g);
  const finding = plan.findings.find(
    (f) => f.rule === rule && (about === undefined || f.action === about || f.control === about),
  ) as Finding;
  const fix = fixFor(finding, scheme, g, plan);
  const after = fix === undefined ? scheme : fix.apply(scheme);
  return { finding, fix, after, before: rulesOf(plan), now: rulesOf(planOf(after, g)) };
}

/** The Xbox controller preset on Helldivers 2 with Fire taken off its button. */
const noFire = (): Scheme =>
  clear(xboxControllerPreset(helldivers2), { mode: 'default', control: 'L.index_2', press: 'tap' });

describe('missing-required: Put it on a button', () => {
  it('puts Fire back on the button the presets give it, and the finding goes', () => {
    const { fix, after, before, now } = fixing(noFire(), 'missing-required', 'fire_primary');
    expect({
      label: fix?.label,
      selects: fix?.reveal?.(noFire())?.control,
      on: shownAction(after, 'default', 'L.index_2')?.id,
      before,
      now,
    }).toEqual({
      label: 'Put it on a button',
      selects: 'L.index_2',
      on: 'fire_primary',
      before: ['missing-required fire_primary'],
      now: [],
    });
  });

  it('takes the first empty button in the rest order when its own is taken', () => {
    const scheme = assign(
      noFire(),
      { mode: 'default', control: 'L.index_2', press: 'tap' },
      'grenade',
      helldivers2,
    );
    const { fix, now } = fixing(scheme, 'missing-required', 'fire_primary');
    expect([fix?.reveal?.(scheme)?.control, now]).toEqual(['R.index_1', []]);
  });

  it('puts an action on a button with key output, sending its own key', () => {
    const scheme = clear(gameKeysPreset(helldivers2), {
      mode: 'default',
      control: 'L.middle_3',
      press: 'tap',
    });
    const { fix, after, now } = fixing(scheme, 'missing-required', 'stratagem');
    const sent = planOf(after).bindings.find((b) => b.action === 'stratagem');
    expect([fix?.reveal?.(scheme)?.control, sent?.signal, now]).toEqual([
      'L.middle_3',
      { kind: 'key', code: 'LCtrl' },
      [],
    ]);
  });

  it('finds the action’s own key on a keyboard-only setup', () => {
    const scheme: Scheme = {
      ...blankKeysScheme(helldivers2),
      devices: { azerons: 'none', keyboard: true, mouse: true, controller: false },
      map: { default: { 'key.W': { tap: 'move_forward' } } },
    };
    expect(putOnButton(scheme, helldivers2, 'default', 'move_back')?.control).toBe('key.S');
  });

  it('offers nothing when no button of the setup is empty', () => {
    const scheme: Scheme = {
      ...blankKeysScheme(helldivers2),
      devices: { azerons: 'none', keyboard: false, mouse: false, controller: true },
      map: {
        default: Object.fromEntries(
          BUILT_IN_DEVICES.flatMap((d) => d.controls)
            .filter((c) => c.id.startsWith('pad.') && c.sends !== undefined)
            .map((c) => [c.id, { tap: 'map' }]),
        ),
      },
    };
    const { fix } = fixing(scheme, 'missing-required', 'fire_primary');
    expect(fix).toBeUndefined();
  });
});

describe('stick-no-directions', () => {
  it('gives the left stick the movement keys, and the right one the mouse, with key output', () => {
    const blank = blankKeysScheme(helldivers2);
    const left = fixing(blank, 'stick-no-directions', 'L.stick');
    const right = fixing(left.after, 'stick-no-directions', 'R.stick');
    expect({
      labels: [left.fix?.label, right.fix?.label],
      now: right.now.filter((r) => r.startsWith('stick') || r.includes('move')),
    }).toEqual({ labels: ['Give it the movement keys', 'Use it as the mouse'], now: [] });
  });

  it('makes a stick sending no keys a controller stick, with controller output', () => {
    const scheme: Scheme = {
      ...xboxControllerPreset(helldivers2),
      behaviour: {
        ...xboxControllerPreset(helldivers2).behaviour,
        'L.stick': { stick: { mode: 'keys' } },
      },
    };
    const { fix, before, now } = fixing(scheme, 'stick-no-directions', 'L.stick');
    expect({
      label: fix?.label,
      before: before.includes('stick-no-directions L.stick'),
      now,
    }).toEqual({ label: 'Use as controller stick', before: true, now: [] });
  });

  it('keeps the stick’s tuning', () => {
    const blank: Scheme = {
      ...blankKeysScheme(helldivers2),
      behaviour: { 'L.stick': { stick: { mode: 'keys', deadzone: 9 } } },
    };
    const { after } = fixing(blank, 'stick-no-directions', 'L.stick');
    expect(after.behaviour['L.stick']?.stick).toMatchObject({ mode: 'keys', deadzone: 9 });
  });
});

describe('stick-not-keyboard and mixed-input', () => {
  const keysOnly: Game = { ...helldivers2, needsKeyStick: true };

  it('makes a stick send the movement keys for a game that needs it to', () => {
    const scheme = { ...gameKeysPreset(helldivers2), gameId: helldivers2.id };
    const pad: Scheme = {
      ...scheme,
      behaviour: { ...scheme.behaviour, 'L.stick': { stick: { mode: 'pad-left' } } },
    };
    const { fix, before, now } = fixing(pad, 'stick-not-keyboard', 'L.stick', keysOnly);
    expect({
      label: fix?.label,
      before: before.filter((r) => r.endsWith('L.stick')),
      now: now.filter((r) => r.endsWith('L.stick')),
    }).toEqual({
      label: 'Give it the movement keys',
      before: ['mixed-input L.stick', 'stick-not-keyboard L.stick'],
      now: [],
    });
  });

  it('offers no keys to a stick the game has none for', () => {
    const scheme = gameKeysPreset(helldivers2);
    const pad: Scheme = {
      ...scheme,
      behaviour: { ...scheme.behaviour, 'R.stick': { stick: { mode: 'pad-right' } } },
    };
    expect(fixing(pad, 'stick-not-keyboard', 'R.stick', keysOnly).fix).toBeUndefined();
  });

  it('makes an Xbox stick among buttons sending keys follow the buttons', () => {
    const scheme = gameKeysPreset(helldivers2);
    const pad: Scheme = {
      ...scheme,
      behaviour: { ...scheme.behaviour, 'L.stick': { stick: { mode: 'pad-left' } } },
    };
    const { fix, now } = fixing(pad, 'mixed-input', 'L.stick');
    expect([fix?.label, now]).toEqual(['Give it the movement keys', []]);
  });

  it('has no fix for a setup whose devices mix the two: which to drop is the player’s', () => {
    const scheme: Scheme = {
      ...xboxControllerPreset(helldivers2),
      devices: { azerons: 'both', keyboard: true, mouse: true, controller: false },
    };
    const plan = planOf(scheme);
    const mixed = plan.findings.find((f) => f.rule === 'mixed-input' && f.control === undefined);
    expect([mixed?.rule, fixFor(mixed as Finding, scheme, helldivers2, plan)]).toEqual([
      'mixed-input',
      undefined,
    ]);
  });
});

describe('action-deleted: Take it off the button', () => {
  it('takes the deleted action off, and only it', () => {
    const gone: Game = { ...game, actions: game.actions.filter((a) => a.id !== 'boost') };
    const scheme: Scheme = {
      ...keysScheme(),
      map: {
        ...keysScheme().map,
        ship: { ...keysScheme().map['ship'], 'L.index_1': { tap: 'boost', long: 'gear' } },
      },
    };
    const { fix, after, now } = fixing(scheme, 'action-deleted', 'L.index_1', gone);
    expect([
      fix?.label,
      after.map['ship']?.['L.index_1'],
      now.filter((r) => r.startsWith('action-deleted')),
    ]).toEqual(['Take it off the button', { long: 'gear' }, []]);
  });

  it('finds it in a mode the game no longer has, and leaves a scheme without it alone', () => {
    const scheme: Scheme = {
      ...keysScheme(),
      map: { ...keysScheme().map, old: { 'L.ring_1': { tap: 'x' } } },
    };
    const out = takeOff(scheme, 'L.ring_1', 'x');
    expect([out.map['old'], takeOff(out, 'L.ring_1', 'x') === out]).toEqual([{}, true]);
  });
});
