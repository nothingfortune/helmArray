# Recon findings (2026-11-13, app 2.0.3, firmware 112, left unit)

## 112-write
- OBM_COPY records for everspace_left.json are byte-identical to `encodeInputRecord` /
  `encodeStickRecord` (25 of 25 comparable). Same header/part framing.
- The app also writes records with type "6" (Disabled) in a slot; our `isWritableInput`
  skips them (gap: thumb-pad directions on the Everspace layout were never written).
  Encoding: identical to "11" (None) except the slot's type byte is 0x06.
- Pins 28/29 (unknown_pins) are skipped by the app too.

## xinput
- Export: empty keys are now ["6","6","6"] (Disabled) in 2.0.3.
- XInputButton: types ["22",...], keyValues[0] = "4096" (0x1000 = XINPUT_GAMEPAD_A).
  Wire: tap type 0x16, key u16 BE 0x1000, rest as a key record.
- XInputTrigger: types ["23",...], keyValues[0] = "T2" (right). Wire: type 0x17, key 0x0002.
- XInputJoystick: stick record, types ["21","0","0"]; wire: the 134-byte stick record with
  type 0x15 instead of 0x04, tuning and direction keys as before.
- Unbound wheel records: pinOne 255, types 30/29, subType 31 (ids 39/40).
- Stick analogSettings carry mouseSensitivity, analogThrottle, isAnalogSmoothing,
  triggerMagnitude, isCombinedAnalog, holdMagnitude, holdType, holdKeyValues.

## joystick-mouse
- Stick types ["40","0","0"] (JoystickMouse); wire type byte 0x28 in the stick record.
- analogSettings.mouseSensitivity is the u8 at record offset 16 (default 5; the owner's
  "super sensitive" stored 2 -- lower looks faster, to confirm on the unit).
- analogSettings.angle 0 -> 5 also changed (offset 10-11, i16); unclear if the owner moved it.

## macro (+ bonus), export recon-macroandbonus.json, slot 5 "Recon"
- **Macro (type 16) and InputSequence (type 37) are not stored on the unit.** Id 14 (macro:
  XInput A 100 ms, XInput B 50 ms) and id 37 (sequence ArrowUp, ArrowRight) went over the
  wire as plain None records (0x0b / 0x0b,0x06,0x06). The app runs them on the PC; the
  firmware has no macro storage. The renderer groups SwitchProfile, Macro, InputSequence in
  one set (NA), consistent with "app-side only".
- Macro steps in the export: {type: "XInput"|..., duration ms, keyCode, direction:
  "Full"|"Down"|"Up"}; macro {repeat, steps, v:1}.
- XInputButton values are XInput bitmask: A 0x1000 (4096), B 0x2000 (8192), DPAD_LEFT
  0x0004 (1024? -- export says "1024" = 0x0400 for the double-tap; wire 0x0004?) -- check.
- Long and double slots take XInput too: id 18 long = A (wire long type 0x16 key 0x1000),
  id 13 double = 1024 (wire double type 0x16, key bytes "04 00" -> 0x0400).
- Type 12 DirectInputDpad: id 1 "directional dpad (up)", key 0, wire tap type 0x0c.
- Type 35 ButtonMouseWheel: id 38, a 55-byte record (shorter): 05 26 07 ff 23 00 00 00 96
  00 96 06 ... -- its own layout, to decode.
- Command 0x2c (LED colour, 14 B: 01 + 3x RGB + ...) was sent repeatedly while the owner
  changed colours; 0x2f saves the slot's colours after the name (0x10).

## wheel-layer (export recon-wheel-layer.json)
- **Scroll is onboard**: type 35 ButtonMouseWheel, a 55-byte record:
  `slot id pin pin 0x23 x y 00 interval(u16 BE) yInterval(u16 BE)` then the long and double
  blocks as usual. Scroll up: x 0, y 1, interval 150, yInterval 100 (100.5 in the export).
  Scroll right: x 1, y 0, interval 106, yInterval 150. Wheel speeds in the export:
  scrollSpeed, scrollThreshold, isSmoothScroll on the unbound 29/30 records.
- **Layer switch is app-driven**: id 8 type 24 SwitchProfile with `layeringProfileId` (a
  software profile UUID) and `isToggleOnHold` went to the unit as a None record. When the
  key is pressed, the app sends SWITCH_PROFILE (0x1a) to change the running slot -- seen 7
  times while the owner tested it. New commands seen: 0x06 (1 byte payload 01 01) and 0x0e
  (no payload; answer 02 05 ...) around a switch.

## Summary
- On the unit, app closed: keys, mouse buttons, **Xbox buttons/triggers/stick (21-23)**,
  **stick as mouse (40) with sensitivity**, **scroll (35)**, DirectInput d-pad (12),
  Disabled (6), long/double/turbo/hold.
- Run by the Azeron app on the PC: **macros (16), input sequences (37), layer/profile
  switch (24)**. The firmware has nowhere to keep them.
- Firmware 112 writes are byte-identical to our encoder for the types we write.

## XInput button values (from the app's renderer table `ca`)
1 DPAD UP, 2 DPAD DOWN, 4 DPAD LEFT, 8 DPAD RIGHT, 16 START, 32 BACK, 64 PUSH L STICK,
128 PUSH R STICK, 256 LB, 512 RB, 1024 HOME, 4096 A, 8192 B, 16384 X, 32768 Y; triggers
"T1" LT, "T2" RT. (The bonus double-tap 1024 was HOME, not d-pad left.)

## write-right (2026-11-15, app 2.0.3, firmware 112, RIGHT unit; capture write-right.pcap, export recon-remaining.json)
- Profile "recon right" written to the right unit (USBPcap2, device 4; device 5, the left unit,
  only got the 5e 32 7e 48 69 0a keep-alive). 31 input records, slot 3.
- Our encoders reproduce 28 of 31 byte for byte, including the Xbox stick (type 0x15, pin 31,
  isRightAnalog byte = 1, angle 176) and scroll up and right.
- Scroll down / left are the same record with a negative byte, which the encoder refuses today:
  `23 xx yy iiii jjjj` = type 0x23, x i8, y i8, interval u16 BE, yInterval u16 BE (112.5 -> 0x70).
    up    23 00 01 0096 0070      down  23 00 ff 0096 0070
    right 23 01 00 0070 0096      left  23 ff 00 0070 0096
- Type "5" (DirectInput joystick button, 'thumb stick click', label "joy1") on pin 32 goes as
  `05 00 01` (type, key u16 BE = button 1). Not modelled.
- Reassembly note: part 1 of a multi-part write is `[len][record...]`; every later part starts
  with an echoed 0x0b before the record's next bytes.
- Not shown by this capture: whether the Xbox stick side comes from isRightAnalog alone. The
  right unit's export always carries true, so only a LEFT-unit write of the same stick can
  tell (isRightAnalog false -> left stick expected).
- The export (14:45) predates the capture (14:52) and is named "Copy of recon right"; the 28
  matching records show the content is the same.
