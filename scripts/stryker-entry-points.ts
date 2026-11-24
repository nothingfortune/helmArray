// `stryker run --mutate <glob>` replaces the `mutate` list in stryker.config.mjs, its `!`
// exclusions included, so a bare glob mutates the tests, the fake unit and the barrels too.
// scripts/mutation-file.ts puts the exclusions back; everything else must go through it.

/** The lines of `text` that run Stryker with its own `--mutate` (or `-m`), skipping the wrapper. */
export function strykerMutateBypasses(text: string): number[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const direct = /\bstryker(?:\.js)?\b[^\n]*(?:--mutate\b|\s-m(?:\s|=|$))/i.test(line);
    return direct ? [index + 1] : [];
  });
}
