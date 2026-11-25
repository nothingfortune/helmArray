// Where the Editor is, and THE ONE reveal: every action that shows or selects a control afterwards
// (a fix, a group's fix, a finding clicked, a move from "Already on a button", undo and redo) gives
// the full location, and the Editor goes there: the mode, the device tab, the control and its press.
// Every other move (a control clicked, a mode, a tab, the devices) goes through `navigate`, and all
// of them through `go`: what belongs to one location (the press targeted, the action picker) is
// cleared when the location changes. Pure: the Editor holds the place, this works out the next one.

import type { ControlId, Finding, ModeId, Press, Scheme, SetupDevices } from '@helmarray/core';
import { PRESSES, own, setupOf } from '@helmarray/core';
import type { DeviceTabId } from './editor-view';

/** Where something is: a mode, and a control and press in it. Left out: as the Editor is. */
export interface Location {
  mode?: ModeId;
  control?: ControlId;
  press?: Press;
}

/** Which press of which control the action picker was opened for. */
export interface Picking {
  control: ControlId;
  press: Press;
}

/** Where the Editor is, and what it shows there for now. */
export interface EditorPlace {
  mode: ModeId;
  selected: ControlId | undefined;
  /** The press a click on an action fills: the location's own, the tap again after a move. */
  press: Press;
  /** The device tab asked for; undefined: the setup's first. */
  tab: DeviceTabId | undefined;
  inspector: boolean;
  /** The action picker, open for the selected control's press; null when shut. */
  picking: Picking | null;
}

/**
 * THE ONE way the place changes. A change of mode, control or tab is a move: the press targeted
 * goes back to the tap and the picker shuts, unless the change says otherwise. The picker also
 * shuts when its press or the side panel changes: it was opened for those.
 */
export function go(place: EditorPlace, change: Partial<EditorPlace>): EditorPlace {
  const next = { ...place, ...change };
  const moved =
    next.mode !== place.mode || next.selected !== place.selected || next.tab !== place.tab;
  const press = moved && change.press === undefined ? 'tap' : next.press;
  const same = !moved && press === place.press && next.inspector === place.inspector;
  const picking = change.picking !== undefined ? change.picking : same ? place.picking : null;
  return { ...next, press, picking };
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
    return mode === place.mode ? place : go(place, { mode, selected: undefined });
  }
  return go(place, {
    mode,
    selected: control,
    press: location.press ?? 'tap',
    tab: tabOf(control, scheme.devices) ?? place.tab,
    inspector: true,
  });
}

/** The Editor's moves, each through `go`: what the player clicks, and undo and redo. */
export const navigate = {
  /** A control clicked: selected, with the side panel open on it; clicked again, let go. */
  select: (place: EditorPlace, control: ControlId): EditorPlace =>
    place.selected === control
      ? go(place, { selected: undefined })
      : go(place, { selected: control, inspector: true }),
  /** The side panel's Close: nothing selected. */
  close: (place: EditorPlace): EditorPlace => go(place, { selected: undefined }),
  mode: (place: EditorPlace, mode: ModeId): EditorPlace => go(place, { mode }),
  /** A device tab: shown, with nothing selected on it. */
  tab: (place: EditorPlace, tab: DeviceTabId): EditorPlace =>
    go(place, { tab, selected: undefined }),
  /** The devices changed: a tab they gained is shown, nothing is selected. */
  devices: (place: EditorPlace, gained: DeviceTabId | undefined): EditorPlace =>
    go(place, { tab: gained ?? place.tab, selected: undefined, picking: null }),
  /** "Azerons send" switched: a controller has a tap only, and the picker's list changes. */
  output: (place: EditorPlace): EditorPlace => go(place, { press: 'tap', picking: null }),
  /** The Inspector button: the side panel shown or hidden. */
  inspector: (place: EditorPlace): EditorPlace => go(place, { inspector: !place.inspector }),
  /** A press row: the press a click on an action fills. */
  target: (place: EditorPlace, press: Press): EditorPlace => go(place, { press }),
  /** "Add" or "Change" on a press of the selected control: the picker opens for it. */
  choose: (place: EditorPlace, press: Press): EditorPlace =>
    place.selected === undefined
      ? place
      : go(place, { press, picking: { control: place.selected, press } }),
  /** An action picked, or the picker shut by Esc or Close. */
  pickDone: (place: EditorPlace): EditorPlace => go(place, { picking: null }),
  /** Undo or redo: to where its edit was (`editedLocation`), the picker shut either way. */
  travel: (place: EditorPlace, location: Location | undefined, scheme: Scheme): EditorPlace =>
    go(location === undefined ? place : reveal(place, location, scheme), { picking: null }),
};

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
