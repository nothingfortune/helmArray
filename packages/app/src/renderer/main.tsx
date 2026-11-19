import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Tooltip } from 'radix-ui';
import './styles/tokens.css';
import './styles/base.css';
import './styles/chrome.css';
import { Header } from './header/Header';
import { HandQuestion } from './header/HandQuestion';
import { WriteBlockLine } from './header/WriteBlockLine';
import { useAppState } from './useAppState';

function MainWindow() {
  const state = useAppState();
  return (
    <>
      <Header state={state} />
      {state !== null && state.writeBlock !== null && (
        <WriteBlockLine sentence={state.writeBlock} />
      )}
      {state !== null && (
        <HandQuestion
          question={state.question}
          onChoose={(unitId, hand) => void window.helm.chooseHand(unitId, hand)}
        />
      )}
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');
createRoot(root).render(
  <StrictMode>
    <Tooltip.Provider>
      <MainWindow />
    </Tooltip.Provider>
  </StrictMode>,
);
