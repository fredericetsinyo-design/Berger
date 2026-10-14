# Berger — Assistant d'accompagnement

Application web progressive (PWA) pour un accompagnateur chrétien qui suit individuellement des jeunes :
fiches, rencontres, notes écrites et vocales, comptes rendus assistés par IA, objectifs, actions, agenda,
rappels, relances WhatsApp, Bible Louis Segond 1910 intégrée et suggestions bibliques vérifiées.
Fonctionne hors ligne, synchronise au retour du réseau, chiffre les dossiers sur l'appareil.

L'outil améliore l'écoute et le suivi ; il ne remplace ni le discernement, ni la prière, ni la relation.
Toute production de l'IA est une proposition à valider.

## Démarrer en 2 minutes

```bash
npm install
npm run dev        # http://localhost:5173
```

Sans configuration, l'application tourne en **mode local** : créez un compte sur l'écran d'accueil,
notez la clé de secours affichée, et commencez. Pour la synchronisation multi-appareils et l'équipe,
voir [docs/INSTALLATION.md](docs/INSTALLATION.md) puis [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Fonctionnalités

| Module | Contenu |
|---|---|
| Authentification | E-mail + mot de passe (local ou Supabase Auth), récupération (clé de secours / e-mail), verrouillage auto, changement d'utilisateur, rôles admin / responsable / accompagnateur |
| Tableau de bord | Statistiques, « Ma journée », alertes formulées comme invitations à vérifier, prochains rendez-vous, comptes rendus à valider |
| Fiche du jeune | Infos (collecte minimale), situation initiale (faits / observations / hypothèses), chronologie filtrable et sourcée, objectifs et progression (aucune note chiffrée), versets, synthèse validable, consentements horodatés, export et suppression |
| Rencontres | Création rapide, sauvegarde automatique, éditeur léger, notes étiquetées, pièces jointes chiffrées, actions, versets vérifiés, prochaine rencontre |
| Notes vocales | Enregistrer / pause / reprendre / arrêter, écoute, suppression, audio chiffré, transcription en ligne ou mise en attente hors ligne, texte brut conservé + correction, relance des échecs |
| Comptes rendus IA | 10 rubriques, hypothèses séparées, informations manquantes, versets limités à une liste vérifiée, sources et date conservées, validation humaine obligatoire ; mode « sans IA » |
| Assistant IA | Questions, préparation, plan de suivi, actions non réalisées, bilan, méditation — avec constat, éléments du dossier, objectif, limites ; accepter / modifier / rejeter |
| Import de contacts | Carnet du téléphone (Chrome Android), fichiers vCard (.vcf) et CSV (Google, Outlook, tableur) ; aperçu, doublons signalés |
| Exemples | 8 fiches d’exemple avec photos pour découvrir l’application, supprimables en un clic |
| Bible | Louis Segond 1910 (domaine public) hors ligne : lecture, recherche par référence ou mots, 12 thèmes, favoris, notes, historique, association aux rencontres ; aucune référence non vérifiée |
| Actions | Vues À faire / En cours / En retard / Terminées, report, résultat, lien rencontre d'origine et ultérieure |
| Agenda | Jour / semaine / mois / liste, conflits horaires, rappels, statuts, préparation automatique de la fiche de séance |
| WhatsApp | Mode lien fonctionnel (statut « WhatsApp ouvert », jamais « envoyé ») ; mode API Business programmable, dédoublonné, annulable |
| Hors ligne | IndexedDB chiffrée, file d'opérations persistante, versions, fusion champ par champ, conflits explicites |

## Structure

```
src/lib/       logique métier (chiffrement, coffre local, synchro, IA, Bible, transcription, WhatsApp, rappels)
src/pages/     écrans
supabase/      migrations SQL + RLS, fonctions serveur (IA, transcription, WhatsApp), tests RLS
public/bible/  Louis Segond 1910 (domaine public), format compact
tests/         tests unitaires (Vitest) et de bout en bout (Playwright)
docs/          installation, déploiement HTTPS, configuration, sécurité, architecture, limites et coûts, tests
```

## Tests

```bash
npm test                                   # 22 tests métier
npm run build && npx vite preview &        # puis :
python3 tests/e2e.py http://localhost:4173/ captures   # parcours navigateur (Playwright)
PGHOST=... PGUSER=postgres ./supabase/tests/run.sh     # 19 vérifications RLS sur PostgreSQL
```

Résultats détaillés : [docs/TESTS.md](docs/TESTS.md).
