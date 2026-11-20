// One adapter per game file format: find, harvest defaults, write. Imports types from
// @helmarray/core only, and does no I/O of its own.
export { VdfError } from './kv';
export type { KvSection, KvValue } from './kv';
export { findKey, findSection, findString, isSection } from './kv';
export { parseVdfBinary } from './vdf-binary';
export { parseVdfText } from './vdf-text';
export type { AppCovers, InstalledGame } from './steam';
export { parseAppManifest, parseAssetCache, parseLibraryFolders, pickPortrait } from './steam';
