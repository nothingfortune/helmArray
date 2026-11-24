import { useState } from 'react';
import type { AppState } from '../shared/api';
import { ApplyDrawer } from './apply/ApplyDrawer';
import { Editor } from './screens/Editor';
import { GameScreen } from './screens/Game';
import type { GameTarget } from './screens/game-model';
import { Library } from './screens/Library';

type Screen =
  { name: 'library' } | { name: 'editor'; schemeId: string } | { name: 'game'; target: GameTarget };

/**
 * The screen under the header: the Library, the Editor on one scheme and its Apply drawer, or the
 * Game screen on one game's data.
 */
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
          onOpenScheme={(schemeId) => {
            setApplying(false);
            setScreen({ name: 'editor', schemeId });
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
  if (screen.name === 'game') {
    return (
      <GameScreen
        target={screen.target}
        onBack={() => setScreen({ name: 'library' })}
        onOpenEditor={(schemeId) => setScreen({ name: 'editor', schemeId })}
      />
    );
  }
  return (
    <Library
      state={state}
      onOpenEditor={(schemeId) => setScreen({ name: 'editor', schemeId })}
      onOpenGame={(target) => setScreen({ name: 'game', target })}
    />
  );
}
