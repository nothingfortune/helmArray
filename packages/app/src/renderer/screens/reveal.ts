// Where the Editor is, and THE ONE reveal: every action that shows or selects a control afterwards
// (a fix, a group's fix, a finding clicked, a move from "Already on a button", undo and redo) gives
// the full location, and the Editor goes there: the mode, the device tab, the control and its press.
// Pure: the Editor holds the place, this works out the next one.

import type { ControlId, Finding, ModeId, Press, Scheme, SetupDevices } from '@helmarray/core';
import { PRESSES, own, setupOf } from '@helmarray/core';
import type { DeviceTabId } from './editor-view';

/** Where something is: a mode, and a control and press in it. Left out: as the Editor is. */
export interface Location {
  mode?: ModeId;
  control?: ControlId;
  press?: Press;
}

/** Where the Editor is. */
export interface EditorPlace {
  mode: ModeId;
  selected: ControlId | undefined;
  press: Press;
  /** The device tab asked for; undefined: the setup's first. */
  tab: DeviceTabId | undefined;
  inspector: boolean;
}

/**
 * The tab that draws a control: a unit's button and the mouse beside the left unit on the
 * Azerons, a key and the mouse on the Keyboard tab, a controller button on the Controller.
 */
export function tabOf(control: ControlId, devices: SetupDevices): DeviceTabId | undefined {
  if (control.startsWith('L.') || control.startsWith('R.')) return 'azerons';
  if (control.startsWith('key.')) return 'keyboard';
  if (control.startsWith('pad.')) return 'controller';
  if (control.startsWith('mouse.'))
    return devices.azerons === 'left' && !setupOf(devices).keyboard ? 'azerons' : 'keyboard';
  return undefined;
}

/**
 * The place a location makes: its mode; its control selected, on its tab, at its press (the tap
 * when it names none), the inspector open on it. A mode with no control leaves nothing selected,
 * as a control of another mode's would mislead. What the location leaves out stays.
 */
export function reveal(place: EditorPlace, location: Location, scheme: Scheme): EditorPlace {
  const mode = location.mode ?? place.mode;
  const control = location.control;
  if (control === undefined) {
    return mode === place.mode ? place : { ...place, mode, selected: undefined, press: 'tap' };
  }
  return {
    mode,
    selected: control,
    press: location.press ?? 'tap',
    tab: tabOf(control, scheme.devices) ?? place.tab,
    inspector: true,
  };
}

/** Where a finding is: its control in its mode, or its mode alone; undefined for one setup-wide. */
export function findingLocation(finding: Finding): Location | undefined {
  if (finding.control !== undefined)
    return {
      ...(finding.mode === undefined ? {} : { mode: finding.mode }),
      control: finding.control,
      press: 'tap',
    };
  return finding.mode === undefined ? undefined : { mode: finding.mode };
}

/**
 * Where an edit from `from` to `to` changed what is on the controls: the first mode whose map
 * differs, and the first control and press in it that do. Undo and redo reveal it, so the player
 * sees what came back. Undefined for an edit that changed no control's action (a name, a label).
 */
export function editedLocation(from: Scheme, to: Scheme): Location | undefined {
  const modes = [...new Set([...Object.keys(from.map), ...Object.keys(to.map)])];
  for (const mode of modes) {
    const a = own(from.map, mode) ?? {};
    const b = own(to.map, mode) ?? {};
    const controls = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const control of controls) {
      const press = PRESSES.find((p) => own(a, control)?.[p] !== own(b, control)?.[p]);
      if (press !== undefined) return { mode, control, press };
    }
  }
  return undefined;
}
