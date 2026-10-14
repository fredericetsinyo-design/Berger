import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { db, type OutboxOp } from './db';
import { open, seal, sealBytes, openBytes, uuid } from './crypto';
import { TABLES, type TableMap, type TableName, type BaseRecord } from './types';

// Coffre local : dossiers déchiffrés en mémoire vive le temps de la session,
// persistés chiffrés dans IndexedDB. Chaque écriture alimente une file d'opérations
// persistante, rejouée par le moteur de synchronisation.

type Listener = () => void;

class Vault {
  key: CryptoKey | null = null;
  ownerId: string | null = null;
  private data = new Map<TableName, Map<string, BaseRecord>>();
  private listeners = new Set<Listener>();
  private versionTick = 0;

  get unlocked() { return !!this.key && !!this.ownerId; }
  get tick() { return this.versionTick; }

  subscribe = (l: Listener) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  private emit() { this.versionTick++; this.listeners.forEach((l) => l()); }

  async unlock(ownerId: string, key: CryptoKey) {
    this.key = key;
    this.ownerId = ownerId;
    this.data = new Map(TABLES.map((t) => [t, new Map()]));
    const rows = await db.records.where('ownerId').equals(ownerId).toArray();
    for (const r of rows) {
      const rec = await open<BaseRecord>(key, r.data);
      this.data.get(r.table)!.set(rec.id, rec);
    }
    this.emit();
  }

  lock() {
    this.key = null;
    this.ownerId = null;
    this.data = new Map();
    this.emit();
  }

  private need() {
    if (!this.key || !this.ownerId) throw new Error('Session verrouillée');
    return { key: this.key, ownerId: this.ownerId };
  }

  all<T extends TableName>(table: T, includeDeleted = false): TableMap[T][] {
    const m = this.data.get(table);
    if (!m) return [];
    const arr = [...m.values()] as TableMap[T][];
    return includeDeleted ? arr : arr.filter((r) => !r.deleted);
  }

  get<T extends TableName>(table: T, id: string | undefined): TableMap[T] | undefined {
    if (!id) return undefined;
    const r = this.data.get(table)?.get(id) as TableMap[T] | undefined;
    return r && !r.deleted ? r : undefined;
  }

  /** Crée ou modifie un enregistrement (fusion superficielle). */
  async put<T extends TableName>(table: T, values: Partial<TableMap[T]> & { id?: string }): Promise<TableMap[T]> {
    const { key, ownerId } = this.need();
    const now = new Date().toISOString();
    const existing = values.id ? (this.data.get(table)!.get(values.id) as TableMap[T] | undefined) : undefined;
    const rec = {
      ...(existing ?? {}),
      ...values,
      id: values.id ?? existing?.id ?? uuid(),
      ownerId: existing?.ownerId ?? ownerId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: existing?.version ?? 0,
    } as TableMap[T];
    await this.persist(table, rec, existing ?? null, 'upsert');
    await this.audit(existing ? 'modification' : 'creation', table, rec.id);
    return rec;
  }

  /** Suppression logique (propagée au serveur, réversible jusqu'à la purge). */
  async remove(table: TableName, id: string) {
    const existing = this.data.get(table)!.get(id);
    if (!existing) return;
    const rec = { ...existing, deleted: true, updatedAt: new Date().toISOString() };
    await this.persist(table, rec, existing, 'delete');
    await this.audit('suppression', table, id);
  }

  private async persist(table: TableName, rec: BaseRecord, previous: BaseRecord | null, kind: 'upsert' | 'delete') {
    const { key, ownerId } = this.need();
    const sealed = await seal(key, rec);
    // Une seule opération en attente par enregistrement : on conserve la base d'origine.
    const pending = await db.outbox.where('[ownerId+recordId]').equals([ownerId, rec.id]).first();
    const baseSealed = !pending && previous ? await seal(key, previous) : null;
    await db.transaction('rw', db.records, db.outbox, async () => {
      await db.records.put({ key: `${ownerId}:${rec.id}`, id: rec.id, table, ownerId, updatedAt: rec.updatedAt, data: sealed });
      if (pending) {
        await db.outbox.update(pending.opId, { kind, status: pending.status === 'conflit' ? 'conflit' : 'en_attente' });
      } else {
        const op: OutboxOp = {
          opId: uuid(), ownerId, table, recordId: rec.id, kind,
          baseVersion: previous?.version ?? 0,
          base: baseSealed,
          createdAt: new Date().toISOString(), attempts: 0, status: 'en_attente',
        };
        await db.outbox.put(op);
      }
    });
    this.data.get(table)!.set(rec.id, rec);
    this.emit();
  }

  /** Écrit un enregistrement provenant du serveur, sans créer d'opération sortante. */
  async applyRemote(table: TableName, rec: BaseRecord) {
    const { key, ownerId } = this.need();
    const sealed = await seal(key, rec);
    await db.records.put({ key: `${ownerId}:${rec.id}`, id: rec.id, table, ownerId, updatedAt: rec.updatedAt, data: sealed });
    this.data.get(table)!.set(rec.id, rec);
    this.emit();
  }

  getRaw(table: TableName, id: string) { return this.data.get(table)?.get(id); }

  async audit(action: string, table?: string, recordId?: string) {
    if (!this.ownerId) return;
    await db.audit.add({ ownerId: this.ownerId, at: new Date().toISOString(), action, table, recordId });
  }

  // ---- Fichiers binaires (audio, pièces jointes) chiffrés ----
  async putBlob(blob: Blob): Promise<string> {
    const { key, ownerId } = this.need();
    const id = uuid();
    const { iv, ct } = await sealBytes(key, new Uint8Array(await blob.arrayBuffer()));
    await db.blobs.put({ key: id, ownerId, iv, ct, mime: blob.type });
    return id;
  }

  async getBlob(id: string): Promise<Blob | null> {
    const { key, ownerId } = this.need();
    const row = await db.blobs.get(id);
    if (!row || row.ownerId !== ownerId) return null;
    const buf = await openBytes(key, row.iv, row.ct);
    return new Blob([buf], { type: row.mime });
  }

  async deleteBlob(id: string) { await db.blobs.delete(id); }

  async decryptSealed<T>(s: Parameters<typeof open>[1]) { return open<T>(this.need().key, s); }
  async sealValue(v: unknown) { return seal(this.need().key, v); }
}

export const vault = new Vault();

// ---------- Hooks React ----------
export function useVaultTick() {
  return useSyncExternalStore(vault.subscribe, () => vault.tick, () => 0);
}

export function useCollection<T extends TableName>(table: T, filter?: (r: TableMap[T]) => boolean, deps: unknown[] = []) {
  const tick = useVaultTick();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (filter ? vault.all(table).filter(filter) : vault.all(table)), [tick, table, ...deps]);
}

export function useRecord<T extends TableName>(table: T, id: string | undefined) {
  const tick = useVaultTick();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => vault.get(table, id), [tick, table, id]);
}

export function usePendingOps() {
  const [count, setCount] = useState({ pending: 0, failed: 0, conflicts: 0 });
  const tick = useVaultTick();
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!vault.ownerId) return;
      const ops = await db.outbox.where('ownerId').equals(vault.ownerId).toArray();
      const conflicts = await db.conflicts.where('ownerId').equals(vault.ownerId).count();
      if (alive) setCount({
        pending: ops.filter((o) => o.status === 'en_attente').length,
        failed: ops.filter((o) => o.status === 'echec').length,
        conflicts,
      });
    };
    run();
    const t = setInterval(run, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [tick]);
  return count;
}
