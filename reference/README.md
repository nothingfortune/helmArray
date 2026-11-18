# Reference

Facts carried over from the first relayMatrix, now
[nothingfortune/relayMatrix-legacy](https://github.com/nothingfortune/relayMatrix-legacy), at
commit `9925939` (2026-11-17). Nothing here is code. Each file is evidence the new app is
tested against: a capture, an export or a game file that came from the real thing.

Treat these as read-only. A test that needs one copies it into its own fixtures and says so.

| Folder          | What                                                                                             | Was, in the legacy repo |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `unit-protocol` | HID captures of the Azeron app talking to a Cyborg II: handshake, reads, writes on firmware 111 and 112. `onboard-112.json` is the byte-for-byte contract for a write. | `tests/fixtures/unit-protocol/` |
| `unit-exports`  | One real export of each unit. The right one carries the 180° stick rotation (`angle` 176) and `invertXAxis: true`. | `templates/everspace2-akimbo-*.json` |
| `devices`       | Press-tested pin maps for both units (thumb pad rotated on the right: `thumb_up` 34↔36, `thumb_left` 35↔33), the right unit's X fact, and the pedals: axis names, rest positions, toe calibration. | `devices/*.yaml` |
| `game-files`    | Everspace 2's `Input.ini` as the game wrote it, Elite's KeyboardMouseOnly preset and a custom `.binds`. CRLF, kept byte for byte. | `tests/fixtures/` |
| `guides`        | How the protocol was recovered and which commands are safe to send; the analog-input findings for Everspace 2 and the pedals; how to take a capture. | `docs/guides/` |

Safety facts that are not in the files' names:

- Send a unit only commands the app was seen to send (`guides/unit-protocol.md`).
- Never send the pedals a HID `GET_REPORT`. It hung them until they were replugged.
- The Azeron app must be closed during a write. A game must be closed before its file is written,
  because it rewrites the file on exit.
