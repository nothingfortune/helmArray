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
2. [ ] On a fresh install (no settings yet), the app asks once, while neither unit is known:
       *"Unplug your left Azeron for a moment, then plug it back in."* Do that. The chips then
       say Left and Right correctly, and the replugged unit comes back as Left. Nothing was
       sent to either unit for this: the log shows no exchange for the unplug beyond the
       replugged unit's own identify and slot read.
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

## v1 · M4: the Azeron app open with helmArray running

13. [ ] With both units plugged in and helmArray running, open the Azeron app and use it for a
        minute: read a profile, switch profiles with the profile button. The units behave as
        they do without helmArray, the Azeron app sees and reads them normally, and helmArray
        shows both chips as paused with the pill saying *Azeron app is open*. (helmArray only
        lists the Azeron units on the bus while the app is open; it opens and sends nothing.)

## v1 · M4 and M4.5: pick a game, play, and setups

Have Helldivers 2 installed, and closed. Back up both units first (see *Before you start*).
Close the Azeron app (step 13 leaves it open; check the tray too) and wait until both chips
are ready and the pill no longer says *Azeron app is open* before step 14.

### J1: pick a game, pick a default, play

14. [ ] In the Library, click Helldivers 2, then *Xbox controller*. The Apply drawer opens by
        itself. It lists each unit's changed buttons in the game's words ("Middle 1 · Reload")
        and says the Azeron app is closed. Click *Apply*. That is 3 clicks.
15. [ ] Both chips stay on, the pill says *In sync*, and each unit now runs one layout named
        *Xbox controller*. Open the Azeron app (helmArray's pill then says *Azeron app is
        open*) and check each unit holds only that layout.
16. [ ] Close the Azeron app and wait until the pill says *In sync* again. Start Helldivers 2
        and play a minute: the left stick moves you,
        the triggers fire and aim, and both units act as one Xbox controller.

### J2: put an action on a button

17. [ ] Close the game. In the Editor, drag Reload onto Left middle 2 (an empty button, so
        nothing else moves). The pill says *1 change not applied*. Click *Apply 1*, then
        *Apply* in the drawer. The drawer listed that one button, and one row "In the game's
        controls, set Reload to …".
18. [ ] The Library card shows "1 to set in the game". Set it in Helldivers 2's own controls
        menu, then click *Done*. Restart helmArray first once: the reminder is still there.

### Setups

19. [ ] Open the Scheme picker and make a new scheme from *Game's own keys*. The drawer opens by
        itself with nothing to fix. Apply it. In game, the left stick sends W, A, S, D and the
        buttons send the game's own keys.
20. [ ] Switch back to the *Xbox controller* scheme (Scheme picker, then Apply). The units run
        it again and the game sees a controller.
21. [ ] Make a scheme for the left Azeron and the mouse (Devices, *Left + mouse*). Apply it.
        Only the left unit is written: the right unit still runs its previous layout, and the
        Library card names both ("Right unit: Helldivers 2 · …").
22. [ ] Open the Azeron app. Make a keyboard-only scheme and apply it. helmArray
        doesn't ask you to close the Azeron app, and nothing is written to either unit.

### A game helmArray doesn't know

23. [ ] Close the Azeron app and wait until both chips are ready again. On a Steam game
        helmArray has no data for, click *Set up*. Add two actions by typing a
        name, pressing Enter, then pressing the key. With your Xbox controller plugged in,
        click a controller cell and press a button: it is taken. Unplug the controller and do
        it again: the screen says no controller is connected and offers a list.
24. [ ] Click the amber *New scheme from* choice, then Apply. The units are written.

### Throughout

25. [ ] The pedals keep working through steps 14 to 24 (`joy.cpl`, every axis). The exchange log
        never shows `06A3`.
26. [ ] At 1280 wide (shrink the window), the Editor shows both units without scrolling, and
        every button label is readable.
