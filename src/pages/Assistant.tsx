import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Sparkles, Check, X, Pencil, ShieldCheck } from 'lucide-react';
import { vault, useCollection } from '../lib/store';
import { suggest, aiAvailability, TASK_LABELS, type Suggestion, type SuggestionTask } from '../lib/ai';
import { youthName } from '../lib/alerts';
import { Field, Empty, toast, toastError } from '../components/ui';

export default function AssistantPage() {
  const [params] = useSearchParams();
  const youth = useCollection('youth');
  const [youthId, setYouthId] = useState(params.get('jeune') ?? youth[0]?.id ?? '');
  const [task, setTask] = useState<SuggestionTask>('preparer');
  const [extra, setExtra] = useState('');
  const [items, setItems] = useState<(Suggestion & { state?: 'accepte' | 'rejete' })[]>([]);
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const y = vault.get('youth', youthId);
  const av = aiAvailability(y);

  const run = async () => {
    if (!y) return;
    setBusy(true);
    try { const r = await suggest(task, y, extra); setItems(r.items); setProvider(r.provider); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const accept = async (s: Suggestion, i: number, as: 'action' | 'note') => {
    if (!y) return;
    if (as === 'action') await vault.put('actions', { youthId: y.id, title: s.questionOrAction.slice(0, 120), description: `${s.proposal}\n\nObjectif : ${s.goal}\n(Suggestion IA acceptée — ${provider})`, owner: 'accompagnateur', priority: 'normale', status: 'a_faire' });
    else await vault.put('notes', { youthId: y.id, title: `Suggestion : ${s.finding.slice(0, 60)}`, content: `## Constat\n${s.finding}\n## Éléments du dossier\n${s.evidence.map((e) => `- ${e}`).join('\n')}\n## Proposition\n${s.proposal}\n## Objectif\n${s.goal}\n## Question ou action\n${s.questionOrAction}\n## Limites\n${s.limits}\n\n_Source : ${provider}, ${new Date().toISOString().slice(0, 10)}_`, tags: ['suggestion-ia'] });
    setItems((l) => l.map((x, j) => (j === i ? { ...x, state: 'accepte' } : x)));
    toast(as === 'action' ? 'Ajoutée aux actions' : 'Enregistrée en note');
  };
  const patch = (i: number, k: keyof Suggestion, v: string) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <div className="stack s18">
      <div className="page-head"><div><h1>Assistant d’accompagnement</h1><p>L’IA propose, vous décidez. Aucune action n’est prise ni aucun message envoyé sans votre validation.</p></div></div>
      {youth.length === 0 ? <div className="card"><Empty title="Aucun jeune" /></div> : (
        <div className="grid dash">
          <div className="stack">
            {items.length === 0 && !busy && <div className="card"><Empty icon={<Sparkles size={32} />} title="Choisissez un jeune et une demande">Les suggestions s’appuient uniquement sur le dossier de ce jeune (pseudonymisé).</Empty></div>}
            {busy && <div className="card"><p className="muted">Analyse du dossier…</p></div>}
            {items.map((s, i) => (
              <div key={i} className="card stack s6" style={s.state === 'rejete' ? { opacity: .45 } : undefined}>
                {editing === i ? (
                  <>
                    {(['finding', 'proposal', 'goal', 'questionOrAction', 'limits'] as const).map((k) => <Field key={k} label={{ finding: 'Constat', proposal: 'Proposition', goal: 'Objectif', questionOrAction: 'Question ou action', limits: 'Limites' }[k]}><textarea className="input" style={{ minHeight: 50 }} value={s[k]} onChange={(e) => patch(i, k, e.target.value)} /></Field>)}
                    <button className="btn sm" onClick={() => setEditing(null)}>OK</button>
                  </>
                ) : (
                  <>
                    <div className="tiny muted">Constat ou besoin à approfondir</div><b>{s.finding}</b>
                    <div className="tiny muted mt8">Éléments du dossier</div>
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{s.evidence.map((e, j) => <li key={j}>{e}</li>)}</ul>
                    <div className="small mt8"><b>Proposition :</b> {s.proposal}</div>
                    <div className="small"><b>Objectif :</b> {s.goal}</div>
                    <div className="small"><b>Question ou action :</b> {s.questionOrAction}</div>
                    <div className="small" style={{ color: 'var(--amber)' }}><b>Limites :</b> {s.limits}</div>
                  </>
                )}
                {s.state ? <span className={`badge ${s.state === 'accepte' ? 'green' : 'grey'}`}>{s.state === 'accepte' ? 'Acceptée' : 'Rejetée'}</span> : (
                  <div className="row wrap mt8">
                    <button className="btn sm" onClick={() => accept(s, i, 'action')}><Check size={14} /> Créer une action</button>
                    <button className="btn secondary sm" onClick={() => accept(s, i, 'note')}>Garder en note</button>
                    <button className="btn ghost sm" onClick={() => setEditing(i)}><Pencil size={14} /> Modifier</button>
                    <button className="btn ghost sm" onClick={() => setItems((l) => l.map((x, j) => (j === i ? { ...x, state: 'rejete' } : x)))}><X size={14} /> Rejeter</button>
                  </div>
                )}
              </div>
            ))}
            {provider && <p className="tiny faint">Généré par {provider}. Vérifiez chaque élément avant de l’utiliser.</p>}
          </div>
          <div className="card stack" style={{ alignSelf: 'start' }}>
            <Field label="Jeune"><select className="input" value={youthId} onChange={(e) => { setYouthId(e.target.value); setItems([]); }}>{youth.map((x) => <option key={x.id} value={x.id}>{youthName(x)}</option>)}</select></Field>
            <Field label="Demande"><select className="input" value={task} onChange={(e) => setTask(e.target.value as SuggestionTask)}>{Object.entries(TASK_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Précision (facultatif)"><textarea className="input" style={{ minHeight: 60 }} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ex. sur les 3 derniers mois, sujet de l’orientation…" /></Field>
            <button className="btn" disabled={busy || !av.ok} onClick={run}><Sparkles size={16} /> {busy ? 'Analyse…' : 'Obtenir des suggestions'}</button>
            {!av.ok && <p className="small" style={{ color: 'var(--amber)' }}>{av.reason} {y && av.reason?.includes('consentement') && <Link to={`/jeunes/${y.id}?onglet=consentements`}>Gérer</Link>}{av.reason?.includes('Réglages') && <Link to="/reglages?onglet=ia">Configurer</Link>}</p>}
            <div className="row tiny muted"><ShieldCheck size={14} /> Nom, téléphone et e-mail remplacés avant l’envoi ; seules les données utiles à la demande sont transmises.</div>
          </div>
        </div>
      )}
    </div>
  );
}
