import { describe, expect, it } from 'vitest';
import { KEY_FONT_SIZES, MIN_FONT_SIZE, fitLabel, textEm, wrapWords } from './label';

// A finger key's text area: 72 x 48 less the padding.
const W = 56;
const H = 38;

describe('fitLabel', () => {
  it('uses the largest size when the label fits', () => {
    const fit = fitLabel('Jump', W, H);
    expect(fit.fontSize).toBe(13);
    expect(fit.fits).toBe(true);
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

  it('floors at 9 px and says so when a word still does not fit', () => {
    const fit = fitLabel('Extraordinarily', W, H);
    expect(fit.fontSize).toBe(MIN_FONT_SIZE);
    expect(fit.fits).toBe(false);
    // Still whole: the one word, not chopped into pieces.
    expect(fit.lines).toEqual(['Extraordinarily']);
  });

  it('never goes below 9 px even if the caller offers smaller sizes', () => {
    const fit = fitLabel('Extraordinarily', W, H, { sizes: [12, 6, 4] });
    expect(fit.fontSize).toBe(MIN_FONT_SIZE);
    expect(fit.fontSize).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
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

  it('reports a miss, at 9 px, when the key is too short for the lines the words need', () => {
    // Three words need three lines in a 56 px key; a 15 px-high one has room for one.
    const fit = fitLabel('Use stim now', 56, 15);
    expect(fit.fits).toBe(false);
    expect(fit.fontSize).toBe(MIN_FONT_SIZE);
  });

  it('honours a custom size ladder and line height', () => {
    const fit = fitLabel('Forward', 52, 24, { sizes: [12, 11, 10, 9], lineHeight: 1.1 });
    expect([12, 11, 10, 9]).toContain(fit.fontSize);
  });

  it('draws the ladder from 13 px down to 9 px', () => {
    expect(KEY_FONT_SIZES[0]).toBe(13);
    expect(KEY_FONT_SIZES[KEY_FONT_SIZES.length - 1]).toBe(MIN_FONT_SIZE);
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

  it('returns no lines for empty text', () => {
    expect(wrapWords('', 13, 56)).toEqual([]);
    expect(wrapWords('   ', 13, 56)).toEqual([]);
  });
});
