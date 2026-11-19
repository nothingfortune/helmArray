# helmArray, phase 4: roadmap

2026-11-17. Phase 4 of 4: features → architecture → UI system → **roadmap**.
Built from [01-features.md](01-features.md), [02-architecture.md](02-architecture.md) and
[03-ui-system.md](03-ui-system.md).

## How it's ordered

1. **Risk first.** Spikes that could change the design run before anything is built on them.
2. **Pure before wired.** `core` and `azeron` are proven in tests, with no window and no hardware,
   before the app touches either.
3. **A journey per milestone.** Every milestone ends in something you can do, judged by the
   journeys (J0–J5) and their click counts, not by a list of finished components.
4. **The legacy repo stays usable until cutover.** You keep playing on it. Nothing in the new
   app has to be good enough to play with until M5.

Sizes are relative (S, M, L). There are no dates.

**[local]** marks a step that needs the owner's Windows machine: the units, the pedals, Steam
or a game. Everything else can run in a cloud session. A cloud PR that reaches a [local] step
ends with it as a checklist for the owner.

## Milestones

### M0 · Foundations and spikes (M)

The repo can build, test and ship an empty window, and the three risks from phase 2 are answered.

- pnpm workspace with `core`, `azeron`, `games` and `app`. Electron, Vite, React and Radix wired up.
  One `pnpm check` gate: typecheck, lint, format and tests. GitHub Actions runs it on every PR.
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no `any`). Lint
  rules enforce the package boundaries: `core` imports nothing, and only `app/main` does I/O.
- The design tokens from phase 3 as CSS variables. A blank main window and a blank Play view
  window open, and the tray icon shows.
- **[local] Spike 1, per-device input.** A throwaway native addon (or helper) uses Raw Input to report
  which device sent a key: the left unit, the right unit or the keyboard. If it can't, Play view
  falls back to showing the scheme without per-unit lighting, and phase 3 is amended.
- **[local] Spike 2, Steam covers.** Read `libraryfolders.vdf` and the local library cache on this
  machine and one clean install, and list the path and format of each game's cover art.
- **[local] Spike 3, harvest survey.** For every installed game, record what defaults can be read: a
  file, a Steam Input template, or nothing. That decides which games get a pad preset in v1.

**Done when** `pnpm check` is green in CI, the windows open, and each spike has a one-page answer
in `docs/spikes/`.

### M1 · The model and the resolver (L)

`core`, entirely pure.

- Types from phase 2: Device, Control, Game, Action, Mode, Scheme, Signal and Press.
- The built-in devices: both Cyborg IIs (control ids, which control is which pin), keyboard and
  mouse, Xbox pad, pedals.
- `resolve(scheme, game, devices) → Plan` for all three paths: pad output, keys with a writable
  file, and keys with no file (native key, otherwise a bind sheet row). The ledger is read
  first, and the key pool only grows at its end.
- Presets: *Xbox controller* (the Azeron → pad map), *game's own keys*, *copy a scheme*.
- The eight checks from phase 1, plus accepting a finding with a reason.
- Schema versions and the migration runner.

**Done when** golden plans pass: the same inputs give the same plan byte for byte, a key once
given is never re-dealt across edits, and every check has a passing and a failing case.

### M2 · Talking to the units (L)

`azeron`, tested against [reference/unit-protocol](../../reference/README.md).

- Report building and parsing; record encoding for keys, mouse buttons, scroll, Xbox
  buttons and triggers, and the stick in all three modes with tuning.
- `UnitProfile` from a Plan, using the press-tested pin maps. The right unit's rotated thumb
  cluster and its X fact are device data, not special cases.
- A session over a `Transport`: identify, read every slot, write one, read it back, switch to it,
  delete the rest. Only the commands the app was seen to send can be built.
- A fake unit that misbehaves as the real ones do: `REQUEST_PROFILE` answers with the running
  slot, and `CHECK_PROFILE` only answers for the lowest free number.

Open from the legacy work (`reference/legacy/handoff-2026-11-15.md`): how a unit stores scroll,
the stick as the Xbox **right** stick, and a chord each needed a **[local]** capture. The
captures of 2026-11-19 (`reference/captures/2026-11-19/FINDINGS.md`) settled scroll and the
right stick, now built; a chord was written by the app but waits on the model (one key per press).

**Done when** a write reproduces `onboard-112.json` byte for byte, every reference capture
parses, and the session's write → verify → switch → clean-up passes against the fake.

### M3 · J0: plug in and the app knows (M)

The first build that touches hardware.

