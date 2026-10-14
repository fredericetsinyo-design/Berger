import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, Check, Plus, Paperclip, Trash2, Heading2, List, Bold, BookOpen, CalendarPlus, Tag, Download } from 'lucide-react';
import { vault, useRecord, useCollection } from '../lib/store';
import type { Session, SummaryDraft, ActionItem, Note } from '../lib/types';
import { toInputDT, fromInputDT, fmtDateTime, fmtDate, toInputDate, fromInputDate } from '../lib/dates';
import { youthName } from '../lib/alerts';
import { Field, Badge, Modal, Md, toast, toastError, REPORT, SESSION_TYPES, ACTION_STATUS, Confirm } from '../components/ui';
import { Recorder, AudioList } from '../components/Recorder';
import { aiAvailability, generateSummary, manualDraft, draftToText } from '../lib/ai';
import { resolve, loadBible, bibleReady } from '../lib/bible';
import { AppointmentForm } from './Agenda';

export function NoteEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after = '', linePrefix = false) => {
    const t = ref.current!;
    const { selectionStart: s, selectionEnd: e } = t;
    let next: string;
    if (linePrefix) {
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      next = value.slice(0, ls) + before + value.slice(ls);
    } else next = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => { t.focus(); t.selectionStart = t.selectionEnd = e + before.length; });
  };
  return (
    <div>
      <div className="editor-tools">
        <button type="button" className="btn ghost sm icon" title="Titre" onClick={() => wrap('## ', '', true)}><Heading2 size={14} /></button>
        <button type="button" className="btn ghost sm icon" title="Liste" onClick={() => wrap('- ', '', true)}><List size={14} /></button>
        <button type="button" className="btn ghost sm icon" title="Gras" onClick={() => wrap('**', '**')}><Bold size={14} /></button>
      </div>
      <textarea ref={ref} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function useAutosave(session: Session | undefined) {
  const [local, setLocal] = useState<Partial<Session>>({});
  const [saved, setSaved] = useState<'ok' | 'pending'>('ok');
  const t = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef<Partial<Session>>({});
  useEffect(() => { setLocal({}); latest.current = {}; }, [session?.id]);
  const flush = async () => {
    if (!session || !Object.keys(latest.current).length) return;
    const patch = latest.current; latest.current = {};
    await vault.put('sessions', { id: session.id, ...patch });
    setSaved('ok');
  };
  const update = (patch: Partial<Session>) => {
    setLocal((l) => ({ ...l, ...patch }));
    latest.current = { ...latest.current, ...patch };
    setSaved('pending');
    clearTimeout(t.current);
    t.current = setTimeout(flush, 700);
  };
  useEffect(() => () => { clearTimeout(t.current); flush(); }, [session?.id]); // eslint-disable-line
  return { v: { ...(session ?? {}), ...local } as Session, update, saved };
}

export default function SessionPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const s = useRecord('sessions', id);
  const youth = useRecord('youth', s?.youthId);
  const { v, update, saved } = useAutosave(s);
  const actions = useCollection('actions', (a) => a.sessionId === id, [id]);
  const notes = useCollection('notes', (n) => n.sessionId === id, [id]);
  const [actionForm, setActionForm] = useState(false);
  const [rdv, setRdv] = useState(false);
  const [verse, setVerse] = useState('');
  const [topic, setTopic] = useState('');
  const [del, setDel] = useState(false);
  const nav = useNavigate();
  useEffect(() => { loadBible().catch(() => undefined); }, []);
  if (!s || !youth) return <p className="muted">Rencontre introuvable.</p>;

  const addVerse = async () => {
    if (!bibleReady()) { toast('Chargement de la Bible…'); await loadBible().catch(toastError); }
    const p = resolve(verse);
    if (!p) return toastError(new Error('Référence introuvable dans la Bible Louis Segond 1910. Vérifiez le livre, le chapitre et le verset.'));
    update({ verses: [...new Set([...(v.verses ?? []), p.ref])] });
    vault.put('bible_recs', { youthId: youth.id, sessionId: s.id, ref: p.ref, status: 'etudie', source: 'manuel', theme: v.theme });
    setVerse('');
  };

  const attach = async (f: File) => {
    if (f.size > 15 * 1024 * 1024) return toastError(new Error('Fichier trop volumineux (15 Mo max).'));
    const blobId = await vault.putBlob(f);
    update({ attachments: [...(v.attachments ?? []), { name: f.name, type: f.type, size: f.size, blobId }] });
  };

  return (
    <div className="stack s18">
      <div className="row wrap between">
        <div className="row">
          <Link to={`/jeunes/${youth.id}?onglet=rencontres`} className="btn ghost icon" aria-label="Retour"><ArrowLeft size={18} /></Link>
          <div><h1>{v.theme || 'Rencontre'}</h1><p className="muted small">{youthName(youth)} · {fmtDateTime(v.date)}</p></div>
        </div>
        <div className="row">
          <span className="tiny faint">{saved === 'ok' ? 'Enregistré' : 'Enregistrement…'}</span>
          <Badge map={REPORT} v={v.reportStatus} />
          <button className="btn ghost sm icon" aria-label="Supprimer la rencontre" onClick={() => setDel(true)}><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="grid dash">
        <div className="stack s18">
          <section className="card stack">
            <div className="grid g2">
              <Field label="Date et heure"><input className="input" type="datetime-local" value={toInputDT(v.date)} onChange={(e) => update({ date: fromInputDT(e.target.value) })} /></Field>
              <Field label="Type de rencontre"><select className="input" value={v.type} onChange={(e) => update({ type: e.target.value as Session['type'] })}>{SESSION_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            </div>
            <Field label="Thème principal"><input className="input" value={v.theme} onChange={(e) => update({ theme: e.target.value })} placeholder="Ex. orientation scolaire, relation familiale…" /></Field>
            <div className="field">
              <span>Sujets abordés</span>
              <div className="row wrap">
                {(v.topics ?? []).map((t) => <span key={t} className="badge">{t} <button style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => update({ topics: v.topics.filter((x) => x !== t) })}>×</button></span>)}
                <form onSubmit={(e) => { e.preventDefault(); if (topic.trim()) { update({ topics: [...(v.topics ?? []), topic.trim()] }); setTopic(''); } }}><input className="input" style={{ width: 200, minHeight: 32, padding: '4px 10px' }} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="+ ajouter" /></form>
              </div>
            </div>
            <Field label="Notes de l’accompagnateur"><NoteEditor value={v.notes ?? ''} onChange={(x) => update({ notes: x })} placeholder="Ce qui a été dit, observé, convenu… (sauvegarde automatique, même hors ligne)" /></Field>
            <div className="grid g2">
              <Field label="Besoins exprimés"><textarea className="input" value={v.needs ?? ''} onChange={(e) => update({ needs: e.target.value })} /></Field>
              <Field label="Décisions prises (une par ligne)"><textarea className="input" value={v.decisions ?? ''} onChange={(e) => update({ decisions: e.target.value })} /></Field>
            </div>
          </section>

          <section className="card stack">
            <h2>Notes vocales</h2>
            <Recorder youthId={youth.id} sessionId={s.id} autoStart={params.get('enregistrer') === '1'} />
            <AudioList sessionId={s.id} />
          </section>

          <SummarySection session={v} onPatch={update} youth={youth} />
        </div>

        <div className="stack s18">
          <section className="card stack">
            <div className="card-head"><h2>Actions</h2><button className="btn sm" onClick={() => setActionForm(true)}><Plus size={14} /> Ajouter</button></div>
            {actions.length === 0 ? <p className="small muted">Aucune action décidée.</p> : actions.map((a) => (
              <div key={a.id} className="list-item">
                <input type="checkbox" checked={a.status === 'terminee'} onChange={(e) => vault.put('actions', { id: a.id, status: e.target.checked ? 'terminee' : 'a_faire' })} />
                <div className="grow"><div className="small bold">{a.title}</div><div className="tiny muted">{a.owner === 'jeune' ? 'Pour le jeune' : 'Pour moi'}{a.dueDate ? ` · ${fmtDate(a.dueDate)}` : ''}</div></div>
                <Badge map={ACTION_STATUS} v={a.status} />
              </div>
            ))}
          </section>

          <section className="card stack">
            <h2>Versets étudiés</h2>
            <form className="row" onSubmit={(e) => { e.preventDefault(); addVerse(); }}>
              <input className="input" value={verse} onChange={(e) => setVerse(e.target.value)} placeholder="Ex. Jacques 1:5" />
              <button className="btn icon" aria-label="Ajouter"><Plus size={16} /></button>
            </form>
            {(v.verses ?? []).map((r) => {
              const p = resolve(r);
              return (
                <div key={r} className="stack s6">
                  <div className="row between"><b className="small">{r}</b><button className="btn ghost sm icon" onClick={() => update({ verses: v.verses.filter((x) => x !== r) })}><Trash2 size={12} /></button></div>
                  {p && <div className="quote small">{p.text.length > 280 ? `${p.text.slice(0, 280)}…` : p.text}</div>}
                </div>
              );
            })}
            <Link to={`/bible?jeune=${youth.id}&rencontre=${s.id}`} className="small"><BookOpen size={12} /> Rechercher dans la Bible</Link>
          </section>

          <section className="card stack">
            <h2>Prochaine rencontre</h2>
            <Field label="Date envisagée"><input className="input" type="date" value={toInputDate(v.nextDate)} onChange={(e) => update({ nextDate: fromInputDate(e.target.value) })} /></Field>
            <button className="btn secondary" onClick={() => setRdv(true)}><CalendarPlus size={16} /> Planifier le rendez-vous</button>
          </section>

          <section className="card stack">
            <h2>Notes complémentaires</h2>
            <SessionNotes notes={notes} youthId={youth.id} sessionId={s.id} />
          </section>

          <section className="card stack">
            <h2>Pièces jointes</h2>
            {(v.attachments ?? []).map((a) => (
              <div key={a.blobId} className="list-item">
                <Paperclip size={14} /><span className="grow small ellipsis">{a.name}</span>
                <button className="btn ghost sm icon" onClick={async () => { const b = await vault.getBlob(a.blobId); if (!b) return toastError(new Error('Fichier absent de cet appareil')); const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = a.name; l.click(); }}><Download size={14} /></button>
                <button className="btn ghost sm icon" onClick={async () => { await vault.deleteBlob(a.blobId); update({ attachments: v.attachments.filter((x) => x.blobId !== a.blobId) }); }}><Trash2 size={14} /></button>
              </div>
            ))}
            <label className="btn ghost"><Paperclip size={16} /> Joindre un fichier<input type="file" hidden onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} /></label>
            <p className="tiny faint">Les fichiers sont chiffrés et restent sur cet appareil.</p>
          </section>
        </div>
      </div>

      {actionForm && <ActionForm initial={{ youthId: youth.id, sessionId: s.id }} onClose={() => setActionForm(false)} />}
      {rdv && <AppointmentForm youthId={youth.id} initialStart={v.nextDate} subject={v.theme ? `Suite : ${v.theme}` : ''} onClose={() => setRdv(false)} />}
      {del && <Confirm danger yes="Supprimer" text="Supprimer cette rencontre et ses notes ?" onClose={() => setDel(false)} onYes={async () => { await vault.remove('sessions', s.id); nav(`/jeunes/${youth.id}`); }} />}
    </div>
  );
}

