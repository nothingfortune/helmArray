import { describe, expect, it } from 'vitest';
import type { ApplyGameRow, ApplyPreview, ApplyResult } from '../../shared/api';
import { NO_SHEETS, dismissSheet, keepSheet, sheetLine } from './bindSheet';

const row = (over: Partial<ApplyGameRow> = {}): ApplyGameRow => ({
  set: 'controller',
  mode: 'default',
  modeName: 'Default',
  action: 'reload',
  actionName: 'Reload',
  to: { kind: 'pad', control: 'Y' },
  from: { kind: 'pad', control: 'X' },
  ...over,
});
const preview = (rows: ApplyGameRow[], via: 'sheet' | 'file' = 'sheet') =>
  ({ gameId: 'helldivers2', gameName: 'Helldivers 2', game: { via, rows } }) as ApplyPreview;
const OK: ApplyResult = { ok: true, message: 'Both units now run the layout.', units: [] };

describe('the bind sheet kept after the drawer closes', () => {
  it('keeps the rows a good apply left to set by hand, for that game', () => {
    const sheets = keepSheet(NO_SHEETS, preview([row()]), OK);
    expect(sheetLine(sheets, 'helldivers2')).toEqual({
      gameId: 'helldivers2',
      text: '1 to set in the game',
      section: {
        title: "In Helldivers 2's controls",
        summary: '1 to set by hand',
        groups: [{ label: null, lines: ['Set Reload to Xbox Y'] }],
      },
    });
  });

  it('names the game when the card shows another', () => {
    const sheets = keepSheet(
      NO_SHEETS,
      preview([row(), row({ action: 'jump', actionName: 'Jump' })]),
      OK,
    );
    expect(sheetLine(sheets, 'other')?.text).toBe('2 to set in Helldivers 2');
  });

  it('keeps nothing for an apply that failed, a game whose file is written, or no row', () => {
    expect([
      keepSheet(NO_SHEETS, preview([row()]), { ...OK, ok: false }),
      keepSheet(NO_SHEETS, preview([row()], 'file'), OK),
      keepSheet(NO_SHEETS, preview([]), OK),
    ]).toEqual([NO_SHEETS, NO_SHEETS, NO_SHEETS]);
  });

  it('adds a later apply to what is still to set: the latest row for an action wins', () => {
    const first = keepSheet(
      NO_SHEETS,
      preview([row(), row({ action: 'jump', actionName: 'Jump' })]),
      OK,
    );
    const second = keepSheet(first, preview([row({ to: { kind: 'pad', control: 'B' } })]), OK);
    expect(sheetLine(second, 'helldivers2')?.section.groups[0]?.lines).toEqual([
      'Set Reload to Xbox B',
      'Set Jump to Xbox Y',
    ]);
  });

  it('shows the game applied last, and the other once that one is dismissed', () => {
    const other = { ...preview([row()]), gameId: 'skiff', gameName: 'Skiff' } as ApplyPreview;
    const both = keepSheet(keepSheet(NO_SHEETS, preview([row()]), OK), other, OK);
    expect([
      sheetLine(both, 'helldivers2')?.gameId,
      sheetLine(dismissSheet(both, 'skiff'), 'helldivers2')?.gameId,
    ]).toEqual(['skiff', 'helldivers2']);
  });

  it('has no line once dismissed, or for none kept', () => {
    const sheets = keepSheet(NO_SHEETS, preview([row()]), OK);
    expect([
      sheetLine(NO_SHEETS, 'helldivers2'),
      sheetLine(dismissSheet(sheets, 'helldivers2'), 'helldivers2'),
    ]).toEqual([null, null]);
  });
});
