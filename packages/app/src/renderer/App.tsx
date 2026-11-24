import { useState } from 'react';
import type { AppState } from '../shared/api';
import { ApplyDrawer } from './apply/ApplyDrawer';
import { Editor } from './screens/Editor';
import { GameScreen } from './screens/Game';
import type { GameTarget } from './screens/game-model';
import { Library } from './screens/Library';

type Screen =
  | { name: 'library' }
  /** `made`: just made from a preset, so the drawer opens on it when it has nothing to fix (J1). */
  | { name: 'editor'; schemeId: string; made?: boolean }
  | { name: 'game'; target: GameTarget };

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
          onOpenScheme={(schemeId, made) => {
            setApplying(false);
            setScreen({ name: 'editor', schemeId, made: made === true });
          }}
          onApply={() => setApplying(true)}
          historyOff={applying}
          keysKept={keysKept}
          applyWhenReady={screen.made === true}
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
        onOpenEditor={(schemeId) => setScreen({ name: 'editor', schemeId, made: true })}
      />
    );
  }
  return (
    <Library
      state={state}
      onOpenEditor={(schemeId, made) =>
        setScreen({ name: 'editor', schemeId, made: made === true })
      }
      onOpenGame={(target) => setScreen({ name: 'game', target })}
    />
  );
}
