import React from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled (no network at runtime). Only the subsets the product
// renders are shipped (V5-032): Inter Latin + Latin Extended for English text,
// Noto Sans Bengali (Bengali block, incl. the taka sign ৳) for Bengali.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/inter/latin-ext-700.css';
import '@fontsource/noto-sans-bengali/bengali-400.css';
import '@fontsource/noto-sans-bengali/bengali-600.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/print.css';
import './styles/documents.css';
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
