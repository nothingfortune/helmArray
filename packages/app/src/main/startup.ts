export type WindowName = 'main' | 'play';

// The main window always opens. `--play` also opens Play view, for a shortcut that starts
// straight into a game.
export function startupWindows(argv: readonly string[]): WindowName[] {
  return argv.includes('--play') ? ['main', 'play'] : ['main'];
}
