# Next steps after M2 (2026-11-19)

M0–M2 are merged: the workspace and gate, the model and resolver with its checks, and the whole
unit protocol (reports, records, read-back, the session and a fake unit), proved against every
capture in `reference/`. This is what comes next, in order, and what each step needs from whom.

## 1. Owner, outside the code

| What | Why it blocks | How |
| --- | --- | --- |
| Give the build rig the helmArray repo | No CI run has ever started: every PR was checked locally under the bypass | Add helmArray to whatever registers runners on `build-rig` |
| Run spike 1 | Telling left from right, and Play view, rest on per-device input | `tools/spikes/raw-input.ps1`, paste the result |
| Restore the units | Both still run test profiles from the 2026-11-19 captures | Switch each to your layout; delete `Recon L` (left slots 2, 3) and the extra right slot |

## 2. M3 · J0: plug in and the app knows

The first build that touches hardware. Each part is its own PR, in this order.

1. **`HidTransport` (app/main).** `node-hid` 3.4 (N-API prebuilds; no rebuild for Electron).
   Opens only VID `0x16D0` PID `0x12F7`, interface `MI_04`, usage page `0xFF01`: the pedals
   (`0x06A3`) can't be opened, so they can never be sent a `GET_REPORT`. Implements the M2
   `Transport`; tests run the session over a fake `node-hid` device, never a real one.
2. **`devices` service.** Find both units, `identify()` each, read their slots, on connect and on
   replug (node-hid has no hotplug event: poll the device list about once a second, which also
   gives the "chip off within a second" of the Done-when).
3. **Which unit is which hand.** A unit's id (`KEYPAD_DETAILS`, e.g. 49229) is permanent and
   needs nothing written, but nothing a unit reports says which hand it is. So the first time an
   id is seen, the app asks once: *"Press any key on your left Azeron."* The press is attributed
   by per-device input (spike 1), and the id→hand pair is kept in settings, so a unit is never
   asked about again. **This changes M3's Done-when**: "Left and Right with no click" becomes
   "with one press per unit, once".
4. **Sync pill and device chips.** In sync / Changes not applied / Units differ, from
   `verify()` of what each unit holds against the last applied plan; never inferred.
5. **`processes` service.** Is the Azeron app running (`Azeron Software.exe`): writes blocked,
   with the reason in one sentence. Before any write, the session also checks the unit's id
   against the profile's device (from the M2 review: today a right profile could be written to
   the left unit).
6. **Rolling log** of every exchange (the session's `trace`), opened from Settings.
7. **Hardware checklist v1** (`docs/hardware-checklist.md`), run by hand **[local]**.

## 3. Per-key ids (the owner's idea, 2026-11-19)

In key output every button press already sends its own key, dealt from the pool, recorded in the
ledger and never re-dealt; the checks make sure no two presses live at once share one. So a key
that arrives *is* an id: the app looks it up in the ledger and knows the button, the unit and
the press, and shows the action's name, never the key. What that gives:

- **Play view (M6)** can light the right key on the right unit from ordinary keystrokes, with no
  per-device input for the units at all.
- **Telling the hands apart** (M3 step 3) can use it too, once a unit runs a helmArray slot: any
  press says which unit it came from.
- **Pad output** doesn't need it: each Azeron is its own Xbox controller to Windows (two XInput
  pads were seen on 2026-11-19), so the XInput slot says which unit.
- **Where it can't help:** in *game's own keys* a button sends the game's key, which the real
  keyboard sends too. There, per-device input (spike 1) still decides, or the app deals pool
  keys for those buttons as well and puts the game's key on the bind sheet.
- The bind sheet is the one place the user sees a key: it says what to set in the game's menu.

## 4. Carried from M2 (in the milestone named)

- **A key-mode stick writes no directions** (`directions: {}`), so it sends nothing. The plan has
  no stick keys yet; the resolver must deal 8 directions (Yaw/Pitch for Everspace 2). **M4**,
  before any key-output scheme is applied; until then a check should flag it.
- **Chords**: the app wrote 4 keys and 3 modifiers on one press. The model's key signal holds
  one key. After v1 (roadmap item 4).
- **Records a slot holds that weren't written** aren't reported by `verify`. Today every write
  covers all 31 inputs, so none survive; worth a line in the read-back when M4 writes partial
  layouts.
- **An empty press** is written as 11 (none), as app 2.0.2 did; 2.0.3 writes 6 (disabled). Both
  read back the same. Revisit only if a unit treats them differently.

## 5. After M3

M4 (pick a game, pad output end to end on Helldivers 2) is the first time the app replaces the
Azeron app for a real game; M5 is the cutover (game files, modes, pedals). The roadmap's order
stands.
