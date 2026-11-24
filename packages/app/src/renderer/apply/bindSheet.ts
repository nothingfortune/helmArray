// The line on the Library's card for what is still to be set by hand in a game's own controls:
// the bind sheet of the applies that said so, kept by the main process (sheets.json) until the
// person says it is done. Pure.

import type { KeptSheet } from '@helmarray/core';
import { gameSection } from './applyFlow';
import type { GameSection } from './applyFlow';

export interface SheetLine {
  gameId: string;
  /** "1 to set in the game", or "2 to set in Helldivers 2" when the card shows another game. */
  text: string;
  /** The rows, worded as the drawer words them. */
  section: GameSection;
}

/** The line on the Library's card: the sheet of the game applied last, or null when none is kept. */
export function sheetLine(
  sheets: readonly KeptSheet[],
  cardGameId: string | null,
): SheetLine | null {
  const sheet = sheets[0];
  if (sheet === undefined) return null;
  const section = gameSection(
    { via: 'sheet', rows: sheet.rows },
    sheet.gameName === '' ? "In the game's controls" : `In ${sheet.gameName}'s controls`,
  );
  if (section === null) return null;
  const n = sheet.rows.length;
  const where = sheet.gameId === cardGameId || sheet.gameName === '' ? 'the game' : sheet.gameName;
  return { gameId: sheet.gameId, text: `${n} to set in ${where}`, section };
}
