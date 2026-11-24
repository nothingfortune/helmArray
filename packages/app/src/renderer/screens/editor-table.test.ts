// Every setup the device chooser can make, with either output, on each tab it shows, for each kind
// of control on that tab: the action list is the selected control's binding set's, and every action
// cleared off a control can be put back on it in two clicks (the control, then the action).
import { describe, expect, it } from 'vitest';
import type { Game, Scheme, SetupDevices } from '@helmarray/core';
import {
  AZERONS_ONLY,
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  controlSet,
  helldivers2,
  inSetup,
  resolve,
  setupOf,
  xboxControllerPreset,
} from '@helmarray/core';
import {
  assign,
  chooseAzerons,
  chooseController,
  chooseKeyboard,
  clear,
  hasDevices,
  isStick,
  setDevices,
  setOutput,
  shownPresses,
} from './editor-model';
import { editorView } from './editor-view';
import { hostileOneMode } from './editor-fixture';
import type { DeviceTabId, EditorView } from './editor-view';

/** Every setup the chooser can reach: which Azerons, the keyboard and mouse, the controller. */
const SETUPS: SetupDevices[] = (['both', 'left', 'none'] as const)
  .flatMap((azerons) =>
    [false, true].flatMap((keyboard) =>
      [false, true].map((controller) =>
        chooseController(
          chooseKeyboard(chooseAzerons({ ...AZERONS_ONLY }, azerons), keyboard),
          controller,
        ),
      ),
    ),
  )
  .filter(hasDevices);

const ALL_CONTROLS = [
  ...CYBORG2_LEFT.positions.map((p) => `L.${p.name}`),
  ...CYBORG2_RIGHT.positions.map((p) => `R.${p.name}`),
  ...BUILT_IN_DEVICES.flatMap((d) => d.controls)
    .filter((c) => c.sends !== undefined && !c.id.startsWith('pedal.'))
    .map((c) => c.id),
].filter((c) => !isStick(c));

/** The kinds of control a tab draws, by the prefix of their ids. */
function kindsOn(view: EditorView, tab: DeviceTabId): string[] {
  if (tab === 'controller') return ['pad.'];
  if (tab === 'keyboard')
    return [...(view.keyboard ? ['key.'] : []), ...(view.mouse ? ['mouse.'] : [])];
  return [
    ...view.hands.map((h) => (h === 'left' ? 'L.' : 'R.')),
    ...(view.mouseBeside ? ['mouse.'] : []),
  ];
}

/** The mode's actions on no control of the setup in this binding set, in the game's order. */
function expectedFor(scheme: Scheme, set: string, g: Game, MODE: string): string[] {
  const setup = setupOf(scheme.devices);
  const placed = new Set(
    ALL_CONTROLS.filter((c) => inSetup(setup, c) && controlSet(scheme, c) === set).flatMap((c) =>
      Object.values(shownPresses(scheme, MODE, c)),
    ),
  );
  return g.actions.filter((a) => a.mode === MODE && !placed.has(a.id)).map((a) => a.id);
}

/** The action list the side panel shows for the selected control: one list, its set's. */
const listFor = (view: EditorView): string[] =>
  view.lists.length === 1 ? (view.lists[0]?.actions.map((a) => a.id) ?? []) : [];
/** Every action a click can put on the selected control: not on its set, or moved from another. */
const offeredBy = (view: EditorView): string[] => [
  ...listFor(view),
  ...view.moves.map((m) => m.id),
];

const viewOf = (g: Game, MODE: string, scheme: Scheme, tab: DeviceTabId, selected?: string) =>
  editorView({
    scheme,
    game: g,
    plan: resolve(scheme, g, BUILT_IN_DEVICES),
    mode: MODE,
    selected,
    tab,
  });

// Helldivers 2, and the same game with its actions in a mode named __proto__ and four of them
// named __proto__, constructor, toString and hasOwnProperty.
const GAMES = [
  { name: 'Helldivers 2', g: helldivers2, MODE: 'default' },
  { name: 'hostile ids', g: hostileOneMode, MODE: '__proto__' },
];
const cases = GAMES.flatMap(({ name, g, MODE }) =>
  SETUPS.flatMap((devices) =>
    (['pad', 'keys'] as const).map((output) => ({ name, g, MODE, devices, output })),
  ),
);

describe.each(cases)(
  '$name: $devices.azerons Azerons, keyboard $devices.keyboard, controller $devices.controller, $output',
  ({ g, MODE, devices, output }) => {
    const scheme = setOutput(setDevices(xboxControllerPreset(g), devices, g), output, g);
    const tabs = viewOf(g, MODE, scheme, 'azerons').tabs.map((t) => t.id);

    it.each(tabs)(
      'on the %s tab, each control’s list is its own binding set’s, and a cleared action goes back on it',
      (tab) => {
        const faults: string[] = [];
        // Nothing lost on the way: the mode is still an entry of the scheme's map, with actions.
        if (!Object.hasOwn(scheme.map, MODE) || Object.keys(scheme.map[MODE] ?? {}).length === 0)
          faults.push(`the switches lost mode ${MODE}`);
        const view = viewOf(g, MODE, scheme, tab);
        for (const kind of kindsOn(view, tab)) {
          const controls = ALL_CONTROLS.filter(
            (c) => c.startsWith(kind) && inSetup(setupOf(scheme.devices), c),
          );
          for (const control of controls) {
            const set = controlSet(scheme, control) ?? '';
            const list = listFor(viewOf(g, MODE, scheme, tab, control));
            if (JSON.stringify(list) !== JSON.stringify(expectedFor(scheme, set, g, MODE)))
              faults.push(
                `${control}: lists ${list.length}, its set has ${expectedFor(scheme, set, g, MODE).length} unplaced`,
              );
            const action = shownPresses(scheme, MODE, control).tap;
            if (action === undefined) continue;
            // Click 1: the control (it is selected, as after clearing it); click 2: the action.
            const cleared = clear(scheme, { mode: MODE, control, press: 'tap' });
            const offered = offeredBy(viewOf(g, MODE, cleared, tab, control));
            if (!offered.includes(action))
              faults.push(`${control}: ${action} isn't offered once cleared`);
            const back = assign(cleared, { mode: MODE, control, press: 'tap' }, action, g);
            if (shownPresses(back, MODE, control).tap !== action)
              faults.push(`${control}: ${action} doesn't go back on it`);
          }
        }
        expect(faults).toEqual([]);
      },
    );
  },
);
