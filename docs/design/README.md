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

## Where the canvas goes beyond the plan

The canvas was drawn further after `01-features.md` was written. These differ from the plan
and are the owner's to settle before the milestone that builds them:

1. **Virtual controller.** Devices lists one ("a virtual Xbox controller that Windows sees").
   Phase 1 rules it out: the Azerons send Xbox output themselves.
2. **Keyboard remaps and macros running through relayMatrix**, with "Start with Windows".
   Phase 1 has the keyboard as a fixed device and macros as v2.
3. **Macros and layers in the editor** (macro drawer, "Hold for layer 2"). Both are v2 in
   phase 1; the drawing is fine to keep as the v2 design.
4. **Pedal calibration and a response curve inside the app.** Phase 1 has the calibration in
   Windows (the app checks it) and dead zone, scale and invert written into the game's file.
5. **"Check firmware"** on a unit. No firmware command may be sent; reading the version is fine.
6. **Settings: "Check for updates"** matches M7's auto-update.
