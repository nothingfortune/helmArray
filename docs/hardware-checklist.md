# Hardware checklist

Run by hand on the real units before a milestone that touches hardware is called done, and
before every release. No test or agent runs these steps: they need the owner's machine, both
Azeron Cyborg II units, the rudder pedals and, from M4, a game.

Write the date, the app's commit and each unit's firmware at the top of a copy of this list,
tick each step, and note anything that surprised you. A step that fails stops the run: say
which step and what the app showed, and attach the exchange log (Settings → Exchange log).

## Before you start

- [ ] Both units have been backed up from the Azeron app (export every slot you care about).
- [ ] The Azeron app is closed (check the tray too).
- [ ] The pedals are plugged in, so the run proves helmArray leaves them alone.

## v1 · M3: plug in and the app knows

### Finding the units

1. [success] Start helmArray with both units plugged in. Within a few seconds both device chips
       show, and neither shows an error.
              commands appear to only be listed under claude.md. that should be for ideally intended for agent use, it shouldnt be a sole source of info for anything. it manually should be REFERENCES towards docs/setups or neuances.
2. [success] On a fresh install (no settings yet), the app asks once, while neither unit is known:
       *"Unplug your left Azeron for a moment, then plug it back in."* Do that. The chips then
       say Left and Right correctly, and the replugged unit comes back as Left. Nothing was
       sent to either unit for this: the log shows no exchange for the unplug beyond the
       replugged unit's own identify and slot read.
              Need to make sure that eventually theres troubleshooting or messages or graceful degradation sort of thing for user
3. [success] Quit and start the app again. It asks nothing; Left and Right are still right.
              I have no way of knowing if they are mapped correct but they're green
4. [success] Unplug the right unit. Its chip turns off within a second. The left chip doesn't change.
              Left doesnt change, but the right disappears and says "not checked yet" the chip should change and show the error, but it disappearing and the side one expanding is not good ui
5. [success] Plug it back in. Its chip comes back as Right without a question.
              The left is worse as the left chip disappears and now the right chip is on the left. just change the dot/chip color for the status.
6. [success] Repeat 4 and 5 with the left unit, then with the two units swapped between USB ports.
       The hands follow the units, not the ports.

### The Azeron app

7. [success] Open the Azeron app while helmArray runs. helmArray says writes are blocked, in one
       sentence that names the Azeron app.
              While you should disable writing to the azerons, make sure that no other functionality is blocked
8. [success] Close the Azeron app. The block clears within a few seconds.

### The pedals

9. [success] Throughout steps 1 to 8, the pedals keep working: open `joy.cpl`, pick the pedals and
       move each axis. If they stop responding, unplug and replug them, and record the step
       you were on. That is a failure, however short.
              Status of these should be the same as it is with the azerons

### The log

10. [ ] Open Settings → Exchange log. It shows each unit's identify and slot read from step 1,
        with times. Nothing in it was sent to the pedals (their id is `06A3`; it must not
        appear).
              Settings is not an option in the app

### The sync pill

11. [ ] With nothing applied yet, the pill doesn't claim *In sync*.
12. [ ] With a unit unplugged, the pill never says *In sync*.

## After the run

- [ ] Put both units back on your own layouts if anything was written.
- [ ] File what failed, with the log, before calling the milestone done.
