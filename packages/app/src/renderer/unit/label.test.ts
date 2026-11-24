import { describe, expect, it } from 'vitest';
import { helldivers2 } from '@helmarray/core';
import { MIN_UNIT_SCALE, SIDE_NARROW, SIDE_WIDE, unitRow } from '../screens/editor-layout';
import {
  KEY_FONT_SIZES,
  MIN_FONT_SIZE,
  MIN_SQUEEZE,
  TIGHT_LINE_HEIGHT,
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

  it('draws the lines closer, at 10 px, when the height is one line short', () => {
    // Three short lines in a key with room for two at the usual height, but three at 1.0.
    const fit = fitLabel('Ping / comms wheel', 38, 31);
    expect(fit).toMatchObject({ fontSize: 10, fits: true, lineHeight: TIGHT_LINE_HEIGHT });
    expect(fit.lines).toHaveLength(3);
    expect(fitLabel('Ping / comms wheel', 38, 40)).not.toHaveProperty('lineHeight');
  });

  it('never draws narrower than MIN_SQUEEZE', () => {
    expect(MIN_SQUEEZE).toBeGreaterThanOrEqual(0.6);
  });

  // Every key shape of the Azeron unit and the keyboard's narrowest key, as the text areas Unit.tsx
  // and Devices.tsx give them (the key less its padding and border): finger 72 x 48, side 60 x 64,
  // thumb 56 x 44, d-pad 60 x 34, a 1-unit keyboard key 64 x 60.
  const SHAPES = [
    ['finger', 54, 35],
    ['side', 42, 51],
    ['thumb', 38, 31],
    ['d-pad', 40, 23],
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
      .filter((label) => !fitLabel(label, 54, 35).fits);
    expect(misses).toEqual([]);
  });
});

describe('fitLabel: a press word is never fitted away', () => {
  // The press words a label can carry (editor-view.ts), long names, and every key shape's text area
  // (as in the table above), at the units' scale with the side panel open at 1440 and at 1280.
  const QUALIFIERS = [undefined, 'Long:', 'Double:'] as const;
  const NAMES = [
    ['Ping / comms wheel', 'Ping'],
    ['Stratagem (hold)', 'Strat'],
    ['Secondary', 'Sec'],
    ['Extraordinarily long action', 'Extra'],
  ] as const;
  const KEYS = [
    ['finger', 54, 35],
    ['side', 42, 51],
    ['thumb', 38, 31],
    ['d-pad', 40, 23],
    ['keyboard', 48, 36],
  ] as const;
  // editor-layout.ts at 1440 and 1280: the main column less a scrollbar's gutter.
  const SCALES = [
    ['1440', unitRow(1440 - SIDE_WIDE - 48 - 17, 2).scale ?? 1],
    ['1280', unitRow(1280 - SIDE_NARROW - 48 - 17, 2).scale ?? 1],
  ] as const;

  const faults: string[] = [];
  for (const qualifier of QUALIFIERS)
    for (const [name, short] of NAMES)
      for (const keyLabel of [undefined, short])
        for (const [shape, w, h] of KEYS)
          for (const [width, scale] of SCALES) {
            const fit = fitLabel(name, w, h, { qualifier, short: keyLabel });
            const at = `${qualifier ?? 'tap'} "${name}"${keyLabel ? ` (${keyLabel})` : ''} on ${shape} at ${width}`;
            if (qualifier !== undefined && !fit.text.startsWith(`${qualifier} `))
              faults.push(`${at}: drawn "${fit.text}"`);
            if (fit.fontSize < MIN_FONT_SIZE) faults.push(`${at}: ${fit.fontSize} px`);
            if (fit.fontSize * scale < MIN_FONT_SIZE * MIN_UNIT_SCALE)
              faults.push(`${at}: ${(fit.fontSize * scale).toFixed(1)} px on screen`);
            if (!fit.fits && fit.squeeze > MIN_SQUEEZE) faults.push(`${at}: not fitted`);
          }

  it('keeps the press word on every key, with and without a key label, at 1440 and 1280', () => {
    expect(faults).toEqual([]);
  });

  it('draws the key label after the press word, in place of the name only', () => {
    const fit = fitLabel('Ping / comms wheel', 40, 23, { qualifier: 'Long:', short: 'Ping' });
    expect([fit.text, fit.short]).toEqual(['Long: Ping', true]);
  });

  it('draws the press word and the whole name when they fit', () => {
    expect(fitLabel('Jump', 54, 35, { qualifier: 'Long:', short: 'J' }).text).toBe('Long: Jump');
  });

  it('draws the press word and the shortest name narrower before it would leave the press word out', () => {
    const fit = fitLabel('Ping / comms wheel', 30, 11, { qualifier: 'Double:', short: 'Ping' });
    expect([fit.text, fit.fontSize, fit.squeeze < 1]).toEqual(['Double: Ping', 10, true]);
  });
});

describe('joinShortWords', () => {
  it('keeps a one-character word with the word before it', () => {
    expect(joinShortWords('D-pad ←')).toBe('D-\u2060pad\u00a0←');
    expect(joinShortWords('Index 1')).toBe('Index\u00a01');
  });

  it('leaves longer words free to wrap at their spaces, and keeps a lone slash with its word', () => {
    expect(joinShortWords('Support weapon')).toBe('Support weapon');
    expect(joinShortWords('Climb / vault')).toBe('Climb\u00a0/ vault');
  });

  it('never lets a word break at its hyphen: a word joiner follows it', () => {
    expect(joinShortWords('D-pad press')).toBe('D-\u2060pad press');
    expect(joinShortWords('Re-arm -')).toBe('Re-\u2060arm\u00a0-');
  });

  it('does not join a one-character word at the start to anything', () => {
    expect(joinShortWords('A button')).toBe('A button');
  });
});

describe('fitLabel: D-pad ← stays on one line', () => {
  it('fits an empty d-pad key on one line', () => {
    const fit = fitLabel('D-pad ←', DPAD_W, DPAD_H);
    expect(fit.text).toBe('D-\u2060pad\u00a0←');
    expect(fit.lines).toEqual(['D-\u2060pad\u00a0←']);
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
    expect(textEm('a\u00a0b')).toBeCloseTo(textEm('a b'));
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
    expect(wrapWords('D-pad\u00a0←', 13, 20)).toEqual(['D-pad\u00a0←']);
  });

  it('returns no lines for empty text', () => {
    expect(wrapWords('', 13, 56)).toEqual([]);
    expect(wrapWords('   ', 13, 56)).toEqual([]);
  });
});
