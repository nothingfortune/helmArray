# relayMatrix, phase 2: architecture

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

interface Scheme {
  id: string; gameId: string; name: string;
  output: "pad" | "keys";
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
  units:     { left: UnitProfile; right: UnitProfile }   // every pin, fully specified
  gameFile?: { format; before; after }                    // a whole new file, not a patch list
  bindSheet?: Row[]                                       // what to press in the game's menu
  ledger:    Ledger                                       // updated with any new keys
  findings:  Finding[]                                    // the checks
}
```

How each control-press gets its signal, in order:

1. **Pad output.** The signal is the pad control from the preset's Azeron→pad map. Actions
   attach through the game's file where writable, otherwise through the game's own pad layout.
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

Harvested data is stored as the game's **defaults**, read-only; your scheme is always a copy.
Re-harvest after a game update shows what changed.

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
| Units       | write the one slot, switch to it, delete every other slot                              | read every slot back           | Azeron app running; unknown unit   |
| Game file   | back up, write the whole file                                                          | re-read, compare               | game running                       |
| Bind sheet  | nothing to write; shown and printable                                                  | —                              | —                                  |
| Helper (v2) | load the macro program                                                                 | —                              | game not opted in                  |

**Apply** runs units then game file, and stops at the first failure with a plain reason.
The units' profile button is never part of any flow: the app writes, switches, and cleans up.

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

- `%APPDATA%/relayMatrix/`: `games/<id>.json`, `schemes/<id>.json`, `settings.json`.
  Each file carries `schemaVersion`; migrations run on load, one function per version.
- **Snapshots:** every Apply saves the scheme and the plan it produced. History is a list in
  the UI, restore is one click.
- **Undo** in the editor is in memory, per scheme. Edits autosave; Apply is separate.
- **Export / import:** one `.relay` file (JSON) per scheme, its game included.
- Built-in presets and game action lists ship read-only inside the app; using one copies it.

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
