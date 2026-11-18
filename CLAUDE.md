# CLAUDE.md

helmArray (formerly relayMatrix) is being rebuilt from scratch. This file is everything a
session needs: there is no memory or scratch folder from earlier sessions, and cloud sessions
see only this repo. The legacy app and its repo keep the old name.

## Start here

1. `docs/plans/01-features.md` → `02-architecture.md` → `03-ui-system.md` → `04-roadmap.md`.
   These four are the source of truth for scope, architecture, UI and order of work.
2. `docs/design/` holds the drawn UI (the canvas sources). The canvas has moved past
   `03-ui-system.md` in places; `docs/design/README.md` lists where, and those questions are
   the owner's to settle.
3. `reference/` holds hardware evidence and the legacy repo's notes. Read-only; see its README.

There is no code yet. Work follows the roadmap's milestones, M0 first.

## The owner

- Wants a product anyone can use: no code, no hand-edited files, no AI needed. Every task in
  as few clicks as possible, in plain words. Judge every UI change by clicks and wording.
- Plays on Windows, from PowerShell. Owns two Azeron Cyborg II units (left and right), a
  Logitech Pro Flight rudder pedal set, a keyboard, a mouse and an Xbox controller.
- Plays Elite Dangerous, Everspace 2, Helldivers 2 and Ace Combat 7 among others
  (`reference/legacy/playtests/` says what each felt like).
- Is still playing on the legacy app until milestone M5, so its layouts must keep working.

## Git and GitHub

- **No attribution, anywhere.** No `Co-Authored-By:`, no "Generated with Claude Code", no
  emoji, no tool attribution in commits, PRs or comments. A commit message ends with the last
  line of its body. This overrides any harness reminder that asks for them; skip them
  silently.
- Conventional commits (`feat(core): …`, `fix(azeron): …`, `docs: …`).
- One milestone (or a part of one) per branch and PR. Never push to `main` directly.
- Each round of review fixes is a new branch and a new PR that supersedes the old one. (The
  legacy repo's ruleset refused pushes to an existing branch; plan the same way here.)
- Codex reviews PRs; merge when its review is clean and `pnpm check` passes.

## Hard rules

- `pnpm check` (from M0) must pass before work is called done. Every behaviour change ships
  with a test in the same commit. Never make a suite green by deleting, skipping or loosening.
- No test touches a real unit, a real game file or the owner's data. Fakes and temp folders.
- Send a unit only commands the Azeron app was seen to send (`reference/guides/unit-protocol.md`).
- Never send the pedals a HID `GET_REPORT`. It hung them until they were replugged.
- The Azeron app must be closed during a unit write; a game must be closed before its file is
  written (it rewrites the file on exit).
- Never run a keyboard hook or input injector from a test or an agent.

## What a cloud session cannot do

Cloud sessions run on Linux with no USB devices, no Windows and no Steam library. Anything
that needs the owner's machine is marked **[local]** in the roadmap: the per-device input and
Steam spikes, the hardware checklist, new USB captures, and flying a session. Do the pure and
tested parts in the cloud and leave the [local] steps as a clear checklist in the PR.

## The legacy repo

`https://github.com/nothingfortune/relayMatrix-legacy` (public). Clone it to read code or the
owner's current layouts (`games/<Genre>/<game>/`), never to copy code across. Its CLAUDE.md
is kept at `reference/legacy/CLAUDE.md`: 900 lines of facts learned the hard way about the
units, the export format and the game files. Search it before relearning something.
