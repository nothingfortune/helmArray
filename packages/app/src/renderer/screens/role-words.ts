// What each role is called where the player chooses one: the Game screen's role list and the
// action picker's filter chips.
import type { Role } from '@helmarray/core';

export const ROLE_WORDS: Readonly<Record<Role, string>> = {
  combat: 'Combat',
  movement: 'Movement',
  ability: 'Ability',
  travel: 'Travel',
  menu: 'Menu',
};

/** A role's colour, as a CSS value: an action with none is drawn neutral. */
export const roleColour = (role: Role | undefined): string =>
  role === undefined ? 'var(--color-muted)' : `var(--color-${role})`;
