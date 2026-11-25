// The Editor's draw cost on a game the size M5 brings: 300 actions in three modes. The fix gate
// re-resolves a scheme for every finding, so the draw takes no offers (`offers` given, empty) and
// they are worked out after it, step by step (`offerSteps`). Generous bounds: a guard against a
// slide back to working them out in the draw, not a benchmark.
import { describe, expect, it } from 'vitest';
import type { Action, Game, PadControl, Role } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  blankKeysScheme,
  gameKeysPreset,
  resolve,
  xboxControllerPreset,
} from '@helmarray/core';
import { editorView, offerSteps } from './editor-view';

const ROLES: Role[] = ['combat', 'movement', 'ability', 'travel', 'menu'];
const PADS: PadControl[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START'];
const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'.split('');
const MODES = ['ship', 'srv', 'foot'];

/** 300 actions, a third in each mode, every fourth required, some on a controller button. */
const big: Game = {
  id: 'big',
  name: 'Big',
  modes: MODES.map((id) => ({ id, name: id })),
  actions: Array.from({ length: 300 }, (_, i): Action => ({
    id: `a${i}`,
    name: `Action ${i}`,
    mode: MODES[i % 3] ?? 'ship',
    role: ROLES[i % 5] ?? 'combat',
    required: i % 4 === 0,
    native: {
      key: { kind: 'key', code: KEYS[Math.floor(i / 3) % KEYS.length] as 'A' },
      ...(i % 7 === 0 ? { pad: PADS[i % PADS.length] } : {}),
    },
  })),
};

const SCHEMES = [
  ['blank keys', blankKeysScheme(big)],
  ['game’s own keys', gameKeysPreset(big)],
  ['Xbox controller', xboxControllerPreset(big)],
] as const;

/** The fastest of a few runs, in ms: what the code costs, not what the machine was doing. */
function fastest(run: () => void, times = 3): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times; i++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe.each(SCHEMES)('a 300-action, three-mode game, %s', (_name, scheme) => {
  const plan = resolve(scheme, big, BUILT_IN_DEVICES);

  it('draws in well under 100 ms with the offers left for later', () => {
    const ms = fastest(() =>
      editorView({ scheme, game: big, plan, mode: 'ship', offers: new Map() }),
    );
    expect(ms).toBeLessThan(100);
  });

  it('works out an offer for every finding still asking, one step at a time', () => {
    const view = editorView({ scheme, game: big, plan, mode: 'ship', offers: new Map() });
    const keys = [...offerSteps(view, scheme, big, plan)].map(([key]) => key);
    expect(view.findings.every((row) => keys.includes(row.key))).toBe(true);
  });
});
