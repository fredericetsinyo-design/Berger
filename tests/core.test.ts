// Scénarios obligatoires (section 18) testés au niveau des modules métier.
// Les numéros renvoient à la liste du cahier des charges.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { db, resetDb } from '../src/lib/db';
import { vault } from '../src/lib/store';
import { registerLocal, login, logout, changePassword, AuthError } from '../src/lib/auth';
import { loadBible, resolve, search, parseRef } from '../src/lib/bible';
import { THEMES } from '../src/lib/bibleThemes';
import { generateSummary, setProviderOverride, suggestPassagesLocal, suggestPassagesAI, pseudonymize, AIError } from '../src/lib/ai';
import { findConflicts, computeDashboard } from '../src/lib/alerts';
import { checkReminders, getInAppReminders } from '../src/lib/reminders';
import { openWhatsApp, scheduleApiMessage, cancelMessage, waLink, fillTemplate } from '../src/lib/whatsapp';
import { transcribeAudio, setEngineOverride } from '../src/lib/transcription';
import { SyncEngine, threeWayMerge, listConflicts, resolveConflict, type RemoteAdapter, type PushResult } from '../src/lib/sync';
import type { BaseRecord, TableName, Youth } from '../src/lib/types';

const bibleJson = JSON.parse(fs.readFileSync('public/bible/lsg.json', 'utf8'));
let n = 0;
async function freshDevice() { await logout(); resetDb(`t${++n}`); }

async function makeYouth(extra: Partial<Youth> = {}) {
  return vault.put('youth', { firstName: 'Kossi', lastName: 'Amegah', phone: '90 12 34 56', status: 'actif', startDate: new Date().toISOString(), initial: { items: [] }, allowWhatsApp: true, ...extra });
}
async function grant(youthId: string, type: 'traitement_ia' | 'messages_whatsapp') {
  await vault.put('consents', { youthId, type, granted: true, by: 'Le jeune (oral)', date: new Date().toISOString() });
}

beforeAll(async () => {
  resetDb('bible-test');
  await loadBible(async () => bibleJson);
}, 120000);

describe('1. Compte et connexion', () => {
  beforeEach(freshDevice);
  it('crée un compte local, se reconnecte, refuse un mauvais mot de passe', async () => {
    await registerLocal('fred@exemple.tg', 'motdepasse-solide', 'Frédéric');
    expect(vault.unlocked).toBe(true);
    await logout();
    expect(vault.unlocked).toBe(false);
    await expect(login('fred@exemple.tg', 'mauvais-mot')).rejects.toBeInstanceOf(AuthError);
    const r = await login('fred@exemple.tg', 'motdepasse-solide');
    expect(r.user.displayName).toBe('Frédéric');
  });
  it('change le mot de passe sans perte de données', async () => {
    await registerLocal('a@b.tg', 'ancien-mot-de-passe', 'A');
    await makeYouth();
    await changePassword('ancien-mot-de-passe', 'nouveau-mot-de-passe');
    await logout();
    await expect(login('a@b.tg', 'ancien-mot-de-passe')).rejects.toBeInstanceOf(AuthError);
    await login('a@b.tg', 'nouveau-mot-de-passe');
    expect(vault.all('youth')).toHaveLength(1);
  });
});

describe('2-3. Fiche, rencontre, notes — données chiffrées au repos', () => {
  beforeEach(freshDevice);
  it('crée une fiche et une rencontre ; aucune donnée lisible dans IndexedDB', async () => {
    await registerLocal('c@d.tg', 'motdepasse-solide', 'C');
    const y = await makeYouth();
    const s = await vault.put('sessions', { youthId: y.id, date: new Date().toISOString(), type: 'presentiel', theme: 'Orientation', topics: ['études'], notes: 'Hésite entre deux filières', verses: [], attachments: [], reportStatus: 'brouillon' });
    await vault.put('notes', { youthId: y.id, sessionId: s.id, title: 'Note', content: 'Appeler la semaine prochaine', tags: ['suivi'] });
    const raw = JSON.stringify(await db.records.toArray());
    expect(raw).not.toContain('Kossi');
    expect(raw).not.toContain('filières');
    await logout();
    await login('c@d.tg', 'motdepasse-solide');
    expect(vault.all('sessions')[0].notes).toBe('Hésite entre deux filières');
    expect(vault.all('notes')[0].tags).toEqual(['suivi']);
  });
});

