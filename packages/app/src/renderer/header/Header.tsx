import type { AppState } from '../../shared/api';
import { SettingsDrawer } from '../settings/SettingsDrawer';
import { DeviceChip } from './DeviceChip';
import { chipViews } from './chips';
import { SyncPill } from './SyncPill';

/** The wordmark; on the right the connected units, the sync pill and Settings. */
export function Header({ state }: { state: AppState | null }) {
  return (
    <header className="header">
      <span className="wordmark">helmArray</span>
      <div className="header-right">
        {state !== null && (
          <>
            {chipViews(state.devices).map((chip) => (
              <DeviceChip key={chip.key} chip={chip} />
            ))}
            <SyncPill sync={state.sync} />
          </>
        )}
        <SettingsDrawer />
      </div>
    </header>
  );
}
