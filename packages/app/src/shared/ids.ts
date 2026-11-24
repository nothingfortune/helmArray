// Ids that become file names (a scheme's, a game's). Shared: the main process checks every id a
// window sends, and the Game screen makes the id of a game it adds.

/** The longest id. */
export const MAX_ID_LENGTH = 100;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** Windows treats these as devices, with or without an extension: never a file name. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** An id that is safe as a file name: ids come from windows and from files, so nothing else. */
export const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_ID.test(value) && !value.endsWith('.') && !RESERVED.test(value);
