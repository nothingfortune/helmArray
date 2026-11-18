# relayMatrix, phase 3: UI system

2026-11-17. Phase 3 of 4: features → architecture → **UI system** → roadmap.
Drawn on a canvas: https://claude.ai/artifact/SiRT17QxsbgA5YsvvQ89s2 (the UI system sheet, the
Azeron unit component, Library, the scheme editor, and Play view for Azerons and a controller).
The Editor and Play view boards are clickable.

## Principles

1. **Devices first.** The hardware is the interface; panels serve it.
2. **The game's words.** "Frame shift drive", never "F13". The signal is a caption, in mono.
3. **One accent.** Amber means: this, now, or do it. Nothing else is amber.
4. **Always true.** The sync pill is read from the units, never assumed.
5. **No essays.** Labels are nouns; a check is one sentence and two buttons.
6. **One click deep.** Drawers slide over the page, never push it. No settings behind dialogs.

## Tokens

| Token        | Value     | Use                                  |
| ------------ | --------- | ------------------------------------ |
| `bg`         | `#0A0C0F` | the window                           |
| `chrome`     | `#0D0F13` | header, side panel                   |
| `panel`      | `#111419` | cards, unit plates, fields           |
| `raised`     | `#1A1F27` | keys, secondary buttons              |
| `hover`      | `#222833` |                                      |
| `line`       | `#262C36` | borders; `#2A313C` on keys           |
| `text`       | `#EDF0F4` |                                      |
| `muted`      | `#8E98A8` | secondary text (≥ 4.5:1 on panel)    |
| `faint`      | `#5E6878` | placeholders, empty keys only        |
| `accent`     | `#FFB224` | primary button, selection, pressed   |
| roles        | combat `#FF7A90` · movement `#3BD6B0` · ability `#6EA8FF` · travel `#B5E361` · menu `#B99BFF` | a key's dot and faint tint |
| state        | ok `#4ADE80` · warning `#FFD866` · error `#FF5D5D` | sync pill, checks |

Type: Space Grotesk (names: games, screens, titles), Inter (everything read), JetBrains Mono
(only what a device sends). Scale 40 / 24 / 15 / 13 / 12. Spacing on 4. Radii 6 (chips,
fields), 10 (keys, buttons), 16 (panels, unit plates). Motion 120 ms hover and selection,
200 ms drawers, 180 ms key flash; none under reduced motion. Dark only for v1.

## Components

- **Unit**: one component draws either hand, mirrored, with every position the Cyborg II has
  (five keys per finger, two side keys standing beside the pinky and index columns rather than in them, d-pad, two thumb keys, the stick with its four
  directions as chips). The thumb keys, the stick and the d-pad each sit in their own labelled
  zone, a darker inset, with more space between zones than within them, so the clusters read
  apart before any label does. Finger keys are 72 px wide; a label is the action's whole words,
  top-left like a keycap legend, stepping its type down (never below 9 px) rather than breaking
  a word, with the role dot in the bottom corner. 640 × 380 at full size.
  Props: hand, keys (position → action, role), stick, selected, lit.
  The editor and Play view use the same one.
- **Key** states: empty (dashed), assigned (role dot and tint), selected (amber outline),
  pressed (amber glow), conflict (red border).
- **Sync pill** (top right, always): In sync / N changes not applied / Right unit differs.
  Beside it, which devices are connected: Left, Right, Pedals.
- **Check**: dot, one sentence, a fix button, "Keep, I know".
- **Apply drawer**: what's ready (Azeron app closed, game closed), then what changes per target
  (left, right, game file, pedals), Cancel and Apply.
- Buttons: primary (amber, one per screen), secondary, ghost, danger. A segmented control for
  Keys / Controller, tabs for modes.

## Screens

| Screen      | What's on it                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Library     | What's on your Azerons now (big card), then your Steam games as covers with a one-line status each. |
| Editor      | Game, scheme, Keys/Controller, mode tabs, Play view, Apply. Both units big in the middle, side by side, scaled to fit the width; they stack only when there is no room for two at a readable size. Pedals and checks under them. Side panel: the selected button in every mode, its presses (tap, long, double), turbo and latch, what it sends, then the actions not on a button yet. With nothing selected, just that list. |
| Play view   | Its own small window, kept on top. Tabs for Azerons, keyboard and controller. Each control labelled with its action in the game's words, lit as you press it, the last few presses along the bottom. |
| Devices     | (not drawn) The units, pedals and controller, their state, and the repair utility.                 |
| Settings    | (not drawn) Game folders found, the log, export and import.                                        |

## Not drawn yet

Light theme, first run (J0), the bind sheet, the history list, Devices and Settings, the Play
view keyboard tab, and narrow windows below 1280 px.
