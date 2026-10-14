# Déploiement HTTPS

Une PWA **exige HTTPS** (service worker, micro, notifications). L'application est un site statique :
le dossier `dist/` produit par `npm run build` se dépose sur n'importe quel hébergeur HTTPS.

```bash
cp .env.example .env.local   # renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY si mode serveur
npm ci
npm run build                # → dist/
```

## Option rapide — Netlify Drop (2 minutes, sans ligne de commande)
1. Ouvrir https://app.netlify.com/drop et glisser le dossier `dist` (ou le contenu de `berger-site.zip` décompressé).
2. Netlify donne une adresse `https://xxxx.netlify.app` en HTTPS. Créer un compte gratuit pour la conserver
   (sinon elle expire au bout d'une heure) et la renommer (Site configuration → Change site name).
3. Domaine personnalisé (ex. berger.lambano.tg) : Domain management → Add a domain, puis l'enregistrement DNS indiqué.
Le fichier `_headers` fourni applique les en-têtes de sécurité.

## Option GitHub Pages (déploiement automatique à chaque modification)
1. Créer un dépôt **public** vide nommé `berger` (les Pages sur dépôt privé exigent un abonnement GitHub payant).
2. Y envoyer le code ; le fichier `.github/workflows/deploy.yml` construit, teste et publie automatiquement.
3. Settings → Pages → Source : **GitHub Actions**. Adresse : `https://<compte>.github.io/berger/`.
4. (Mode serveur) Settings → Secrets and variables → Actions → Variables : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Option A — Hébergeur statique (le plus simple)
Netlify, Vercel, Cloudflare Pages ou GitHub Pages : dossier de publication `dist`, commande `npm run build`.
Le certificat HTTPS est automatique. Le routage utilise `#/` : aucune règle de réécriture n'est nécessaire.

## Option B — Votre serveur (Nginx + Let's Encrypt)
```nginx
server {
  listen 443 ssl http2;
  server_name berger.votre-domaine.tg;
  ssl_certificate     /etc/letsencrypt/live/berger.votre-domaine.tg/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/berger.votre-domaine.tg/privkey.pem;
  root /var/www/berger/dist;

  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  add_header Permissions-Policy "microphone=(self), camera=(), geolocation=()" always;
  add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://api.openai.com; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'" always;

  location = /sw.js { add_header Cache-Control "no-cache"; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location / { try_files $uri /index.html; }
}
server { listen 80; server_name berger.votre-domaine.tg; return 301 https://$host$request_uri; }
```
Certificat : `sudo certbot --nginx -d berger.votre-domaine.tg`.
Adaptez `connect-src` aux fournisseurs IA/transcription réellement utilisés (ou n'autorisez que Supabase
si l'IA passe par les fonctions serveur — recommandé).

## Mises à jour
Après chaque déploiement, l'application propose « Une nouvelle version est disponible ». Les données locales
(IndexedDB) sont conservées. Ne changez jamais de domaine sans avoir synchronisé ou exporté : les données
locales sont liées à l'origine (domaine).

## Installation sur smartphone
Ouvrir l'adresse dans Chrome (Android) → menu → « Installer l'application ». Sur iPhone : Safari → Partager →
« Sur l'écran d'accueil » (les notifications nécessitent iOS 16.4+ et l'application installée).
