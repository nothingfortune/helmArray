import type { HelmApi } from '../shared/api';

declare global {
  interface Window {
    /** Exposed by the preload; the only way a window reaches the main process. */
    helm: HelmApi;
  }
}
