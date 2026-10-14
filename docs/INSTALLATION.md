# Installation

## Prérequis
- Node.js 20 ou plus récent, npm.
- (Optionnel) un projet Supabase gratuit ou payant, et la CLI Supabase pour le mode serveur.

## 1. Mode local (aucun serveur)
```bash
npm install
npm run dev
```
Ouvrez http://localhost:5173, cliquez sur **Créer un compte**. Une **clé de secours** s'affiche une seule fois :
conservez-la (papier, gestionnaire de mots de passe). Sans elle, un mot de passe oublié rend les dossiers
de l'appareil illisibles — c'est le prix du chiffrement local.

Les données restent dans le navigateur de cet appareil, chiffrées. Exportez-les régulièrement
(Réglages → Sécurité & données → Exporter) tant qu'aucun serveur n'est configuré.

## 2. Mode serveur (Supabase)
1. Créez un projet sur supabase.com (région la plus proche : Europe de l'Ouest pour Lomé).
2. Appliquez les migrations :
   ```bash
   supabase link --project-ref <ref>
   supabase db push                      # applique supabase/migrations/*.sql
   node scripts/bible-to-sql.mjs > supabase/seed_bible_lsg1910.sql
   psql "<chaîne de connexion>" -f supabase/seed_bible_lsg1910.sql   # optionnel : Bible côté serveur
   ```
3. Copiez `.env.example` en `.env.local` et renseignez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`
   (Project Settings → API). Vous pouvez aussi saisir ces deux valeurs dans l'écran de connexion
   (« Configurer ») sans recompiler.
4. Dans Authentication → URL Configuration, ajoutez l'adresse de l'application (pour les e-mails de
   réinitialisation : `https://votre-domaine/#/reinitialisation`).
5. Le **premier compte créé devient administrateur**. Les suivants sont accompagnateurs ;
   l'administrateur attribue les rôles et les accès dans Réglages → Équipe & accès.

## 3. Fonctions serveur (optionnelles)
```bash
supabase secrets set --env-file .env.local      # uniquement les variables non VITE_
supabase functions deploy ai
supabase functions deploy transcribe
supabase functions deploy whatsapp-send --no-verify-jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt
```
Voir CONFIGURATION.md pour chaque fournisseur.

## 4. Vérifier
```bash
npm test
PGHOST=... PGUSER=postgres ./supabase/tests/run.sh   # sur une base PostgreSQL de test, jamais en production
```
