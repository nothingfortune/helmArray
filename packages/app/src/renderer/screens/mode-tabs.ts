// The Editor's mode tabs, as a keyboard moves through them: a tablist in a row (WAI-ARIA's tabs
// pattern). The left and right arrows go to the tab before or after, round from either end; Home
// and End go to the first and the last. Selection follows the focus: the tab gone to is the mode
// shown. Every other key is left to do what it does anywhere. Pure: the Editor's tabs ask this.

/**
 * The tab a key goes to, in a row of `count` tabs, from the tab at `from` (-1: none of them); null
 * when the key isn't the tabs' or there are none.
 */
export function tabKeyTarget(key: string, from: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      // From none of them (-1), the first.
      return (from + 1) % count;
    case 'ArrowLeft':
      return from <= 0 ? count - 1 : from - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