function SessionNotes({ notes, youthId, sessionId }: { notes: Note[]; youthId: string; sessionId: string }) {
  const [edit, setEdit] = useState<Partial<Note> | null>(null);
  return (
    <>
      {notes.map((n) => (
        <button key={n.id} className="list-item" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setEdit(n)}>
          <div className="grow"><div className="small bold">{n.title || 'Note'}</div><div className="row wrap">{n.tags.map((t) => <span key={t} className="badge grey">{t}</span>)}</div></div>
        </button>
      ))}
      <button className="btn ghost sm" onClick={() => setEdit({ title: '', content: '', tags: [] })}><Plus size={14} /> Nouvelle note</button>
      {edit && <NoteModal note={edit} youthId={youthId} sessionId={sessionId} onClose={() => setEdit(null)} />}
    </>
  );
}

export function NoteModal({ note, youthId, sessionId, onClose }: { note: Partial<Note>; youthId?: string; sessionId?: string; onClose: () => void }) {
  const [v, setV] = useState(note);
  const [tag, setTag] = useState('');
  return (
    <Modal title="Note" onClose={onClose} wide>
      <div className="stack">
        <Field label="Titre"><input className="input" value={v.title ?? ''} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <NoteEditor value={v.content ?? ''} onChange={(c) => setV({ ...v, content: c })} />
        <div className="row wrap"><Tag size={14} />{(v.tags ?? []).map((t) => <span key={t} className="badge">{t}</span>)}
          <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) { setV({ ...v, tags: [...(v.tags ?? []), tag.trim()] }); setTag(''); } }}><input className="input" style={{ width: 160, minHeight: 32 }} placeholder="+ étiquette" value={tag} onChange={(e) => setTag(e.target.value)} /></form>
        </div>
        <div className="row">
          <button className="btn" onClick={async () => { await vault.put('notes', { ...v, youthId: v.youthId ?? youthId, sessionId: v.sessionId ?? sessionId, tags: v.tags ?? [] } as Note); onClose(); }}>Enregistrer</button>
          {v.id && <button className="btn danger" onClick={async () => { await vault.remove('notes', v.id!); onClose(); }}>Supprimer</button>}
        </div>
      </div>
    </Modal>
  );
}

