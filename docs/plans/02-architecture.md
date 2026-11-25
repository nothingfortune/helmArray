# helmArray, phase 2: architecture

2026-11-17. Phase 2 of 4: features → **architecture** → UI system → roadmap.
Built from [01-features.md](01-features.md). A new repo; no code is imported from the old one, only the evidence in [reference/](../../reference/README.md).

## Stack

| Layer      | Choice                                   | Why                                                                                     |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Shell      | **Electron**                             | One language end to end. `node-hid` for the units, native hooks for live input, multiple windows (Play view) and a tray are first-class. Tauri is smaller but puts the hardware code in Rust, a second language for a one-person project. |
| UI         | React + TypeScript, Vite                 | The largest pool of good primitives.                                                    |
| Components | Radix primitives, own styling            | Accessible behaviour for free; the look is entirely ours (phase 3).                     |
| State      | Zustand in the window, the store in main | Small, no ceremony.                                                                     |
| Repo       | pnpm workspaces                          | Packages below, one `pnpm check` gate.                                                  |
| Tests      | Vitest; Playwright for Electron          | Core is pure, so most tests need no window or hardware.                                 |

## Packages

```
packages/
  core/      the model, the resolver, presets, checks. Pure TypeScript, no I/O, no Node.
  azeron/    the units: protocol, record encoding, pin maps, session over a Transport.
  games/     one adapter per game file format: find, harvest defaults, write.
  app/       Electron: main (services), preload (typed bridge), windows (React).
tools/
  repair/    re-map a unit's pins by pressing them. Dire straits only.
  hid-debug/ WebHID page that speaks the protocol from a browser. Debug only.
```

Rules: `core` imports nothing but itself. `azeron` and `games` import `core` types only.
Only `app/main` touches the disk, the units and other processes. The windows never do.

## The model (core)

```ts
type ControlId = string;            // "L.f1" … "R.stick" — fixed for the Cyborg II pair
type Signal =                       // what a control physically sends
  | { kind: "key"; code: KeyCode; mods?: Mod[] }
  | { kind: "mouse"; button: "left" | "middle" | "right" }
  | { kind: "scroll"; dir: "up" | "down" | "left" | "right"; speed: number }
  | { kind: "pad"; control: PadControl }              // A, RT, LS_UP …
  | { kind: "macro"; trigger: KeyCode };              // v2: the app types it

interface Device  { id: string; kind: "azeron" | "kbm" | "pad" | "pedals"; controls: Control[] }
interface Control { id: ControlId; kind: "button" | "stick" | "axis"; programmable: boolean }
// pedals: rudder (rests centred), left toe and right toe (rest at the end of travel).
// An axis maps to a game axis per mode (Yaw in the ship, Steer in the SRV), plus invert,
// dead zone and scale; a toe may drive one direction of an axis. Written only into a game file.

interface Game {
  id: string; name: string; steamAppId?: number;
  modes: Mode[];                    // at least one ("default")
  actions: Action[];
  file?: { format: "unreal-ini" | "elite-binds"; path?: string };   // writable if known
}
interface Action {
  id: string; name: string; mode: ModeId; role: Role; required: boolean;
  native?: { key?: Signal; pad?: PadControl };        // what the game ships with
}

interface Scheme {                  // a setup: the app keeps several per game
  id: string; gameId: string; name: string;
  devices: {
    azerons: "both" | "left" | "none";               // "left": the left unit and the mouse
    keyboard: boolean; mouse: boolean; controller: boolean;
  };
  output: "pad" | "keys";                            // what the Azerons send
  // pad output: which Xbox control each Azeron button sends (edited, not fixed)
  padMap: Record<ControlId, PadControl>;
  // per mode, per control, per press: which action
  map: Record<ModeId, Record<ControlId, Partial<Record<Press, ActionId>>>>;
  behaviour: Record<ControlId, Behaviour>;            // turbo, latch, stick mode + tuning
  ledger: Record<ControlId, Partial<Record<Press, Signal>>>;  // keys handed out, never re-dealt
  accepted: { rule: RuleId; control: ControlId; reason: string }[];
}
type Press = "tap" | "long" | "double";
```

A press (tap, long, double) is a slot on the control. The **ledger** is how "a key once given
never moves" is kept: the resolver reads it first and only allocates for what's new.

## The resolver

