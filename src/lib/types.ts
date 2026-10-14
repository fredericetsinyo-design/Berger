// Modèle de données local. Chaque enregistrement est chiffré dans IndexedDB
// et synchronisé (si Supabase est configuré) vers la table serveur correspondante.

export type TableName =
  | 'youth'
  | 'sessions'
  | 'notes'
  | 'audios'
  | 'transcriptions'
  | 'goals'
  | 'actions'
  | 'appointments'
  | 'events'
  | 'bible_recs'
  | 'bible_favs'
  | 'messages'
  | 'templates'
  | 'consents'
  | 'settings';

export const TABLES: TableName[] = [
  'youth', 'sessions', 'notes', 'audios', 'transcriptions', 'goals', 'actions',
  'appointments', 'events', 'bible_recs', 'bible_favs', 'messages', 'templates', 'consents', 'settings',
];

export interface BaseRecord {
  id: string;
  ownerId: string; // accompagnateur propriétaire
  createdAt: string;
  updatedAt: string;
  version: number; // incrémenté à chaque modification locale validée par le serveur
  deleted?: boolean;
}

export type YouthStatus = 'nouveau' | 'actif' | 'pause' | 'termine';
export type Kind = 'fait' | 'observation' | 'hypothese';

export interface InitialItem { kind: Kind; text: string }

export interface Youth extends BaseRecord {
  firstName: string;
  lastName: string;
  photo?: string; // data URL réduite
  birthDate?: string;
  isMinor?: boolean;
  guardianConsent?: string; // qui a autorisé, quand
  phone?: string;
  email?: string;
  zone?: string;
  status: YouthStatus;
  startDate: string;
  accompagnateur?: string;
  contactMode?: 'whatsapp' | 'appel' | 'sms' | 'email' | 'presentiel';
  language?: string;
  availability?: string;
  allowWhatsApp?: boolean;
  emergencyContact?: string;
  initial: {
    context?: string;
    expectations?: string;
    needs?: string;
    personalGoals?: string;
    spiritualGoals?: string;
    schoolWork?: string;
    strengths?: string;
    specialPoints?: string;
    firstActions?: string;
    items: InitialItem[];
  };
  synthesis?: { text: string; generatedAt?: string; source?: string; validatedAt?: string };
  isSample?: boolean; // fiche d'exemple (démonstration), supprimable en un clic
  importedFrom?: 'vcard' | 'csv' | 'telephone';
}

export type SessionType = 'presentiel' | 'telephone' | 'visio' | 'messagerie';
export type ReportStatus = 'brouillon' | 'a_valider' | 'valide';

export interface SummaryDraft {
  context: string;
  themes: string[];
  concerns: string[];
  needs: string[];
  strengths: string[];
  decisions: string[];
  actions: string[];
  toDeepen: string[];
  verses: { ref: string; why: string }[];
  next: string;
  hypotheses: string[];
  missing: string[];
}

export interface Session extends BaseRecord {
  youthId: string;
  date: string;
  type: SessionType;
  theme: string;
  topics: string[];
  notes: string;
  needs?: string;
  decisions?: string;
  verses: string[];
  nextDate?: string;
  attachments: { name: string; type: string; size: number; blobId: string }[];
  reportStatus: ReportStatus;
  summary?: {
    draft?: SummaryDraft;
    text?: string; // compte rendu validé (modifiable)
    generatedAt?: string;
    provider?: string;
    sources?: string[]; // ce qui a été transmis à l'IA (notes, transcription x…)
    validatedAt?: string;
  };
}

export interface Note extends BaseRecord {
  youthId?: string;
  sessionId?: string;
  title: string;
  content: string; // markdown léger
  tags: string[];
}

export type AudioStatus = 'enregistre' | 'en_attente' | 'en_cours' | 'transcrit' | 'echec' | 'manuel';
export interface Audio extends BaseRecord {
  youthId?: string;
  sessionId?: string;
  durationSec: number;
  mime: string;
  blobId: string;
  status: AudioStatus;
  consent: string; // mention du consentement
  error?: string;
}

export interface Transcription extends BaseRecord {
  audioId: string;
  sessionId?: string;
  raw: string; // texte brut produit par le moteur, jamais modifié
  corrected?: string;
  language?: string;
  uncertain?: string[];
  provider: string;
}

