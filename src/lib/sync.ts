import { useSyncExternalStore } from 'react';
import { db, type OutboxOp } from './db';
import { vault } from './store';
import type { BaseRecord, TableName } from './types';
import { supabase, isOnline } from './supabase';

// ------------------------------------------------------------------
// Moteur de synchronisation offline-first
// - file d'opérations persistante (IndexedDB), une opération par enregistrement
// - identifiants UUID générés sur l'appareil → envois idempotents, pas de doublons
// - versions d'enregistrement contrôlées côté serveur (verrou optimiste)
// - fusion automatique champ par champ quand les modifications ne se recouvrent pas,
//   sinon conflit explicite à arbitrer : jamais d'écrasement silencieux
// ------------------------------------------------------------------

export const LOCAL_ONLY: TableName[] = ['settings']; // contient des clés d'API : jamais envoyé

export type PushResult =
  | { status: 'ok'; version: number }
  | { status: 'conflict'; server: BaseRecord }
  | { status: 'forbidden'; message?: string };

export interface RemoteAdapter {
  /** Vrai si une session serveur valide existe pour le compte déverrouillé. */
  ready?(ownerId: string): Promise<boolean>;
  push(table: TableName, record: BaseRecord, baseVersion: number): Promise<PushResult>;
  pull(since: string | null): Promise<{ items: { table: TableName; record: BaseRecord }[]; cursor: string | null }>;
}

export class AuthLostError extends Error {}

export type SyncState = 'hors_ligne' | 'en_ligne' | 'synchronisation' | 'en_attente' | 'synchronise' | 'erreur' | 'local';
interface Status { state: SyncState; lastSync?: string; message?: string }

let status: Status = { state: 'local' };
const listeners = new Set<() => void>();
function setStatus(s: Partial<Status>) { status = { ...status, ...s }; listeners.forEach((l) => l()); }
export function useSyncStatus() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => status, () => status);
}
export const getSyncStatus = () => status;

const MAX_BACKOFF_MS = 5 * 60_000;

/** Fusion à 3 voies superficielle (champ par champ). */
export function threeWayMerge(base: Record<string, unknown> | null, local: Record<string, unknown>, server: Record<string, unknown>) {
  const ignore = new Set(['version', 'updatedAt', 'ownerId', 'createdAt']);
  const keys = new Set([...Object.keys(local), ...Object.keys(server), ...Object.keys(base ?? {})]);
  const merged: Record<string, unknown> = { ...server };
  const conflicts: string[] = [];
  const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const k of keys) {
    if (ignore.has(k)) continue;
    const b = base?.[k], l = local[k], s = server[k];
    if (eq(l, s)) merged[k] = l;
    else if (base && eq(l, b)) merged[k] = s;
    else if (base && eq(s, b)) merged[k] = l;
    else conflicts.push(k);
  }
  return { merged, conflicts };
}

export class SyncEngine {
  private running = false;
  constructor(public adapter: RemoteAdapter | null) {}

  private cursorKey() { return `cursor:${vault.ownerId}`; }

  async pendingOps(): Promise<OutboxOp[]> {
    if (!vault.ownerId) return [];
    return db.outbox.where('ownerId').equals(vault.ownerId).toArray();
  }

  async run(): Promise<{ pushed: number; pulled: number; conflicts: number; failed: number }> {
    const res = { pushed: 0, pulled: 0, conflicts: 0, failed: 0 };
    if (!this.adapter || !vault.unlocked) { setStatus({ state: 'local' }); return res; }
    if (!isOnline()) { setStatus({ state: 'hors_ligne' }); return res; }
    if (this.running) return res;
    this.running = true;
    setStatus({ state: 'synchronisation', message: undefined });
    try {
      if (this.adapter.ready && !(await this.adapter.ready(vault.ownerId!))) {
        // Pas de session serveur : on n'envoie rien (sinon tout serait refusé) et on garde la file intacte.
        setStatus({ state: 'erreur', message: 'Synchronisation en pause : reconnexion au serveur nécessaire.' });
        return res;
      }
      const ops = (await this.pendingOps()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const op of ops) {
        if (op.status === 'conflit') { res.conflicts++; continue; }
        if (LOCAL_ONLY.includes(op.table)) { await db.outbox.delete(op.opId); continue; }
        if (op.status === 'echec' && !this.dueForRetry(op)) { res.failed++; continue; }
        const r = await this.pushOne(op);
        if (r === 'ok') res.pushed++;
        else if (r === 'conflit') res.conflicts++;
        else res.failed++;
      }
      res.pulled = await this.pullAll();
      const remaining = (await this.pendingOps()).length;
      setStatus({
        state: res.failed || res.conflicts ? 'erreur' : remaining ? 'en_attente' : 'synchronise',
        lastSync: new Date().toISOString(),
        message: res.conflicts ? `${res.conflicts} conflit(s) à arbitrer` : res.failed ? `${res.failed} envoi(s) en échec, nouvel essai automatique` : undefined,
      });
    } catch (e) {
      if (e instanceof AuthLostError) { setStatus({ state: 'erreur', message: 'Session serveur expirée : reconnectez-vous.' }); throw e; }
      setStatus({ state: 'erreur', message: (e as Error).message });
    } finally {
      this.running = false;
    }
    return res;
  }

