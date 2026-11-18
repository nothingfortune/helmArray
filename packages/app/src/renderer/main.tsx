import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Tooltip } from 'radix-ui';
import './styles/tokens.css';
import './styles/base.css';

function MainWindow() {
  return (
    <header className="header">
      <span className="wordmark">helmArray</span>
    </header>
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
