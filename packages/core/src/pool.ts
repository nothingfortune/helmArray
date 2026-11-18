import type { KeyCode } from './keys';
import type { GameFileFormat } from './model';

/**
 * Keys the resolver may hand out, most out of the way first. Copied in order from the legacy
 * repo's WIRE_POOL (src/lib/wiring.ts), which the owner's current layouts were wired from.
 *
 * Left out on purpose: letters, digits and F1–F11, which games' defaults and menus use; F12,
 * which Steam takes for screenshots; Enter, Space, Tab, Esc, Backspace and Caps, which mean
 * something in every menu; and the modifiers. The numpad digits come late because Windows reads
 * them as navigation keys with Num Lock off; the backquote late because games put a console
 * on it; the arrows late because menus use them; F13–F24 last because some formats can't name
 * them.
 *
 * FROZEN: a key, once given, is never re-dealt, so this list only ever grows at its end.
 */
export const KEY_POOL: readonly KeyCode[] = [
  'Insert',
  'Home',
  'PageUp',
  'Del',
  'End',
  'PageDown',
  'NumAdd',
  'NumSubtract',
  'NumMultiply',
  'NumDivide',
  '[',
  ']',
  ';',
  "'",
  ',',
  '.',
  '/',
  '\\',
  '-',
  'Num0',
  'Num1',
  'Num2',
  'Num3',
  'Num4',
  'Num5',
  'Num6',
  'Num7',
  'Num8',
  'Num9',
  'NumDecimal',
  '`',
  '=',
  'Up',
  'Down',
  'Left',
  'Right',
  'F13',
  'F14',
  'F15',
  'F16',
  'F17',
  'F18',
  'F19',
  'F20',
  'F21',
  'F22',
  'F23',
  'F24',
];

const F13_TO_F24 = /^F(1[3-9]|2[0-4])$/;

/** Whether a game file in this format can name the key. Unreal and Elite have no F13–F24. */
export function formatCanName(format: GameFileFormat, key: KeyCode): boolean {
  switch (format) {
    case 'unreal-ini':
    case 'elite-binds':
      return !F13_TO_F24.test(key);
  }
}