  private dueForRetry(op: OutboxOp) {
    const wait = Math.min(MAX_BACKOFF_MS, 2 ** op.attempts * 1000);
    const last = (op as OutboxOp & { lastTry?: string }).lastTry;
    return !last || Date.now() - new Date(last).getTime() >= wait;
  }

  private async pushOne(op: OutboxOp): Promise<'ok' | 'conflit' | 'echec'> {
    const local = vault.getRaw(op.table, op.recordId);
    if (!local) { await db.outbox.delete(op.opId); return 'ok'; }
    const snapshot = JSON.stringify(local);
    let result: PushResult;
    try {
      result = await this.adapter!.push(op.table, local, op.baseVersion);
    } catch (e) {
      if (e instanceof AuthLostError) throw e;
      await db.outbox.update(op.opId, { status: 'echec', attempts: op.attempts + 1, lastError: (e as Error).message, lastTry: new Date().toISOString() } as Partial<OutboxOp>);
      return 'echec';
    }

    if (result.status === 'ok') {
      const current = vault.getRaw(op.table, op.recordId)!;
      const changedMeanwhile = JSON.stringify(current) !== snapshot;
      await vault.applyRemote(op.table, { ...current, version: result.version });
      if (changedMeanwhile) {
        // Modifié pendant l'envoi : on garde l'opération, avec la nouvelle base.
        await db.outbox.update(op.opId, { baseVersion: result.version, base: await vault.sealValue({ ...local, version: result.version }), status: 'en_attente', attempts: 0 });
      } else {
        await db.outbox.delete(op.opId);
      }
      return 'ok';
    }

    if (result.status === 'forbidden') {
      await db.outbox.update(op.opId, { status: 'echec', attempts: op.attempts + 1, lastError: result.message ?? 'Accès refusé par le serveur' });
      return 'echec';
    }

    // Conflit de version : tentative de fusion automatique
    const base = op.base ? await vault.decryptSealed<Record<string, unknown>>(op.base) : null;
    const { merged, conflicts } = threeWayMerge(base, local as unknown as Record<string, unknown>, result.server as unknown as Record<string, unknown>);
    if (!conflicts.length) {
      const rec = { ...(merged as unknown as BaseRecord), id: local.id, ownerId: local.ownerId, createdAt: local.createdAt, updatedAt: new Date().toISOString(), version: result.server.version };
      await vault.applyRemote(op.table, rec);
      await db.outbox.update(op.opId, { baseVersion: result.server.version, base: await vault.sealValue(result.server), attempts: 0, status: 'en_attente' });
      const again = await this.pushOne((await db.outbox.get(op.opId))!);
      return again;
    }
    await db.conflicts.put({
      key: `${vault.ownerId}:${op.table}:${op.recordId}`,
      ownerId: vault.ownerId!, table: op.table, recordId: op.recordId, detectedAt: new Date().toISOString(),
      data: await vault.sealValue({ local, server: result.server, base, fields: conflicts }),
    });
    await db.outbox.update(op.opId, { status: 'conflit' });
    return 'conflit';
  }

  private async pullAll(): Promise<number> {
    const since = ((await db.meta.get(this.cursorKey()))?.value as string | undefined) ?? null;
    const { items, cursor } = await this.adapter!.pull(since);
    let n = 0;
    const pendingIds = new Set((await this.pendingOps()).map((o) => o.recordId));
    for (const { table, record } of items) {
      if (LOCAL_ONLY.includes(table)) continue;
      if (pendingIds.has(record.id)) continue; // la modification locale en attente sera arbitrée à l'envoi
      const local = vault.getRaw(table, record.id);
      if (!local || record.version > local.version) { await vault.applyRemote(table, record); n++; }
    }
    if (cursor) await db.meta.put({ key: this.cursorKey(), value: cursor });
    return n;
  }
}

export interface ConflictView {
  key: string; table: TableName; recordId: string; detectedAt: string;
  local: Record<string, unknown>; server: Record<string, unknown>; base: Record<string, unknown> | null; fields: string[];
}

export async function listConflicts(): Promise<ConflictView[]> {
  if (!vault.ownerId) return [];
  const rows = await db.conflicts.where('ownerId').equals(vault.ownerId).toArray();
  return Promise.all(rows.map(async (r) => ({ key: r.key, table: r.table, recordId: r.recordId, detectedAt: r.detectedAt, ...(await vault.decryptSealed<Omit<ConflictView, 'key' | 'table' | 'recordId' | 'detectedAt'>>(r.data)) })));
}

