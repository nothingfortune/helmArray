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
| `pnpm test:e2e` | Builds the app and drives it in a real window over two fake units: the M4 screens (J1, J2, the Azeron app refusal), the keyboard and an axe scan of each. Not part of `pnpm check`. |
| `pnpm format`  | Rewrites files to the house format (`pnpm check` only reports).                          |
| `pnpm tokens`  | Rewrites `styles/tokens.css` from `src/shared/tokens.ts` after a token changes.          |

The built app takes `--play` to open Play view beside the main window, for a shortcut that
starts straight into play.

No test talks to a real unit, game file or your settings, so `pnpm check` is safe with
everything plugged in. The same goes for `pnpm test:e2e`: it sets `HELM_E2E=1` and `HELM_E2E_DIR` (a
temp folder), which swap in fake units, a fake list of running programs, a Steam folder inside the
temp folder and that folder for the app's files. With the switch set the real HID backend throws
if anything reaches it. It opens a window for a few seconds without taking the keyboard focus, and
needs Electron's binary (`node packages/app/node_modules/electron/install.js` if it is missing).

How the tests are written and what the gate holds them to: [`testing.md`](testing.md).

## Where the app keeps things

| What                              | Where                                       |
| --------------------------------- | ------------------------------------------- |
| Which unit is which hand          | `%APPDATA%\@helmarray\app\hands.json`       |
| The exchange log (and `.1` before it) | `%APPDATA%\@helmarray\app\logs\exchange.log` |

Settings → Exchange log shows the same log and opens its folder. Deleting `hands.json` makes
the app ask which unit is which again.

## Trying it on the units

[`hardware-checklist.md`](hardware-checklist.md) is the hand-run test on the real units, pedals
and (from M4) a game. Back up both units from the Azeron app before a run.
