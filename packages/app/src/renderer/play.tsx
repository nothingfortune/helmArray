import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';

// Frameless window: the bar is the drag handle.
function PlayView() {
  return (
    <header className="header drag">
      <span className="wordmark">Play view</span>
    </header>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');
createRoot(root).render(
  <StrictMode>
    <PlayView />
  </StrictMode>,
);
