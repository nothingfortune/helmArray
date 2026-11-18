# Spike 3: harvest survey

2026-11-17, on the owner's machine (43 installed games). Survey:
`node tools/spikes/steam-survey.mjs`. It reads each install folder, the player's Unreal config
under `%LOCALAPPDATA%`, and Steam Input's cached configs. It is read-only.

## Answer

Few games ship default controls that can be read. For v1, write adapters only for the formats
already planned, plus the pad preset by itself where nothing is readable:

| Game                 | Readable defaults                                                                                       | v1 plan                          |
| -------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Elite Dangerous      | 30 shipped presets in `Products/elite-dangerous-odyssey-64/ControlSchemes/*.binds`, keyboard and pads   | full harvest (planned)           |
| Everspace 2          | none shipped; the player's `%LOCALAPPDATA%/ES2/Saved/Config/Windows/Input.ini` holds all 408 `KeybindingsConfig=` lines once the game has saved settings | harvest from the player's file (planned) |
| Helldivers 2         | none. `%APPDATA%/Arrowhead/Helldivers2/user_settings.config` has no bindings                             | *Xbox controller* preset, actions named by hand |
| Ace Combat 7         | not installed; Ace Combat 8 is (Unreal, nothing readable)                                                | *Xbox controller* preset         |
| Cyberpunk 2077       | `r6/config/inputUserMappings.xml`, `inputContexts.xml`: full action and key lists in XML                 | v2 format candidate              |
| The Witcher 3        | `bin/config/r4game/legacy/base/input_qwerty.ini` and `user_config_matrix/pc/input.xml`                   | v2 format candidate              |
| Heart of the Machine | `GameData/Configuration/9_InputAction/*.xml`                                                             | v2 format candidate              |
| Sniper Elite 4       | `game_actions_312660.vdf`: a Steam Input action manifest (action names, no keys)                         | names only                       |
| Stellaris            | cached Steam Input community config with 8 labelled key presses                                          | names only                       |
| everything else      | nothing readable                                                                                        | pad preset; teach by pressing (v2) |

## What the survey found

- **Engines.** 12 Unreal games, 8 Unity, 1 Cobra (Elite), and 22 others.
  - Unity games never had readable input files.
  - Unreal games keep their defaults inside `.pak` files. The only readable input is the
    player's `Saved/Config/<platform>/Input.ini`, and only Everspace 2's has bindings in it.
    Days Gone, Outpost: Infinity Siege, Chained Together and Dispatch have one, but it's empty.
- **Everspace 2 writes its own format.** `KeybindingsConfig=(Action=...,Key1=...,Key2=...)` in
  `[/Script/ES2.CustomPlayerInput]`, not stock Unreal `ActionMappings`. The M5 adapter targets
  this format, and `reference/game-files/everspace2-Input.before.ini` matches it.
- **Steam Input gives little.** Only the config a player has picked is cached locally, under
  `steamapps/workshop/content/241100/<id>/`, as text VDF. `configset_*.vdf` maps an app to it.
  Two games had one: Everspace 2 (9 Xbox bindings, no labels) and Stellaris (8 key presses
  with labels). Official per-game templates are not on disk until chosen, so they are not a
  harvest source.
- **Steam Input action manifests** (`game_actions_<appid>.vdf`): Sniper Elite 4 only.

## What it changes

- The *Xbox controller* preset can't rely on harvested pad layouts for most games. In pad mode
  the units send Xbox output, and the game's own pad bindings apply as shipped. The preset needs
  the Azeron → pad map only, plus action names for Play view. Those are entered by hand for
  Helldivers 2 now, or taught by pressing in v2.
- Harvesting for Everspace 2 needs the game to have saved its settings once. If the file has no
  `KeybindingsConfig` lines, the app asks the player to open the game's controls menu once and
  save.
- v2 format candidates, in order of what the owner plays: none of the owner's main four. Pick
  from the owner's next games.
