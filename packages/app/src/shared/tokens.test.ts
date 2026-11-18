import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { color, motion, tokensCss } from './tokens';

describe('tokens', () => {
  it('tokens.css is the file written from tokens.ts', () => {
    const css = readFileSync(new URL('../renderer/styles/tokens.css', import.meta.url), 'utf8');
    // On failure: run `pnpm tokens` and commit the result.
    expect(css).toBe(tokensCss());
  });

  it('every colour becomes a CSS variable', () => {
    const css = tokensCss();
    for (const [name, value] of Object.entries(color)) {
      expect(css).toContain(`--color-${name}: ${value};`);
    }
  });

  it('turns every motion off under reduced motion', () => {
    const reduced = tokensCss().split('prefers-reduced-motion')[1] ?? '';
    for (const name of Object.keys(motion)) expect(reduced).toContain(`--motion-${name}: 0ms;`);
  });

  it('keeps the colours the contrast audit retired out of the tokens', () => {
    const values = Object.values(color).map((value) => value.toUpperCase());
    for (const retired of ['#5E6878', '#4A5362', '#2E3540']) expect(values).not.toContain(retired);
  });
});

// The pairs on the canvas's Contrast board. Text needs 4.5:1 (WCAG 1.4.3); a shape you must
// find to use a control needs 3:1 (WCAG 1.4.11).
const text: [string, keyof typeof color, keyof typeof color][] = [
  ['text on ground', 'text', 'bg'],
  ['secondary on key', 'secondary', 'raised'],
  ['muted on panel', 'muted', 'panel'],
  ['muted on hover', 'muted', 'hover'],
  ['muted on selected segment', 'muted', 'line'],
  ['accent on ground', 'accent', 'bg'],
  ['ink on accent button', 'accent-ink', 'accent'],
  ['accent on pressed key', 'accent', 'pressed'],
  ['in sync status', 'ok', 'ok-bg'],
  ['warning status', 'warning', 'warning-bg'],
  ['error status', 'error-text', 'error-bg'],
];
const shapes: [string, keyof typeof color, keyof typeof color][] = [
  ['edge on ground', 'edge', 'bg'],
  ['edge on panel', 'edge', 'panel'],
  ['edge on key', 'edge', 'raised'],
  ['accent ring on panel', 'accent', 'panel'],
];

describe('contrast audit', () => {
  it.each(text)('%s reaches 4.5:1', (_name, fg, bg) => {
    expect(contrastRatio(color[fg], color[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(shapes)('%s reaches 3:1', (_name, fg, bg) => {
    expect(contrastRatio(color[fg], color[bg])).toBeGreaterThanOrEqual(3);
  });
});
