import { describe, expect, it } from 'vitest';
import { helldivers2 } from '@helmarray/core';
import {
  KEY_FONT_SIZES,
  MIN_FONT_SIZE,
  MIN_SQUEEZE,
  fitLabel,
  joinShortWords,
  textEm,
  wrapWords,
} from './label';

// A finger key's text area: 72 x 48 less the padding.
const W = 56;
const H = 38;
// A d-pad key's: 60 x 34 less the padding of a flat key.
const DPAD_W = 43;
const DPAD_H = 26;

describe('fitLabel: the game word at 13, 12, 11 px', () => {
  it('uses the largest size when the label fits', () => {
    const fit = fitLabel('Jump', W, H);
    expect(fit).toMatchObject({ text: 'Jump', fontSize: 13, fits: true, short: false, squeeze: 1 });
    expect(fit.lines).toEqual(['Jump']);
  });

  it('steps the size down as the label gets longer', () => {
    const sizes = ['Jump', 'Flashlight', 'Support weapon', 'Hold position'].map(
      (t) => fitLabel(t, W, H).fontSize,
    );
    expect(sizes[0]).toBeGreaterThanOrEqual(sizes[1] as number);
    expect(sizes[1] as number).toBeLessThan(13);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  it('steps down to fit a word that is too wide at 13 px, instead of splitting it', () => {
    const fit = fitLabel('Flashlight', W, H);
    expect(fit.fontSize).toBeLessThan(13);
    expect(fit.lines).toEqual(['Flashlight']);
    expect(fit.fits).toBe(true);
    expect(textEm('Flashlight') * fit.fontSize).toBeLessThanOrEqual(W);
  });

  it('breaks lines at spaces only, so every word comes out whole', () => {
    for (const text of [
      'Support weapon',
      'Throw grenade',
      'Use stim',
      'Swap weapon',
      'Hold to aim',
    ]) {
      const fit = fitLabel(text, W, H);
      expect(fit.lines.join(' ')).toBe(text);
      for (const line of fit.lines)
        expect(text.split(' ')).toEqual(expect.arrayContaining(line.split(' ')));
    }
  });

  it('keeps the words of a multi-word label on lines that fit when it fits', () => {
    const fit = fitLabel('Support weapon', W, H);
    expect(fit.fits).toBe(true);
    for (const line of fit.lines) expect(textEm(line) * fit.fontSize).toBeLessThanOrEqual(W);
    expect(fit.lines.length).toBeLessThanOrEqual(Math.floor(H / (fit.fontSize * 1.12)));
  });

  it('honours a custom size ladder and line height', () => {
    const fit = fitLabel('Forward', 52, 24, { sizes: [12, 11, 10], lineHeight: 1.1 });
    expect([12, 11, 10]).toContain(fit.fontSize);
  });
});

describe('fitLabel: then the short label, then 10 px (the Main board rule)', () => {
  it('shows the short label at 11 px or more before the game word drops to 10 px', () => {
    // "Backpack" fits this key at 10 px but not at 11.
    expect(fitLabel('Backpack', DPAD_W + 8, DPAD_H)).toMatchObject({ fontSize: 10, fits: true });
    const fit = fitLabel('Backpack', DPAD_W + 8, DPAD_H, { short: 'Pack' });
    expect(fit).toMatchObject({ text: 'Pack', short: true, fits: true });
    expect(fit.fontSize).toBeGreaterThanOrEqual(11);
  });

  it('keeps the game word when it fits at 11 px, even with a short label', () => {
    expect(fitLabel('Jump', W, H, { short: 'J' })).toMatchObject({ text: 'Jump', short: false });
  });

  it('uses the game word at 10 px when the short label does not fit at 11 px either', () => {
    // Both are one long word: the short one is no better, so the game's own word is kept.
    const fit = fitLabel('Reinforce', 50, 12, { short: 'Reinforcing' });
    expect(fit).toMatchObject({ text: 'Reinforce', fontSize: 10, short: false, squeeze: 1 });
  });

  it('uses the short label at 10 px when only it fits there', () => {
    const fit = fitLabel('Extraordinarily', 44, 12, { short: 'Extra ord' });
    expect(fit).toMatchObject({ text: 'Extra ord', fontSize: 10, short: true, fits: true });
  });

  it('ignores a blank short label', () => {
    expect(fitLabel('Flashlight', W, H, { short: '   ' }).short).toBe(false);
  });
});

describe('fitLabel: the 10 px floor', () => {
  it('draws the ladder from 13 px down to 10 px, and no smaller', () => {
    expect(KEY_FONT_SIZES).toEqual([13, 12, 11, 10]);
    expect(MIN_FONT_SIZE).toBe(10);
  });

  it('never goes below 10 px even if the caller offers smaller sizes', () => {
    const fit = fitLabel('Extraordinarily', W, H, { sizes: [12, 9, 6, 4] });
    expect(fit.fontSize).toBe(MIN_FONT_SIZE);
  });

  it('fits a word too wide at 10 px by drawing it narrower, never by cutting it', () => {
    const fit = fitLabel('Extraordinarily', W, H);
    expect(fit).toMatchObject({ fontSize: MIN_FONT_SIZE, fits: true, short: false });
    expect(fit.lines).toEqual(['Extraordinarily']);
    expect(fit.squeeze).toBeLessThan(1);
    expect(fit.squeeze).toBeGreaterThanOrEqual(MIN_SQUEEZE);
    expect(textEm('Extraordinarily') * fit.fontSize * fit.squeeze).toBeLessThanOrEqual(W);
  });

  it('draws narrower only as much as the widest word needs', () => {
    const fit = fitLabel('Extraordinarily', W, H);
    const needed = W / (textEm('Extraordinarily') * MIN_FONT_SIZE);
    expect(fit.squeeze).toBeGreaterThan(needed - 0.06);
  });

  it('fits too many words for the height by drawing them narrower, on fewer lines', () => {
    // Three words need two lines in a 56 px key; a 12 px-high one has room for one at 10 px.
    const fit = fitLabel('Use stim now', 56, 12);
    expect(fit).toMatchObject({ fontSize: 10, fits: true });
    expect(fit.lines).toEqual(['Use stim now']);
    expect(fit.squeeze).toBeLessThan(1);
  });

  it('says so, at the narrowest it draws, when even that does not fit', () => {
    const fit = fitLabel('Antidisestablishmentarianism', 20, 12);
    expect(fit).toMatchObject({ fontSize: 10, fits: false, squeeze: MIN_SQUEEZE });
    expect(fit.lines).toEqual(['Antidisestablishmentarianism']);
  });

  it('never draws narrower than MIN_SQUEEZE', () => {
    expect(MIN_SQUEEZE).toBeGreaterThanOrEqual(0.6);
  });

  // Every key shape of the Azeron unit and the keyboard's narrowest key, as text areas (Unit.tsx
  // and Devices.tsx take the padding off): finger, side, thumb, d-pad, a 1-unit keyboard key.
  const SHAPES = [
    ['finger', W, H],
    ['side', 44, 54],
    ['thumb', 40, 34],
    ['d-pad', DPAD_W, DPAD_H],
    ['keyboard', 48, 36],
  ] as const;

  it('fits every Helldivers 2 action name on every key shape, at 10 px or more', () => {
    const misses = helldivers2.actions.flatMap((action) =>
      SHAPES.flatMap(([shape, w, h]) => {
        const fit = fitLabel(action.name, w, h);
        return fit.fits && fit.fontSize >= MIN_FONT_SIZE ? [] : [`${action.name} on ${shape}`];
      }),
    );
    expect(misses).toEqual([]);
  });

  it('fits a long-press label of every Helldivers 2 action on a finger key', () => {
    const misses = helldivers2.actions
      .map((a) => `Long: ${a.name}`)
      .filter((label) => !fitLabel(label, W, H).fits);
    expect(misses).toEqual([]);
  });
});

describe('joinShortWords', () => {
  it('keeps a one-character word with the word before it', () => {
    expect(joinShortWords('D-pad ←')).toBe('D-pad ←');
    expect(joinShortWords('Index 1')).toBe('Index 1');
  });

  it('leaves longer words free to wrap', () => {
    expect(joinShortWords('Support weapon')).toBe('Support weapon');
    expect(joinShortWords('D-pad press')).toBe('D-pad press');
  });

  it('does not join a one-character word at the start to anything', () => {
    expect(joinShortWords('A button')).toBe('A button');
  });
});

describe('fitLabel: D-pad ← stays on one line', () => {
  it('fits an empty d-pad key on one line', () => {
    const fit = fitLabel('D-pad ←', DPAD_W, DPAD_H);
    expect(fit.text).toBe('D-pad ←');
    expect(fit.lines).toEqual(['D-pad ←']);
    expect(fit.fits).toBe(true);
  });
});

describe('textEm', () => {
  it('measures Inter 600 per character: wide capitals, thin i and l, wider m and w', () => {
    expect(textEm('W')).toBeGreaterThan(textEm('A'));
    expect(textEm('i')).toBeLessThan(textEm('n'));
    expect(textEm('m')).toBeGreaterThan(textEm('n'));
  });

  it('counts a non-breaking space as a space', () => {
    expect(textEm('a b')).toBeCloseTo(textEm('a b'));
  });

  it('counts an arrow as wide as it is drawn, a full em', () => {
    expect(textEm('←')).toBeGreaterThanOrEqual(0.95);
  });

  it('allows for a character it has no width for, generously', () => {
    expect(textEm('漢')).toBeGreaterThanOrEqual(1);
  });
});

describe('wrapWords', () => {
  it('wraps greedily at spaces', () => {
    expect(wrapWords('aa bb cc', 10, 1000)).toEqual(['aa bb cc']);
    expect(wrapWords('Support weapon', 13, 56)).toEqual(['Support', 'weapon']);
  });

  it('puts a word wider than the line on a line of its own, whole', () => {
    expect(wrapWords('a Extraordinarily b', 13, 40)).toEqual(['a', 'Extraordinarily', 'b']);
  });

  it('never breaks at a non-breaking space', () => {
    expect(wrapWords('D-pad ←', 13, 20)).toEqual(['D-pad ←']);
  });

  it('returns no lines for empty text', () => {
    expect(wrapWords('', 13, 56)).toEqual([]);
    expect(wrapWords('   ', 13, 56)).toEqual([]);
  });
});
