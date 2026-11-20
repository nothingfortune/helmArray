// The games that ship with the app, handed to the store. Core is where each game's actions are
// written down; this is the one place that lists them for the app.

import type { Game } from '@helmarray/core';
import { helldivers2 } from '@helmarray/core';

export const BUILT_IN_GAMES: readonly Game[] = [helldivers2];
