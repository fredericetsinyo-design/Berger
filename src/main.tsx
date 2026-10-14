import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Filet de sécurité : si la session précédente s'est arrêtée sans se fermer normalement
// (plantage du navigateur, fréquent sur iPhone en cas de manque de mémoire), on passe en mode allégé.
try {
  const ALIVE = 'berger.alive', LITE = 'berger.lite';
  if (localStorage.getItem(ALIVE) === '1') localStorage.setItem(LITE, '1');
  if (localStorage.getItem(LITE) === '1') document.documentElement.classList.add('lite');
  localStorage.setItem(ALIVE, '1');
  const bye = () => localStorage.removeItem(ALIVE);
  addEventListener('pagehide', bye);
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? bye() : localStorage.setItem(ALIVE, '1')));
} catch { /* stockage indisponible */ }

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
