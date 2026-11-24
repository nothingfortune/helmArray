import type { SyncPill as SyncPillState } from '../../shared/api';
import { pillView } from './pill';

/**
 * What the units hold against what was applied. Always visible; read, never assumed. A unit that
 * differs makes it a button that opens Apply (`onFix`).
 */
export function SyncPill({
  sync,
  onFix,
}: {
  sync: SyncPillState;
  onFix?: (() => void) | undefined;
}) {
  const view = pillView(sync, onFix !== undefined);
  const body = (
    <>
      <span className={`dot tone-${sync.tone}`} aria-hidden="true" />
      {view.text}
    </>
  );
  if (view.fix) {
    return (
      <button
        type="button"
        className={`pill pill-button tone-${sync.tone}`}
        title={sync.detail}
        onClick={onFix}
      >
        {body}
      </button>
    );
  }
  return (
    <span className={`pill tone-${sync.tone}`} title={sync.detail}>
      {body}
    </span>
  );
}
