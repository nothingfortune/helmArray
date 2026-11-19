import type { AppState, HelmApi } from '../shared/api';

/**
 * Tells `listener` the state now and every change after it; returns the way to stop.
 * A pushed state is newer than the answer to `state()` if it arrives first, so the late
 * answer is dropped rather than overwriting it.
 */
export function watchState(
  api: Pick<HelmApi, 'state' | 'onState'>,
  listener: (state: AppState) => void,
): () => void {
  let live = true;
  let pushed = false;
  const stopListening = api.onState((state) => {
    if (!live) return;
    pushed = true;
    listener(state);
  });
  api.state().then(
    (state) => {
      if (live && !pushed) listener(state);
    },
    () => {
      // The next push fills the header in; until then it shows only the wordmark.
    },
  );
  return () => {
    live = false;
    stopListening();
  };
}
