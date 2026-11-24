import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AppState } from '../shared/api';
import { ApplyDrawer } from './apply/ApplyDrawer';
import { Header } from './header/Header';
import { HandQuestion } from './header/HandQuestion';
import { WriteBlockLine } from './header/WriteBlockLine';
import { applyButton } from './apply/applyButton';
import { Editor } from './screens/Editor';
import { GameScreen } from './screens/Game';
import type { GameTarget } from './screens/game-model';
import { Library } from './screens/Library';

type Screen =
  { name: 'library' } | { name: 'editor'; schemeId: string } | { name: 'game'; target: GameTarget };

/**
 * The main window: the header, the lines under it, and the screen: the Library, the Editor on one
 * scheme and its Apply drawer, or the Game screen on one game's data. The header's pill, when a
 * unit differs, opens Apply for the active scheme from any screen.
 */
export function App({ state }: { state: AppState | null }) {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  const [applying, setApplying] = useState(false);
  const [keysKept, setKeysKept] = useState(0);
  const chrome = (body: ReactNode) => (
    <>
      <Header
        state={state}
        onFix={(schemeId) => {
          setScreen({ name: 'editor', schemeId });
          setApplying(true);
        }}
      />
      {/* Only when the Azeron app blocks the setup: one with no Azeron isn't. */}
      {state !== null && state.writeBlock !== null && state.sync.paused === true && (
        <WriteBlockLine sentence={state.writeBlock} />
      )}
      {state !== null && (
        <HandQuestion
          question={state.question}
          onChoose={(unitId, hand) => void window.helm.chooseHand(unitId, hand)}
        />
      )}
      {body}
    </>
  );
  if (screen.name === 'editor') {
    return chrome(
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
          applyButton={applyButton(state, screen.schemeId)}
        />
        <ApplyDrawer
          schemeId={screen.schemeId}
          open={applying}
          onClose={() => setApplying(false)}
          onApplied={() => setKeysKept((n) => n + 1)}
          state={state}
        />
      </>,
    );
  }
  if (screen.name === 'game') {
    return chrome(
      <GameScreen
        target={screen.target}
        onBack={() => setScreen({ name: 'library' })}
        onOpenEditor={(schemeId) => setScreen({ name: 'editor', schemeId })}
      />,
    );
  }
  return chrome(
    <Library
      state={state}
      onOpenEditor={(schemeId) => setScreen({ name: 'editor', schemeId })}
      onOpenGame={(target) => setScreen({ name: 'game', target })}
      onSheetDone={(gameId) => void window.helm.dismissSheet(gameId)}
    />,
  );
}
