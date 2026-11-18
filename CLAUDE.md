# CLAUDE.md

relayMatrix is being rebuilt from scratch. Read `docs/plans/01`–`04` before changing anything.
They are the source of truth for scope, architecture, UI and order of work.

- `reference/` holds hardware evidence from the legacy repo. It is read-only; see its README.
- There is no code yet. M0 in `docs/plans/04-roadmap.md` sets up the workspace and the
  `pnpm check` gate.
- No test touches a real unit, a real game file or the owner's data.
- Never send the pedals a HID `GET_REPORT`. Send a unit only commands the Azeron app was seen to send.
- No attribution trailers on commits or PRs.
