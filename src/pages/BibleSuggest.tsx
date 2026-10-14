import { useState } from 'react';
import { Sparkles, Check, X, Pencil, Search } from 'lucide-react';
import { THEMES } from '../lib/bibleThemes';
import { suggestPassagesLocal, suggestPassagesAI, aiAvailability, type VerseSuggestion } from '../lib/ai';
import { vault } from '../lib/store';
import type { Youth } from '../lib/types';
import { Field, toast, toastError } from '../components/ui';

export function BibleSuggestPanel({ youth, context, sessionId }: { youth?: Youth; context?: string; sessionId?: string }) {
  const [themes, setThemes] = useState<string[]>([]);
  const [kw, setKw] = useState('');
  const [items, setItems] = useState<VerseSuggestion[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [comment, setComment] = useState<Record<number, string>>({});
  const av = aiAvailability(youth);

  const run = async (ai: boolean) => {
    setBusy(true);
    try {
      const r = ai ? await suggestPassagesAI(youth, `${context ?? ''}\n${kw}`, themes) : await suggestPassagesLocal(themes, kw);
      setItems(r.items); setNotFound(r.notFound);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const accept = async (s: VerseSuggestion, i: number, meditation = false) => {
    await vault.put('bible_recs', { youthId: youth?.id, sessionId, ref: s.ref, theme: s.theme, why: s.why, reflection: s.reflection, question: s.question, application: s.application, caution: s.caution, comment: comment[i], status: 'accepte', source: s.source });
    if (meditation && youth) await vault.put('actions', { youthId: youth.id, title: `Préparer une méditation : ${s.ref}`, description: `${s.reflection}\nQuestion : ${s.question}`, owner: 'accompagnateur', priority: 'normale', status: 'a_faire' });
    toast(meditation ? 'Passage retenu et méditation ajoutée aux actions' : 'Passage enregistré dans la fiche');
    setItems((l) => l?.filter((_, j) => j !== i) ?? null);
  };
  const patch = (i: number, k: keyof VerseSuggestion, v: string) => setItems((l) => l?.map((x, j) => (j === i ? { ...x, [k]: v } : x)) ?? null);

  return (
    <div className="card stack">
      <h2>Suggestions de passages</h2>
      <p className="tiny muted">Les thèmes sont des catégories de recherche, pas des diagnostics. Les suggestions sont proposées à vous seul : rien n’est envoyé au jeune.</p>
      <div className="row wrap">{THEMES.map((t) => <button key={t.id} className={`badge ${themes.includes(t.id) ? '' : 'grey'}`} style={{ border: 0, cursor: 'pointer', padding: '5px 10px' }} onClick={() => setThemes((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>{t.label}</button>)}</div>
      <Field label="Mots-clés (facultatif)"><input className="input" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Ex. pardon, sagesse, crainte" /></Field>
      <div className="row wrap">
        <button className="btn ghost" disabled={busy || (!themes.length && !kw.trim())} onClick={() => run(false)}><Search size={16} /> Rechercher</button>
        <button className="btn secondary" disabled={busy || !av.ok} title={av.reason} onClick={() => run(true)}><Sparkles size={16} /> {busy ? 'Analyse…' : 'Affiner avec l’IA'}</button>
      </div>
      {!av.ok && <p className="tiny faint">{av.reason}</p>}
      {notFound && <p className="small" style={{ color: 'var(--amber)' }}>Aucun passage suffisamment pertinent n’a été identifié. Essayez d’autres thèmes ou mots-clés.</p>}
      {items?.map((s, i) => (
        <div key={s.ref + i} className="card flat stack s6" style={{ background: 'var(--surface-2)', padding: 14 }}>
          <div className="row between"><b>{s.ref}</b><span className="badge grey">{s.theme}</span></div>
          <div className="quote small">{s.text}</div>
          {editing === i ? (
            <div className="stack s6">
              {(['why', 'reflection', 'question', 'application', 'caution'] as const).map((k) => <Field key={k} label={{ why: 'Pourquoi pertinent', reflection: 'Piste de réflexion', question: 'Question ouverte', application: 'Application pratique', caution: 'Mise en garde' }[k]}><textarea className="input" style={{ minHeight: 50 }} value={s[k]} onChange={(e) => patch(i, k, e.target.value)} /></Field>)}
              <button className="btn sm" onClick={() => setEditing(null)}>OK</button>
            </div>
          ) : (
            <div className="small stack s6">
              <div><b>Pourquoi :</b> {s.why}</div>
              <div><b>Réflexion :</b> {s.reflection}</div>
              <div><b>Question :</b> {s.question}</div>
              <div><b>Application :</b> {s.application}</div>
              {s.caution && <div style={{ color: 'var(--amber)' }}><b>Mise en garde :</b> {s.caution}</div>}
              <div className="tiny faint">Source : {s.source} · Bible Louis Segond 1910 (domaine public)</div>
            </div>
          )}
          <input className="input" placeholder="Votre commentaire…" value={comment[i] ?? ''} onChange={(e) => setComment({ ...comment, [i]: e.target.value })} />
          <div className="row wrap">
            {youth && <button className="btn sm" onClick={() => accept(s, i)}><Check size={14} /> Enregistrer dans la fiche</button>}
            {youth && <button className="btn secondary sm" onClick={() => accept(s, i, true)}>Préparer une méditation</button>}
            <button className="btn ghost sm" onClick={() => setEditing(i)}><Pencil size={14} /> Modifier</button>
            <button className="btn ghost sm" onClick={() => setItems((l) => l?.filter((_, j) => j !== i) ?? null)}><X size={14} /> Rejeter</button>
          </div>
        </div>
      ))}
    </div>
  );
}
