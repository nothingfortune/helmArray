# Spike 1: per-device input

**Open: waiting for the owner to run it.** It listens to keyboard input, so it is never run by
an agent or a test.

## The question

Can helmArray tell which device sent a key (the left unit, the right unit or the keyboard),
so Play view can light the right unit's key? If it can't, Play view shows the scheme without
per-unit lighting, and `03-ui-system.md` is amended (roadmap, M0).

## Run it

Close nothing; the Azeron app can stay open. In PowerShell, from the repo:

```
powershell -ExecutionPolicy Bypass -File tools\spikes\raw-input.ps1
```

For 60 seconds, press a few keys on the **left** unit, then a few on the **right** unit, then a
few on the keyboard. Don't type anything private while it runs. Paste the whole output under
"Result" below.

The script is read-only. It uses Windows Raw Input to see keys from every device, and cannot
block, change or send one.

## What the output answers

1. **Does each unit show up as its own keyboard?** Look for two device paths containing
   `VID_16D0&PID_12F7` in "Keyboards Raw Input can see". They will differ in the part after
   `MI_xx#`.
2. **Is each key press attributed to the right device?** In the live lines, each unit's keys
   should carry its own handle and path. The keyboard's keys should carry a different one.
3. **Can a key-sending interface be matched to its unit?** The first block lists every
   interface of both units with its *container*. The keyboard interface and the vendor
   interface (`MI_04`, which M3 talks to and which reports the unit's id) of one unit should
   share a container. If they do, M3 can say "this keyboard path is the left unit" with no
   pressing.

Expected trouble:
- A key sent by the stick in key mode, or by a macro, may show as injected (no device).
- If a unit sends Xbox output instead of keys, its presses won't appear here at all. Play view
  reads those through XInput, a separate check.

## Result

_Paste the output here._

## Answer

_To be written from the result._
