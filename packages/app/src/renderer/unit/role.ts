// A role's two colours, as CSS variables a key reads: its dot and its faint tint. Shared by the units,
// the keyboard, the mouse and the controller.
import type { CSSProperties } from 'react';
import type { Role } from '@helmarray/core';

const ROLE_COLOURS: Record<Role, { dot: string; tint: string }> = {
  combat: { dot: 'var(--color-combat)', tint: 'var(--color-combat-tint)' },
  movement: { dot: 'var(--color-movement)', tint: 'var(--color-movement-tint)' },
  ability: { dot: 'var(--color-ability)', tint: 'var(--color-ability-tint)' },
  travel: { dot: 'var(--color-travel)', tint: 'var(--color-travel-tint)' },
  menu: { dot: 'var(--color-menu)', tint: 'var(--color-menu-tint)' },
};
// An action with no role yet: a plain key, not a guess at a colour.
const NO_ROLE = { dot: 'var(--color-muted)', tint: 'var(--color-raised)' };

export function roleVars(role: Role | undefined): CSSProperties {
  const c = role === undefined ? NO_ROLE : ROLE_COLOURS[role];
  return { '--role': c.dot, '--tint': c.tint } as CSSProperties;
}
