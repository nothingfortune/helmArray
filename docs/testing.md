# Testing

How helmArray's tests are built, and what keeps them honest. A green suite is only worth what it
can fail on, so most of this is about the ways a test can pass while checking nothing.

`pnpm check` is the single gate and CI runs exactly it: typecheck, lint, format, the tests with
coverage, and the coverage drift check. If it passes locally it passes in CI.

## The layers

| Layer              | What it tests                                                                                        | Where                                                  | State     |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------- |
| Unit               | Pure modules: core, azeron, games, app's shared and renderer logic; the renderer's parts drawn to markup with `react-dom/server` (what each state shows; clicks are e2e's) | `*.test.ts(x)` beside the source, and root `test/`     | In the gate |
| Integration        | Main-process services wired together, with a fake HID unit and temp folders                          | `test/integration/`, `*.test.ts` in `packages/app/src/main` |  In the gate |
| End to end         | The real app: Playwright on Electron over fake units, a temp data folder, a fake Steam and a fake game folder (the M4 journeys, the game's file in Apply and read into the game's data, Elite's file made from its shipped preset, a game read from its file and deleted, the mode tabs and J4 on Elite, the layout at 1440 and 1280 px, the fonts, the keyboard, axe) | `packages/app/e2e/*.spec.ts`, run by `pnpm test:e2e` | Outside the gate |
| Mutation           | Whether the tests notice when the code is broken: Stryker, over the pure logic that can do damage   | `pnpm test:mutation`, `.github/workflows/mutation.yml` | Outside the gate, informational |
| Hardware checklist | The real units, pedals and a game, run by hand                                                       | [`hardware-checklist.md`](hardware-checklist.md)       | Manual    |

The hardware checklist is never automated. No test, in any layer, touches a real unit, a real
game file or the owner's data: fakes and temp folders only. Never send the pedals a HID
`GET_REPORT`, and never run a keyboard hook or an input injector from a test.

Vitest tests never import `electron` (it downloads its binary on first use). Main-process logic
lives in pure modules beside `src/main/index.ts` and is tested there. The Electron glue itself,
`src/main/index.ts` and `src/preload/index.ts`, is what the end-to-end suite (`pnpm test:e2e`) covers, and is the
only code left out of coverage for that reason. The e2e switch itself (`e2e-seam.ts`, `e2e-fakes.ts`,
the guard in `hid-backend.ts`) is counted and has vitest tests: a run with `HELM_E2E=1` can never
reach a real HID device.

## Integration tests

`test/integration/` runs the main process as `src/main/index.ts` wires it: `compose.ts`
(`composeServices`) builds the store, the hands file, the devices service and its gate, the
coordinator, Apply, the Library and the exchange log, and `index.ts` calls the same function. Only
the edges are faked, with the fakes this document already allows: the HID bus (`FakeUnit` from
`@helmarray/azeron` behind a fake backend that hands out hidapi-style paths), the process list,
Steam's files, and the clock (a clock and a scheduler the test moves by hand). The store, the
hands file, the log and the games' files are real, on a temp folder (a game's file is a copy of
one in `reference/game-files`, where the game keeps it under the world's own `%LOCALAPPDATA%`);
a test that needs the disk to fail swaps `world.gameDisk`.

`support/world.ts` is the harness. A test drives the app through `window.helm` (the preload's
`createHelmApi` over an in-memory bridge to the real `registerHelmIpc`), plays the owner at the
edges (`world.left.unplug()`, `world.processes.azeronOpen`, `world.left.unit.running`), and reads
the result from the same places a window would and from the fakes. `support/fake-hid.ts` records
everything that reaches the bus, including any feature report, so "the pedals were never touched"
is read at the bus, not assumed.

A file's `beforeAll` does the journey once and each test reads one thing it left behind; a test that
changes the world makes its own.

## Rules

- **Every behavior change ships with a test in the same commit.**
- **Every bug fix starts with a failing test.** Watch it fail, then fix it, and watch it fail
  for the right reason. A test that is green before the fix is not testing the bug. That is the
  alarm, not a convenience. The usual cause is an assertion that a different path satisfies, a
  setup that never reaches the state being asserted about, or a matcher that accepts any
  outcome.
- **Assert what separates the branches, not what they share.** If deleting the branch you just
  wrote leaves the suite green, the test is decoration.
- **Drive the precondition, do not assume it.** For "on the second attempt", "after a reload",
  "when the unit is unplugged": assert first that the state the behavior depends on exists, or
  the test passes through the ordinary path and tests nothing.
- **Mock only what crosses the network, the filesystem, the clock, the HID device or the process
  list.** Prefer real objects. Those five are faked with the fakes already in the repo (the
  fake HID unit in `@helmarray/azeron`, temp folders, fake timers); nothing else is.
- **One expected result per test. No conditionals** and no `try`/`catch` that let it pass either
  way. To assert on a thrown error use `await expect(promise).rejects.toThrow('the message')`,
  or in a root test the `thrown()` and `thrownAsync()` helpers in `test/thrown.ts`, which return
  the error to assert on and fail when nothing was thrown. To check every item of a list,
  collect the faults into an array and assert it equals `[]`, so a failure names them all.
- **Never make a suite green by deleting a test, adding `.skip` or `.todo`, or loosening an
  assertion.** If a test is wrong, say so and explain why before changing it.
- **Tests clean up after themselves.** See below.
- **Test observable behavior through public interfaces.** If a test needs something private,
  the boundary is wrong: fix the boundary, do not export the internal.

## What the gate enforces

The rules above that a machine can hold, it holds.

**Lint, on every test file** (`*.test.ts(x)` beside the source, and `test/**`). All are errors,
and `eslint --max-warnings=0` is part of the gate:

| Rule                                  | Bans                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `vitest/expect-expect`                | A test with no assertion at all                                               |
| `vitest/require-to-throw-message`     | `toThrow()` with no message: it passes for any error, including the wrong one |
| `vitest/no-conditional-expect`        | An `expect` inside an `if` or a `catch`, which never runs when not reached    |
| `vitest/valid-expect` (`maxArgs: 2`)  | A malformed `expect`, such as an async matcher nobody awaits                  |
| `vitest/no-identical-title`           | Two tests with one title                                                      |
| `vitest/no-focused-tests`             | `.only`                                                                       |
| `vitest/no-disabled-tests`            | `.skip`                                                                       |

`maxArgs` is 2 because Vitest, unlike Jest, takes a failure message as the second argument of
`expect`, and a named assertion is how a failure explains itself. `test/lint-test-integrity.test.ts`
lints a bad example of each and fails if the rule is not an error where tests live.

`test/no-disabled-tests.test.ts` reads the test files themselves for what lint cannot see: a skip
or focus hidden behind an `eslint-disable` comment, and `.todo`.

**Temp folders.** `scripts/vitest-tmp-setup.ts` points `os.tmpdir()` (and `TEMP`, `TMP`, `TMPDIR`)
at a folder made for the run, and removes it when the run ends. If a test left anything in it,
the run fails and names what was left. So a test that makes a temp folder removes it, in
`afterEach`, and waits for anything still writing into it (a debounced save, a flush) before it
does. `test/tmp-containment.test.ts` proves the failure fires, including with a real child
Vitest run that plants a leak. A folder left over from a run that was killed is swept the next
time, once it is a day old.

**Workflows.** `test/workflow-hygiene.test.ts` checks every job in `.github/workflows` runs on
`[self-hosted, linux, x64, build-rig]` and sets `timeout-minutes`. Never a GitHub-hosted runner.

## Coverage

`pnpm test:coverage` runs the tests with V8 coverage over all source in `packages/*/src`, not
just what a test happens to load, so an untested file shows as 0% and cannot vanish from the
report. It prints the totals and writes `coverage/` (git-ignored; open `coverage/index.html` to
see the lines).

- Files are left out of coverage by explicit path in `vitest.config.ts`, with a comment saying
  why. Never a blanket `**/index.ts`: that also hides real code. Today only the Electron glue
  and a types-only file are out.
- The floor, `coverage.thresholds` in `vitest.config.ts`, sits about 1 point under what is
  measured, so the gate catches a slide and never honest work. **The floor only goes up.** When
  a change makes coverage fall below it, the new code needs tests: do not lower the floor.
- The floor is kept close by a ratchet. `pnpm coverage:drift` runs in `pnpm check` right after
  coverage and fails when any metric is more than 2 points above its floor, or when the summary
  is missing. A floor left behind stops catching regressions. The remedy is always to raise the
  floor to about 1 point under the new measured totals, never to widen the 2.

Coverage says a line ran, not that anything checked it. A line covered by the wrong branch counts
as covered. That is what mutation testing is for.

## Mutation testing

Mutation testing answers what coverage cannot: **can this code be broken without a test noticing?**
Stryker changes the source one small way at a time (flips a `<`, drops a branch, empties a
string) and runs the tests for each change, a mutant. A mutant the tests fail on is killed. One
they pass on survived: the code can be broken that way and nothing would say so. Coverage cannot
tell, because a line the wrong branch ran still counts as covered.

**It is informational. It does not block, so it must not look like it blocks.** It is not in
`pnpm check`, not a pull-request check and not a required status: `thresholds.break` is `null`,
and `.github/workflows/mutation.yml` runs only when someone dispatches it. The score is read and
acted on by a person.

### What it mutates

The pure logic that can do damage, listed in `stryker.config.mjs` (`mutate`):

- `packages/azeron/src`: the report and command protocol, the record encoding, the profile, the
  session, what is read back and what a write is verified against. Not `index.ts` or `fake.ts`.
- `packages/core/src`: `resolve.ts`, the presets, `checks.ts` (the findings), `placed.ts` (whether
  an action is placed, on a control or a stick), `sticks.ts`, the games, `game-data.ts` (a
  game's data checked before it is saved) and `harvest.ts` (a game's file merged into its data).
- `packages/games/src`.
- `packages/app/src/main`: `apply-units`, `apply-service`, `gated-session`, `plan-fingerprint`,
  `scheme-plan`, `active-plans`, `sync-state`, `devices` and `devices-gate`, `hands`,
  `hand-finder`, `store`, `hid-transport`, `processes`, `game-file` (the game's file written by
  Apply), `game-harvest` (the game's file read into its data), `exchange-log`, `e2e-seam` and `compose`.
- `packages/app/src/renderer`: the pure models `editor-model`, `editor-view`, `libraryView`,
  `libraryFlow`, `applyFlow`, the checks' `fixes` and `check-groups`, `offer-work` and `offer-slices`, `recent-games` and `reveal`, the `action-picker`, the mode tabs' keys (`mode-tabs`), and the Game screen's `game-model`, `game-editor`, `file-read`
  (what reading the game's file changes), `capture` (press-to-set), `press-listener` and `gameTile`.

Not React components, CSS, `index.ts` or the preload: the Playwright e2e suite covers those, and
mutating them would measure the wrong suite.

### Thresholds

`high: 90`, `low: 75`, `break: null`. Under 75 the report colours a file red, under 90 amber. The
score is mutants killed or timed out, over those and the survivors and the ones nothing ran. A
mutant that does not compile is discarded by the TypeScript checker and is not counted.

### Reading a run

`reports/mutation/mutation.html` lists every survivor with the line, what it was changed to, and
the tests that ran and passed. Each one is one of:

1. **A missing test.** Write one that asserts the behavior through the public interface, and watch
   it fail on the mutant. Do not export an internal to reach it.
2. **A real bug.** Write the failing test first, then fix.
3. **An equivalent mutant**, one no test can tell from the original. Prefer removing the redundant
   code that makes it equivalent. If the code stays, accept the mutant in the source:

   `// Stryker disable next-line <Mutator>[,<Mutator>]: <reason>`

   on the line before the one the mutant is on. Only that single-line form is allowed, with the
   mutators named (never `all`) and a reason given. **"Hard to test" is not a reason**, and
   neither is "tests would be long": only a true equivalent (a guard the types or the caller make
   unreachable, a label that can never be printed). A directive is line-wide for the mutators it
   names, so it must not also hide a mutant a test can kill. `test/stryker-disable-comments.test.ts`
   refuses every other form, an unknown mutator name and the obvious non-reasons, and runs over
   every file in `packages/`.

### How it runs here

- `vitest.stryker.config.ts` extends the base config and drops what a mutation run cannot use:
  coverage, and the meta-tests that spawn child runs or lint the repository.
- The packages reach each other through `node_modules` links that lead back to the real,
  unmutated tree. The Stryker config points `@helmarray/azeron`, `core` and `games` at the
  sandbox's own source, so every test that uses them (the reference-capture tests in `test/`, the
  integration tests, the app's own) can kill a mutant in them.
- Temp containment still holds: `scripts/vitest-stryker-tmp-setup.ts` is `vitest-tmp-setup.ts` with
  the run folder made inside the sandbox. Stryker kills and restarts its runner whenever a mutant
  makes a test hang, a killed runner never reaches its teardown, and in the real temp folder that
  left a `helm-test-*` folder behind for each restart. Inside the sandbox they go when Stryker
  removes it, and a test that leaks still fails the run.
- Stryker's own glob option replaces the config's `mutate` list, `!` exclusions included, so a bare
  glob would mutate the tests and the fake unit. Every run over a glob, the workflow included,
  goes through `pnpm test:mutation:file`, which puts the exclusions back;
  `test/mutation-entry-points.test.ts` fails if a workflow, package script or doc bypasses it.
- `incremental: true`, with `reports/mutation/incremental.json` committed: a re-run tests only the
  mutants whose code or tests changed. `pnpm exec stryker run --force` ignores it
  and tests everything.
- Concurrency is 3: the build rig can take more, a laptop with little memory cannot.
- A full run takes hours (about 1.5 hours for `packages/azeron` alone). Run it per area.

## Running them

| Command               | Does                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `pnpm check`          | The whole gate                                                            |
| `pnpm test`           | Just the tests, without coverage                                          |
| `pnpm test:coverage`  | The tests with coverage and the floor                                     |
| `pnpm coverage:drift` | Whether the floor is within 2 points of the last measured totals          |
| `pnpm lint`           | Just lint, including the test-integrity rules                             |
| `pnpm test:mutation`  | Stryker over the whole scope. Hours. Not in the gate, informational       |
| `pnpm test:mutation:file -- <glob>` | Stryker over one file or glob, e.g. `packages/azeron/src/records.ts`; the exclusions in the config (tests, barrels, fakes) still apply |

To run one file: `pnpm vitest run packages/core/src/resolve.test.ts`.
