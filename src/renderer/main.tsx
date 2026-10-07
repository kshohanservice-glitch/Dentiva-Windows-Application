import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-bengali/400.css';
import '@fontsource/noto-sans-bengali/600.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/print.css';
import { App } from './App';

// Use Bangladesh/UK-style calendar ordering everywhere the Chromium date controls render: DD/MM/YYYY.
document.documentElement.lang = 'en-GB';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
