import { getSettings } from './defaults';
import { supabase, isOnline } from './supabase';
import { vault } from './store';
import { resolve, searchText, loadBible } from './bible';
import { THEMES } from './bibleThemes';
import type { Session, SummaryDraft, Youth, Goal, ActionItem } from './types';

// ------------------------------------------------------------------
// Assistance IA — fournisseur interchangeable
// Principes appliqués dans le code (pas seulement dans le prompt) :
// - consentement « traitement IA » du jeune vérifié avant tout envoi ;
// - données minimisées : nom remplacé par « [JEUNE] », pas de téléphone, e-mail, zone… ;
// - références bibliques choisies dans une liste fournie puis re-vérifiées dans la base ;
// - rien n'est intégré au dossier sans validation humaine.
// ------------------------------------------------------------------

export class AIError extends Error {}

export interface AIProvider { name: string; complete(system: string, user: string): Promise<string> }

export const DEFAULT_MODELS = { anthropic: 'claude-sonnet-5-5', openai_compatible: 'gpt-4o-mini' };

export function getProvider(): AIProvider | null {
  const s = getSettings().ai;
  if (s.provider === 'anthropic') {
    if (!s.apiKey) return null;
    return {
      name: `anthropic:${s.model || DEFAULT_MODELS.anthropic}`,
      async complete(system, user) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json', 'x-api-key': s.apiKey!, 'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({ model: s.model || DEFAULT_MODELS.anthropic, max_tokens: 2500, system, messages: [{ role: 'user', content: user }] }),
        });
        if (!r.ok) throw new AIError(`Fournisseur IA : erreur ${r.status} ${(await r.text()).slice(0, 200)}`);
        const j = await r.json();
        return (j.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
      },
    };
  }
  if (s.provider === 'openai_compatible') {
    if (!s.apiKey || !s.baseUrl) return null;
    return {
      name: `openai:${s.model || DEFAULT_MODELS.openai_compatible}`,
      async complete(system, user) {
        const r = await fetch(`${s.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
          body: JSON.stringify({ model: s.model || DEFAULT_MODELS.openai_compatible, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } }),
        });
        if (!r.ok) throw new AIError(`Fournisseur IA : erreur ${r.status}`);
        const j = await r.json();
        return j.choices?.[0]?.message?.content ?? '';
      },
    };
  }
  if (s.provider === 'serveur') {
    const sb = supabase();
    if (!sb) return null;
    return {
      name: 'serveur',
      async complete(system, user) {
        const { data, error } = await sb.functions.invoke('ai', { body: { system, user } });
        if (error) throw new AIError(error.message);
        return (data as { text: string }).text;
      },
    };
  }
  return null;
}

/** Remplaçable dans les tests. */
let providerOverride: AIProvider | null | undefined;
export function setProviderOverride(p: AIProvider | null | undefined) { providerOverride = p; }
const provider = () => (providerOverride !== undefined ? providerOverride : getProvider());

export function aiAvailability(youth?: Youth): { ok: boolean; reason?: string } {
  if (!provider()) return { ok: false, reason: 'Aucun fournisseur IA configuré (Réglages → Intelligence artificielle).' };
  if (!isOnline() && !providerOverride) return { ok: false, reason: 'Hors ligne : l’IA fonctionne sur serveur et nécessite Internet.' };
  if (youth && !hasConsent(youth.id, 'traitement_ia')) return { ok: false, reason: 'Le consentement « traitement par l’IA » n’est pas enregistré pour ce jeune.' };
  return { ok: true };
}

export function hasConsent(youthId: string, type: string) {
  const list = vault.all('consents').filter((c) => c.youthId === youthId && c.type === type).sort((a, b) => b.date.localeCompare(a.date));
  return !!list[0]?.granted;
}

/** Pseudonymisation : le nom du jeune n'est pas transmis. */
export function pseudonymize(text: string, youth: Youth) {
  let out = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[E-MAIL]');
  for (const n of [youth.firstName, youth.lastName].filter((x) => x && x.length > 1)) {
    out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[JEUNE]');
  }
  return out.replace(/(\+?\d[\d\s.-]{7,}\d)/g, '[TÉLÉPHONE]');
}

function extractJson<T>(raw: string): T {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new AIError('Réponse IA illisible (JSON attendu).');
  try { return JSON.parse(m[0]) as T; } catch { throw new AIError('Réponse IA illisible (JSON invalide).'); }
}

const RULES = `Règles impératives :
- N'invente jamais de propos, faits, émotions ou intentions. N'utilise que le contenu fourni.
- Sépare ce qui est explicitement exprimé (faits) de ce qui est une hypothèse ; place les hypothèses dans "hypotheses".
- Signale ce qui manque dans "missing". Aucun diagnostic médical, psychologique ou spirituel.
- Ne présente jamais une suggestion biblique comme une révélation divine ou une réponse certaine de Dieu.
- Pour les versets, choisis UNIQUEMENT parmi les références de la liste CANDIDATS fournie ; n'écris jamais le texte d'un verset de mémoire.
- Réponds en français, uniquement avec un objet JSON valide.`;

function candidatePassages(texts: string[], limit = 18) {
  const hay = texts.join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const themes = THEMES.filter((t) => t.keywords.some((k) => hay.includes(k)));
  const refs = new Set<string>();
  for (const t of (themes.length ? themes : THEMES.slice(0, 4))) t.refs.forEach((r) => refs.add(r));
  return [...refs].map((r) => resolve(r)).filter(Boolean).slice(0, limit).map((p) => ({ ref: p!.ref, text: p!.text.slice(0, 400) }));
}

export interface SummaryInput { session: Session; youth: Youth; transcripts: string[] }

export function emptyDraft(): SummaryDraft {
  return { context: '', themes: [], concerns: [], needs: [], strengths: [], decisions: [], actions: [], toDeepen: [], verses: [], next: '', hypotheses: [], missing: [] };
}

/** Compte rendu sans IA : structure pré-remplie uniquement avec ce qui a été saisi. */
export function manualDraft({ session }: SummaryInput): SummaryDraft {
  const d = emptyDraft();
  const actions = vault.all('actions').filter((a) => a.sessionId === session.id).map((a) => `${a.title} (${a.owner === 'jeune' ? 'pour le jeune' : 'pour l’accompagnateur'})`);
  const TYPES: Record<string, string> = { presentiel: 'Rencontre en présentiel', telephone: 'Échange téléphonique', visio: 'Visioconférence', messagerie: 'Échange par messagerie' };
  d.context = `${TYPES[session.type] ?? session.type} — ${session.theme || 'thème non précisé'}`;
  d.themes = session.topics;
  d.needs = session.needs ? [session.needs] : [];
  d.decisions = session.decisions ? session.decisions.split('\n').filter(Boolean) : [];
  d.actions = actions;
  d.verses = session.verses.map((r) => ({ ref: r, why: 'Étudié pendant la rencontre' }));
  d.next = session.nextDate ? `Prochaine rencontre prévue le ${session.nextDate.slice(0, 10)}` : '';
  d.missing = ['Préoccupations, forces et points à approfondir à compléter par l’accompagnateur'];
  return d;
}

export async function generateSummary(input: SummaryInput): Promise<{ draft: SummaryDraft; provider: string; sources: string[]; rejectedRefs: string[] }> {
  const av = aiAvailability(input.youth);
  if (!av.ok) throw new AIError(av.reason);
  await loadBible();
  const p = provider()!;
  const { session, youth, transcripts } = input;
  const material = [
    `Type : ${session.type}. Thème : ${session.theme || '(non précisé)'}. Sujets : ${session.topics.join(', ') || '(aucun)'}`,
    `NOTES DE L'ACCOMPAGNATEUR :\n${session.notes || '(vides)'}`,
    session.needs ? `BESOINS NOTÉS : ${session.needs}` : '',
    session.decisions ? `DÉCISIONS NOTÉES : ${session.decisions}` : '',
    ...transcripts.map((t, i) => `TRANSCRIPTION ${i + 1} :\n${t}`),
  ].filter(Boolean).map((x) => pseudonymize(x, youth)).join('\n\n');
  const candidates = candidatePassages([material]);
  const user = `${material}\n\nCANDIDATS (références vérifiées) :\n${candidates.map((c) => `- ${c.ref} : ${c.text}`).join('\n')}

Produis le JSON : {"context":"","themes":[],"concerns":[],"needs":[],"strengths":[],"decisions":[],"actions":[],"toDeepen":[],"verses":[{"ref":"","why":""}],"next":"","hypotheses":[],"missing":[]}
"concerns" = préoccupations exprimées par le jeune ; "next" = proposition de date ou sujet pour le prochain entretien.`;
  const raw = await p.complete(`Tu aides un accompagnateur chrétien à rédiger un compte rendu fidèle et concis d'une rencontre avec un jeune.\n${RULES}`, user);
  const parsed = { ...emptyDraft(), ...extractJson<Partial<SummaryDraft>>(raw) };
  const allowed = new Set(candidates.map((c) => c.ref));
  const rejectedRefs: string[] = [];
  parsed.verses = (parsed.verses ?? []).filter((v) => {
    const r = resolve(v.ref);
    const ok = !!r && (allowed.has(r.ref) || [...allowed].some((a) => resolve(a)?.parsed.book === r.parsed.book && resolve(a)?.parsed.chapter === r.parsed.chapter));
    if (!ok) rejectedRefs.push(v.ref);
    return ok;
  }).map((v) => ({ ...v, ref: resolve(v.ref)!.ref }));
  const sources = ['notes', ...transcripts.map((_, i) => `transcription ${i + 1}`)];
  await vault.audit('ia_compte_rendu', 'sessions', session.id);
  return { draft: parsed, provider: p.name, sources, rejectedRefs };
}

export function draftToText(d: SummaryDraft) {
  const sec = (t: string, items: string[]) => (items.length ? `## ${t}\n${items.map((x) => `- ${x}`).join('\n')}\n` : '');
  return [
    d.context ? `## Contexte\n${d.context}\n` : '',
    sec('Thèmes abordés', d.themes),
    sec('Préoccupations exprimées', d.concerns),
    sec('Besoins identifiés', d.needs),
    sec('Forces et ressources', d.strengths),
    sec('Décisions prises ensemble', d.decisions),
    sec('Actions à entreprendre', d.actions),
    sec('Points à approfondir', d.toDeepen),
    sec('Versets potentiellement pertinents', d.verses.map((v) => `${v.ref} — ${v.why}`)),
    d.next ? `## Prochain entretien\n${d.next}\n` : '',
    sec('Hypothèses à vérifier (non confirmées)', d.hypotheses),
    sec('Informations manquantes', d.missing),
  ].filter(Boolean).join('\n');
}

// ---------- Suggestions d'accompagnement ----------
export interface Suggestion {
  finding: string; evidence: string[]; proposal: string; goal: string; questionOrAction: string; limits: string;
}

export type SuggestionTask = 'questions' | 'preparer' | 'plan' | 'actions_non_realisees' | 'bilan' | 'meditation';
export const TASK_LABELS: Record<SuggestionTask, string> = {
  questions: 'Questions ouvertes pour approfondir',
  preparer: 'Préparer la prochaine rencontre',
  plan: 'Proposer un plan de suivi',
  actions_non_realisees: 'Analyser les actions non réalisées',
  bilan: 'Préparer un bilan périodique',
  meditation: 'Thèmes de prière ou de méditation',
};

export function buildYouthContext(youth: Youth, sinceDays = 120) {
  const since = Date.now() - sinceDays * 86_400_000;
  const sessions = vault.all('sessions').filter((s) => s.youthId === youth.id && new Date(s.date).getTime() >= since).sort((a, b) => a.date.localeCompare(b.date));
  const goals = vault.all('goals').filter((g) => g.youthId === youth.id);
  const actions = vault.all('actions').filter((a) => a.youthId === youth.id);
  const fmtGoal = (g: Goal) => `[objectif ${g.id.slice(0, 6)}] ${g.title} — ${g.status}${g.lastEvaluated ? `, évalué le ${g.lastEvaluated.slice(0, 10)}` : ''}`;
  const fmtAct = (a: ActionItem) => `[action ${a.id.slice(0, 6)}] ${a.title} (${a.owner}) — ${a.status}${a.dueDate ? `, échéance ${a.dueDate.slice(0, 10)}` : ''}`;
  const parts = [
    `Situation initiale — attentes : ${youth.initial.expectations || '?'} ; besoins : ${youth.initial.needs || '?'} ; objectifs : ${youth.initial.personalGoals || '?'}`,
    ...sessions.map((s) => `[rencontre ${s.date.slice(0, 10)}] ${s.theme} — ${s.summary?.text ? s.summary.text.slice(0, 900) : (s.notes || '').slice(0, 600)}`),
    ...goals.map(fmtGoal),
    ...actions.map(fmtAct),
  ];
  return pseudonymize(parts.join('\n'), youth);
}

export async function suggest(task: SuggestionTask, youth: Youth, extra = ''): Promise<{ items: Suggestion[]; provider: string }> {
  const av = aiAvailability(youth);
  if (!av.ok) throw new AIError(av.reason);
  const p = provider()!;
  const ctx = buildYouthContext(youth);
  const raw = await p.complete(
    `Tu assistes un accompagnateur chrétien. Tu proposes, il décide. ${RULES}\nCite dans "evidence" les éléments précis du dossier (date de rencontre, identifiant d'objectif ou d'action) qui motivent chaque suggestion. Ne présume jamais qu'une absence de contact signifie une difficulté.`,
    `TÂCHE : ${TASK_LABELS[task]}. ${extra}\n\nDOSSIER (pseudonymisé) :\n${ctx}\n\nRéponds : {"items":[{"finding":"","evidence":[""],"proposal":"","goal":"","questionOrAction":"","limits":""}]} (3 à 5 éléments).`,
  );
  const j = extractJson<{ items: Suggestion[] }>(raw);
  await vault.audit(`ia_suggestion:${task}`, 'youth', youth.id);
  return { items: (j.items ?? []).slice(0, 6), provider: p.name };
}

// ---------- Suggestions bibliques ----------
export interface VerseSuggestion { ref: string; text: string; theme: string; why: string; reflection: string; question: string; application: string; caution: string; source: string }

/** Sans IA : index thématique + recherche par mots-clés, entièrement vérifiés. */
export async function suggestPassagesLocal(themeIds: string[], keywords = ''): Promise<{ items: VerseSuggestion[]; notFound: boolean }> {
  await loadBible();
  const items: VerseSuggestion[] = [];
  for (const t of THEMES.filter((x) => themeIds.includes(x.id))) {
    for (const r of t.refs) {
      const p = resolve(r);
      if (!p) continue; // référence absente de la base : écartée
      items.push({ ref: p.ref, text: p.text, theme: t.label, why: `Passage de l’index thématique « ${t.label} ».`, reflection: t.reflection, question: t.question, application: t.application, caution: t.caution, source: 'index-thematique' });
    }
  }
  if (keywords.trim()) {
    for (const h of searchText(keywords, 8)) {
      if (!items.some((i) => i.ref === h.ref)) items.push({ ref: h.ref, text: h.text, theme: 'Recherche', why: `Contient les mots « ${keywords} ».`, reflection: 'Lire le passage dans son contexte (chapitre entier) avant de l’utiliser.', question: 'Qu’est-ce que ce passage dit de Dieu ? Et de nous ?', application: 'À préciser par l’accompagnateur.', caution: 'Résultat d’une recherche par mots : la pertinence doit être vérifiée.', source: 'recherche' });
    }
  }
  return { items, notFound: items.length === 0 };
}

export async function suggestPassagesAI(youth: Youth | undefined, context: string, themeIds: string[]): Promise<{ items: VerseSuggestion[]; notFound: boolean; provider: string }> {
  const av = aiAvailability(youth);
  if (!av.ok) throw new AIError(av.reason);
  await loadBible();
  const base = await suggestPassagesLocal(themeIds.length ? themeIds : THEMES.map((t) => t.id));
  const cands = base.items.slice(0, 40);
  const p = provider()!;
  const raw = await p.complete(
    `Tu aides un accompagnateur chrétien à choisir des passages bibliques. ${RULES}\nRespecte le contexte et le genre littéraire des textes ; n'utilise jamais un verset pour culpabiliser. Si aucun candidat n'est pertinent, renvoie une liste vide.`,
    `CONTEXTE (pseudonymisé) : ${youth ? pseudonymize(context, youth) : context}\n\nCANDIDATS :\n${cands.map((c) => `- ${c.ref} [${c.theme}] : ${c.text.slice(0, 300)}`).join('\n')}\n\nRéponds : {"items":[{"ref":"","theme":"","why":"","reflection":"","question":"","application":"","caution":""}]} (3 à 5 au maximum, références prises dans CANDIDATS).`,
  );
  const j = extractJson<{ items: Omit<VerseSuggestion, 'text' | 'source'>[] }>(raw);
  const allowed = new Map(cands.map((c) => [c.ref, c]));
  const items = (j.items ?? []).flatMap((it) => {
    const r = resolve(it.ref);
    if (!r || !allowed.has(r.ref)) return [];
    return [{ ...allowed.get(r.ref)!, ...it, ref: r.ref, text: r.text, source: `ia:${p.name}` }];
  });
  return { items, notFound: items.length === 0, provider: p.name };
}

export async function generateSynthesis(youth: Youth): Promise<{ text: string; provider: string }> {
  const av = aiAvailability(youth);
  if (!av.ok) throw new AIError(av.reason);
  const p = provider()!;
  const studied = vault.all('bible_recs').filter((r) => r.youthId === youth.id && (r.status === 'accepte' || r.status === 'etudie')).map((r) => r.ref);
  const raw = await p.complete(
    `Tu rédiges la synthèse du parcours d'accompagnement d'un jeune pour son accompagnateur. ${RULES}`,
    `DOSSIER :\n${buildYouthContext(youth, 3650)}\nVersets déjà étudiés : ${studied.join(', ') || 'aucun'}\n\nRéponds : {"text":"..."} avec les sections markdown : Situation initiale, Principaux sujets abordés, Objectifs définis, Actions réalisées, Progrès constatés, Objectifs restant à travailler, Versets déjà étudiés, Prochaines étapes convenues. Aucune note chiffrée ni jugement de maturité spirituelle.`,
  );
  return { text: extractJson<{ text: string }>(raw).text, provider: p.name };
}

/** Synthèse sans IA, construite à partir des seules données saisies. */
export function manualSynthesis(youth: Youth) {
  const sessions = vault.all('sessions').filter((s) => s.youthId === youth.id).sort((a, b) => a.date.localeCompare(b.date));
  const goals = vault.all('goals').filter((g) => g.youthId === youth.id);
  const actions = vault.all('actions').filter((a) => a.youthId === youth.id);
  const studied = vault.all('bible_recs').filter((r) => r.youthId === youth.id && (r.status === 'accepte' || r.status === 'etudie'));
  const li = (a: string[]) => (a.length ? a.map((x) => `- ${x}`).join('\n') : '- (à compléter)');
  return [
    `## Situation initiale\n${youth.initial.context || ''}\nAttentes : ${youth.initial.expectations || '—'}\nBesoins : ${youth.initial.needs || '—'}`,
    `## Principaux sujets abordés\n${li([...new Set(sessions.flatMap((s) => [s.theme, ...s.topics]).filter(Boolean))])}`,
    `## Objectifs définis\n${li(goals.map((g) => `${g.title} (${g.status})`))}`,
    `## Actions réalisées\n${li(actions.filter((a) => a.status === 'terminee').map((a) => a.title))}`,
    `## Progrès constatés\n${li(goals.flatMap((g) => g.observations.map((o) => `${o.date.slice(0, 10)} — ${o.text}`)))}`,
    `## Objectifs restant à travailler\n${li(goals.filter((g) => g.status === 'en_cours').map((g) => g.title))}`,
    `## Versets déjà étudiés\n${li(studied.map((r) => r.ref))}`,
    `## Prochaines étapes convenues\n${li(actions.filter((a) => a.status === 'a_faire' || a.status === 'en_cours').map((a) => a.title))}`,
  ].join('\n\n');
}
