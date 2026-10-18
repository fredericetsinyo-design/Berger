# Configuration des fournisseurs externes

Chaque intégration est **optionnelle** et se configure dans **Réglages**. Tant qu'une intégration n'est pas
configurée, l'interface l'indique clairement (bouton désactivé + raison) au lieu de simuler un résultat.

## Intelligence artificielle (comptes rendus, suggestions, passages)
Trois modes (Réglages → Intelligence artificielle) :

| Mode | Où est la clé | Quand l'utiliser |
|---|---|---|
| Anthropic (Claude), clé personnelle | chiffrée sur l'appareil | accompagnateur seul |
| Compatible OpenAI (OpenAI, Mistral, Groq, Ollama local…) | chiffrée sur l'appareil | autre fournisseur ou modèle local |
| Fonction serveur | secrets Supabase (`AI_*`) | équipe : aucune clé dans les navigateurs |

Changer de fournisseur ne demande aucune modification de code (`src/lib/ai.ts`, interface `AIProvider`).

Garde-fous appliqués **dans le code** :
- envoi refusé si le consentement « traitement automatisé » du jeune n'est pas enregistré ;
- nom, prénom, téléphone et e-mail remplacés par `[JEUNE]`, `[TÉLÉPHONE]`, `[E-MAIL]` ;
- seules les données utiles à la demande sont transmises (pas de zone, date de naissance, contacts) ;
- versets : l'IA choisit dans une liste de références déjà vérifiées ; toute autre référence est écartée et signalée ;
- résultats en brouillon ; validation humaine obligatoire.

Choisissez un fournisseur dont les conditions **excluent l'entraînement sur vos données** (cas des API
professionnelles d'Anthropic et d'OpenAI par défaut) et formalisez-le dans votre politique de confidentialité.

## Transcription
Réglages → Transcription : API compatible Whisper (`/audio/transcriptions`) — OpenAI, Groq, ou un serveur
Whisper auto-hébergé — ou fonction serveur `transcribe` (`STT_*`). Aucun moteur hors ligne n'est intégré :
hors connexion, l'audio est conservé chiffré et la transcription est relancée au retour du réseau.

## Supabase (synchronisation, équipe)
Voir INSTALLATION.md. Rôles :
- **Administrateur** : rôles, activation des comptes, attributions. Ne lit pas les dossiers sans attribution.
- **Responsable d'accompagnement** : lit (sans modifier) les dossiers qui lui sont explicitement attribués.
- **Accompagnateur** : ses propres dossiers et ceux qui lui sont attribués en écriture.

## WhatsApp
**Mode lien (par défaut, fonctionnel immédiatement)** : bouton « Ouvrir dans WhatsApp » avec message prérempli
et validé. Statut enregistré : « WhatsApp ouvert (envoi non vérifiable) ».

**Mode API (WhatsApp Business Platform / Cloud API)** — nécessite :
1. un compte Meta Business vérifié, une application Meta avec le produit WhatsApp, un numéro professionnel ;
2. un jeton d'accès permanent (utilisateur système) → `WA_TOKEN`, l'identifiant du numéro → `WA_PHONE_NUMBER_ID` ;
3. un **modèle de message approuvé** (catégorie « utilitaire », ex. corps « {{1}} ») → `WA_TEMPLATE_NAME` :
   hors de la fenêtre de 24 h suivant un message du jeune, seuls les modèles approuvés peuvent être envoyés ;
4. le **consentement** du jeune (onglet Consentements → « Messages WhatsApp programmés ») — vérifié à la
   programmation ET au moment de l'envoi ;
5. le déploiement de `whatsapp-send` appelé chaque minute :
   ```sql
   select cron.schedule('berger-whatsapp', '* * * * *', $$
     select net.http_post(url := 'https://<ref>.functions.supabase.co/whatsapp-send',
                          headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'));
   $$);
   ```
6. le webhook `whatsapp-webhook` déclaré dans l'application Meta (jeton `WA_VERIFY_TOKEN`, signature `WA_APP_SECRET`)
   pour les statuts remis / lu / échec.

Puis Réglages → WhatsApp → mode « API ». Les messages programmés passent par la file `message_queue`,
sont annulables tant que leur statut est « En file d'attente », et ne sont jamais envoyés en double
(verrou de version côté serveur).

## Google Gemini

**Sur l'appareil :** Réglages → Intelligence artificielle → « Google Gemini ». Collez une clé créée sur https://aistudio.google.com/apikey, puis touchez « Tester et enregistrer ». La clé est chiffrée sur l'appareil et n'est jamais synchronisée. Il faut donc la saisir sur chaque appareil.

**Sur le serveur, une seule clé pour tous les appareils :** dans Supabase, ouvrez Edge Functions → Secrets et ajoutez `GEMINI_API_KEY`. Choisissez ensuite « Fonction serveur » dans les Réglages.

Si le champ « Modèle » est laissé vide, l'application utilise `gemini-flash-latest`. Le secret `AI_MODEL` permet d'en imposer un autre côté serveur.

Avec l'offre gratuite, Google peut réutiliser les textes envoyés. Les noms, numéros et e-mails sont retirés avant l'envoi, mais pour des données sensibles, activez la facturation.