export type GoalStatus = 'en_cours' | 'atteint' | 'en_pause' | 'abandonne';
export interface Goal extends BaseRecord {
  youthId: string;
  title: string;
  description?: string;
  dueDate?: string;
  plannedActions?: string;
  status: GoalStatus;
  observations: { date: string; text: string }[];
  lastEvaluated?: string;
  youthComment?: string;
}

export type ActionStatus = 'a_faire' | 'en_cours' | 'terminee' | 'annulee';
export interface ActionItem extends BaseRecord {
  youthId?: string;
  sessionId?: string;
  followUpSessionId?: string;
  title: string;
  description?: string;
  owner: 'accompagnateur' | 'jeune';
  dueDate?: string;
  priority: 'basse' | 'normale' | 'haute';
  status: ActionStatus;
  reminderAt?: string;
  followUp?: string;
  result?: string;
}

export type AppointmentStatus = 'planifie' | 'confirme' | 'effectue' | 'annule' | 'reporte';
export interface Appointment extends BaseRecord {
  youthId: string;
  start: string;
  end: string;
  place?: string;
  mode: SessionType;
  subject?: string;
  prepNotes?: string;
  reminders: number[]; // minutes avant
  status: AppointmentStatus;
  sessionId?: string;
  notifiedAt?: string[];
}

export type EventKind = 'appel' | 'relance' | 'retour' | 'bilan_intermediaire' | 'bilan_final' | 'progres' | 'difficulte' | 'autre';
export interface TimelineEvent extends BaseRecord {
  youthId: string;
  date: string;
  kind: EventKind;
  title: string;
  text?: string;
}

export interface BibleRec extends BaseRecord {
  youthId?: string;
  sessionId?: string;
  ref: string; // référence normalisée, vérifiée dans la base biblique
  theme?: string;
  why?: string;
  reflection?: string;
  question?: string;
  application?: string;
  caution?: string;
  comment?: string;
  status: 'propose' | 'accepte' | 'rejete' | 'etudie';
  source: string; // 'index-thematique' | 'recherche' | 'ia:<fournisseur>' | 'manuel'
  meditationFor?: string; // id de rendez-vous
}

export interface BibleFav extends BaseRecord { ref: string; note?: string; kind: 'favori' | 'note' | 'historique' }

export type MessageStatus = 'brouillon' | 'prepare' | 'lien_ouvert' | 'en_file' | 'envoi_en_cours' | 'envoye' | 'remis' | 'lu' | 'echec' | 'annule';
export interface Message extends BaseRecord {
  youthId: string;
  templateId?: string;
  body: string;
  channel: 'whatsapp_lien' | 'whatsapp_api';
  status: MessageStatus;
  scheduledAt?: string;
  validatedAt?: string;
  log: { at: string; status: MessageStatus; detail?: string }[];
  dedupeKey?: string;
}

export interface Template extends BaseRecord { name: string; body: string }

export interface Consent extends BaseRecord {
  youthId: string;
  type: 'enregistrement_audio' | 'traitement_ia' | 'messages_whatsapp' | 'autorisation_parentale' | 'conservation_donnees';
  granted: boolean;
  by: string; // qui a donné / retiré le consentement
  date: string;
  note?: string;
}

export interface Settings extends BaseRecord {
  appName: string;
  primary: string;
  logo?: string;
  theme: 'clair' | 'sombre' | 'systeme';
  ai: { provider: 'aucun' | 'anthropic' | 'openai_compatible' | 'serveur'; apiKey?: string; model?: string; baseUrl?: string };
  stt: { provider: 'aucun' | 'openai_compatible' | 'serveur'; apiKey?: string; model?: string; baseUrl?: string };
  whatsapp: { mode: 'lien' | 'api'; countryCode: string };
  autoLockMinutes: number;
  audioEnabled: boolean;
  notifications: boolean;
  defaultReminders: number[];
}

export type AnyRecord =
  | Youth | Session | Note | Audio | Transcription | Goal | ActionItem | Appointment
  | TimelineEvent | BibleRec | BibleFav | Message | Template | Consent | Settings;

export interface TableMap {
  youth: Youth; sessions: Session; notes: Note; audios: Audio; transcriptions: Transcription;
  goals: Goal; actions: ActionItem; appointments: Appointment; events: TimelineEvent;
  bible_recs: BibleRec; bible_favs: BibleFav; messages: Message; templates: Template;
  consents: Consent; settings: Settings;
}

export type Role = 'admin' | 'responsable' | 'accompagnateur';
export interface UserProfile { id: string; email: string; displayName: string; role: Role; mode: 'local' | 'supabase' }