describe('4. Résumé IA', () => {
  beforeEach(freshDevice);
  it('exige le consentement, pseudonymise, écarte les références inventées et reste un brouillon', async () => {
    await registerLocal('e@f.tg', 'motdepasse-solide', 'E');
    const y = await makeYouth();
    const s = await vault.put('sessions', { youthId: y.id, date: new Date().toISOString(), type: 'presentiel', theme: 'Décision', topics: ['orientation'], notes: 'Kossi doit faire un choix d’études. Appeler le 90 12 34 56.', verses: [], attachments: [], reportStatus: 'brouillon' });
    let seen = '';
    setProviderOverride({ name: 'test', complete: async (_sys, user) => { seen = user; return JSON.stringify({ context: 'Rencontre', themes: ['orientation'], verses: [{ ref: 'Jacques 1:5', why: 'sagesse' }, { ref: 'Hezekiah 4:2', why: 'inventé' }, { ref: 'Jean 99:1', why: 'inexistant' }] }); } });
    await expect(generateSummary({ session: s, youth: y, transcripts: [] })).rejects.toBeInstanceOf(AIError);
    await grant(y.id, 'traitement_ia');
    const r = await generateSummary({ session: s, youth: y, transcripts: [] });
    expect(seen).not.toContain('Kossi');
    expect(seen).not.toContain('90 12 34 56');
    expect(r.draft.verses.map((v) => v.ref)).toEqual(['Jacques 1:5']);
    expect(r.rejectedRefs).toEqual(['Hezekiah 4:2', 'Jean 99:1']);
    // validation humaine : rien n'est validé automatiquement
    expect(vault.get('sessions', s.id)!.reportStatus).toBe('brouillon');
    setProviderOverride(undefined);
  });
  it('pseudonymise noms, téléphones et e-mails', () => {
    const y = { firstName: 'Afi', lastName: 'Mensah' } as Youth;
    expect(pseudonymize('Afi Mensah afi@x.tg +228 90 00 00 00', y)).toBe('[JEUNE] [JEUNE] [E-MAIL] [TÉLÉPHONE]');
  });
});

describe('5. Actions après une rencontre', () => {
  beforeEach(freshDevice);
  it('crée des actions liées et les classe en retard', async () => {
    await registerLocal('g@h.tg', 'motdepasse-solide', 'G');
    const y = await makeYouth();
    await vault.put('actions', { youthId: y.id, title: 'Contacter le jeune', owner: 'accompagnateur', priority: 'haute', status: 'a_faire', dueDate: new Date(Date.now() - 3 * 86400000).toISOString() });
    await vault.put('actions', { youthId: y.id, title: 'Lire Jacques 1', owner: 'jeune', priority: 'normale', status: 'a_faire' });
    const d = computeDashboard();
    expect(d.stats.actionsEnAttente).toBe(2);
    expect(d.day.enRetard).toHaveLength(1);
    expect(d.alerts.some((a) => a.kind === 'action' && a.text.includes('À vérifier'))).toBe(true);
  });
});

describe('6. Références bibliques vérifiables', () => {
  it('résout les références et refuse les inexistantes', () => {
    expect(resolve('Jean 3:16')!.text).toMatch(/^Car Dieu a tant aimé le monde/);
    expect(resolve('Jn 3.16-17')!.verses).toHaveLength(2);
    expect(resolve('1 Co 13:4')!.ref).toBe('1 Corinthiens 13:4');
    expect(resolve('Ps 23')!.verses.length).toBe(6);
    expect(resolve('Jean 22:1')).toBeNull();
    expect(resolve('Jean 3:99')).toBeNull();
    expect(parseRef('Livre inconnu 3:4')).toBeNull();
    expect(search('berger ne manquerai').hits[0].ref).toBe('Psaumes 23:1');
  });
  it('toutes les références de l’index thématique existent dans la base', () => {
    const missing = THEMES.flatMap((t) => t.refs).filter((r) => !resolve(r));
    expect(missing).toEqual([]);
  });
  it('suggestions sans IA vérifiées ; IA limitée aux candidats', async () => {
    const local = await suggestPassagesLocal(['sagesse'], 'sagesse');
    expect(local.items.every((i) => resolve(i.ref)?.text === i.text)).toBe(true);
    setProviderOverride({ name: 'test', complete: async () => JSON.stringify({ items: [{ ref: 'Jacques 1:5', why: 'x' }, { ref: 'Jean 3:16', why: 'hors candidats' }] }) });
    const ai = await suggestPassagesAI(undefined, 'choix d’études', ['sagesse']);
    expect(ai.items.map((i) => i.ref)).toEqual(['Jacques 1:5']);
    expect(ai.items[0].text).toBe(resolve('Jacques 1:5')!.text);
    setProviderOverride({ name: 'test', complete: async () => JSON.stringify({ items: [] }) });
    expect((await suggestPassagesAI(undefined, 'x', ['sagesse'])).notFound).toBe(true);
    setProviderOverride(undefined);
  });
});

