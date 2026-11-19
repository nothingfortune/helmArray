# Captures of 2026-11-19 (app 2.0.3, firmware 112, both units)

The owner imported three profiles helmArray generated (`imported/`, made by
`tools/recon/make-recon.mjs` from the 2026-11-13 Recon export), checked each in the Azeron app,
wrote them, and exported them back. USBPcap recorded root hub `5&19aa5c54` (filter 2), which
holds the two units and the rudder pedals only. Left unit: id 49229, USB device 5. Right unit:
id 29993, USB device 4. Decoded into `../../unit-protocol/captures-2026-11-19.json`.

| Recording | What happened | Export |
| --- | --- | --- |
| `write-right-rstick` | `Recon R right` into the right unit, slot 0 (new) | `recon-r-right.json` |
| `write-right-lstick` | slot 3 deleted; `Recon R left` into the right unit, slot 1 (new) | `recon-r-left.json` |
| `write-left-recon` | slots 2 and 1 deleted on the right unit; `Recon L` into the right unit's slot 1 by mistake, then the left unit's slot 2 | `recon-l.json` |
| `read-connect` | `Recon L` again into the left unit's slot 3 with a turbo key and deadzones; `Recon R right` into the right unit's slot 1; the app closed and reopened, streaming every slot of both units | `recon-l-2.json` |

## What they settled

- **Which Xbox stick.** `isRightAnalog` (byte 35 of the stick record) picks it, on either unit:
  set is the right stick, clear the left. The app showed `Recon R right`'s stick as the right
  stick and `Recon R left`'s as the left, both on the right unit, and `Recon L`'s (set) as the
  right stick on the left unit. The two right-unit records differ in that byte only.
- **How a unit stores scroll.** As a button record (60 bytes: page 0 of 53, page 1 of 7), tap
  type 35, with the tap's 14 bytes of keys and modifiers replaced by 6: x and y as signed bytes,
  then the two intervals little-endian. Speed 20 up stored `00 01 96 00 78 00`; speed 70 down
  `00 ff 96 00 2d 00`. Long, double, delays, hold bits and tails as any button. Same on both
  units.
- **Mouse back and forward** are mouse buttons 4 and 5. The app wrote them as given, and the
  owner pressed them in a browser: back and forward.
- **Deadzones** are stored in 512ths: the app's 10 and 20 went out and came back as 51 and 102.
- **Turbo** at the app's default rate wrote, stored and exported 20 ms.
- **Stick directions on keys** are not offered by the app. **Combined, hold trigger and angle
  lock** are not in the app's settings either.
- **The app** deletes a slot with `DELETE_PROFILE` before adding one where the owner chose,
  adds with `CHECK_PROFILE` at the lowest free number, and switches to the slot it wrote.
- **Reading on connect**, it streamed the left unit's four older slots in one stream (`parts`
  135), then the newly written slot 3 on its own (`parts` 33).
