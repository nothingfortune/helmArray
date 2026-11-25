# Setup

How to install, run and check helmArray from source on Windows. There is no installer yet.

## What you need

- Node 24.
- pnpm, the version `package.json` pins in `packageManager`. `corepack enable` sets it up, or
  install that version globally.
- Git.

## Install

From PowerShell, in the repo folder:

```powershell
pnpm install
```

pnpm refuses a dependency newer than its minimum release age. If an install fails on that,
pin an older version of the package rather than adding an exclusion.

## Commands

| Command        | Does                                                                                    |
| -------------- | --------------------------------------------------------------------------------------- |
| `pnpm dev`     | Starts the app with hot reload. Close the Azeron app first: helmArray waits while it runs. |
| `pnpm check`   | The gate: typecheck, lint, format, tests with coverage, coverage drift. CI runs exactly this. |
| `pnpm test`    | The tests on their own, without coverage.                                               |
| `pnpm test:e2e` | Builds the app and drives it in a real window over two fake units: the M4 screens (J1, J2, the Azeron app refusal), setups (J1 and J2 as a controller, left Azeron + mouse, keyboard only, switching setups), the game's file in Apply (Everspace 2's, a copy, in the temp folder), the game's file read into its data (Everspace 2 and Elite from their tiles, Everspace 2's again from the Game screen, a file with nothing to read, Everspace 2 with no file yet, Everspace 2 deleted and set up again from its tile, and Everspace 2 typed in by hand then read), the mode tabs on Elite (J4 counted, the file bound per mode, the tabs by keyboard), the Editor's layout at 1440 and 1280 px wide, with and without the mode tabs (no window scroll, both units in view, the 10 px label floor), the bundled fonts, the keyboard and an axe scan of each. Not part of `pnpm check`. |
| `pnpm test:mutation` | Mutation testing over the whole scope (Stryker): does a test notice when the code is broken. Takes hours, so run it per area with the next command. Informational: never part of `pnpm check`, never blocks anything. |
| `pnpm test:mutation:file -- <glob>` | The same over one file or glob, e.g. `pnpm test:mutation:file -- packages/azeron/src/records.ts`. Minutes for a file. The report is `reports/mutation/mutation.html`; the last results are kept in `reports/mutation/incremental.json`, so a re-run tests only what changed. |
| `pnpm format`  | Rewrites files to the house format (`pnpm check` only reports).                          |
| `pnpm tokens`  | Rewrites `styles/tokens.css` from `src/shared/tokens.ts` after a token changes.          |

The built app takes `--play` to open Play view beside the main window, for a shortcut that
starts straight into play.

No test talks to a real unit, game file or your settings, so `pnpm check` is safe with
everything plugged in. The same goes for `pnpm test:e2e`: it sets `HELM_E2E=1` and `HELM_E2E_DIR` (a
temp folder), which swap in fake units, a fake list of running programs, a Steam folder inside the
temp folder, a folder inside it for the games' files in place of `%LOCALAPPDATA%`, and that folder
for the app's files. With the switch set the real HID backend throws
if anything reaches it. It opens a window for a few seconds without taking the keyboard focus, and
needs Electron's binary (`node packages/app/node_modules/electron/install.js` if it is missing).

How the tests are written and what the gate holds them to, and what mutation testing is for, what it covers and how to read it: [`testing.md`](testing.md). Mutation testing is also a manual workflow on the build rig (`.github/workflows/mutation.yml`, one glob per run); like the command, it is informational.

## Where the app keeps things

| What                              | Where                                       |
| --------------------------------- | ------------------------------------------- |
| Which unit is which hand          | `%APPDATA%\@helmarray\app\hands.json`       |
| The exchange log (and `.1` before it) | `%APPDATA%\@helmarray\app\logs\exchange.log` |
| A copy of each game file, kept before Apply writes it (the newest five per game) | `%APPDATA%\@helmarray\app\backups\<game>\` |

Settings → Exchange log shows the same log and opens its folder. Deleting `hands.json` makes
the app ask which unit is which again.

## Trying it on the units

[`hardware-checklist.md`](hardware-checklist.md) is the hand-run test on the real units, pedals
and (from M4) a game. Back up both units from the Azeron app before a run.