```
resolve(scheme, game, devices) → Plan
Plan = {
  units:        { left?: UnitProfile; right?: UnitProfile } // the setup's units only, every pin
  bindings:     Binding[]          // every control-press of the setup carrying an action
  gameBindings: GameBinding[]      // the game's bindings for the setup, whole (below)
  gameFile?:    { format }         // the file is written: its adapter writes gameBindings
  bindSheet:    GameBinding[]      // it isn't: the gameBindings that differ from what it ships
  ledger:       Ledger             // updated with any new keys
  findings:     Finding[]          // the resolver's own, then the checks
}
GameBinding = {
  set: "keyboard" | "controller"   // which of the game's two binding sets
  mode; action
  signal: Signal | null            // what the action is on; null: on nothing in this set
  native: Signal | null            // what the game ships it on in this set
}
```

**Game bindings** (M4.5) are the representation M5's adapters consume. For each binding set the
setup uses (controller: the controller, or Azerons sending Xbox controls; keyboard: the
keyboard, the mouse, or Azerons sending keys) the plan lists **every** action of the game in its
mode, not only what changed. The game holds whatever setup was applied last, so a setup applied
after another must be able to put an action back where the game ships it; a diff against the
shipped bindings could not. An adapter writes the whole set into the game's file (both sets, each
in the file's own terms); the bind sheet is the rows that differ from what the game ships; the
Apply drawer lists the rows that differ from the setup applied to the game last (the store's
applied plans), falling back to what it ships. An action may have two rows in the keyboard set
(two keys); in the controller set one, or the resolver's `pad-bound-twice` error.

Each action lands on the first of these that applies (`GAME BINDINGS` in `resolve.ts`):

