# Limitations connues et coûts

## Limitations
| Sujet | Limite | Contournement |
|---|---|---|
| Transcription hors ligne | Aucun moteur local intégré | Audio conservé chiffré, transcription relancée au retour du réseau |
| IA hors ligne | Aucune ; les boutons IA sont désactivés avec la raison | Mode « Structurer sans IA » toujours disponible |
| Rappels application fermée | Une PWA ne peut pas programmer une notification fiable quand elle est fermée ; les rappels sont vérifiés à l'ouverture puis toutes les 30 s | Garder l'application installée et ouverte en arrière-plan ; pour des rappels garantis : Web Push via le serveur (évolution) ou rappels WhatsApp API |
| iPhone | Notifications seulement si l'application est installée (iOS 16.4+) ; enregistrement audio au format mp4 | — |
| Audios multi-appareils | Les audios restent sur l'appareil qui les a enregistrés (choix de confidentialité) | La transcription, elle, est synchronisée |
| Mot de passe oublié (mode local) | Sans clé de secours, les données de l'appareil sont irrécupérables | Conserver la clé de secours ; utiliser le mode serveur |
| Effacement du navigateur | « Effacer les données du site » supprime les données locales | Mode serveur ou exports réguliers ; l'application demande le stockage persistant |
| Conflits | Fusion automatique champ par champ ; sinon arbitrage manuel (Réglages → Synchronisation) | — |
| Pièces jointes | 15 Mo max, stockées sur l'appareil | — |
| Journal des lectures | Côté serveur, seules les écritures sont journalisées | Journal local des consultations sensibles (exports, IA) |
| Bible | Une traduction (Louis Segond 1910, domaine public) | Ajout d'autres traductions via `bible_translations`, uniquement avec licence compatible |
| Mode WhatsApp API | Non testé de bout en bout ici (nécessite un compte Meta vérifié) | Mode lien entièrement fonctionnel |

## Coûts indicatifs (à vérifier auprès des fournisseurs, tarifs susceptibles d'évoluer)
| Poste | Ordre de grandeur |
|---|---|
| Hébergement de l'application (statique) | gratuit (Netlify/Cloudflare Pages) |
| Supabase | offre gratuite suffisante pour un accompagnateur ; offre Pro mensuelle pour une équipe et les sauvegardes |
| IA (compte rendu ≈ 3 000 mots entrée/sortie) | quelques centimes d'euro par compte rendu avec un modèle de milieu de gamme |
| Transcription (Whisper API) | de l'ordre de 0,006 $ par minute d'audio |
| WhatsApp Business Platform | facturation par conversation/message selon la catégorie et le pays ; les messages « utilitaires » vers le Togo ont un coût unitaire faible mais non nul |

Les clés personnelles (mode « clé sur l'appareil ») sont facturées directement sur le compte du fournisseur.
