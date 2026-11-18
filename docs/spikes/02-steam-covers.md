# Spike 2: Steam covers

2026-11-17, on the owner's machine (two libraries, 43 installed games, plus Steamworks Common
Redistributables and SteamVR). Survey: `node tools/spikes/steam-survey.mjs`. Not yet checked on a
clean install.

## Answer

Every installed game's cover art can be read locally, with no network and no Steam API.

1. **Steam's folder:** `HKCU\Software\Valve\Steam`, value `SteamPath`.
2. **Libraries:** `<Steam>/steamapps/libraryfolders.vdf` (text KeyValues). Each entry has a `path`
   and the app ids installed there. Each library's `steamapps/appmanifest_<appid>.acf` gives the
   name and `installdir`.
3. **Covers:** `<Steam>/appcache/librarycache/<appid>/`. The files move around, so read the
   index rather than guessing names:
   `<Steam>/appcache/librarycache/assetcache.vdf` is **binary** KeyValues. Under each app id,
   numbered slots name a file relative to that app's folder.

| Slot | What                     | Size seen            | Use in helmArray            |
| ---- | ------------------------ | -------------------- | --------------------------- |
| `0f` | portrait capsule         | 300 × 450 jpg (a few 600 × 900) | Library cover tile |
| `3f` | header                   | 460 × 215 jpg        | "On your Azerons now" card  |
| `1f` | hero                     | 1920 × 620 jpg       | not drawn yet               |
| `2f` | logo                     | 640 × 360 png        | not drawn yet               |
| `4f` | icon                     | 32 × 32 jpg          | tray, small lists           |
| `5f` | hero blur                | 192 × 62 jpg         | not drawn yet               |

Despite its name, `library_600x900.jpg` is usually 300 × 450: across the whole cache, 219 portraits
are 300 × 450 and 26 are 600 × 900. The Library tile is drawn at least 168 px wide, so a
300 px portrait holds up to about 1.75× display scaling. Above that, it will look soft.

## What the survey found

- All 43 games are in the index (663 apps in all, including ones no longer installed). Each has
  a portrait and a header that exist on disk. App ids run from 3 to 7 digits, Portal 2's is 620,
  so never filter them by size.
- **Two layouts.** For 26 games, the portrait sits directly in their folder as
  `library_600x900.jpg`. For 12, it is `library_capsule.jpg` (or `library_600x900.jpg`) inside a
  40-character hashed subfolder, which changes when the art does. The index always names the
  current one.
- Scanning the folder for `library_600x900.jpg` or `library_capsule.jpg`, at any depth, also
  found a portrait for all 43. That makes it a usable fallback when the index lacks a game.

## For M4

- The `games` adapter reads `assetcache.vdf` first and scans the folder second. It shows the
  dashed placeholder from the canvas when neither finds anything, for example for a game added
  by hand. Not seen yet: an installed game missing from the index.
- Parse binary KeyValues with types `0x00` section, `0x01` string, `0x02` int32, `0x07`
  uint64 and `0x08` end. `tools/spikes/vdf.mjs` is the throwaway version; M4 rebuilds it in
  `games` with tests.
- **[local] still open:** repeat on a clean Steam install, to confirm the index exists before
  the library has been browsed.
