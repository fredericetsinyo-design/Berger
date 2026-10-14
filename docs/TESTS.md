# Tests — résultats

Exécutés le 14 octobre 2026. Trois niveaux, tous rejouables (voir README).

| # | Scénario du cahier des charges | Où | Résultat |
|---|---|---|---|
| 1 | Création de compte et connexion | unitaire + navigateur | ✅ (mauvais mot de passe refusé, clé de secours) |
| 2 | Création d'une fiche | unitaire + navigateur | ✅ (données illisibles dans IndexedDB) |
| 3 | Rencontre et notes | unitaire + navigateur | ✅ |
| 4 | Génération puis validation d'un résumé IA | unitaire (fournisseur simulé) | ✅ consentement exigé, pseudonymisation, références inventées écartées, reste en brouillon |
| 5 | Actions après une rencontre | unitaire + navigateur | ✅ (retard, alerte « à vérifier ») |
| 6 | Références bibliques vérifiables | unitaire + navigateur | ✅ 71 références de l'index thématique toutes présentes ; « Jean 99:1 » refusé |
| 7 | Rendez-vous et rappels | unitaire + navigateur | ✅ conflit horaire détecté, rappel sans donnée sensible |
| 8 | Relance WhatsApp | unitaire + navigateur | ✅ lien wa.me correct, statut « WhatsApp ouvert », jamais « envoyé » |
| 9 | Enregistrement et transcription audio | unitaire (moteur simulé) | ✅ audio chiffré, brut conservé, correction séparée |
| 10 | Coupure réseau puis création | unitaire + navigateur | ✅ |
| 11 | Fermeture et réouverture hors ligne | unitaire + navigateur | ✅ application servie par le service worker, connexion hors ligne, Bible disponible |
| 12 | Retour réseau, synchronisation sans doublons | unitaire (serveur simulé) + PostgreSQL | ✅ rejeu idempotent |
| 13 | Conflit entre deux appareils | unitaire + PostgreSQL | ✅ fusion automatique si champs différents ; sinon conflit explicite, rien écrasé |
| 14 | Accès non autorisé | unitaire + PostgreSQL (RLS) | ✅ autre compte local : ni lecture ni déchiffrement ; serveur : lecture, écriture, auto-promotion refusées |
| 15 | Changement d'utilisateur | unitaire + navigateur | ✅ |
| 16 | Transcription en échec | unitaire | ✅ statut « échec », audio conservé, relance réussie |
| 17 | Annulation d'une relance programmée | unitaire | ✅ dédoublonnage, consentement exigé, annulation |
| 18 | Smartphone et ordinateur | navigateur 390 px et 1366 px | ✅ navigation inférieure, pas de défilement horizontal |

## Détail
- **Unitaires** (`npm test`) : 22 tests, 22 réussis (dont 3 pour l’import de contacts vCard/CSV et les doublons).
- **Navigateur** (`tests/e2e.py`, Chromium) : 11 parcours, 11 réussis (dont import de contacts et recherche biblique instantanée avec surlignage), aucune erreur JavaScript.
- **PostgreSQL 16 + RLS** (`supabase/tests/run.sh`) : 19 vérifications, 19 réussies — dont : premier compte
  administrateur ; administrateur sans accès automatique aux dossiers ; supervision en lecture seule ;
  compte désactivé sans accès ; journalisation ; purge en cascade.
- **Import de la Bible côté serveur** : 31 102 versets, recherche plein texte en français vérifiée.

## Non testé ici (dépend de comptes externes)
- Appels réels aux API Anthropic / OpenAI / Whisper : testés avec des fournisseurs simulés respectant le même
  contrat ; à vérifier avec vos clés.
- Projet Supabase hébergé (Auth, fonctions Deno) : le schéma et les politiques ont été testés sur PostgreSQL 16
  avec un environnement Supabase reproduit ; les fonctions serveur n'ont pas été exécutées.
- WhatsApp Business Platform (envoi programmé, webhooks) : nécessite un compte Meta vérifié.
- Microphone réel et notifications système sur un téléphone physique.
