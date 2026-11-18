# Recon session: what to do after the restart

Goal: learn how firmware 112 and the Azeron app write Xbox output, stick-as-mouse, macros,
scroll and layers, by recording the app doing each one. Nothing here sends anything to a
unit from our side; USBPcap only copies the traffic.

Save every file into this folder:
`C:\Users\there\Documents\GitHub\azeronMappings\build\scratch\recon\`

## 0. Before you start

- Close the editor's Write to units and Test keys if either is open.
- Updating both units to firmware 112 in the Azeron app is fine (our Write to units will
  refuse 112 until these captures check out, which is safe).

## 1. Which filter (found 2026-11-13)

The Azeron is on root hub `USB\ROOT_HUB30\5&19aa5c54&0&0`, behind an ASM107x hub, beside
the rudder pedals -- and nothing else: no keyboard or mouse. So in USBPcapCMD's list pick
the `\\.\USBPcapN` whose line contains `5&19aa5c54`, and capture all of it with `-A`
instead of `--devices`:

```
"C:\Program Files\USBPcap\USBPcapCMD.exe" -d \\.\USBPcapN -A --inject-descriptors -o "C:\Users\there\Documents\GitHub\azeronMappings\build\scratch\recon\NAME.pcap"
```

If a capture comes out empty, run `USBPcapCMD.exe -I` once as admin and reboot (USB 3.0
capture needs it).

The section below is the original way, kept for reference.

## 1b. Find the left unit (once, after the restart)

Open an **administrator** terminal and run:

```
"C:\Program Files\USBPcap\USBPcapCMD.exe"
```

It is interactive. Note which `\\.\USBPcapN` the left Azeron unit is on, and its device
**address** (a number). Pick the unit, not the whole hub: a capture of a hub includes your
keyboard, and what you type ends up in the file.

## 2. One capture per item

For each row: start the capture, do the one thing in the Azeron app, then stop the capture
with Ctrl+C. Replace `N` and `ADDR` with what step 1 showed.

```
"C:\Program Files\USBPcap\USBPcapCMD.exe" -d \\.\USBPcapN --devices ADDR --inject-descriptors -o "C:\Users\there\Documents\GitHub\azeronMappings\build\scratch\recon\NAME.pcap"
```

| NAME                | What to do in the Azeron app, on the LEFT unit                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `112-write`         | Import `C:\Users\there\Documents\GitHub\azeronMappings\dist\SpaceSims\everspace\everspace_left.json` and write it to the unit.          |
| `xinput`            | New profile named `Recon`: one key = Xbox **A**, one key = **RT** (trigger), the stick = Xbox **left stick**. Write it to the unit.     |
| `joystick-mouse`    | In `Recon`, set the stick to **mouse movement** (Joystick Mouse). Write it.                                                             |
| `macro`             | In `Recon`, make one key a **macro** of 3 steps, e.g. press A, wait 100 ms, press B. Write it.                                          |
| `wheel-layer`       | In `Recon`, one key = **scroll up**, one key = **switch profile** (as a layer, to another profile). Write it.                          |

After each capture, **export the `Recon` profile** as JSON into the same folder
(`recon-xinput.json`, `recon-joystick-mouse.json`, and so on).

Write down: the app version (2.0.3) and the firmware the app shows for the unit.

## 3. Then

Tell Claude the files are in. It decodes them with `azeron hidcap`, allows firmware 112 if
`112-write` matches what our tool sends on 111, and builds Xbox output, mouse movement,
macros and layers on top.
