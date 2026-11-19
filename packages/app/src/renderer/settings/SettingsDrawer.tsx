import { Dialog } from 'radix-ui';
import { ExchangeLog } from './ExchangeLog';

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Settings slide over the page from the right; nothing behind them moves. */
export function SettingsDrawer() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className="btn ghost icon" aria-label="Settings">
          <GearIcon />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <div className="drawer-head">
            <Dialog.Title className="drawer-title">Settings</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn ghost">
                Close
              </button>
            </Dialog.Close>
          </div>
          <ExchangeLog />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
