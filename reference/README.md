# Reference

Evidence carried over from the first relayMatrix, now
[nothingfortune/relayMatrix-legacy](https://github.com/nothingfortune/relayMatrix-legacy), at
commit `9925939` (2026-11-17), plus captures and notes that only existed on the owner's
machine. Nothing here is code. A test that needs a file copies it into its own fixtures and
says where it came from.

| Folder          | What                                                                                             | Was, in the legacy repo |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `unit-protocol` | Decoded HID exchanges between the Azeron app and a Cyborg II: handshake, reads, writes on firmware 111 and 112. `onboard-112.json` is the byte-for-byte contract for a write. | `tests/fixtures/unit-protocol/` |
| `captures`      | The raw USBPcap captures behind those (`*.pcap`, decoded as `*.txt`), the app's own exports of the recon profiles (`recon-*.json`), and `FINDINGS.md` / `RECON-STEPS.md`: what each capture showed and how to take another. `capture-helper.ps1` is the elevated helper that ran them. | `build/scratch/recon/` (never committed) |
| `unit-exports`  | One real export of each unit. The right one carries the 180° stick rotation (`angle` 176) and `invertXAxis: true`. | `templates/everspace2-akimbo-*.json` |
| `devices`       | Press-tested pin maps for both units (thumb pad rotated on the right: `thumb_up` 34↔36, `thumb_left` 35↔33), the right unit's X fact, the owner's unit ids, and the pedals: axis names, rest positions, toe calibration. | `devices/*.yaml` |
| `game-files`    | Everspace 2's `Input.ini` as the game wrote it, Elite's KeyboardMouseOnly preset and a custom `.binds`. CRLF, kept byte for byte. | `tests/fixtures/` |
| `guides`        | How the protocol was recovered and which commands are safe; analog input for Everspace 2 and the pedals; taking a capture; the macro helper's design. | `docs/guides/` |
| `legacy`        | The legacy `CLAUDE.md` (every hard-won fact, 900 lines), the original brief, the macros plan, each game's playtest notes, and the last two handoffs (open owner requests, captures still owed, what was unverified on hardware). | various |

## Not carried over, on purpose

- Code extracted from the Azeron app (`azeron-app/`) and strings from reWASD: third-party
  material, kept on the owner's machine only, in the legacy folder's `build/scratch/`.
- The owner's layouts: they live in the legacy repo under `games/`, and are rebuilt by hand
  in the new app at M5.

## Safety facts

- Send a unit only commands the app was seen to send (`guides/unit-protocol.md`).
- Never send the pedals a HID `GET_REPORT`. It hung them until they were replugged.
- The Azeron app must be closed during a write. A game must be closed before its file is
  written, because it rewrites the file on exit.
