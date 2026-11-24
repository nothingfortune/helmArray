// The bind sheet after the drawer closes: what is still to be set by hand in each game's own
// controls, until the person says it is done. Kept for the session (the drawer's last word is not
// the only place it can be read). Pure.

import type { ApplyGameRow, ApplyPreview, ApplyResult } from '../../shared/api';
import { gameSection } from './applyFlow';
import type { GameSection } from './applyFlow';

interface KeptSheet {
  gameId: string;
  gameName: string;
  rows: ApplyGameRow[];
}

/** Per game, the one applied last first. */
export type KeptSheets = readonly KeptSheet[];

export const NO_SHEETS: KeptSheets = [];

const keyOf = (row: ApplyGameRow) => `${row.set}|${row.mode}|${row.action}`;

/**
 * After an apply: the rows it left to set by hand are added to that game's sheet. A row for an
 * action already there replaces it (the latest is what the game should have); rows a later apply
 * doesn't mention are still to be set. Nothing for an apply that failed, or a game whose file
 * helmArray writes.
 */
export function keepSheet(
  sheets: KeptSheets,
  preview: ApplyPreview,
  result: ApplyResult,
): KeptSheets {
  if (!result.ok || preview.game.via !== 'sheet' || preview.game.rows.length === 0) return sheets;
  const before = sheets.find((s) => s.gameId === preview.gameId)?.rows ?? [];
  const fresh = new Map(preview.game.rows.map((r) => [keyOf(r), r]));
  // The game's own order where the rows were already there, the new ones after.
  const rows = [
    ...before.map((r) => fresh.get(keyOf(r)) ?? r),
    ...preview.game.rows.filter((r) => !before.some((b) => keyOf(b) === keyOf(r))),
  ];
  return [
    { gameId: preview.gameId, gameName: preview.gameName, rows },
    ...sheets.filter((s) => s.gameId !== preview.gameId),
  ];
}

/** The person has set them: the game's sheet goes. */
export const dismissSheet = (sheets: KeptSheets, gameId: string): KeptSheets =>
  sheets.filter((s) => s.gameId !== gameId);

export interface SheetLine {
  gameId: string;
  /** "1 to set in the game", or "2 to set in Helldivers 2" when the card shows another game. */
  text: string;
  /** The rows, worded as the drawer words them. */
  section: GameSection;
}

/** The line on the Library's card: the sheet of the game applied last, or null when none is kept. */
export function sheetLine(sheets: KeptSheets, cardGameId: string | null): SheetLine | null {
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
