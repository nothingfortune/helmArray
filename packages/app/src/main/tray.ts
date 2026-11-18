import type { MenuItemConstructorOptions } from 'electron';

export interface TrayActions {
  activeGame: string | null;
  openPlayView: () => void;
  quit: () => void;
}

export function trayMenu(actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: actions.activeGame ?? 'No game active', enabled: false },
    { type: 'separator' },
    { label: 'Open Play view', click: actions.openPlayView },
    { label: 'Quit helmArray', click: actions.quit },
  ];
}
