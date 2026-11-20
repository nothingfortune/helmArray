# helmArray, phase 1: features

2026-11-17. Built for the first time. Phase 1 of 4: **features** → architecture → UI system → roadmap.

## What it is

A desktop app that holds how you want to control each game, and makes your devices and the
game agree with it. Two Azeron keypads first; keyboard, mouse and Xbox controller alongside.

## Setups (the owner's correction, 2026-11-19)

M3 and M4 were built on a misreading; this section is the model, and the rest of this file is
read through it.

- **helmArray holds several setups per game; the game holds one.** A game's own settings can only
  hold one set of bindings at a time. The app keeps as many setups as you like for each game
  (the Editor's *Scheme* picker on the canvas) and **Apply** puts one of them onto the devices
  and into the game. Switching setup is picking another and applying it.
- **A setup says what you play with:** keyboard and mouse, two Azerons, the **left** Azeron and
  the mouse, an Xbox controller, or a mix.
- **The Azerons act as a controller or as a keyboard.** *Controller*: each button sends an Xbox
  button, trigger or stick. *Keys*: each button sends a key.
- **Putting an action on a control rebinds the game, for every device.** On the keyboard, or on an
  Azeron sending keys, the game's keyboard binding for that action changes. On an Azeron acting as
  a controller, or on the controller itself, the game's controller binding changes. The game's
  shipped bindings are only where a new setup starts; nothing in a setup is fixed to them.
- **The keyboard and the Azerons work the same way** in the editor: drag an action onto a key or
  a button. Only the Azerons are also written (what each button sends).
- **Worked example, Helldivers 2.** *Desk: Azerons as controller*: drag Reload onto Left index 1;
  the unit is written to send an Xbox button and the game's controller binding for Reload becomes
  that button. *Couch: controller*: drag Reload onto X; the game's controller binding changes,
  nothing is written to a unit. Apply on either writes what that setup needs and nothing else.
- **Left Azeron + mouse** writes the left unit only. The right unit is not written, and the sync
  pill doesn't judge it.
- Where the game has no file the app can write, the game's half of Apply is a **bind sheet**:
  what to set in the game's own menu.

## Decided

- **Desktop app.** Owns its data. No git, no files to hand-edit, no code, no AI needed.
- **A pad is a very small keyboard.** Its buttons are fixed; you point them at actions through
  the game's own config. No game file, no remap. No virtual controller driver.
- **The Azerons are the flexible part.** They can send keys, mouse buttons, scroll, Xbox
  buttons, triggers and sticks, and the app writes them directly.
- **Start from defaults.** The basic one: two Azerons as one Xbox controller, starting from the
  game's own controller bindings.
- **You never touch the Azeron's profile button.** Each unit holds one profile, the app's. The
  app writes, overwrites and activates it whenever it needs to; nothing else lives on the unit.
- **Two Cyborg IIs only.** Their pin maps are known and built in. Re-mapping a unit is a repair
  utility for dire straits, not a feature.

## The bar

What you'd get if the Azeron app and reWASD had a child and Valve blessed it. Steam Input is the
benchmark for feel: the devices drawn big and real, the game's cover art, actions named in the
game's words, few words anywhere else, everything one click deep. No dialogs explaining
themselves. Nothing from the previous UI is kept.

## Journeys (everything is judged by these)

| #   | Journey                                                        | Target                       |
| --- | -------------------------------------------------------------- | ---------------------------- |
| J0  | First run: plug in both Azerons, app knows left from right     | 0 clicks after plugging in   |
| J1  | Pick a game, pick a default, play                              | 2 clicks                     |
| J2  | Put an action on a button and get it onto the units / the game | drag, then Apply (1 click)   |
| J3  | Switch to another game                                         | 1 click; later automatic     |
| J4  | One button, different jobs per game mode (Elite: ship / foot)  | J2 with a mode tab           |
| J5  | While playing: see both Azerons with each button's action, lit as pressed | Play view, 1 click to open |

## Features

**v1** = first usable release · **v2** = next, designed for now · **no** = out.

### Devices

| Feature                                                                   | When |
| ------------------------------------------------------------------------- | ---- |
| Azeron Cyborg II left and right: detect, tell apart by unit id            | v1   |
| Pin maps built in; right unit's rotated thumb cluster handled             | v1   |
| Repair utility: re-map a unit's pins by pressing each one                 | v2   |
| Keyboard + mouse as a device (fixed keys)                                 | v1   |
| Xbox controller as a device (fixed buttons)                               | v1   |
| Logitech Pro Flight rudder pedals (yours only): rudder + two toes, per mode, written into the game's file | v1 |
| Toe-brake calibration check (a toe rests at full travel until calibrated) | v1   |
| Other pedals                                                              | no   |
| Other Azeron models                                                       | no   |

### Play view

| Feature                                                                          | When |
| -------------------------------------------------------------------------------- | ---- |
| Both Azerons drawn with each button's action, in the game's words, by role colour | v1   |
| Lights the button you press, live                                                | v1   |
| Small window, always on top, or full on a second monitor                         | v1   |
| Follows the game's mode (Elite: ship / on foot) by a click, later by itself      | v1 / v2 |
| The same view for keyboard + mouse and for an Xbox controller                    | v1   |
| Print / save as an image (a cheat sheet)                                         | v2   |

### What an Azeron button can do (written to the unit)

| Feature                                                          | When |
| ---------------------------------------------------------------- | ---- |
| Send a key, a modifier + key, a mouse button                     | v1   |
| Send an Xbox button or trigger                                   | v1   |
| Stick as Xbox stick, as keys (8 directions), as mouse            | v1   |
| Tap / long press / double tap / hold-to-latch / turbo            | v1   |
| Scroll up / down / left / right                                  | v1   |
| Stick tuning: deadzones, sensitivity, angle, invert              | v1   |
| Chords (several keys at once)                                    | v2   |
| One profile per unit, written, read back, made active; others removed | v1   |
| Units read on connect: the app always knows what they hold       | v1   |

### Games

| Feature                                                                         | When |
| ------------------------------------------------------------------------------- | ---- |
| Game library from your installed Steam games, with their cover art              | v1   |
| Add any other game by hand                                                      | v1   |
| A game's actions: name, role, required                                          | v1   |
| Modes within a game (Elite: ship, SRV, on foot); actions belong to modes        | v1   |
| Write the game's own binding file where we know its format                      | v1   |
| … Unreal `Input.ini` (Everspace 2), Elite `.binds`                              | v1   |
| … more formats                                                                  | v2   |
| Find the game's files automatically (Steam, AppData)                            | v1   |
| No writable file: a bind sheet (what to press in the game's own menu)           | v1   |
| Harvest the game's default controls (actions, keys, pad) from its own files     | v1   |
| … where the game ships none we can read: you teach it once by pressing          | v2   |
| Built-in action lists for common games                                          | v2   |

### Schemes (what you edit)

| Feature                                                                                   | When |
| ----------------------------------------------------------------------------------------- | ---- |
| Several setups per game (the app holds them; Apply puts one on the devices and the game)  | v1   |
| A setup's devices: keyboard + mouse, two Azerons, left Azeron + mouse, controller, a mix   | v1   |
| Per mode, control → action for every device in the setup, plus behaviour                  | v1   |
| Defaults: *Xbox controller* (two Azerons = one pad), *game's own keys*, *copy a scheme*   | v1   |
| Keys we choose stay out of the game's way and never move once given                       | v1   |
| Checks from real play (below), with "accept, because…"                                    | v1   |
| Undo, snapshots, export / import one file                                                 | v1   |
| Switch scheme automatically when a game starts                                            | v2   |
| Macros (typed by the app; the unit can't store them), opt-in per game                     | v2   |
| Layers (hold / toggle a second set)                                                       | v2   |
| Share schemes with others                                                                 | v2   |
| In-game overlay, radial menus, virtual controller                                              | no   |

### Checks (each one came from a session that went wrong)

| Rule                                                                           | Level   |
| ------------------------------------------------------------------------------ | ------- |
| Two actions live at once on the same key (an Xbox control counts once: the controller's button and an Azeron button sending it are one) | error   |
| A button whose action sends nothing (or is on a device the setup doesn't use)  | error   |
| A required action on no button (a button that only happens to send its shipped Xbox control doesn't count: the game is rebound to the setup) | error   |
| A menu action (Escape) on a combat button you mash                             | error   |
| Long press / double tap on a combat button (they delay the tap)                | warning |
| Hold-to-latch on movement or boost                                             | warning |
| Xbox output and keys mixed in one scheme (Everspace 2 stutters): a stick, or a setup's devices | warning |
| Stick not in key mode, for a game that needs it (Everspace 2)                  | error   |

## Facts the design has to respect

- The units hold onboard profiles and run one; the app writes them over a private HID protocol
  (already captured and understood). The official Azeron app must be closed while writing.
- Both units report the same USB product id; only the id each one reports tells them apart.
- The right unit's thumb pad and stick are rotated 180° relative to the left.
- Long press and double tap delay the tap by design. Hold-to-latch keeps a key down until
  pressed again.
- Some games treat keyboard and pad as two inputs fighting over control (Everspace 2): mixing
  them stutters.
- A game rewrites its binding file on exit, so it must be closed when the app writes it.
- Macros, layers and auto-switching need the app running; everything else lives on the unit
  and works with the app closed.

## The model, one screen (detail is phase 2)

```
Device   what you hold, and what each control can send
           keyboard, mouse, Xbox pad : fixed
           Azeron left / right       : programmable
Game     what it listens for: actions in modes; whether we can write its file
Scheme   per game: per mode, control → action, plus how the control behaves
Target   where it lands: Azeron units · game file · bind sheet · (v2) the app's helper

resolve(Scheme, Game, Devices) → Plan → each target: preview · apply · verify
```

- **One signal per control per scheme.** A button sends the same thing in every mode; the
  game's file binds it per mode. That is J4.
- **Controller vs keys** is a property of a setup's Azerons. Controller: the Azerons are an Xbox
  controller, and the game's **controller** bindings are rewritten to the setup's. Keys: the
  Azerons send keys we pick, and the game's **keyboard** bindings are rewritten to the setup's.
  Either way the game is rebound; where its file can't be written, a bind sheet says what to set.
  (Corrected 2026-11-19: this used to say the game's pad bindings apply as shipped.)
- **Apply is one button** and always says what it will touch (units, game file) before it does.
- **A setup** is the scheme plus which devices it uses. The app keeps many per game; the game and
  the units hold the one applied.

Phase 2: [02-architecture.md](02-architecture.md).
