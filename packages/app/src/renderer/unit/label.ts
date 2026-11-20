// Fitting a key's label: the action's whole words, stepping the type down rather than breaking
// a word. Widths are estimated per character (the canvas's table), so this stays pure and
// agrees with what Inter 600 draws closely enough to choose a size; the browser does the
// drawing and wraps only at spaces.

/** Never smaller than this: below it a label is not readable at arm's length. */
export const MIN_FONT_SIZE = 9;
export const KEY_FONT_SIZES: readonly number[] = [13, 12, 11, 10, 9];
export const KEY_LINE_HEIGHT = 1.12;

export interface LabelFit {
  fontSize: number;
  /** The text as it will wrap: lines break at spaces only, so no word is ever split. */
  lines: string[];
  /** False only when a single word is wider than the space even at the smallest size. */
  fits: boolean;
}

export interface FitOptions {
  /** Candidate sizes, largest first. None may be below MIN_FONT_SIZE. */
  sizes?: readonly number[];
  lineHeight?: number;
}

const NARROW = /[iljtfrI.,:'!| ]/;
const WIDE = /[A-Z0-9%]/;

/** Estimated width of `text` in em: capitals and digits wide, thin letters and spaces narrow. */
export function textEm(text: string): number {
  let em = 0;
  for (const ch of text) em += WIDE.test(ch) ? 0.68 : NARROW.test(ch) ? 0.34 : 0.6;
  return em;
}

/** Greedy wrap at spaces. A word wider than the line goes on a line of its own. */
export function wrapWords(text: string, fontSize: number, availWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    const joined = line === '' ? word : `${line} ${word}`;
    if (line === '' || textEm(joined) * fontSize <= availWidth) line = joined;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/**
 * The largest size at which `text` wraps within `availWidth` x `availHeight` with every word
 * whole. When even the smallest size cannot do it, the smallest size is returned with
 * `fits: false`: the word stays whole and the key is the owner's to widen, never the text's
 * to chop.
 */
export function fitLabel(
  text: string,
  availWidth: number,
  availHeight: number,
  options: FitOptions = {},
): LabelFit {
  const sizes = (options.sizes ?? KEY_FONT_SIZES).map((s) => Math.max(s, MIN_FONT_SIZE));
  const lineHeight = options.lineHeight ?? KEY_LINE_HEIGHT;
  let last: LabelFit = { fontSize: MIN_FONT_SIZE, lines: [text], fits: false };
  for (const fontSize of sizes) {
    const lines = wrapWords(text, fontSize, availWidth);
    const maxLines = Math.max(1, Math.floor(availHeight / (fontSize * lineHeight)));
    const wordsFit = lines.every((l) => textEm(l) * fontSize <= availWidth);
    last = { fontSize, lines, fits: wordsFit && lines.length <= maxLines };
    if (last.fits) return last;
  }
  return last;
}