describe('7. Rendez-vous, conflits horaires et rappels', () => {
  beforeEach(freshDevice);
  it('détecte un chevauchement et déclenche un rappel discret', async () => {
    await registerLocal('i@j.tg', 'motdepasse-solide', 'I');
    const y = await makeYouth();
    const start = new Date(Date.now() + 30 * 60000);
    const a = await vault.put('appointments', { youthId: y.id, start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(), mode: 'presentiel', reminders: [60], status: 'planifie' });
    const conflicts = findConflicts({ id: 'nouveau', start: new Date(start.getTime() + 1800000).toISOString(), end: new Date(start.getTime() + 5400000).toISOString() }, vault.all('appointments'));
    expect(conflicts.map((c) => c.id)).toEqual([a.id]);
    await checkReminders();
    const r = getInAppReminders().find((x) => x.id.startsWith(a.id));
    expect(r?.text).toMatch(/^Rendez-vous à \d\d:\d\d$/);
    expect(r?.text).not.toContain('Kossi'); // rien de sensible sur l'écran verrouillé
  });
});

describe('8 & 17. Relances WhatsApp', () => {
  beforeEach(freshDevice);
  it('prépare un lien sans prétendre que le message est envoyé', async () => {
    await registerLocal('k@l.tg', 'motdepasse-solide', 'K');
    const y = await makeYouth();
    expect(waLink('90 12 34 56', 'Bonjour')).toBe('https://wa.me/22890123456?text=Bonjour');
    expect(fillTemplate('Bonjour {prenom}', { youth: y })).toBe('Bonjour Kossi');
    const m = await openWhatsApp(y, 'Bonjour Kossi');
    expect(m.status).toBe('lien_ouvert');
    expect(m.log.some((l) => l.status === 'envoye')).toBe(false);
  });
  it('programme sans doublon, exige le consentement, puis annule', async () => {
    await registerLocal('m@n.tg', 'motdepasse-solide', 'M');
    const y = await makeYouth();
    const when = new Date(Date.now() + 86400000).toISOString();
    await expect(scheduleApiMessage(y, 'Rappel', when)).rejects.toThrow(/Consentement/);
    await grant(y.id, 'messages_whatsapp');
    const m1 = await scheduleApiMessage(y, 'Rappel', when);
    const m2 = await scheduleApiMessage(y, 'Rappel', when);
    expect(m2.id).toBe(m1.id);
    const c = await cancelMessage(m1);
    expect(c.status).toBe('annule');
    await expect(cancelMessage({ ...c })).rejects.toThrow();
  });
});

describe('9 & 16. Audio et transcription', () => {
  beforeEach(freshDevice);
  it('chiffre l’audio, transcrit, conserve le brut ; gère l’échec et la mise en attente', async () => {
    await registerLocal('o@p.tg', 'motdepasse-solide', 'O');
    const y = await makeYouth();
    await grant(y.id, 'traitement_ia');
    const blobId = await vault.putBlob(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }));
    expect((await vault.getBlob(blobId))!.size).toBe(4);
    const audio = await vault.put('audios', { youthId: y.id, durationSec: 4, mime: 'audio/webm', blobId, status: 'enregistre', consent: 'oral' });

    setEngineOverride(null);
    expect((await transcribeAudio(audio)).status).toBe('en_attente');

    setEngineOverride({ name: 'test', transcribe: async () => { throw new Error('Service indisponible'); } });
    const failed = await transcribeAudio(audio);
    expect(failed.status).toBe('echec');
    expect(failed.error).toContain('indisponible');
    expect(await vault.getBlob(blobId)).not.toBeNull(); // l'audio n'est pas perdu

    setEngineOverride({ name: 'test', transcribe: async () => ({ text: 'bonjour je voulais parler', language: 'fr', uncertain: ['parler'] }) });
    expect((await transcribeAudio(failed)).status).toBe('transcrit');
    const t = vault.all('transcriptions')[0];
    expect(t.raw).toBe('bonjour je voulais parler');
    await vault.put('transcriptions', { id: t.id, corrected: 'Bonjour, je voulais parler.' });
    expect(vault.get('transcriptions', t.id)!.raw).toBe('bonjour je voulais parler');
    setEngineOverride(undefined);
  });
});

