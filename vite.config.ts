import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  // En mode démo (aperçu hébergé), chemins relatifs et pas de service worker.
  // VITE_BASE permet l'hébergement dans un sous-dossier (ex. /berger/ sur GitHub Pages).
  base: mode === 'demo' ? './' : (process.env.VITE_BASE ?? '/'),
  plugins: [
    react(),
    mode !== 'demo' &&
      VitePWA({
        registerType: 'autoUpdate', // une version corrigée s'installe d'elle-même, même si l'ancienne plante
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Berger — Assistant d’accompagnement',
          short_name: 'Berger',
          description: 'Suivi et accompagnement des jeunes',
          lang: 'fr',
          theme_color: '#F7891F',
          background_color: '#FFF6EC',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Seuls les fichiers statiques de l'application sont mis en cache.
          // Aucune réponse privée (Supabase, IA, transcription) n'est mise en cache par le service worker :
          // les données des jeunes vivent chiffrées dans IndexedDB.
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: 'index.html',
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.endsWith('/bible/lsg.json'),
              handler: 'CacheFirst',
              options: { cacheName: 'bible-public-domain' },
            },
          ],
        },
      }),
  ].filter(Boolean),
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
  },
}));