- `devices` service: find both units over `node-hid`, tell left from right by the id each reports,
  read what they hold on connect and on replug.
- The sync pill and the device chips in the header (Left, Right, Pedals), read from the units and
  never inferred.
- `processes` service: is the Azeron app running (writes blocked, with the reason in one sentence).
- A rolling log of every exchange, opened from Settings.
- Hardware checklist v1 in `docs/hardware-checklist.md`. **[local]** Run by hand on the real units.

**Done when** both units plugged in on a fresh install show as Left and Right with no click,
and unplugging one turns its chip off within a second.

### M4 · J1 and J2: pick a game, play (L)

The first time the app replaces the Azeron app for a real game.

- `games` service: Steam library with covers (from spike 2), add a game by hand, game running.
- Library screen: the "on your Azerons now" card and the cover grid with a status line each.
- Editor screen: the Unit component from phase 3, both hands side by side, the side panel
  (selected button, presses, turbo and latch, what it sends, unplaced actions), drag to assign,
  checks under the units, undo, autosave.
- Apply drawer: what's ready, then what changes per target. Units target only in this milestone.
- Pad output end to end: pick a game, pick *Xbox controller*, Apply, play. Helldivers 2 is the
  test game.

Owner requests carried from the legacy app (`reference/legacy/handoff-2026-11-17.md`), each
answered here: a straight controller setup (keypad buttons send Xbox buttons, no actions) is
the *Xbox controller* preset; editable defaults are copies of presets; more mouse
responsiveness is the stick's mouse speed in the side panel.

**Done when** J1 takes 2 clicks and J2 is a drag plus Apply on Helldivers 2, verified with the
hardware checklist **[local]**.

### M5 · Game files, modes and pedals (L)

Key mode, and the two games you fly. **This is the cutover point.**

- `games` adapters: Unreal `Input.ini` (Everspace 2) and Elite `.binds` + `StartPreset`. Each
  has harvest, preview and write, a backup first, and a refusal while the game runs. Golden files
  come from [reference/game-files](../../reference/README.md): untouched lines stay identical and
  CRLF is kept.
- Harvesting fills each game's defaults and the *game's own keys* preset.
- Modes as tabs in the editor; one signal per control-press across modes (J4 on Elite).
- Bind sheet target for games with no writable file.
- Pedals: per-mode axis assignments, invert, dead zone, scale, a toe on one direction of an
  axis, and the calibration check. Written into the game file only; the pedals are never sent a
  `GET_REPORT`.
- **[local]** Rebuild your current Everspace 2, Elite and Helldivers 2 layouts in the new app, by hand, from
  the legacy repo's boards.

**Done when** **[local]** you fly an Everspace 2 session and an Elite session (ship and on foot) on schemes
the new app applied. Then archive `relayMatrix-legacy`.

### M6 · J5: Play view (M)

- `liveInput` service from spike 1: per-device keys, and XInput for the pad and the Azerons' pad
  output.
- The Play view window: frameless, always on top or full screen on a second monitor, with tabs for
  Azerons, keyboard and controller. Every control is labelled in the game's words and lit as
  pressed, with the last few presses along the bottom. Switch modes with a click.
- Tray: active game, open Play view, quit.

**Done when** **[local]** J5 takes 1 click and a press lights its key within a frame on both units.

### M7 · Trust and release (M)

- Snapshots on every Apply, the history list, one-click restore.
- Export and import a `.helm` file.
- The screens that weren't drawn: first run, Devices, Settings, the bind sheet and history.
  Narrow windows below 1280 px.
- Playwright on Electron, with fake devices and a temp data folder, covering J0–J5.
- A signed Windows installer and auto-update from GitHub Releases.

**Done when** **[local]** v1.0.0 installs on a clean machine, and J0–J5 pass both the e2e suite and the hardware
checklist.

## After v1

In rough order, each one designed for already (phase 1's v2 column):

1. Switch scheme automatically when a game starts; Play view follows the game's mode by itself.
2. Teach a game by pressing, for games with no readable defaults; built-in action lists.
3. Macros through a helper, opt-in per game. Never run from a test.
4. Layers, then chords.
5. More game file formats, chosen from the spike 3 survey.
6. Repair utility (re-map a unit's pins) and `tools/hid-debug`.
7. Cheat sheet export, and sharing schemes.

## Working rules for this repo

- `pnpm check` must pass before anything is called done. Every behaviour change ships with a test.
- No test touches a real unit, a real game file or your data. Fakes and temp folders only.
- One milestone per branch and PR. `main` stays releasable from M4 on.
- Conventional commits, with no attribution trailers.
