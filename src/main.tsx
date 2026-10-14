import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Service worker (PWA). Absent en mode démo (aperçu hébergé).
if (import.meta.env.MODE !== 'demo' && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    // Mise à jour automatique : la nouvelle version prend la main dès qu'elle est téléchargée.
    registerSW({ immediate: true });
  }).catch(() => undefined);
}

// Demande au navigateur de ne pas effacer les données locales en cas de manque d'espace.
navigator.storage?.persist?.().catch(() => undefined);
