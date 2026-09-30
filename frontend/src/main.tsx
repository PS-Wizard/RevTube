import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/design-tokens.css'
import App from './App.tsx'
import './styles/page-shell.css'
import './styles/page-chrome.css'
import './styles/shell-workspace.css'
import './styles/data-table.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Remove the static initial-loader once React has painted
queueMicrotask(() => {
  const el = document.getElementById('initial-loader');
  if (el) {
    el.style.transition = 'opacity 0.25s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 280);
  }
});