// ---------------- Synchronisation ----------------
class MemoryServer implements RemoteAdapter {
  rows = new Map<string, { table: TableName; rec: BaseRecord; seq: number }>();
  seq = 0;
  online = true;
  pushes = 0;
  async push(table: TableName, record: BaseRecord, baseVersion: number): Promise<PushResult> {
    if (!this.online) throw new Error('Réseau indisponible');
    this.pushes++;
    const cur = this.rows.get(record.id);
    if (cur && cur.rec.version !== baseVersion) return { status: 'conflict', server: structuredClone(cur.rec) };
    const version = (cur?.rec.version ?? 0) + 1;
    this.rows.set(record.id, { table, rec: { ...structuredClone(record), version }, seq: ++this.seq });
    return { status: 'ok', version };
  }
  async pull(since: string | null) {
    const s = since ? +since : 0;
    const items = [...this.rows.values()].filter((r) => r.seq > s).map((r) => ({ table: r.table, record: structuredClone(r.rec) }));
    return { items, cursor: String(this.seq) };
  }
}

describe('10-13. Hors ligne, réouverture, synchronisation, conflits', () => {
  const server = new MemoryServer();
  const engine = new SyncEngine(server);
  const owner = 'user-1';
  const keys: Record<string, CryptoKey> = {};
  async function device(name: string) {
    vault.lock();
    resetDb(name);
    keys[name] ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    await vault.unlock(owner, keys[name]);
  }

  it('crée des données hors ligne, les retrouve après réouverture, synchronise sans doublon', async () => {
    await device('telephone');
    server.online = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => server.online });
    const y = await makeYouth();
    await vault.put('youth', { id: y.id, zone: 'Bè' });
    await vault.put('sessions', { youthId: y.id, date: new Date().toISOString(), type: 'telephone', theme: 'Nouvelles', topics: [], notes: 'Hors ligne', verses: [], attachments: [], reportStatus: 'brouillon' });
    expect((await engine.run()).pushed).toBe(0); // hors ligne : rien n'est envoyé
    expect(await db.outbox.count()).toBe(2); // une opération par enregistrement

    // fermeture puis réouverture hors ligne
    vault.lock();
    await vault.unlock(owner, keys.telephone);
    expect(vault.all('youth')[0].zone).toBe('Bè');

    server.online = true;
    const r1 = await engine.run();
    expect(r1.pushed).toBe(2);
    expect(await db.outbox.count()).toBe(0);
    const r2 = await engine.run(); // relancer ne crée pas de doublon
    expect(r2.pushed).toBe(0);
    expect(server.rows.size).toBe(2);
    expect(vault.all('youth')[0].version).toBe(1);
  });

  it('fusionne automatiquement des modifications de champs différents', async () => {
    await device('ordinateur');
    await engine.run();
    const y = vault.all('youth')[0];
    await vault.put('youth', { id: y.id, availability: 'Samedi matin' });
    await device('telephone');
    await vault.put('youth', { id: y.id, phone: '91 00 00 00' });
    await engine.run();
    await device('ordinateur');
    const r = await engine.run();
    expect(r.conflicts).toBe(0);
    const merged = vault.all('youth')[0];
    expect(merged.availability).toBe('Samedi matin');
    expect(merged.phone).toBe('91 00 00 00');
  });

  it('ne perd jamais un compte rendu modifié sur deux appareils : conflit explicite', async () => {
    await device('telephone');
    await engine.run();
    const s = vault.all('sessions')[0];
    await vault.put('sessions', { id: s.id, notes: 'Version téléphone' });
    await engine.run();
    await device('ordinateur');
    // l'ordinateur modifie la même note sans avoir reçu la version du téléphone
    const before = vault.all('sessions')[0];
    expect(before.notes).toBe('Hors ligne');
    await vault.put('sessions', { id: s.id, notes: 'Version ordinateur' });
    const r = await engine.run();
    expect(r.conflicts).toBe(1);
    expect(vault.get('sessions', s.id)!.notes).toBe('Version ordinateur'); // rien d'écrasé localement
    const [c] = await listConflicts();
    expect(c.fields).toEqual(['notes']);
    expect(c.server.notes).toBe('Version téléphone');
    await resolveConflict(c, { notes: 'Version téléphone\n\nVersion ordinateur' });
    const r2 = await engine.run();
    expect(r2.pushed).toBe(1);
    expect(server.rows.get(s.id)!.rec).toMatchObject({ notes: 'Version téléphone\n\nVersion ordinateur' });
  });

  it('fusion à trois voies : cas limites', () => {
    expect(threeWayMerge({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }).merged).toMatchObject({ a: 2, b: 3 });
    expect(threeWayMerge({ a: 1 }, { a: 2 }, { a: 3 }).conflicts).toEqual(['a']);
    expect(threeWayMerge(null, { a: 2 }, { a: 2 }).conflicts).toEqual([]);
  });
});

