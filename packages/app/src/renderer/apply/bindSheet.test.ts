import { describe, expect, it } from 'vitest';
import type { KeptSheet, SheetRow } from '@helmarray/core';
import { sheetLine } from './bindSheet';

const row = (over: Partial<SheetRow> = {}): SheetRow => ({
  set: 'controller',
  mode: 'default',
  modeName: 'Default',
  action: 'reload',
  actionName: 'Reload',
  to: { kind: 'pad', control: 'Y' },
  from: { kind: 'pad', control: 'X' },
  ...over,
});
const sheet = (rows: SheetRow[], gameId = 'helldivers2', gameName = 'Helldivers 2'): KeptSheet => ({
  gameId,
  gameName,
  rows,
});

describe('the bind sheet line on the Library card', () => {
  it('says how many are left to set in the game the card shows, with the rows worded', () => {
    expect(sheetLine([sheet([row()])], 'helldivers2')).toEqual({
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
    const two = sheet([row(), row({ action: 'jump', actionName: 'Jump' })]);
    expect(sheetLine([two], 'other')?.text).toBe('2 to set in Helldivers 2');
  });

  it('is the game applied last, first in the list', () => {
    const lines = sheetLine([sheet([row()], 'skiff', 'Skiff'), sheet([row()])], null);
    expect(lines?.gameId).toBe('skiff');
  });

  it('is nothing when none is kept', () => {
    expect(sheetLine([], 'helldivers2')).toBeNull();
  });
});
