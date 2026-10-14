# Architecture

```
Navigateur (PWA React + TypeScript)
 ├─ Service worker (Workbox) : fichiers de l'application + Bible en cache
 ├─ Coffre local (src/lib/store.ts)
 │    IndexedDB (Dexie) : enregistrements chiffrés AES-GCM, blobs audio chiffrés,
 │    file d'opérations, conflits, journal local, Bible (31 102 versets)
 ├─ Moteur de synchro (src/lib/sync.ts) ── RPC sync_push / lecture incrémentale ──┐
 ├─ IA (src/lib/ai.ts) ── fournisseur interchangeable (direct ou fonction serveur)  │
 ├─ Transcription (src/lib/transcription.ts) ── moteur interchangeable              │
 └─ WhatsApp (src/lib/whatsapp.ts) ── lien wa.me | file message_queue               │
                                                                                     ▼
Supabase : Auth · PostgreSQL + RLS · Fonctions (ai, transcribe, whatsapp-send, whatsapp-webhook)
```

## Synchronisation
1. Chaque écriture locale : enregistrement chiffré + **une** opération dans la file (par enregistrement),
   avec la version serveur de base et une copie chiffrée de l'état de base.
2. Envoi : `sync_push(table, ligne, version_de_base)`. Identifiants UUID générés sur l'appareil → le rejeu
   ne crée jamais de doublon.
3. Version différente côté serveur → fusion à trois voies champ par champ ; si le même champ a changé des deux
   côtés → conflit enregistré, rien n'est écrasé, l'utilisateur arbitre.
4. Réception : lecture incrémentale par `server_updated_at` ; un élément ayant une modification locale en
   attente n'est jamais remplacé.
5. Échecs : nouvel essai avec attente exponentielle (jusqu'à 5 min).

## Schéma de données (serveur)
| Table | Contenu | Clés |
|---|---|---|
| profiles | utilisateur, rôle, actif | id → auth.users |
| youth_profiles | dossier du jeune (identité, contact, situation initiale, synthèse) | owner_id, retention_until |
| accompaniment_assignments | attribution explicite (accompagnateur / superviseur) | youth_id, user_id |
| accompaniment_sessions | rencontres + compte rendu (brouillon, texte validé, fournisseur, sources) | youth_id |
| session_notes | notes écrites, étiquettes | youth_id, session_id |
| audio_recordings | métadonnées audio (fichier sur l'appareil) | youth_id, session_id |
| transcriptions | brut + corrigé, langue, incertitudes, moteur | session_id |
| goals | objectifs, observations, dernière évaluation | youth_id |
| action_items | actions, responsable, échéance, priorité, statut, résultat | youth_id, session_id |
| appointments | rendez-vous, rappels, statut | youth_id, session_id |
| timeline_events | appels, retours, bilans | youth_id |
| bible_recommendations | passages proposés / retenus / étudiés, source | youth_id, session_id |
| message_templates | modèles de messages | owner_id |
| message_queue | messages WhatsApp (statut, programmation, journal) | youth_id |
| message_delivery_logs | statuts fournis par l'API WhatsApp | message_id |
| consent_records | consentements horodatés | youth_id |
| bible_translations / bible_books / bible_verses | Bible avec métadonnées de licence | — |
| bible_bookmarks | favoris, notes, historique | owner_id |
| audit_logs | journal des écritures | user_id |
| sync_operations | traçabilité des envois (ok / conflit) | user_id |

Colonnes communes : `id uuid`, `owner_id`, `youth_id`, `session_id`, `data jsonb` (détail métier typé dans
`src/lib/types.ts`), `version`, `deleted`, `created_at`, `server_updated_at`.
Les préférences de contact (`contact_preferences` du cahier des charges) sont dans la fiche
(`contactMode`, `allowWhatsApp`, `language`, `availability`) ; les pièces jointes (`attachments`) sont des
métadonnées de la rencontre, le fichier restant chiffré sur l'appareil.
`settings` n'existe que localement (contient les clés d'API, jamais synchronisé).