export function ActionForm({ initial, action, onClose }: { initial?: Partial<ActionItem>; action?: ActionItem; onClose: () => void }) {
  const [v, setV] = useState<Partial<ActionItem>>(action ?? { owner: 'accompagnateur', priority: 'normale', status: 'a_faire', title: '', ...initial });
  const youth = vault.all('youth');
  const EX = ['Contacter le jeune', 'Envoyer une ressource biblique', 'Préparer la prochaine rencontre', 'Faire le point sur un objectif', 'Reprogrammer un rendez-vous', 'Vérifier si la démarche convenue a été effectuée'];
  return (
    <Modal title={action ? 'Modifier l’action' : 'Nouvelle action'} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); await vault.put('actions', v as ActionItem); toast('Action enregistrée'); onClose(); }}>
        <Field label="Intitulé"><input className="input" list="ex-actions" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /><datalist id="ex-actions">{EX.map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Description"><textarea className="input" value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <div className="grid g2">
          <Field label="Jeune"><select className="input" value={v.youthId ?? ''} onChange={(e) => setV({ ...v, youthId: e.target.value || undefined })}><option value="">—</option>{youth.map((y) => <option key={y.id} value={y.id}>{youthName(y)}</option>)}</select></Field>
          <Field label="Responsable"><select className="input" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value as ActionItem['owner'] })}><option value="accompagnateur">Moi (accompagnateur)</option><option value="jeune">Le jeune</option></select></Field>
          <Field label="Échéance"><input className="input" type="date" value={toInputDate(v.dueDate)} onChange={(e) => setV({ ...v, dueDate: fromInputDate(e.target.value) })} /></Field>
          <Field label="Priorité"><select className="input" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value as ActionItem['priority'] })}><option value="basse">Basse</option><option value="normale">Normale</option><option value="haute">Haute</option></select></Field>
          <Field label="Statut"><select className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as ActionItem['status'] })}>{Object.entries(ACTION_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Rappel"><input className="input" type="datetime-local" value={toInputDT(v.reminderAt)} onChange={(e) => setV({ ...v, reminderAt: fromInputDT(e.target.value) || undefined })} /></Field>
        </div>
        <Field label="Observation de suivi"><textarea className="input" value={v.followUp ?? ''} onChange={(e) => setV({ ...v, followUp: e.target.value })} /></Field>
        {(v.status === 'terminee' || action) && <Field label="Résultat"><textarea className="input" value={v.result ?? ''} onChange={(e) => setV({ ...v, result: e.target.value })} /></Field>}
        {action && v.youthId && (
          <Field label="Relier à une rencontre ultérieure">
            <select className="input" value={v.followUpSessionId ?? ''} onChange={(e) => setV({ ...v, followUpSessionId: e.target.value || undefined })}>
              <option value="">—</option>
              {vault.all('sessions').filter((x) => x.youthId === v.youthId && x.id !== v.sessionId).map((x) => <option key={x.id} value={x.id}>{fmtDate(x.date)} — {x.theme || 'Rencontre'}</option>)}
            </select>
          </Field>
        )}
        <button className="btn">Enregistrer</button>
      </form>
    </Modal>
  );
}

