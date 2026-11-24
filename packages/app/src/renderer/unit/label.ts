// Fitting a key's label, as the Main board's rule has it: the game's word at 13, 12, then 11 px,
// wrapping on spaces; then the key's short label; then 10 px, the floor. A word is never split or
// cut: when even 10 px is too wide, the label is drawn narrower (`squeeze`, a horizontal scale)
// rather than smaller. Widths are estimated per character from Inter 600, the face the labels are
// drawn in, so this stays pure; the browser does the drawing and wraps only at spaces.

/** Never smaller than this: below it a label is not readable at arm's length. */
export const MIN_FONT_SIZE = 10;
export const KEY_FONT_SIZES: readonly number[] = [13, 12, 11, 10];
export const KEY_LINE_HEIGHT = 1.12;
/** The narrowest a label is drawn, as a share of its width: past it, letters stop reading. */
export const MIN_SQUEEZE = 0.6;
const SQUEEZE_STEP = 0.05;
/** The line height of a last resort that needs one more line than the usual height allows. */
export const TIGHT_LINE_HEIGHT = 1;

export interface LabelFit {
  /** What to draw: the game's word or the short label, with its one-letter words kept joined. */
  text: string;
  fontSize: number;
  /** The text as it will wrap: lines break at spaces only, so no word is ever split. */
  lines: string[];
  /** Whether `text` is the short label. */
  short: boolean;
  /** 1, or the horizontal scale the text is drawn at to fit at 10 px. */
  squeeze: number;
  /** Set when the lines are drawn closer than usual (TIGHT_LINE_HEIGHT) to fit at 10 px. */
  lineHeight?: number;
  /** False only when the label does not fit even drawn at MIN_SQUEEZE. */
  fits: boolean;
}

export interface FitOptions {
  /** Candidate sizes, largest first. None below MIN_FONT_SIZE is used. */
  sizes?: readonly number[];
  lineHeight?: number;
  /** The key's short label, shown when the game's word won't fit at a readable size. */
  short?: string | undefined;
}

// Advance widths of Inter 600, in em, as the app draws them (measured in the app's own window).
// prettier-ignore
const INTER_600: Readonly<Record<string, number>> = {
  a: 0.57, b: 0.62, c: 0.58, d: 0.62, e: 0.59, f: 0.39, g: 0.63, h: 0.61, i: 0.26, j: 0.26,
  k: 0.57, l: 0.26, m: 0.9, n: 0.61, o: 0.61, p: 0.62, q: 0.62, r: 0.4, s: 0.55, t: 0.35,
  u: 0.61, v: 0.59, w: 0.84, x: 0.57, y: 0.59, z: 0.57,
  A: 0.73, B: 0.66, C: 0.74, D: 0.72, E: 0.61, F: 0.59, G: 0.75, H: 0.75, I: 0.28, J: 0.58,
  K: 0.7, L: 0.57, M: 0.92, N: 0.76, O: 0.77, P: 0.65, Q: 0.77, R: 0.65, S: 0.65, T: 0.66,
  U: 0.74, V: 0.73, W: 1.02, X: 0.72, Y: 0.71, Z: 0.65,
  '0': 0.66, '1': 0.42, '2': 0.62, '3': 0.64, '4': 0.67, '5': 0.61, '6': 0.64, '7': 0.58,
  '8': 0.64, '9': 0.64,
  ' ': 0.25, '\u00a0': 0.25, '.': 0.32, ',': 0.32, ':': 0.32, ';': 0.33, "'": 0.33, '!': 0.32,
  '|': 0.36, '-': 0.47, '/': 0.38, '(': 0.37, ')': 0.37, '%': 1, '+': 0.67, '−': 0.67,
  '&': 0.66, '?': 0.54, '←': 1, '→': 1, '↑': 0.88, '↓': 0.88, '\u2060': 0,
};
/** A character not in the table: as wide as the widest letter, so a guess never overflows. */
const UNKNOWN_EM = 1.02;

/** Estimated width of `text` in em, in Inter 600. */
export function textEm(text: string): number {
  let em = 0;
  for (const ch of text) em += INTER_600[ch] ?? UNKNOWN_EM;
  return em;
}

