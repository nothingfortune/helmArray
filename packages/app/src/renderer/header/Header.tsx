import type { AppState } from '../../shared/api';
import { SettingsDrawer } from '../settings/SettingsDrawer';
import { DeviceChip } from './DeviceChip';
import { chipViews } from './chips';
import { SyncPill } from './SyncPill';

/**
 * The wordmark; on the right the connected units, the sync pill and Settings. `onFix` opens Apply
 * for the active scheme, from the pill when a unit differs.
 */
export function Header({
  state,
  onFix,
}: {
  state: AppState | null;
  onFix?: ((schemeId: string) => void) | undefined;
}) {
  const schemeId = state?.activeSchemeId ?? null;
  return (
    <header className="header">
      <span className="wordmark">helmArray</span>
      <div className="header-right">
        {state !== null && (
          <>
            {chipViews(state.devices).map((chip) => (
              <DeviceChip key={chip.key} chip={chip} />
            ))}
            <SyncPill
              sync={state.sync}
              onFix={onFix !== undefined && schemeId !== null ? () => onFix(schemeId) : undefined}
            />
          </>
        )}
        <SettingsDrawer />
      </div>
    </header>
  );
}
