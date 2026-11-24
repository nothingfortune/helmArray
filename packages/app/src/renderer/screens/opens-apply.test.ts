// J1: a scheme just made from a preset opens the Apply drawer when it has nothing to fix (the
// owner's decision, 2026-11-24), else the Editor, to fix it.
import { describe, expect, it } from 'vitest';
import type { Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  blankKeysScheme,
  gameKeysPreset,
  helldivers2,
  resolve,
  xboxControllerPreset,
} from '@helmarray/core';
import { acceptFinding, setLatch } from './editor-model';
import { editorView, opensApply } from './editor-view';

const opens = (scheme: Scheme) =>
  opensApply(
    editorView({
      scheme,
      game: helldivers2,
      plan: resolve(scheme, helldivers2, BUILT_IN_DEVICES),
      mode: 'default',
    }),
  );

describe('opensApply', () => {
  it('opens the drawer on either preset, made on Helldivers 2', () => {
    expect([opens(xboxControllerPreset(helldivers2)), opens(gameKeysPreset(helldivers2))]).toEqual([
      true,
      true,
    ]);
  });

  it('keeps the Editor for a scheme with an error, or only a warning', () => {
    // Hold to latch on Sprint's button: a warning, and nothing else.
    const latched = setLatch(xboxControllerPreset(helldivers2), 'L.stick_press', true);
    expect([opens(blankKeysScheme(helldivers2)), opens(latched)]).toEqual([false, false]);
  });

  it('counts a finding the player kept as settled', () => {
    const latched = setLatch(xboxControllerPreset(helldivers2), 'L.stick_press', true);
    const plan = resolve(latched, helldivers2, BUILT_IN_DEVICES);
    const kept = plan.findings.reduce((s, f) => acceptFinding(s, f), latched);
    expect(opens(kept)).toBe(true);
  });
});
