import { describe, expect, it, vi } from 'vitest';
import { trayMenu } from './tray';

function menu(activeGame: string | null) {
  const openPlayView = vi.fn();
  const quit = vi.fn();
  return { items: trayMenu({ activeGame, openPlayView, quit }), openPlayView, quit };
}

describe('trayMenu', () => {
  it('names the active game, or says there is none', () => {
    expect(menu('Elite Dangerous').items[0]).toEqual({ label: 'Elite Dangerous', enabled: false });
    expect(menu(null).items[0]).toEqual({ label: 'No game active', enabled: false });
  });

  it('opens Play view and quits from their own items', () => {
    const m = menu(null);
    const byLabel = (label: string) => m.items.find((item) => item.label === label);
    byLabel('Open Play view')?.click?.({} as never, undefined, {} as never);
    expect(m.openPlayView).toHaveBeenCalledOnce();
    expect(m.quit).not.toHaveBeenCalled();
    byLabel('Quit helmArray')?.click?.({} as never, undefined, {} as never);
    expect(m.quit).toHaveBeenCalledOnce();
  });

  it('lists the items in order', () => {
    expect(menu(null).items.map((item) => item.label ?? item.type)).toEqual([
      'No game active',
      'separator',
      'Open Play view',
      'Quit helmArray',
    ]);
  });
});