1. A stick of the setup sends what the game ships it on (a key stick's direction keys; an Xbox
   stick's directions, the Azerons' or the controller's): it stays there. A button carrying it
   that sends anything else is `stick-key-rebind`.
2. Placed: on what each control-press of the setup carrying it sends.
3. Shipped on nothing in this set: on nothing.
4. Shipped on something that, in this mode, carries an action the game also ships there: kept
   (the game's own second use of one control: Helldivers 2's Climb on a held A, Interact on the
   tap).
5. Shipped on something that carries another action put there: on nothing (displaced).
6. Shipped on an Xbox control the setup sends, or on a key or mouse button of the setup's own
   keyboard or mouse, carrying nothing in this mode: on nothing. A control shown empty does
   nothing.
7. Otherwise kept: nothing of the setup sends it, or only an Azeron button sending keys for an
   action of another mode (J4 on the game's own keys).

**One controller set.** A pad control is one live control: the controller's own button and every
Azeron button sending it (`padSignalOf`). The editor keeps one action per pad control per mode
(assigning displaces what else was on it; clearing takes the action off every control sending
it), every control sending it shows that action, and `key-collision` flags any two actions on one
pad control that get past it. An action moves within one binding set: Fire can be on an Azeron
button sending RT and on the mouse's left button at once.

How each control-press gets its signal, in order:

1. **Pad output.** The signal is the pad control from the scheme's Azeron→pad map. The game's
   **controller bindings** are rewritten so each pad control does the action the scheme put on
   it: through the game's file where writable, otherwise as bind sheet rows (game bindings,
   below). The controller, when the setup has one, edits the same controller bindings (the game
   can't tell it from the Azerons), so the two can't disagree. A button sending no pad control
   gets a free one when an action is put on it: the one the game ships the action on if free,
   else the first free one; a button emptied in every mode stops sending.
   Keyboard and mouse controls in the setup attach the same way through the **keyboard
   bindings**: the action's key becomes the key the scheme put it on.
2. **Keys, game file writable.** Ledger first; otherwise the next free key from the pool
   (navigation, numpad operators, punctuation, then F13–F24 where the format can name them). The
   file then binds that key to the action in **every mode** the control is mapped in.
3. **Keys, no writable file.** The action's native key. A bind sheet lists anything that has none.

One signal per control-press per scheme, whatever the mode. That's what makes Elite's ship /
SRV / on foot a mode tab instead of three profiles.

Deterministic and pure: the same inputs give the same plan, byte for byte. That's the main test.

## Harvesting a game's defaults

Each format adapter can `harvest(installDir) → { modes, actions }`, every action with its
native key and native pad control. That is the game's own scheme, and it feeds three things:
the *game's own keys* preset, the *Xbox controller* preset (pad output knows what each pad
button does in this game), and the action names Play view shows.

| Source                                         | Gives                                   |
| ---------------------------------------------- | --------------------------------------- |
| Elite's shipped presets (`ControlSchemes/*.binds`) | every control, modes, keyboard and pad presets |
| Unreal `Input.ini` with full binding lines (Everspace 2) | actions, keyboard, pad, joystick rows |
| Unreal games that keep defaults inside their pak files | nothing readable; taught by pressing (v2) |
| Steam Input templates the game ships           | pad layout, where present (spike)       |

A harvest goes into the game's data (`games/<id>.json`), the same data the Game screen edits:
its modes, its actions with their default key and controller button, and `file.format`. Your
setups are always copies, and never change when the game's data does. With it the data keeps
what the file held at that read (`Game.fromFile`), so the next read can tell what you changed
from what the game changed.

**Reading the file again** (`mergeHarvest`, core's `harvest.ts`) never loses anything you typed.
Per field (an action's name, mode, role, *required*, default key and default button; a mode's
name), with what the file has now, what it had at the last read, and what the data has:

- The data still has what the file had last time: it takes what the file has now (the game was
  updated, or rebound in its own menu).
- The data has something else: that is yours, and it stays. A game never read before counts
  every value it has as yours; a value it doesn't have is filled from the file.
- A binding the file has because helmArray put it there (what the game holds from the last
  Apply, its baseline) isn't news from the game: it counts as what the file had last time. So
  Apply then a read changes no default.
- An action or mode in the file and not in the data is added at the end of its mode, unless its
  id is retired (you deleted it, or its mode: the Game screen's rule, so it never comes back) or
  its mode isn't there. One in the data and not in the file stays: added by hand, or gone from
  the file.
- `file.format` is the file's; the game's name, Steam id, retired ids and *the sticks must send
  keys* are the data's.

A re-read is shown before it is saved: one list of what changes (and what of yours stays though
the file differs), and one button. The first read of a game has nothing of yours to lose and
saves at once.

**Where it is read** (`app/main/game-harvest.ts`, read only: the game's file is never written by
a read). The games helmArray has a file format for are known by their Steam app id (Everspace 2,
1128920; Elite Dangerous, 359320). A game whose file is found and whose data the app doesn't have
yet is listed as a game helmArray knows (its Steam tile, *Game's own keys* offered) and is saved
the first time it is used: a scheme made from it, or an edit on the Game screen. So setting one up
from its tile is a click on the tile, one on the preset, and Apply, as for a game that ships with
helmArray. A game with a file format (or known by its id or Steam id) has *Read from the game's file*
on the Game screen. Deleting a game read this way brings it back from its file, fresh, the next
time the Library looks.

## Targets

```ts
interface Target<P> {
  preview(plan: P, current: Snapshot): Change[];   // what will change, in words for the UI
  apply(plan: P): Promise<ApplyResult>;            // does it
  verify(plan: P): Promise<Verified>;              // reads it back
}
```

| Target      | apply                                                                                  | verify                         | Refuses when                       |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------- |
| Units       | write the one slot, switch to it, delete every other slot; only the units the setup uses (left only for *left Azeron + mouse*) | read every slot back           | Azeron app running; unknown unit   |
| Game file   | back up, write the whole file: keyboard **and** controller bindings for the setup      | re-read, harvest, compare      | game running; file unreadable, or can't take the bindings (a file not found isn't a refusal: the bind sheet) |
| Bind sheet  | nothing to write; shown and printable                                                  | —                              | —                                  |
| Helper (v2) | load the macro program                                                                 | —                              | game not opted in                  |

**Apply** runs units then game file, and stops at the first failure with a plain reason.
The units' profile button is never part of any flow: the app writes, switches, and cleans up.

**The game file target** (M5, `app/main/game-file.ts`). Its preview is the write done in memory:
the file found (the adapter's `find`, under `%LOCALAPPDATA%`), read as UTF-8 and given the plan's
`gameBindings`, so a file that is unreadable or can't take them (a key it can't name, more
bindings than a line holds) is a check that isn't ready, before any unit is written; text that comes out the
same is not written at all. A file that isn't there (Everspace 2 saves one only once a control is
changed in its menu) doesn't stop Apply: the units are written, and the game's half is bind sheet
rows with one sentence saying why; the game's baseline doesn't move, so the Library's reminder
keeps them until *Done*. An action the file doesn't have (one added by hand on the Game screen)
has no line to write: its rows are bind sheet rows, listed apart in the drawer, the rest is
written, and the baseline moves for the rest only. The game must be closed, told from the running
programs; a game whose programs helmArray doesn't know can't be told running, so its file is
never written and its bindings stay on the bind sheet. A write keeps a copy of the file first in
the data folder (`backups/<game>/`, named by when, the newest five), then reads the file back:
the harvest of what it holds must be the harvest of what was meant, or the copy is put back. A
file written (or holding the bindings already) moves the game's baseline to them, so nothing is
left to set by hand. Elite's file is only ever the player's own (`Custom.4.1.binds`, as
`StartPreset.4.start` names it), never a preset the game ships.

The presets turn `writeGameFile` on for a game that has a file format, and *game's own keys*
puts each key it places in the ledger, so the units still send the game's own keys.

## The app (Electron main)

| Service        | Job                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `devices`      | Finds the two units by HID, tells left from right by the id each reports, reads what they hold on connect |
| `liveInput`    | Raw Input per device, so a key is attributed to the unit that sent it or to the keyboard / mouse; XInput for a controller and for the Azerons' pad output. Feeds Play view for every device. |
| `games`        | Reads the Steam library (installed games, cover art from Steam's local cache); finds each game's file    |
| `processes`    | Is the game running, is the Azeron app running (blocks writes; v2: auto-switch on launch)                |
| `store`        | The app's data                                                                                            |
| `apply`        | resolve → preview → targets                                                                               |

**IPC is one typed contract** (`app/src/contract.ts`): a list of commands and events, each with
its types. Preload exposes exactly that. No other way across.

**Windows:** Main (library, editor) and **Play view** (frameless, always-on-top or full-screen
on a second monitor, subscribed to `liveInput` and the active scheme). Tray icon: active game,
open Play view, quit.

## Storage

- `%APPDATA%/helmArray/`: `games/<id>.json`, `schemes/<id>.json`, `settings.json`.
  Each file carries `schemaVersion`; migrations run on load, one function per version. (Scheme
  version 3 added `devices`: an older scheme is both Azerons and nothing else. Applied plan
  version 2 added `gameBindings`: an older plan claims none.)
- **Snapshots:** every Apply saves the scheme and the plan it produced. History is a list in
  the UI, restore is one click.
- **Undo** in the editor is in memory, per scheme. Edits autosave; Apply is separate.
- **Export / import:** one `.helm` file (JSON) per scheme, its game included.
- Built-in presets and game action lists ship read-only inside the app; using one copies it.
- **A game's data is yours to add and edit.** `games/<id>.json` holds a game you added, or your
  copy of a built-in or harvested game (same id; yours wins, and *back to helmArray's* deletes
  your copy). Editing a game never changes the setups made from it: a setup names actions by id,
  and an action you delete shows as a finding in the setups that used it.

## Trust (the app always tells the truth)

- On connect, and after every Apply, the app reads the units and compares against the plan.
  The header shows one state: **In sync**, **Changes not applied**, or **Units differ** (with
  what). It is never inferred from what the app last did.
- A refused write says why and what to do, in one sentence.
- Every exchange with a unit goes to a rolling log, opened from Settings.

## Testing

| What                         | How                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Resolver, checks, presets    | Pure unit tests; golden plans                                                         |
| Unit protocol and encoding   | Byte-for-byte against captures of the units; a fake unit that misbehaves as the real ones do |
| Game file adapters           | Golden files: the game's real file in, expected file out; untouched lines identical  |
| App                          | Playwright on Electron with fake devices and a temp data folder                       |
| Hardware                     | A manual checklist per release, never in CI                                           |

No test touches a real unit, a real game file, or the user's data.

## Risks worth a spike first

1. **Per-device live input.** Raw Input needs a native addon (or a tiny helper). Prove it
   attributes a key to the left unit vs the keyboard before Play view is designed around it.
2. **Steam cover art** from the local library cache: confirm paths and formats across installs.
3. **Harvest coverage**: which of your games expose defaults we can read (files, Steam Input
   templates). Survey the installed library before promising the pad preset per game.

Phase 3: UI system. Phase 4: roadmap.
