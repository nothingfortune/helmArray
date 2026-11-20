import { useCallback, useEffect, useState } from 'react';
import type { LibraryEntry } from '../../shared/api';

export interface LibraryData {
  /** Null until the first answer. */
  entries: LibraryEntry[] | null;
  /** One plain sentence when the library couldn't be read, or null. */
  error: string | null;
  /** True while Steam is being read again. */
  scanning: boolean;
  /** Reads Steam again, for a game installed since. */
  rescan(): void;
}

/** The merged library from the main process: Steam's games and the ones helmArray knows. */
export function useLibrary(): LibraryData {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let live = true;
    window.helm.listLibrary(false).then(
      (list) => {
        if (live) setEntries(list);
      },
      () => {
        if (live) setError("The games couldn't be listed.");
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const rescan = useCallback(() => {
    setScanning(true);
    window.helm.listLibrary(true).then(
      (list) => {
        setEntries(list);
        setError(null);
        setScanning(false);
      },
      () => {
        setError("The games couldn't be listed.");
        setScanning(false);
      },
    );
  }, []);

  return { entries, error, scanning, rescan };
}
