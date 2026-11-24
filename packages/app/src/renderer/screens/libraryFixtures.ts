// A Library entry to build tests from. Shared by the Library's tests; the app never imports it.

import type { LibraryEntry } from '../../shared/api';

export const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  name: 'Helldivers 2',
  appId: '553850',
  gameId: 'helldivers2',
  schemes: [],
  activeSchemeId: null,
  applied: null,
  nativeKeys: true,
  hasCover: true,
  hasHeader: true,
  actionCount: 30,
  ...over,
});
