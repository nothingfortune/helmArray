import { useEffect, useState } from 'react';
import type { AppState } from '../shared/api';
import { watchState } from './appState';

/** The state the main process last told this window, or null until it has. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => watchState(window.helm, setState), []);
  return state;
}
