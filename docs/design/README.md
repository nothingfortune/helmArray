# Design

The UI is drawn on a canvas: https://claude.ai/artifact/SiRT17QxsbgA5YsvvQ89s2 (it needs the
owner's claude.ai sign-in). `canvas/` is a copy of its sources as of 2026-11-17, so a session
without access can read them. The live canvas wins over this copy, and both win over the
prose in `03-ui-system.md` for anything visual.

Each board is a `.dc.html` file: markup with `{{bindings}}` and a small `Component` class
whose `renderVals()` returns the values. Read the class for geometry and states; it
won't run outside the canvas (`support.js` isn't included). `canvas.json` lists the boards.

| Board                 | What                                                         |
| --------------------- | ------------------------------------------------------------ |
| `Main`                | The UI system sheet: tokens, type, components, rules         |
| `Unit`                | The Azeron unit component (either hand, 640 × 380)           |
| `Pedals`, `Keyboard`  | The pedal strip and keyboard components                      |
| `Contrast`            | WCAG 2.2 AA audit of every colour pair in use                |
| `Library`, `Devices`, `Settings` | The main screens                                  |
| `Editor` (+ `EditorPicker`, `EditorMacro`, `EditorKeys`) | The scheme editor and its states |
| `Play`, `PlayPad`, `PlayKeys` | Play view: Azerons, controller, keyboard and mouse   |

## Changing the canvas

A local session with the owner's claude.ai sign-in edits the live canvas through the Artifact
tool: read the board files it needs (`project/<Board>.dc.html`, and `project/canvas.json` only
when boards are added, moved or retitled), edit copies under one folder, and publish them to
the canvas URL with that folder as `root`. Then copy the same files into `canvas/` here in the
same PR, so the two never drift. A cloud session without that sign-in proposes design changes
in its PR instead.

When code starts using the design, the tokens in `03-ui-system.md` and `Main.dc.html` become
CSS variables (M0). If the canvas changes a token, the PR that syncs `canvas/` also updates
the variables.

## Where the canvas goes beyond the plan

The canvas was drawn further after `01-features.md` was written. These differ from the plan
and are the owner's to settle before the milestone that builds them:

1. **Virtual controller.** Devices lists one ("a virtual Xbox controller that Windows sees").
   Phase 1 rules it out: the Azerons send Xbox output themselves.
2. **Keyboard remaps and macros running through helmArray**, with "Start with Windows".
   Phase 1 has the keyboard as a fixed device and macros as v2.
3. **Macros and layers in the editor** (macro drawer, "Hold for layer 2"). Both are v2 in
   phase 1; the drawing is fine to keep as the v2 design.
4. **Pedal calibration and a response curve inside the app.** Phase 1 has the calibration in
   Windows (the app checks it) and dead zone, scale and invert written into the game's file.
5. **"Check firmware"** on a unit. No firmware command may be sent; reading the version is fine.
6. **Settings: "Check for updates"** matches M7's auto-update.

## Where the plan now goes beyond the canvas

The setups model (01-features.md, *Setups*, 2026-11-19) follows the Editor board's *Scheme*
picker, *Azerons | Keyboard* toggle and *Azerons send: Keys | Controller*. Two parts are not
drawn yet: a *Controller* device in that toggle, and a setup of the **left** Azeron with the
mouse (the right unit not drawn, or drawn idle). M4.5 built them in the app, to the canvas's style,
and has not drawn them on the canvas yet:

- **The Controller tab** draws the Play view's controller (`PlayPad`) with its controls as rows
  either side, scaled for editing; the rows are what is clicked and dropped on.
- **The mouse** is drawn with the keyboard, as `PlayKeys` has it, and in a left Azeron + mouse
  setup beside the left unit, where the right one was. The right unit is not drawn.
- **Devices ▾**, beside the device tabs: which Azerons (both, left + mouse, none), keyboard and
  mouse, Xbox controller.
- **The Scheme picker's contents**: the game's setups, *New from* (Xbox controller, Game's own
  keys, Copy this one), the name, and *Delete this scheme* behind a confirmation.
- **"Azerons send"** as a visible label before *Keys | Controller*.
- **In the side panel**, *Sends* is a choice of Xbox control for an Azeron button in controller
  output.
- **Below a 1440 px window** the side panel is 300 px, not 340, so the two units stay side by
  side at 1280 px (about 0.70, where the canvas's container queries stack them), and on the
  Keyboard tab the mouse goes under the keyboard when beside it the keyboard would be under 0.8.
- **The Apply drawer's game half**, "In the game's controls", one line per binding ("Set Reload
  to Xbox Y"), and after Apply the same lines as the bind sheet.
- **Recent games** in the Editor's bar, after the game's name: a muted "Recent" and up to three
  games as ghost buttons, each opening that game's scheme in one click (J3).
- **A check with no fix it can offer** says why after its sentence, in the secondary colour ("Every
  controller button is in use; clear one first."). A fix button is drawn only when applying it
  removes the finding and adds no error.
- **The checks' groups**: findings of one rule about actions of one role are one line ("**4
  movement actions** aren't on a button.") with one fix for them all, and *Show each* opens them.
- **The stick in the side panel** lists its four directions read only (each with its action and
  what it sends), and the action list has an *On the stick* group for the actions a stick does.
- **J1 from a preset** opens the Apply drawer straight away when the new scheme has nothing to
  fix (the owner, 2026-11-24): tile, preset, the drawer's Apply.
