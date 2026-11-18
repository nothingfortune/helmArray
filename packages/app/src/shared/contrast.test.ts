import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance } from './contrast';

describe('contrastRatio', () => {
  it('is 21:1 for black on white, either way round', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1:1 for a colour on itself', () => {
    expect(contrastRatio('#FFB224', '#ffb224')).toBe(1);
  });

  it('matches a known value', () => {
    // #777777 on white is the textbook 4.48:1 that just fails AA.
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('refuses anything that is not #RRGGBB', () => {
    expect(() => luminance('#FFF')).toThrow('Not a #RRGGBB colour: #FFF');
    expect(() => luminance('red')).toThrow();
  });
});
