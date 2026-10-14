import { vault } from './store';
import type { TableName } from './types';

// Données d'exemple pour découvrir l'application. Personnes fictives, photos de démonstration.
// Toutes les fiches portent isSample=true et se suppriment en un clic.

const SAMPLES = [
  { firstName: 'Afi', lastName: 'Mensah', photo: 'y-afi', zone: 'Bè', status: 'actif', theme: 'Confiance en soi', goal: 'Prendre la parole au groupe de jeunes' },
  { firstName: 'Kossi', lastName: 'Amegah', photo: 'y-kossi', zone: 'Tokoin', status: 'actif', theme: 'Orientation scolaire', goal: 'Choisir sa filière avant juin' },
  { firstName: 'Ayélé', lastName: 'Koffi', photo: 'y-ayele', zone: 'Agoè', status: 'nouveau', theme: 'Première rencontre', goal: 'Lire un évangile en un mois' },
  { firstName: 'Elom', lastName: 'Kpodar', photo: 'y-elom', zone: 'Adidogomé', status: 'actif', theme: 'Recherche de stage', goal: 'Envoyer 5 candidatures' },
  { firstName: 'Dzifa', lastName: 'Agbeko', photo: 'y-dzifa', zone: 'Kégué', status: 'actif', theme: 'Relations familiales', goal: 'Renouer le dialogue avec sa mère' },
  { firstName: 'Yao', lastName: 'Lawson', photo: 'y-yao', zone: 'Nyékonakpoè', status: 'pause', theme: 'Gestion du temps', goal: 'Tenir un planning de révision' },
  { firstName: 'Akossiwa', lastName: 'Ayivi', photo: 'y-akossiwa', zone: 'Hédzranawoé', status: 'nouveau', theme: 'Vie de prière', goal: 'Prier 10 minutes chaque matin' },
  { firstName: 'Esi', lastName: 'Amedzro', photo: 'y-esi', zone: 'Baguida', status: 'actif', theme: 'Persévérance', goal: 'Terminer sa formation en couture' },
] as const;

async function toDataUrl(path: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL ?? '/'}img/${path}.webp`);
    if (!r.ok) return undefined;
    const b = await r.blob();
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(b); });
  } catch { return undefined; }
}

const day = (n: number, h = 10) => { const d = new Date(Date.now() + n * 86_400_000); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };

export function hasSamples() { return vault.all('youth').some((y) => y.isSample); }

export async function loadSamples() {
  for (const [i, s] of SAMPLES.entries()) {
    const photo = await toDataUrl(s.photo);
    const y = await vault.put('youth', {
      firstName: s.firstName, lastName: s.lastName, photo, zone: s.zone, status: s.status, isSample: true,
      startDate: day(-30 - i * 9), phone: `90 00 0${i} ${10 + i}`, contactMode: 'whatsapp', allowWhatsApp: true, language: 'Français',
      initial: { context: 'Rencontré au culte des jeunes (exemple).', expectations: s.theme, items: [{ kind: 'fait', text: `Souhaite avancer sur : ${s.theme.toLowerCase()}` }] },
    });
    const sess = await vault.put('sessions', {
      youthId: y.id, date: day(-3 - i, 15), type: i % 2 ? 'telephone' : 'presentiel', theme: s.theme, topics: [s.theme],
      notes: `Échange d'exemple autour de « ${s.theme.toLowerCase()} ».`, verses: [], attachments: [], reportStatus: i % 3 === 0 ? 'valide' : 'brouillon',
      summary: i % 3 === 0 ? { text: `## Contexte\nRencontre d'exemple.\n## Thèmes abordés\n- ${s.theme}`, validatedAt: day(-2) } : undefined,
    });
    await vault.put('goals', { youthId: y.id, title: s.goal, status: i === 4 ? 'atteint' : 'en_cours', observations: i % 2 ? [{ date: day(-2), text: 'Premiers progrès constatés (exemple).' }] : [], lastEvaluated: i % 2 ? day(-2) : undefined });
    await vault.put('actions', { youthId: y.id, sessionId: sess.id, title: i % 2 ? 'Prendre des nouvelles' : 'Préparer la prochaine rencontre', owner: 'accompagnateur', priority: i < 2 ? 'haute' : 'normale', status: 'a_faire', dueDate: day(i - 2) });
    if (i < 5) await vault.put('appointments', { youthId: y.id, start: day(i, 9 + i * 2), end: day(i, 10 + i * 2), mode: 'presentiel', place: 'Salle des jeunes', subject: s.theme, reminders: [60], status: i % 2 ? 'confirme' : 'planifie' });
  }
}

export async function removeSamples() {
  const ids = new Set(vault.all('youth').filter((y) => y.isSample).map((y) => y.id));
  const tables: TableName[] = ['sessions', 'notes', 'goals', 'actions', 'appointments', 'events', 'bible_recs', 'messages', 'consents'];
  for (const t of tables) for (const r of vault.all(t)) if (ids.has((r as { youthId?: string }).youthId ?? '')) await vault.remove(t, r.id);
  for (const id of ids) await vault.remove('youth', id);
}
