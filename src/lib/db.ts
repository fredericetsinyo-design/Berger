import Dexie, { type Table } from 'dexie';
import type { Sealed } from './crypto';
import type { TableName } from './types';

// Compte connu sur cet appareil (local ou Supabase). Aucune donnée de dossier ici.
export interface DeviceAccount {
  id: string; // id utilisateur (local ou auth.users.id)
  email: string;
  displayName: string;
  role: 'admin' | 'responsable' | 'accompagnateur';
  mode: 'local' | 'supabase';
  salt: string; // sel PBKDF2 (mot de passe)
  iterations: number;
  wrappedKey: Sealed; // clé de données chiffrée par la clé dérivée du mot de passe
  recoverySalt: string;
  wrappedKeyRecovery: Sealed; // même clé, chiffrée par la clé de secours
  createdAt: string;
  lastLoginAt?: string;
  locked?: boolean; // autorisation perdue : dossiers verrouillés, conservés chiffrés
}

// Enregistrement chiffré. Seuls les champs nécessaires au rangement restent en clair
// (identifiant, table, propriétaire, horodatage) — aucune donnée personnelle.
export interface StoredRecord {
  key: string; // `${ownerId}:${id}`
  id: string;
  table: TableName;
  ownerId: string;
  updatedAt: string;
  data: Sealed;
}

export interface StoredBlob { key: string; ownerId: string; iv: string; ct: ArrayBuffer; mime: string }

export type OpKind = 'upsert' | 'delete';
export interface OutboxOp {
  opId: string;
  ownerId: string;
  table: TableName;
  recordId: string;
  kind: OpKind;
  baseVersion: number; // version serveur connue au moment de la modification
  base: Sealed | null; // copie chiffrée de l'état de base (pour la fusion à 3 voies)
  createdAt: string;
  attempts: number;
  status: 'en_attente' | 'echec' | 'conflit';
  lastError?: string;
}

export interface ConflictRow {
  key: string; // `${ownerId}:${table}:${recordId}`
  ownerId: string;
  table: TableName;
  recordId: string;
  detectedAt: string;
  data: Sealed; // { local, server, base, fields }
}

export interface MetaRow { key: string; value: unknown }

export interface BibleVerseRow { k: string; b: number; c: number; v: number; t: string }

class BergerDB extends Dexie {
  accounts!: Table<DeviceAccount, string>;
  records!: Table<StoredRecord, string>;
  blobs!: Table<StoredBlob, string>;
  outbox!: Table<OutboxOp, string>;
  conflicts!: Table<ConflictRow, string>;
  meta!: Table<MetaRow, string>;
  audit!: Table<{ id?: number; ownerId: string; at: string; action: string; table?: string; recordId?: string }, number>;
  bible!: Table<BibleVerseRow, string>;

  constructor(name = 'berger') {
    super(name);
    this.version(1).stores({
      accounts: 'id, email',
      records: 'key, ownerId, [ownerId+table], updatedAt',
      blobs: 'key, ownerId',
      outbox: 'opId, ownerId, [ownerId+recordId], status, createdAt',
      conflicts: 'key, ownerId',
      meta: 'key',
      audit: '++id, ownerId, at',
      bible: 'k, [b+c]',
    });
  }
}

export let db = new BergerDB();

// Utilisé par les tests pour isoler les bases.
export function resetDb(name = 'berger') {
  db.close();
  db = new BergerDB(name);
  return db;
}
