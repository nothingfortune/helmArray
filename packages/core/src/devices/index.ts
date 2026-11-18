import type { Device } from '../model';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from './cyborg2';
import { KEYBOARD_MOUSE, PRO_FLIGHT_PEDALS, XBOX_PAD } from './fixed';

export { CYBORG2_LEFT, CYBORG2_RIGHT } from './cyborg2';
export { KEYBOARD_MOUSE, PRO_FLIGHT_PEDALS, XBOX_PAD } from './fixed';

/** Every device helmArray knows, in the order the editor and Play view show them. */
export const BUILT_IN_DEVICES: readonly Device[] = [
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  KEYBOARD_MOUSE,
  XBOX_PAD,
  PRO_FLIGHT_PEDALS,
];