// ---------- Compte rendu ----------
const SECTIONS: [keyof SummaryDraft, string][] = [
  ['themes', 'Thèmes abordés'], ['concerns', 'Préoccupations exprimées par le jeune'], ['needs', 'Besoins identifiés'], ['strengths', 'Forces et ressources évoquées'],
  ['decisions', 'Décisions prises ensemble'], ['actions', 'Actions à entreprendre'], ['toDeepen', 'Points à approfondir'], ['hypotheses', 'Hypothèses (à vérifier)'], ['missing', 'Informations manquantes'],
];

function SummarySection({ session, youth, onPatch }: { session: Session; youth: NonNullable<ReturnType<typeof vault.get<'youth'>>>; onPatch: (p: Partial<Session>) => void }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SummaryDraft | null>(session.summary?.draft ?? null);
  const [text, setText] = useState(session.summary?.text ?? '');
  const [mode, setMode] = useState<'view' | 'draft' | 'text'>(session.summary?.text ? 'view' : session.summary?.draft ? 'draft' : 'view');
  const av = aiAvailability(youth);
  const transcripts = () => vault.all('transcriptions').filter((t) => t.sessionId === session.id).map((t) => t.corrected || t.raw).filter(Boolean);

  const run = async (ai: boolean) => {
    setBusy(true);
    try {
      if (ai) {
        const r = await generateSummary({ session, youth, transcripts: transcripts() });
        setDraft(r.draft);
        onPatch({ reportStatus: 'a_valider', summary: { ...(session.summary ?? {}), draft: r.draft, generatedAt: new Date().toISOString(), provider: r.provider, sources: r.sources, validatedAt: undefined } });
        if (r.rejectedRefs.length) toast(`Références écartées car non vérifiables : ${r.rejectedRefs.join(', ')}`);
      } else {
        const d = manualDraft({ session, youth, transcripts: [] });
        setDraft(d);
        onPatch({ reportStatus: 'a_valider', summary: { ...(session.summary ?? {}), draft: d, generatedAt: new Date().toISOString(), provider: 'saisie manuelle', sources: ['champs de la rencontre'] } });
      }
      setMode('draft');
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const editList = (k: keyof SummaryDraft, val: string) => setDraft((d) => d && ({ ...d, [k]: val.split('\n').map((x) => x.trim()).filter(Boolean) }));

  return (
    <section className="card stack">
      <div className="card-head">
        <div>
          <h2>Compte rendu</h2>
          {session.summary?.generatedAt && <p className="tiny muted">Brouillon généré le {fmtDateTime(session.summary.generatedAt)} · {session.summary.provider} · sources : {session.summary.sources?.join(', ')}{session.summary.validatedAt ? ` · validé le ${fmtDateTime(session.summary.validatedAt)}` : ''}</p>}
        </div>
        <div className="row wrap">
          <button className="btn ghost sm" disabled={busy} onClick={() => run(false)}>Structurer sans IA</button>
          <button className="btn secondary sm" disabled={busy || !av.ok} title={av.reason} onClick={() => run(true)}><Sparkles size={14} /> {busy ? 'Génération…' : 'Générer avec l’IA'}</button>
        </div>
      </div>
      {!av.ok && <p className="tiny faint">{av.reason}</p>}

      {mode === 'draft' && draft && (
        <div className="stack">
          <p className="small" style={{ color: 'var(--amber)' }}>Brouillon à relire : corrigez, complétez ou supprimez. Rien n’est intégré au dossier avant votre validation.</p>
          <Field label="Contexte de l’échange"><textarea className="input" style={{ minHeight: 60 }} value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} /></Field>
          <div className="grid g2">
            {SECTIONS.map(([k, l]) => (
              <Field key={k} label={l} hint="Un élément par ligne"><textarea className="input" style={{ minHeight: 70 }} defaultValue={(draft[k] as string[]).join('\n')} onBlur={(e) => editList(k, e.target.value)} /></Field>
            ))}
          </div>
          <Field label="Versets potentiellement pertinents (vérifiés)">
            <div className="stack s6">{draft.verses.length ? draft.verses.map((vv, i) => <div key={i} className="row small"><b>{vv.ref}</b><span className="grow muted">{vv.why}</span><button className="btn ghost sm icon" onClick={() => setDraft({ ...draft, verses: draft.verses.filter((_, j) => j !== i) })}><Trash2 size={12} /></button></div>) : <span className="small muted">Aucun</span>}</div>
          </Field>
          <Field label="Proposition pour le prochain entretien"><input className="input" value={draft.next} onChange={(e) => setDraft({ ...draft, next: e.target.value })} /></Field>
          <div className="row"><button className="btn" onClick={() => { const t = draftToText(draft); setText(t); setMode('text'); onPatch({ summary: { ...(session.summary ?? {}), draft } }); }}>Mettre en forme</button></div>
        </div>
      )}

      {mode === 'text' && (
        <div className="stack">
          <textarea className="input" style={{ minHeight: 300 }} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button className="btn success" onClick={async () => {
              onPatch({ reportStatus: 'valide', summary: { ...(session.summary ?? {}), draft: draft ?? undefined, text, validatedAt: new Date().toISOString() } });
              await vault.audit('compte_rendu_valide', 'sessions', session.id);
              setMode('view'); toast('Compte rendu validé et intégré au dossier');
            }}><Check size={16} /> Valider le compte rendu</button>
            <button className="btn ghost" onClick={() => setMode(draft ? 'draft' : 'view')}>Retour</button>
          </div>
        </div>
      )}

      {mode === 'view' && (session.summary?.text ? (
        <><Md text={session.summary.text} /><div><button className="btn ghost sm" onClick={() => { setText(session.summary!.text!); setMode('text'); }}>Modifier</button></div></>
      ) : <p className="small muted">Aucun compte rendu. Structurez vos notes, avec ou sans IA, puis validez.</p>)}
    </section>
  );
}
