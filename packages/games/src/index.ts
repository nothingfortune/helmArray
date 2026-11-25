// One adapter per game file format: find, harvest defaults, write. Imports types from
// @helmarray/core only, and does no I/O of its own: `find` reads through the folder reader it is
// handed.
export { VdfError } from './kv';
export type { KvSection, KvValue } from './kv';
export { findKey, findSection, findString, isSection } from './kv';
export { parseVdfBinary } from './vdf-binary';
export { parseVdfText } from './vdf-text';
export type { AppCovers, InstalledGame } from './steam';
export { parseAppManifest, parseAssetCache, parseLibraryFolders, pickPortrait } from './steam';
export type { FolderReader } from './game-file';
export { GameFileError } from './game-file';
export type { Harvest, KeptBinding } from './unreal-ini';
export { findEverspace2Ini, harvestUnrealIni, writeUnrealIni } from './unreal-ini';
export {
  UNREAL_KEYS,
  UNREAL_MOUSE,
  UNREAL_PAD,
  UNREAL_SCROLL,
  signalOfUnreal,
  unrealKeyOf,
} from './unreal-keys';
export type { EliteFound } from './elite-binds';
export {
  findEliteBinds,
  harvestEliteBinds,
  readStartPreset,
  writeEliteBinds,
  writeStartPreset,
} from './elite-binds';
export type { EliteInput, EliteKey } from './elite-keys';
export {
  ELITE_KEYS,
  ELITE_MOUSE,
  ELITE_PAD,
  ELITE_SCROLL,
  eliteKeyOf,
  signalOfElite,
} from './elite-keys';
