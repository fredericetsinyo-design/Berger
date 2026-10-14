// Index thématique : uniquement des RÉFÉRENCES. Le texte est toujours lu dans la base biblique,
// et toute référence qui n'y serait pas trouvée est écartée (voir suggestPassages).
// Ces thèmes sont des catégories de recherche, jamais des diagnostics sur un jeune.

export interface BibleTheme {
  id: string;
  label: string;
  keywords: string[];
  refs: string[];
  reflection: string;
  question: string;
  application: string;
  caution: string;
}

export const THEMES: BibleTheme[] = [
  {
    id: 'identite', label: 'Identité et valeur personnelle',
    keywords: ['identite', 'valeur', 'estime', 'confiance en soi', 'rejet', 'comparaison', 'image de soi', 'complexe'],
    refs: ['Psaumes 139:13-16', 'Genèse 1:27', 'Éphésiens 2:10', '1 Pierre 2:9', 'Ésaïe 43:1-4', 'Romains 8:38-39'],
    reflection: 'Ce que Dieu dit de la personne précède ce qu’elle fait ou réussit.',
    question: 'Qu’est-ce qui influence le plus la manière dont tu te vois en ce moment ?',
    application: 'Noter chaque jour une chose reçue de Dieu ou des autres, et la relire en fin de semaine.',
    caution: 'Ne pas opposer ces textes à une souffrance réelle ; écouter d’abord ce que le jeune vit.',
  },
  {
    id: 'foi', label: 'Foi et confiance en Dieu',
    keywords: ['foi', 'confiance', 'doute', 'peur', 'inquietude', 'avenir', 'incertitude'],
    refs: ['Proverbes 3:5-6', 'Hébreux 11:1', 'Ésaïe 41:10', 'Matthieu 6:25-34', 'Psaumes 23', 'Marc 9:24'],
    reflection: 'La confiance se construit dans la relation, pas dans l’absence de questions.',
    question: 'Dans quel domaine as-tu le plus de mal à faire confiance aujourd’hui ?',
    application: 'Identifier une inquiétude précise et la confier dans la prière chaque jour de la semaine.',
    caution: 'Le doute n’est pas présenté comme une faute ; Marc 9:24 montre une foi qui coexiste avec le doute.',
  },
  {
    id: 'priere', label: 'Prière et vie spirituelle',
    keywords: ['priere', 'prier', 'vie spirituelle', 'meditation', 'lecture biblique', 'eglise', 'devotion'],
    refs: ['Philippiens 4:6-7', 'Matthieu 6:5-13', '1 Thessaloniciens 5:16-18', 'Marc 1:35', 'Luc 18:1', 'Jacques 5:16'],
    reflection: 'La prière est présentée comme une relation simple et régulière plutôt qu’une performance.',
    question: 'À quel moment de ta journée te serait-il le plus naturel de prier ?',
    application: 'Choisir un moment fixe et court (5 minutes) et en parler à la prochaine rencontre.',
    caution: 'Éviter de mesurer la valeur spirituelle du jeune à la quantité de prière.',
  },
  {
    id: 'sagesse', label: 'Sagesse et prise de décision',
    keywords: ['decision', 'choix', 'orientation', 'sagesse', 'discernement', 'conseil', 'etudes'],
    refs: ['Jacques 1:5', 'Proverbes 15:22', 'Psaumes 119:105', 'Romains 12:2', 'Proverbes 16:3', 'Proverbes 2:1-6'],
    reflection: 'La Bible associe la sagesse à la prière, au conseil des autres et à la réflexion.',
    question: 'Quelles options as-tu déjà envisagées, et qui pourrait t’aider à les évaluer ?',
    application: 'Lister les options, les avantages et les risques, puis en parler à une personne de confiance.',
    caution: 'Ne pas présenter un verset comme la réponse directe de Dieu à une décision particulière.',
  },
  {
    id: 'emotions', label: 'Gestion des émotions',
    keywords: ['colere', 'tristesse', 'emotion', 'stress', 'anxiete', 'decouragement', 'pleurs', 'angoisse'],
    refs: ['Psaumes 42:6', 'Éphésiens 4:26', 'Jacques 1:19-20', '1 Pierre 5:7', 'Jean 11:35', 'Psaumes 34:19'],
    reflection: 'Les Psaumes et Jésus lui-même expriment librement les émotions devant Dieu.',
    question: 'Quand cette émotion apparaît, que se passe-t-il juste avant ?',
    application: 'Tenir un court journal des émotions pendant une semaine.',
    caution: 'Une détresse importante ou durable appelle aussi l’aide d’un professionnel de santé ; ne pas spiritualiser un besoin de soin.',
  },
  {
    id: 'pardon', label: 'Relations et pardon',
    keywords: ['pardon', 'relation', 'famille', 'amitie', 'blessure', 'trahison', 'reconciliation', 'parents'],
    refs: ['Colossiens 3:13', 'Matthieu 18:21-22', 'Éphésiens 4:32', '1 Corinthiens 13:4-7', 'Romains 12:18', 'Proverbes 17:17'],
    reflection: 'Le pardon est un chemin, distinct de la réconciliation qui suppose deux parties.',
    question: 'Qu’est-ce qui, pour toi, rendrait cette relation plus saine ?',
    application: 'Identifier une petite démarche possible, sans forcer une réconciliation.',
    caution: 'Pardonner n’oblige jamais à rester dans une situation dangereuse ou abusive ; orienter vers une aide adaptée si nécessaire.',
  },
  {
    id: 'vocation', label: 'Travail et vocation',
    keywords: ['travail', 'vocation', 'emploi', 'metier', 'ecole', 'etudes', 'talent', 'service', 'carriere'],
    refs: ['Colossiens 3:23-24', 'Genèse 2:15', '1 Pierre 4:10', 'Proverbes 22:29', 'Ecclésiaste 9:10', 'Éphésiens 2:10'],
    reflection: 'Le travail est présenté comme une manière de servir Dieu et les autres.',
    question: 'Quelles activités te donnent le sentiment d’être utile ?',
    application: 'Rencontrer une personne qui exerce un métier qui l’intéresse.',
    caution: 'Ne pas confondre réussite professionnelle et approbation divine.',
  },
  {
    id: 'perseverance', label: 'Persévérance',
    keywords: ['perseverance', 'abandon', 'echec', 'epreuve', 'patience', 'difficulte', 'decourage'],
    refs: ['Galates 6:9', 'Hébreux 12:1-2', 'Jacques 1:2-4', 'Romains 5:3-5', 'Ésaïe 40:31', 'Philippiens 3:13-14'],
    reflection: 'La persévérance est décrite comme un processus qui transforme, pas comme une simple volonté.',
    question: 'Qu’est-ce qui t’a aidé à tenir la dernière fois que c’était difficile ?',
    application: 'Découper l’objectif en une prochaine étape réalisable cette semaine.',
    caution: 'Ne pas présenter la souffrance comme voulue ou méritée.',
  },
  {
    id: 'responsabilite', label: 'Responsabilité',
    keywords: ['responsabilite', 'engagement', 'fidelite', 'promesse', 'gestion', 'argent'],
    refs: ['Luc 16:10', 'Galates 6:4-5', 'Matthieu 25:14-30', 'Proverbes 6:6-8', 'Romains 14:12'],
    reflection: 'La fidélité dans les petites choses prépare aux plus grandes.',
    question: 'Quel engagement aimerais-tu mieux tenir ?',
    application: 'Choisir un engagement concret et convenir d’un point de suivi.',
    caution: 'Valoriser les progrès plutôt que pointer les manquements.',
  },
  {
    id: 'discipline', label: 'Discipline personnelle',
    keywords: ['discipline', 'habitude', 'temps', 'organisation', 'tentation', 'maitrise', 'addiction', 'ecran'],
    refs: ['1 Corinthiens 9:24-27', 'Hébreux 12:11', '2 Timothée 1:7', 'Proverbes 25:28', 'Galates 5:22-23', 'Tite 2:11-12'],
    reflection: 'La maîtrise de soi est présentée comme un fruit de l’Esprit qui grandit avec le temps.',
    question: 'Quelle habitude aimerais-tu installer, et quel est le premier pas ?',
    application: 'Mettre en place une habitude simple suivie pendant deux semaines.',
    caution: 'Une dépendance installée nécessite un accompagnement spécialisé en plus du soutien spirituel.',
  },
  {
    id: 'conflits', label: 'Gestion des conflits',
    keywords: ['conflit', 'dispute', 'tension', 'violence', 'desaccord', 'communication'],
    refs: ['Matthieu 18:15', 'Proverbes 15:1', 'Romains 12:17-21', 'Matthieu 5:9', 'Éphésiens 4:29', 'Jacques 4:1-2'],
    reflection: 'La Bible encourage à aller vers l’autre directement et avec douceur.',
    question: 'Comment l’autre personne décrirait-elle ce conflit ?',
    application: 'Préparer ensemble les mots d’une conversation apaisée.',
    caution: 'En cas de violence, la sécurité de la personne passe avant la recherche de dialogue.',
  },
  {
    id: 'esperance', label: 'Espérance dans les périodes difficiles',
    keywords: ['esperance', 'deuil', 'souffrance', 'maladie', 'perte', 'difficile', 'espoir', 'chagrin'],
    refs: ['Romains 15:13', 'Jérémie 29:11', 'Lamentations 3:22-23', '2 Corinthiens 4:16-18', 'Apocalypse 21:4', 'Romains 8:28'],
    reflection: 'L’espérance biblique ne nie pas la douleur : elle la traverse.',
    question: 'Qu’est-ce qui te donne un peu de force en ce moment ?',
    application: 'Identifier une personne ou un lieu de soutien à solliciter cette semaine.',
    caution: 'Jérémie 29:11 s’adresse d’abord au peuple en exil : le présenter dans son contexte, sans promesse individuelle simpliste.',
  },
];
