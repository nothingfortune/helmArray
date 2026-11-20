import { useState } from 'react';
import type { AppState } from '../shared/api';
import { ApplyDrawer } from './apply/ApplyDrawer';
import { Editor } from './screens/Editor';
import { Library } from './screens/Library';

type Screen = { name: 'library' } | { name: 'editor'; schemeId: string };

/** The screen under the header: the Library, or the Editor on one scheme and its Apply drawer. */
export function App({ state }: { state: AppState | null }) {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  const [applying, setApplying] = useState(false);
  const [keysKept, setKeysKept] = useState(0);
  if (screen.name === 'editor') {
    return (
      <>
        <Editor
          schemeId={screen.schemeId}
          onBack={() => {
            setApplying(false);
            setScreen({ name: 'library' });
          }}
          onApply={() => setApplying(true)}
          historyOff={applying}
          keysKept={keysKept}
        />
        <ApplyDrawer
          schemeId={screen.schemeId}
          open={applying}
          onClose={() => setApplying(false)}
          onApplied={() => setKeysKept((n) => n + 1)}
          state={state}
        />
      </>
    );
  }
  return (
    <Library state={state} onOpenEditor={(schemeId) => setScreen({ name: 'editor', schemeId })} />
  );
}