/** Arbitrage : `choice` indique, pour chaque champ en conflit, la valeur retenue (ou une valeur fusionnée saisie). */
export async function resolveConflict(c: ConflictView, choice: Record<string, unknown>) {
  const { merged } = threeWayMerge(c.base, c.local, c.server);
  const rec = {
    ...(merged as unknown as BaseRecord), ...choice,
    id: c.recordId, ownerId: (c.local as unknown as BaseRecord).ownerId, createdAt: (c.local as unknown as BaseRecord).createdAt,
    updatedAt: new Date().toISOString(), version: (c.server as unknown as BaseRecord).version,
  } as BaseRecord;
  await vault.applyRemote(c.table, rec);
  const op = await db.outbox.where('[ownerId+recordId]').equals([vault.ownerId!, c.recordId]).first();
  if (op) await db.outbox.update(op.opId, { status: 'en_attente', baseVersion: rec.version, base: await vault.sealValue(c.server), attempts: 0 });
  await db.conflicts.delete(c.key);
  await vault.audit('conflit_resolu', c.table, c.recordId);
}

// ------------------------------------------------------------------
// Adaptateur Supabase : tables relationnelles (colonnes de liaison + jsonb "data")
// ------------------------------------------------------------------
export const SERVER_TABLE: Record<TableName, string> = {
  youth: 'youth_profiles', sessions: 'accompaniment_sessions', notes: 'session_notes', audios: 'audio_recordings',
  transcriptions: 'transcriptions', goals: 'goals', actions: 'action_items', appointments: 'appointments',
  events: 'timeline_events', bible_recs: 'bible_recommendations', bible_favs: 'bible_bookmarks', messages: 'message_queue',
  templates: 'message_templates', consents: 'consent_records', settings: 'settings',
};

export function toRow(table: TableName, r: BaseRecord) {
  const { id, ownerId, version, deleted, createdAt, ...rest } = r as BaseRecord & Record<string, unknown>;
  const row: Record<string, unknown> = { id, owner_id: ownerId, deleted: !!deleted, created_at: createdAt, data: rest };
  if ('youthId' in rest && rest.youthId) row.youth_id = rest.youthId;
  if (table === 'youth') row.youth_id = id;
  if ('sessionId' in rest && rest.sessionId) row.session_id = rest.sessionId;
  return { row, version };
}

export function fromRow(row: Record<string, unknown>): BaseRecord {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return { ...data, id: row.id, ownerId: row.owner_id, version: row.version, deleted: row.deleted, createdAt: row.created_at, updatedAt: (data.updatedAt as string) ?? row.server_updated_at } as BaseRecord;
}

export class SupabaseAdapter implements RemoteAdapter {
  async ready(ownerId: string) {
    const sb = supabase();
    if (!sb) return false;
    const { data } = await sb.auth.getSession();
    return data.session?.user.id === ownerId;
  }

  async push(table: TableName, record: BaseRecord, baseVersion: number): Promise<PushResult> {
    const sb = supabase();
    if (!sb) throw new Error('Serveur non configuré');
    const { row } = toRow(table, record);
    const { data, error } = await sb.rpc('sync_push', { p_table: SERVER_TABLE[table], p_row: row, p_base_version: baseVersion });
    if (error) {
      if (error.code === 'PGRST301' || /JWT/i.test(error.message)) throw new AuthLostError(error.message);
      if (error.code === '42501' || error.code === '23505') return { status: 'forbidden', message: 'Accès refusé (politique de sécurité)' };
      throw new Error(error.message);
    }
    const d = data as { status: string; version?: number; server?: Record<string, unknown> };
    if (d.status === 'ok') return { status: 'ok', version: d.version! };
    if (d.status === 'conflict') return { status: 'conflict', server: fromRow(d.server!) };
    return { status: 'forbidden', message: 'Accès refusé' };
  }

  async pull(since: string | null) {
    const sb = supabase();
    if (!sb) throw new Error('Serveur non configuré');
    const items: { table: TableName; record: BaseRecord }[] = [];
    let cursor = since;
    for (const [local, server] of Object.entries(SERVER_TABLE) as [TableName, string][]) {
      if (LOCAL_ONLY.includes(local)) continue;
      let q = sb.from(server).select('*').order('server_updated_at', { ascending: true }).limit(1000);
      if (since) q = q.gt('server_updated_at', since);
      const { data, error } = await q;
      if (error) {
        if (/JWT/i.test(error.message)) throw new AuthLostError(error.message);
        throw new Error(`${server} : ${error.message}`);
      }
      for (const row of data ?? []) {
        items.push({ table: local, record: fromRow(row) });
        if (!cursor || (row.server_updated_at as string) > cursor) cursor = row.server_updated_at as string;
      }
    }
    return { items, cursor };
  }
}

export const syncEngine = new SyncEngine(null);

export function configureSync() {
  syncEngine.adapter = supabase() ? new SupabaseAdapter() : null;
  setStatus({ state: syncEngine.adapter ? (isOnline() ? 'en_ligne' : 'hors_ligne') : 'local' });
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startAutoSync(intervalMs = 30_000) {
  configureSync();
  const kick = () => { syncEngine.run().catch(() => undefined); };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', kick);
    window.addEventListener('offline', () => setStatus({ state: syncEngine.adapter ? 'hors_ligne' : 'local' }));
  }
  if (timer) clearInterval(timer);
  timer = setInterval(kick, intervalMs);
  kick();
}
