import { vault } from './store';
import type { TableName } from './types';
import { dayKey } from './dates';

// Opérations groupées sur les dossiers : export et suppression en cascade.

const LINKED: TableName[] = ['sessions', 'notes', 'goals', 'actions', 'appointments', 'events', 'bible_recs', 'messages', 'consents', 'audios'];

/** Rassemble tout ce qui appartient aux dossiers indiqués. */
export function collectDossiers(ids: string[]) {
  const set = new Set(ids);
  const of = (t: TableName) => vault.all(t).filter((r) => set.has((r as { youthId?: string }).youthId ?? ''));
  const audios = of('audios');
  const audioIds = new Set(audios.map((a) => a.id));
  return {
    jeunes: vault.all('youth').filter((y) => set.has(y.id)),
    rencontres: of('sessions'), notes: of('notes'), objectifs: of('goals'), actions: of('actions'),
    rendezVous: of('appointments'), evenements: of('events'), versets: of('bible_recs'), messages: of('messages'),
    consentements: of('consents'), audios,
    transcriptions: vault.all('transcriptions').filter((t) => audioIds.has(t.audioId)),
  };
}

/** Télécharge un export JSON des dossiers (à faire avant une suppression). */
export function exportDossiers(ids: string[], label = 'dossiers') {
  const data = { exportéLe: new Date().toISOString(), ...collectDossiers(ids) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `berger-${label}-${dayKey(new Date())}.json`;
  a.click();
  vault.audit(`export:${ids.length}`, 'youth');
}

/** Supprime les dossiers et tout ce qui s'y rattache (rencontres, notes, audios chiffrés…). */
export async function deleteDossiers(ids: string[], onProgress?: (done: number, total: number) => void) {
  const set = new Set(ids);
  const audioIds = new Set<string>();
  for (const t of LINKED) {
    for (const r of vault.all(t).filter((x) => set.has((x as { youthId?: string }).youthId ?? ''))) {
      if (t === 'audios') {
        audioIds.add(r.id);
        await vault.deleteBlob((r as { blobId: string }).blobId);
      }
      await vault.remove(t, r.id);
    }
  }
  for (const tr of vault.all('transcriptions').filter((x) => audioIds.has(x.audioId))) await vault.remove('transcriptions', tr.id);
  let done = 0;
  for (const id of ids) {
    await vault.remove('youth', id);
    onProgress?.(++done, ids.length);
  }
  await vault.audit(`suppression_groupee:${ids.length}`, 'youth');
}