/**
 * Keeps words whole where the browser would break them: a one-character word is joined to the word
 * before it with a non-breaking space, so "D-pad ←" and "Index 1" never wrap into a word and a lone
 * arrow or digit; and a word joiner after each hyphen, so "D-pad" is never "D-" and "pad".
 */
export const joinShortWords = (text: string): string =>
  text.replace(/(\S) (\S)(?=\s|$)/gu, '$1\u00a0$2').replace(/-(?=\S)/gu, '-\u2060');

/** Greedy wrap at ordinary spaces. A word wider than the line goes on a line of its own. */
export function wrapWords(text: string, fontSize: number, availWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter((w) => w.trim() !== '')) {
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

interface Box {
  width: number;
  height: number;
  lineHeight: number;
}

/** How `text` wraps at one size and squeeze, and whether every line fits the box. */
function tryFit(
  text: string,
  fontSize: number,
  squeeze: number,
  box: Box,
): { lines: string[]; fits: boolean } {
  const width = box.width / squeeze;
  const lines = wrapWords(text, fontSize, width);
  const maxLines = Math.max(1, Math.floor(box.height / (fontSize * box.lineHeight)));
  const fits = lines.length <= maxLines && lines.every((l) => textEm(l) * fontSize <= width);
  return { lines, fits };
}

/**
 * The label to draw in `availWidth` x `availHeight`: the game's word at the sizes above the floor,
 * then the short label at those sizes, then the game's word at 10 px, then the short label at 10 px
 * (the Main board's rule). When none fits, the short label (else the game's word) at 10 px, drawn
 * only as much narrower as it needs and never below MIN_SQUEEZE; `fits` is false only past that.
 */
export function fitLabel(
  text: string,
  availWidth: number,
  availHeight: number,
  options: FitOptions = {},
): LabelFit {
  const box: Box = {
    width: availWidth,
    height: availHeight,
    lineHeight: options.lineHeight ?? KEY_LINE_HEIGHT,
  };
  const sizes = [...new Set(options.sizes ?? KEY_FONT_SIZES)].filter((s) => s >= MIN_FONT_SIZE);
  const above = sizes.filter((s) => s > MIN_FONT_SIZE);
  const full = joinShortWords(text.trim());
  const shortText = options.short?.trim() ?? '';
  const short = shortText === '' ? undefined : joinShortWords(shortText);
  const steps: [string | undefined, boolean, readonly number[]][] = [
    [full, false, above],
    [short, true, above],
    [full, false, [MIN_FONT_SIZE]],
    [short, true, [MIN_FONT_SIZE]],
  ];
  for (const [candidate, isShort, ladder] of steps) {
    if (candidate === undefined) continue;
    for (const fontSize of ladder) {
      const { lines, fits } = tryFit(candidate, fontSize, 1, box);
      if (fits) return { text: candidate, fontSize, lines, short: isShort, squeeze: 1, fits };
    }
  }
  // The last resort: drawn narrower, at the usual line height and then with the lines closer.
  const last = short ?? full;
  const narrower = (lineHeight: number) => {
    const at = { ...box, lineHeight };
    let squeeze = 1;
    let tried = tryFit(last, MIN_FONT_SIZE, squeeze, at);
    while (!tried.fits && squeeze - SQUEEZE_STEP >= MIN_SQUEEZE - 1e-9) {
      squeeze = Math.round((squeeze - SQUEEZE_STEP) * 100) / 100;
      tried = tryFit(last, MIN_FONT_SIZE, squeeze, at);
    }
    return { squeeze, ...tried };
  };
  const usual = narrower(box.lineHeight);
  const tight =
    usual.fits || box.lineHeight <= TIGHT_LINE_HEIGHT ? null : narrower(TIGHT_LINE_HEIGHT);
  const best = tight?.fits === true ? tight : usual;
  return {
    text: last,
    fontSize: MIN_FONT_SIZE,
    lines: best.lines,
    short: short !== undefined,
    squeeze: best.squeeze,
    ...(best === tight ? { lineHeight: TIGHT_LINE_HEIGHT } : {}),
    fits: best.fits,
  };
}
