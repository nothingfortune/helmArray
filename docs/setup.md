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
| `pnpm check`   | The gate: typecheck, lint, format and tests. CI runs exactly this.                      |
| `pnpm test`    | The tests on their own.                                                                 |
| `pnpm format`  | Rewrites files to the house format (`pnpm check` only reports).                          |
| `pnpm tokens`  | Rewrites `styles/tokens.css` from `src/shared/tokens.ts` after a token changes.          |

The built app takes `--play` to open Play view beside the main window, for a shortcut that
starts straight into play.

No test talks to a real unit, game file or your settings, so `pnpm check` is safe with
everything plugged in.

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
