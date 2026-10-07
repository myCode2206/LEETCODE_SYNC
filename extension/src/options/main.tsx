import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/base.css';
import './options.css';
import { OptionsApp } from './OptionsApp.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
);
