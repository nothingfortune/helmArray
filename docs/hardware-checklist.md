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

1. [ ] Start helmArray with both units plugged in. Within a few seconds both device chips
       show, and neither shows an error.
2. [ ] On a fresh install (no settings yet), the app asks for one press at most: *"Press the
       profile button on your left Azeron."* After that press, the chips say Left and Right
       correctly, and the unit you pressed is back on the slot it was running (it flicks to the
       next slot for a moment).
3. [ ] Quit and start the app again. It asks nothing; Left and Right are still right.
4. [ ] Unplug the right unit. Its chip turns off within a second. The left chip doesn't change.
5. [ ] Plug it back in. Its chip comes back as Right without a question.
6. [ ] Repeat 4 and 5 with the left unit, then with the two units swapped between USB ports.
       The hands follow the units, not the ports.

### The Azeron app

7. [ ] Open the Azeron app while helmArray runs. helmArray says writes are blocked, in one
       sentence that names the Azeron app.
8. [ ] Close the Azeron app. The block clears within a few seconds.

### The pedals

9. [ ] Throughout steps 1 to 8, the pedals keep working: open `joy.cpl`, pick the pedals and
       move each axis. If they stop responding, unplug and replug them, and record the step
       you were on. That is a failure, however short.

### The log

10. [ ] Open Settings → Exchange log. It shows each unit's identify and slot read from step 1,
        with times. Nothing in it was sent to the pedals (their id is `06A3`; it must not
        appear).

### The sync pill

11. [ ] With nothing applied yet, the pill doesn't claim *In sync*.
12. [ ] With a unit unplugged, the pill never says *In sync*.

## After the run

- [ ] Put both units back on your own layouts if anything was written.
- [ ] File what failed, with the log, before calling the milestone done.