describe('14-15. Accès non autorisé et changement d’utilisateur', () => {
  beforeEach(freshDevice);
  it('un second compte sur le même appareil ne voit ni ne peut déchiffrer les dossiers du premier', async () => {
    await registerLocal('premier@x.tg', 'motdepasse-solide', 'Premier');
    const y = await makeYouth();
    const blobId = await vault.putBlob(new Blob(['audio secret']));
    const firstId = vault.ownerId!;
    await logout();
    await registerLocal('second@x.tg', 'autre-mot-de-passe', 'Second');
    expect(vault.all('youth')).toHaveLength(0);
    expect(vault.get('youth', y.id)).toBeUndefined();
    expect(await vault.getBlob(blobId)).toBeNull();
    const row = await db.records.get(`${firstId}:${y.id}`);
    await expect(vault.decryptSealed(row!.data)).rejects.toBeTruthy();
    await logout();
    expect(vault.unlocked).toBe(false);
    await login('premier@x.tg', 'motdepasse-solide');
    expect(vault.all('youth')).toHaveLength(1);
  });
});

describe('Adaptateur Supabase : correspondance colonnes ↔ enregistrements', () => {
  it('toRow / fromRow conserve les données et place les clés relationnelles', async () => {
    const { toRow, fromRow } = await import('../src/lib/sync');
    const rec = { id: 's1', ownerId: 'u1', version: 3, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', youthId: 'y1', sessionId: undefined, theme: 'Test', notes: 'n' } as unknown as BaseRecord;
    const { row } = toRow('sessions', rec);
    expect(row).toMatchObject({ id: 's1', owner_id: 'u1', youth_id: 'y1', deleted: false });
    expect((row.data as Record<string, unknown>).notes).toBe('n');
    const back = fromRow({ ...row, version: 3, server_updated_at: 'x' });
    expect(back).toMatchObject({ id: 's1', ownerId: 'u1', version: 3, theme: 'Test', notes: 'n', updatedAt: '2026-10-02T00:00:00Z' });
  });
});

describe('Suppression groupée de dossiers', () => {
  beforeEach(freshDevice);
  it('supprime la sélection et tout ce qui s’y rattache, sans toucher aux autres', async () => {
    const { deleteDossiers, collectDossiers } = await import('../src/lib/youthOps');
    await registerLocal('del@x.tg', 'motdepasse-solide', 'D');
    const a = await makeYouth({ firstName: 'A' });
    const b = await makeYouth({ firstName: 'B' });
    const c = await makeYouth({ firstName: 'C' });
    for (const y of [a, b, c]) {
      await vault.put('sessions', { youthId: y.id, date: new Date().toISOString(), type: 'presentiel', theme: 't', topics: [], notes: 'n', verses: [], attachments: [], reportStatus: 'brouillon' });
      await vault.put('actions', { youthId: y.id, title: 'x', owner: 'jeune', priority: 'normale', status: 'a_faire' });
    }
    const blobId = await vault.putBlob(new Blob(['son']));
    const au = await vault.put('audios', { youthId: a.id, durationSec: 1, mime: 'audio/webm', blobId, status: 'transcrit', consent: 'oral' });
    await vault.put('transcriptions', { audioId: au.id, raw: 'texte', provider: 'test' });
    expect(collectDossiers([a.id]).transcriptions).toHaveLength(1);

    await deleteDossiers([a.id, b.id]);
    expect(vault.all('youth').map((y) => y.firstName)).toEqual(['C']);
    expect(vault.all('sessions').every((s) => s.youthId === c.id)).toBe(true);
    expect(vault.all('actions')).toHaveLength(1);
    expect(vault.all('audios')).toHaveLength(0);
    expect(vault.all('transcriptions')).toHaveLength(0);
    expect(await vault.getBlob(blobId)).toBeNull();
    // suppression logique propagée à la synchronisation
    expect((await db.outbox.toArray()).some((o) => o.recordId === a.id && o.kind === 'delete')).toBe(true);
  });
});
