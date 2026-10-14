# Sécurité et confidentialité

## Sur l'appareil
- Clé de données AES-256-GCM aléatoire par compte, enveloppée (a) par une clé dérivée du mot de passe
  (PBKDF2-SHA256, 310 000 itérations) et (b) par la clé de secours. La clé n'existe qu'en mémoire vive
  pendant la session.
- Chiffrés : fiches, rencontres, notes, transcriptions, comptes rendus, actions, rendez-vous, consentements,
  réglages (dont clés d'API), **audios et pièces jointes**. En clair : identifiant technique, nom de table,
  horodatage — aucune donnée personnelle.
- Verrouillage automatique après inactivité (15 min par défaut) ; « Changer d'utilisateur » verrouille sans
  rien effacer. Un second compte sur le même appareil ne peut ni voir ni déchiffrer les dossiers du premier
  (testé).
- Le service worker ne met en cache que les fichiers de l'application et la Bible (domaine public) ;
  aucune réponse privée n'est mise en cache.
- Perte d'autorisation : le compte est verrouillé, les données locales restent chiffrées, les modifications
  non synchronisées ne sont jamais supprimées silencieusement (l'effacement demande une confirmation
  explicite indiquant le nombre de modifications perdues).
- Notifications : texte neutre (« Rendez-vous à 15:00 »), jamais de nom ni de sujet.

## Sur le serveur (Supabase)
- RLS sur toutes les tables ; accès = propriétaire du dossier ou attribution explicite
  (supervision en lecture seule) ; l'administrateur n'a pas d'accès automatique aux dossiers.
- Un utilisateur ne peut pas modifier son rôle ; un compte désactivé perd tout accès.
- `sync_push` s'exécute avec les droits de l'appelant (RLS appliquée) et refuse les écritures périmées.
- Journal `audit_logs` : toutes les écritures (création, modification, suppression logique, purge,
  attributions). Les lectures ne sont pas journalisées côté base (limite PostgreSQL/RLS) ; le journal local
  de l'appareil enregistre connexions, exports et appels IA.
- Communications chiffrées (HTTPS/TLS). Données chiffrées au repos par Supabase.
- Les audios ne sont **pas** envoyés au serveur de synchronisation : ils restent chiffrés sur l'appareil
  qui les a enregistrés (seule la transcription est synchronisée).

## Mineurs
Case « Mineur(e) » sur la fiche, champ d'autorisation parentale et consentement dédié. Pour un mineur,
recueillez l'autorisation du responsable légal avant tout enregistrement audio, traitement IA ou message
programmé, selon le cadre légal applicable (au Togo : loi n° 2019-014 relative à la protection des données
à caractère personnel) et les règles de votre église ou organisation.

## Conservation et effacement
- Export JSON d'un dossier (fiche du jeune) ou de toutes les données (Réglages).
- Suppression d'un dossier : suppression logique synchronisée, puis purge définitive serveur
  (`purge_youth`, ou `purge_expired()` planifiée : dossiers supprimés depuis 30 jours ou dont la date
  `retention_until` est dépassée).
- Recommandation : fixer une durée de conservation après la fin de l'accompagnement (ex. 2 ans) et l'indiquer
  aux jeunes.

## À faire par l'organisation
- Rédiger une notice d'information et un modèle de consentement pour les jeunes.
- Désigner un responsable des données ; tenir un registre des traitements.
- Sauvegardes : activer les sauvegardes Supabase (Point-in-Time Recovery sur les offres payantes).
