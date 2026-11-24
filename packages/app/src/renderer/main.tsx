import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Tooltip } from 'radix-ui';
import './fonts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/chrome.css';
import './styles/library.css';
import { App } from './App';
import { useAppState } from './useAppState';

function MainWindow() {
  const state = useAppState();
  return <App state={state} />;
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
