import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, Phone, Mail, MapPin, CalendarPlus, MessageCircle, FilePlus, Pencil, Trash2, Target, BookOpen, Sparkles, ShieldCheck, Download, Search, Contact,
} from 'lucide-react';
import { vault, useCollection, useRecord } from '../lib/store';
import type { Youth, Goal, Kind, TimelineEvent, Consent } from '../lib/types';
import { fmtDate, fmtDateTime, relative, toInputDate, fromInputDate, dayKey } from '../lib/dates';
import { youthName } from '../lib/alerts';
import { Avatar, Badge, Empty, Field, Modal, Tabs, Md, toast, toastError, STATUS_YOUTH, GOAL_STATUS, REPORT, typeLabel, Confirm, Pills } from '../components/ui';
import { aiAvailability, generateSynthesis, manualSynthesis, hasConsent } from '../lib/ai';
import { resolve, loadBible } from '../lib/bible';
import { AppointmentForm } from './Agenda';
import { WhatsAppComposer } from './Messages';
import { BibleSuggestPanel } from './BibleSuggest';
import { newSession } from './QuickCreate';
import { PersonCard } from '../components/PersonCard';
import { ImportContacts } from '../components/ImportContacts';
import { loadSamples, removeSamples, hasSamples } from '../lib/samples';

// ======================= Liste =======================
export function YouthList() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'tous' | Youth['status']>('tous');
  const list = useCollection('youth');
  useCollection('sessions');
  const [edit, setEdit] = useState<Youth | null | 'new'>(params.get('nouveau') ? 'new' : null);
  const [importOpen, setImportOpen] = useState(false);
  const [wa, setWa] = useState<Youth | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (params.get('nouveau')) setEdit('new'); }, [params]);
  useEffect(() => { if (params.get('importer')) setImportOpen(true); }, [params]);
  const filtered = list
    .filter((y) => status === 'tous' || y.status === status)
    .filter((y) => `${y.firstName} ${y.lastName} ${y.zone ?? ''} ${y.phone ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.firstName.localeCompare(b.firstName));
  const count = (s: Youth['status']) => list.filter((y) => y.status === s).length;
  const chips: ['tous' | Youth['status'], string, number][] = [['tous', 'Tous', list.length], ['actif', 'Actifs', count('actif')], ['nouveau', 'Nouveaux', count('nouveau')], ['pause', 'En pause', count('pause')], ['termine', 'Terminés', count('termine')]];
  const samples = async () => { setBusy(true); try { await loadSamples(); toast('8 fiches d’exemple ajoutées'); } catch (e) { toastError(e); } finally { setBusy(false); } };
  return (
    <div className="stack s18">
      <div className="page-head">
        <div><h1>Jeunes accompagnés</h1><p>{list.length} fiche{list.length > 1 ? 's' : ''}{hasSamples() ? ' · dont des exemples' : ''}</p></div>
        <div className="row wrap">
          <button className="btn ghost" onClick={() => setImportOpen(true)}><Contact size={16} /> Importer des contacts</button>
          <button className="btn" onClick={() => setEdit('new')}><Plus size={16} /> Nouveau jeune</button>
        </div>
      </div>
      <div className="search-box" style={{ maxWidth: 'none' }}>
        <Search size={16} />
        <input placeholder="Rechercher par nom, quartier ou téléphone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrer les jeunes" />
      </div>
      <div className="chips">
        {chips.map(([v, l, n]) => <button key={v} className={`chip ${status === v ? 'on' : ''}`} onClick={() => setStatus(v)}>{l} <span className="tiny" style={{ opacity: .8 }}>{n}</span></button>)}
      </div>
      {filtered.length === 0 ? (
        <div className="card">
          <Empty icon={<img className="art" src="img/duo.webp" alt="" />} title={list.length ? 'Aucun résultat' : 'Aucune fiche pour l’instant'}>
            {!list.length && (
              <div className="stack" style={{ alignItems: 'center' }}>
                <span>Créez une fiche, importez vos contacts ou découvrez l’application avec des exemples.</span>
                <div className="row wrap" style={{ justifyContent: 'center' }}>
                  <button className="btn sm" onClick={() => setEdit('new')}><Plus size={14} /> Nouvelle fiche</button>
                  <button className="btn ghost sm" onClick={() => setImportOpen(true)}><Contact size={14} /> Importer</button>
                  <button className="btn secondary sm" disabled={busy} onClick={samples}><Sparkles size={14} /> Charger des exemples</button>
                </div>
              </div>
            )}
          </Empty>
        </div>
      ) : (
        <div className="grid g2 stagger" key={status}>
          {filtered.map((y) => <PersonCard key={y.id} y={y} onWhatsApp={setWa} />)}
        </div>
      )}
      {hasSamples() && <div><button className="btn ghost sm" onClick={async () => { await removeSamples(); toast('Exemples supprimés'); }}><Trash2 size={14} /> Supprimer les fiches d’exemple</button></div>}
      {edit && <YouthForm youth={edit === 'new' ? undefined : edit} onClose={() => { setEdit(null); if (params.get('nouveau')) setParams({}); }} />}
      {importOpen && <ImportContacts onClose={() => { setImportOpen(false); if (params.get('importer')) setParams({}); }} />}
      {wa && <WhatsAppComposer youth={wa} onClose={() => setWa(null)} />}
    </div>
  );
}

// ======================= Formulaire =======================
async function resizePhoto(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const s = 320 / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

export function YouthForm({ youth, onClose }: { youth?: Youth; onClose: () => void }) {
  const nav = useNavigate();
  const [v, setV] = useState<Partial<Youth>>(youth ?? { status: 'nouveau', startDate: new Date().toISOString(), contactMode: 'whatsapp', language: 'Français', allowWhatsApp: true, initial: { items: [] } });
  const set = (k: keyof Youth, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await vault.put('youth', { ...v, initial: v.initial ?? { items: [] } });
      toast(youth ? 'Fiche mise à jour' : 'Fiche créée');
      onClose();
      if (!youth) nav(`/jeunes/${r.id}`);
    } catch (err) { toastError(err); }
  };
  return (
    <Modal title={youth ? 'Modifier la fiche' : 'Nouvelle fiche'} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <p className="small muted">Ne collectez que les informations réellement nécessaires à l’accompagnement.</p>
        <div className="row">
          <Avatar youth={v as Youth} size="lg" />
          <label className="btn ghost sm">Photo (facultative)<input type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && set('photo', await resizePhoto(e.target.files[0]))} /></label>
          {v.photo && <button type="button" className="btn ghost sm" onClick={() => set('photo', undefined)}>Retirer</button>}
        </div>
        <div className="grid g2">
          <Field label="Prénom *"><input className="input" required value={v.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} /></Field>
          <Field label="Nom"><input className="input" value={v.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} /></Field>
          <Field label="Téléphone"><input className="input" type="tel" value={v.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="90 00 00 00" /></Field>
          <Field label="E-mail"><input className="input" type="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Date de naissance (facultative)"><input className="input" type="date" value={toInputDate(v.birthDate)} onChange={(e) => set('birthDate', fromInputDate(e.target.value))} /></Field>
          <Field label="Ville ou zone (si nécessaire)"><input className="input" value={v.zone ?? ''} onChange={(e) => set('zone', e.target.value)} /></Field>
          <Field label="Statut"><select className="input" value={v.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(STATUS_YOUTH).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Début du suivi"><input className="input" type="date" value={toInputDate(v.startDate)} onChange={(e) => set('startDate', fromInputDate(e.target.value))} /></Field>
          <Field label="Accompagnateur responsable"><input className="input" value={v.accompagnateur ?? ''} onChange={(e) => set('accompagnateur', e.target.value)} /></Field>
          <Field label="Mode de contact privilégié">
            <select className="input" value={v.contactMode} onChange={(e) => set('contactMode', e.target.value)}>
              <option value="whatsapp">WhatsApp</option><option value="appel">Appel</option><option value="sms">SMS</option><option value="email">E-mail</option><option value="presentiel">Présentiel</option>
            </select>
          </Field>
          <Field label="Langue préférée"><input className="input" value={v.language ?? ''} onChange={(e) => set('language', e.target.value)} /></Field>
          <Field label="Disponibilités"><input className="input" value={v.availability ?? ''} onChange={(e) => set('availability', e.target.value)} placeholder="Ex. samedi matin, soirs en semaine" /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={v.allowWhatsApp !== false} onChange={(e) => set('allowWhatsApp', e.target.checked)} /> Accepte d’être contacté(e) par WhatsApp</label>
        <label className="check"><input type="checkbox" checked={!!v.isMinor} onChange={(e) => set('isMinor', e.target.checked)} /> Mineur(e) — une autorisation du responsable légal est requise selon le contexte</label>
        {v.isMinor && <Field label="Autorisation parentale (qui, quand, comment)"><input className="input" value={v.guardianConsent ?? ''} onChange={(e) => set('guardianConsent', e.target.value)} /></Field>}
        <Field label="Contact d’urgence (uniquement si nécessaire et autorisé)"><input className="input" value={v.emergencyContact ?? ''} onChange={(e) => set('emergencyContact', e.target.value)} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Annuler</button><button className="btn">Enregistrer</button></div>
      </form>
    </Modal>
  );
}

// ======================= Fiche =======================
type Tab = 'profil' | 'situation' | 'chronologie' | 'rencontres' | 'objectifs' | 'bible' | 'synthese' | 'consentements';

export function YouthDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const y = useRecord('youth', id);
  const [tab, setTab] = useState<Tab>((params.get('onglet') as Tab) || 'profil');
  const [edit, setEdit] = useState(false);
  const [rdv, setRdv] = useState(false);
  const [wa, setWa] = useState(false);
  const [del, setDel] = useState(false);
  const nav = useNavigate();
  const sessions = useCollection('sessions', (s) => s.youthId === id, [id]);
  const goals = useCollection('goals', (g) => g.youthId === id, [id]);
  if (!y) return <Empty title="Fiche introuvable ou non autorisée" />;

  const exportJson = () => {
    const pick = (t: Parameters<typeof vault.all>[0]) => vault.all(t).filter((r) => (r as { youthId?: string }).youthId === y.id);
    const data = { exportéLe: new Date().toISOString(), jeune: y, rencontres: pick('sessions'), notes: pick('notes'), objectifs: pick('goals'), actions: pick('actions'), rendezVous: pick('appointments'), evenements: pick('events'), versets: pick('bible_recs'), messages: pick('messages'), consentements: pick('consents'), transcriptions: vault.all('transcriptions').filter((t) => pick('audios').some((a) => a.id === t.audioId)) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `dossier-${y.firstName}-${dayKey(new Date())}.json`;
    a.click();
    vault.audit('export_dossier', 'youth', y.id);
  };

  const deleteAll = async () => {
    for (const t of ['sessions', 'notes', 'goals', 'actions', 'appointments', 'events', 'bible_recs', 'messages', 'consents', 'audios'] as const) {
      for (const r of vault.all(t).filter((x) => (x as { youthId?: string }).youthId === y.id)) {
        if (t === 'audios') await vault.deleteBlob((r as { blobId: string }).blobId);
        await vault.remove(t, r.id);
      }
    }
    await vault.remove('youth', y.id);
    toast('Dossier supprimé');
    nav('/jeunes');
  };

  return (
    <div className="stack s18">
      <div className="card hero youth-hero">
        {y.photo && <div className="bgph" style={{ backgroundImage: `url(${y.photo})` }} />}
        <div className="row wrap" style={{ gap: 16 }}>
          <Avatar youth={y} size="lg" />
          <div className="grow">
            <div className="row wrap"><h1>{youthName(y)}</h1><span className="badge frost">{STATUS_YOUTH[y.status][0]}</span></div>
            <div className="row wrap small muted mt8" style={{ gap: 16 }}>
              {y.phone && <span className="row" style={{ gap: 4 }}><Phone size={14} />{y.phone}</span>}
              {y.email && <span className="row" style={{ gap: 4 }}><Mail size={14} />{y.email}</span>}
              {y.zone && <span className="row" style={{ gap: 4 }}><MapPin size={14} />{y.zone}</span>}
              <span>Suivi depuis le {fmtDate(y.startDate)}</span>
            </div>
          </div>
          <button className="btn frost icon" onClick={() => setEdit(true)} aria-label="Modifier"><Pencil size={16} /></button>
        </div>
        <div className="row wrap mt16">
          <button className="btn white" onClick={async () => { const s = await newSession(y.id); nav(`/rencontres/${s.id}`); }}><FilePlus size={16} /> Nouvelle rencontre</button>
          <button className="btn frost" onClick={() => setRdv(true)}><CalendarPlus size={16} /> Rendez-vous</button>
          <button className="btn frost" onClick={() => setWa(true)}><MessageCircle size={16} /> WhatsApp</button>
          <Link className="btn frost" to={`/assistant?jeune=${y.id}`}><Sparkles size={16} /> Assistant</Link>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} options={[
        ['profil', 'Profil'], ['situation', 'Situation initiale'], ['chronologie', 'Chronologie'], ['rencontres', 'Rencontres', sessions.length],
        ['objectifs', 'Objectifs', goals.filter((g) => g.status === 'en_cours').length], ['bible', 'Versets'], ['synthese', 'Synthèse'], ['consentements', 'Consentements'],
      ]} />

      {tab === 'profil' && (
        <div className="grid g2">
          <div className="card stack s6">
            <h3>Informations générales</h3>
            {[
              ['Date de naissance', y.birthDate ? fmtDate(y.birthDate) : '—'], ['Mineur(e)', y.isMinor ? `Oui — autorisation : ${y.guardianConsent || 'non renseignée'}` : 'Non'],
              ['Accompagnateur', y.accompagnateur || '—'], ['Contact privilégié', y.contactMode || '—'], ['Langue', y.language || '—'],
              ['Disponibilités', y.availability || '—'], ['WhatsApp', y.allowWhatsApp === false ? 'Refusé' : 'Accepté'], ['Contact d’urgence', y.emergencyContact || '—'],
            ].map(([k, v]) => <div key={k} className="row between small"><span className="muted">{k}</span><span style={{ textAlign: 'right' }}>{v}</span></div>)}
          </div>
          <div className="card stack">
            <h3>Dossier</h3>
            <p className="small muted">Export complet au format JSON (droit d’accès et de portabilité) ou suppression définitive du dossier.</p>
            <div className="row wrap">
              <button className="btn ghost" onClick={exportJson}><Download size={16} /> Exporter le dossier</button>
              <button className="btn danger" onClick={() => setDel(true)}><Trash2 size={16} /> Supprimer le dossier</button>
            </div>
          </div>
        </div>
      )}
      {tab === 'situation' && <InitialSituation youth={y} />}
      {tab === 'chronologie' && <Timeline youth={y} />}
      {tab === 'rencontres' && (
        <div className="card">
          <div className="card-head"><h2>Rencontres</h2><button className="btn sm" onClick={async () => { const s = await newSession(y.id); nav(`/rencontres/${s.id}`); }}><Plus size={14} /> Nouvelle</button></div>
          {sessions.length === 0 ? <Empty title="Aucune rencontre" /> : (
            <div className="list">{[...sessions].sort((a, b) => b.date.localeCompare(a.date)).map((s) => (
              <Link key={s.id} to={`/rencontres/${s.id}`} className="list-item">
                <div className="grow"><div className="bold">{s.theme || 'Rencontre'}</div><div className="small muted">{fmtDateTime(s.date)} · {typeLabel(s.type)}</div></div>
                <Badge map={REPORT} v={s.reportStatus} />
              </Link>
            ))}</div>
          )}
        </div>
      )}
      {tab === 'objectifs' && <Goals youth={y} />}
      {tab === 'bible' && <YouthVerses youth={y} />}
      {tab === 'synthese' && <Synthesis youth={y} />}
      {tab === 'consentements' && <Consents youth={y} />}

      {edit && <YouthForm youth={y} onClose={() => setEdit(false)} />}
      {rdv && <AppointmentForm youthId={y.id} onClose={() => setRdv(false)} />}
      {wa && <WhatsAppComposer youth={y} onClose={() => setWa(false)} />}
      {del && <Confirm danger yes="Supprimer définitivement" text={<>Le dossier de <b>{youthName(y)}</b>, ses rencontres, notes, audios et actions seront supprimés (et la suppression synchronisée). Pensez à exporter le dossier avant si nécessaire.</>} onYes={deleteAll} onClose={() => setDel(false)} />}
    </div>
  );
}

// ---------- Situation initiale ----------
function InitialSituation({ youth }: { youth: Youth }) {
  const [v, setV] = useState(youth.initial ?? { items: [] });
  const [kind, setKind] = useState<Kind>('fait');
  const [text, setText] = useState('');
  useEffect(() => { setV(youth.initial ?? { items: [] }); }, [youth.id]);
  const save = async (patch: Partial<Youth['initial']>) => {
    const n = { ...v, ...patch };
    setV(n);
    await vault.put('youth', { id: youth.id, initial: n });
  };
  const F = ({ k, label, hint }: { k: keyof Youth['initial']; label: string; hint?: string }) => (
    <Field label={label} hint={hint}>
      <textarea className="input" style={{ minHeight: 70 }} defaultValue={(v[k] as string) ?? ''} onBlur={(e) => e.target.value !== (v[k] ?? '') && save({ [k]: e.target.value })} />
    </Field>
  );
  const labels: Record<Kind, string> = { fait: 'Fait rapporté par le jeune', observation: 'Observation de l’accompagnateur', hypothese: 'Hypothèse à vérifier' };
  return (
    <div className="grid g2">
      <div className="card stack">
        <h3>Première rencontre</h3>
        <F k="context" label="Contexte de la première rencontre" />
        <F k="expectations" label="Attentes exprimées par le jeune" />
        <F k="needs" label="Besoins prioritaires" />
        <F k="personalGoals" label="Objectifs personnels" />
        <F k="spiritualGoals" label="Objectifs spirituels" hint="Seulement s’il souhaite les aborder." />
        <F k="schoolWork" label="Préoccupations scolaires ou professionnelles" hint="S’il le souhaite." />
        <F k="strengths" label="Forces et ressources" />
        <F k="specialPoints" label="Points nécessitant un accompagnement particulier" />
        <F k="firstActions" label="Premières pistes d’action convenues ensemble" />
        <p className="tiny faint">Enregistrement automatique à la sortie de chaque champ.</p>
      </div>
      <div className="card stack">
        <h3>Faits, observations, hypothèses</h3>
        <p className="small muted">Distinguez clairement ce que le jeune a dit, ce que vous avez observé, et ce qui reste à vérifier.</p>
        <Pills value={kind} onChange={setKind} options={[['fait', 'Fait rapporté'], ['observation', 'Observation'], ['hypothese', 'Hypothèse']]} />
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { save({ items: [...v.items, { kind, text: text.trim() }] }); setText(''); } }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={labels[kind]} />
          <button className="btn icon" aria-label="Ajouter"><Plus size={16} /></button>
        </form>
        <div className="list">
          {v.items.map((it, i) => (
            <div key={i} className={`list-item kind-${it.kind}`}>
              <div className="grow"><div className="tiny muted">{labels[it.kind]}</div><div className="small">{it.text}</div></div>
              <button className="btn ghost sm icon" aria-label="Retirer" onClick={() => save({ items: v.items.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Chronologie ----------
const EVENT_LABELS: Record<TimelineEvent['kind'], string> = {
  appel: 'Appel', relance: 'Relance', retour: 'Retour du jeune', bilan_intermediaire: 'Bilan intermédiaire', bilan_final: 'Bilan final', progres: 'Point de progression', difficulte: 'Difficulté persistante', autre: 'Échange important',
};
function Timeline({ youth }: { youth: Youth }) {
  const [add, setAdd] = useState(false);
  const [filter, setFilter] = useState('tout');
  const items = useMemo(() => {
    const out: { date: string; kind: string; title: string; text?: string; link?: string }[] = [];
    out.push({ date: youth.startDate, kind: 'debut', title: 'Début de l’accompagnement', text: youth.initial?.context });
    for (const s of vault.all('sessions').filter((x) => x.youthId === youth.id)) {
      out.push({ date: s.date, kind: 'rencontre', title: `${typeLabel(s.type)} — ${s.theme || 'Rencontre'}`, link: `/rencontres/${s.id}` });
      if (s.summary?.validatedAt) out.push({ date: s.summary.validatedAt, kind: 'compte_rendu', title: 'Compte rendu validé', link: `/rencontres/${s.id}` });
    }
    for (const a of vault.all('appointments').filter((x) => x.youthId === youth.id)) out.push({ date: a.start, kind: 'rdv', title: `Rendez-vous ${a.status === 'effectue' ? 'effectué' : a.status}`, text: a.subject, link: `/agenda?rdv=${a.id}` });
    for (const a of vault.all('actions').filter((x) => x.youthId === youth.id)) {
      out.push({ date: a.createdAt, kind: 'action', title: `Action décidée : ${a.title}`, link: '/actions' });
      if (a.status === 'terminee') out.push({ date: a.updatedAt, kind: 'action', title: `Action réalisée : ${a.title}`, text: a.result, link: '/actions' });
    }
    for (const g of vault.all('goals').filter((x) => x.youthId === youth.id)) {
      out.push({ date: g.createdAt, kind: 'objectif', title: `Objectif fixé : ${g.title}` });
      if (g.status === 'atteint') out.push({ date: g.lastEvaluated ?? g.updatedAt, kind: 'objectif', title: `Objectif atteint : ${g.title}` });
      for (const o of g.observations) out.push({ date: o.date, kind: 'progres', title: `Progression — ${g.title}`, text: o.text });
    }
    for (const b of vault.all('bible_recs').filter((x) => x.youthId === youth.id && x.status !== 'rejete' && x.status !== 'propose')) out.push({ date: b.updatedAt, kind: 'verset', title: `Verset ${b.status === 'etudie' ? 'étudié' : 'recommandé'} : ${b.ref}`, text: b.comment });
    for (const m of vault.all('messages').filter((x) => x.youthId === youth.id)) out.push({ date: m.createdAt, kind: 'relance', title: `Message WhatsApp — ${m.status === 'lien_ouvert' ? 'préparé (WhatsApp ouvert)' : m.status}`, text: m.body, link: '/relances' });
    for (const e of vault.all('events').filter((x) => x.youthId === youth.id)) out.push({ date: e.date, kind: e.kind, title: `${EVENT_LABELS[e.kind]} : ${e.title}`, text: e.text });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [youth, vault.tick]);
  const kinds = [['tout', 'Tout'], ['rencontre', 'Rencontres'], ['action', 'Actions'], ['objectif', 'Objectifs'], ['verset', 'Versets'], ['relance', 'Relances']] as [string, string][];
  const shown = filter === 'tout' ? items : items.filter((i) => i.kind === filter);
  return (
    <div className="card">
      <div className="card-head"><h2>Chronologie</h2><button className="btn sm" onClick={() => setAdd(true)}><Plus size={14} /> Ajouter un élément</button></div>
      <div className="mt8" style={{ marginBottom: 16 }}><Pills value={filter} onChange={setFilter} options={kinds} /></div>
      <div className="timeline">
        {shown.map((i, k) => (
          <div key={k} className="tl-item done">
            <div className="when">{fmtDate(i.date)}</div>
            <div className="tl-card">
              {i.link ? <Link to={i.link} className="bold">{i.title}</Link> : <span className="bold">{i.title}</span>}
              {i.text && <div className="small muted pre">{i.text}</div>}
            </div>
          </div>
        ))}
      </div>
      {add && <EventForm youthId={youth.id} onClose={() => setAdd(false)} />}
    </div>
  );
}

function EventForm({ youthId, onClose }: { youthId: string; onClose: () => void }) {
  const [v, setV] = useState<Partial<TimelineEvent>>({ kind: 'appel', date: new Date().toISOString(), title: '' });
  return (
    <Modal title="Ajouter à la chronologie" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); await vault.put('events', { ...v, youthId } as TimelineEvent); onClose(); }}>
        <Field label="Type"><select className="input" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as TimelineEvent['kind'] })}>{Object.entries(EVENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Date"><input className="input" type="date" value={toInputDate(v.date)} onChange={(e) => setV({ ...v, date: fromInputDate(e.target.value) })} /></Field>
        <Field label="Intitulé"><input className="input" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Détails"><textarea className="input" value={v.text ?? ''} onChange={(e) => setV({ ...v, text: e.target.value })} /></Field>
        <button className="btn">Enregistrer</button>
      </form>
    </Modal>
  );
}

// ---------- Objectifs ----------
function Goals({ youth }: { youth: Youth }) {
  const goals = useCollection('goals', (g) => g.youthId === youth.id, [youth.id]);
  const [edit, setEdit] = useState<Goal | 'new' | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});
  return (
    <div className="stack">
      <div className="row between"><p className="small muted">Objectifs définis avec le jeune. Aucune note chiffrée de maturité n’est calculée.</p><button className="btn" onClick={() => setEdit('new')}><Target size={16} /> Nouvel objectif</button></div>
      {goals.length === 0 && <div className="card"><Empty title="Aucun objectif" /></div>}
      <div className="grid g2">
        {goals.map((g) => {
          const acts = vault.all('actions').filter((a) => a.youthId === youth.id && (a.description ?? '').includes(g.title));
          return (
            <div key={g.id} className="card stack s6">
              <div className="row between"><h3>{g.title}</h3><Badge map={GOAL_STATUS} v={g.status} /></div>
              {g.description && <p className="small">{g.description}</p>}
              <div className="tiny muted">Créé le {fmtDate(g.createdAt)}{g.dueDate ? ` · échéance ${fmtDate(g.dueDate)}` : ''} · dernière évaluation : {g.lastEvaluated ? fmtDate(g.lastEvaluated) : 'jamais'}</div>
              {g.plannedActions && <div className="small"><b>Actions prévues :</b> {g.plannedActions}</div>}
              {acts.length > 0 && <div className="tiny muted">{acts.length} action(s) liée(s)</div>}
              {g.youthComment && <div className="quote small">« {g.youthComment} » — commentaire du jeune</div>}
              {g.observations.length > 0 && (
                <div className="timeline mt8">{g.observations.slice().reverse().map((o, i) => <div key={i} className="tl-item done"><div className="when">{fmtDate(o.date)}</div><div className="small">{o.text}</div></div>)}</div>
              )}
              <form className="row" onSubmit={async (e) => { e.preventDefault(); const t = obs[g.id]?.trim(); if (!t) return; const now = new Date().toISOString(); await vault.put('goals', { id: g.id, observations: [...g.observations, { date: now, text: t }], lastEvaluated: now }); setObs({ ...obs, [g.id]: '' }); }}>
                <input className="input" placeholder="Observation de progression…" value={obs[g.id] ?? ''} onChange={(e) => setObs({ ...obs, [g.id]: e.target.value })} />
                <button className="btn sm">Ajouter</button>
              </form>
              <div className="row"><button className="btn ghost sm" onClick={() => setEdit(g)}><Pencil size={14} /> Modifier</button>{g.status === 'en_cours' && <button className="btn secondary sm" onClick={() => vault.put('goals', { id: g.id, status: 'atteint', lastEvaluated: new Date().toISOString() })}>Marquer atteint</button>}</div>
            </div>
          );
        })}
      </div>
      {edit && <GoalForm youthId={youth.id} goal={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function GoalForm({ youthId, goal, onClose }: { youthId: string; goal?: Goal; onClose: () => void }) {
  const [v, setV] = useState<Partial<Goal>>(goal ?? { status: 'en_cours', observations: [], title: '' });
  return (
    <Modal title={goal ? 'Modifier l’objectif' : 'Nouvel objectif'} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); await vault.put('goals', { ...v, youthId, observations: v.observations ?? [] } as Goal); onClose(); }}>
        <Field label="Intitulé"><input className="input" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Description (mesurable ou descriptive)"><textarea className="input" value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <div className="grid g2">
          <Field label="Échéance (facultative)"><input className="input" type="date" value={toInputDate(v.dueDate)} onChange={(e) => setV({ ...v, dueDate: fromInputDate(e.target.value) })} /></Field>
          <Field label="Statut"><select className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Goal['status'] })}>{Object.entries(GOAL_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <Field label="Actions prévues"><textarea className="input" value={v.plannedActions ?? ''} onChange={(e) => setV({ ...v, plannedActions: e.target.value })} /></Field>
        <Field label="Commentaire du jeune (si pertinent)"><textarea className="input" value={v.youthComment ?? ''} onChange={(e) => setV({ ...v, youthComment: e.target.value })} /></Field>
        <button className="btn">Enregistrer</button>
      </form>
    </Modal>
  );
}

// ---------- Versets ----------
function YouthVerses({ youth }: { youth: Youth }) {
  const recs = useCollection('bible_recs', (r) => r.youthId === youth.id, [youth.id]);
  const [ready, setReady] = useState(false);
  useEffect(() => { loadBible().then(() => setReady(true)).catch(toastError); }, []);
  const sessions = vault.all('sessions').filter((s) => s.youthId === youth.id && s.reportStatus === 'valide');
  const ctx = [youth.initial?.needs, ...sessions.map((s) => s.summary?.text ?? s.theme)].filter(Boolean).join('\n');
  const STATUS: Record<string, [string, string]> = { propose: ['Proposé', 'grey'], accepte: ['Retenu', 'blue'], etudie: ['Étudié ensemble', 'green'], rejete: ['Écarté', 'grey'] };
  return (
    <div className="grid g2">
      <div className="card stack">
        <h2>Passages enregistrés</h2>
        {recs.filter((r) => r.status !== 'rejete').length === 0 && <Empty icon={<BookOpen size={32} />} title="Aucun passage" />}
        {recs.filter((r) => r.status !== 'rejete').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((r) => {
          const p = ready ? resolve(r.ref) : null;
          return (
            <div key={r.id} className="stack s6" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <div className="row between"><b>{r.ref}</b><Badge map={STATUS} v={r.status} /></div>
              {p && <div className="quote small">{p.text}</div>}
              {r.theme && <div className="tiny muted">Thème : {r.theme} · source : {r.source}</div>}
              {r.question && <div className="small"><b>Question :</b> {r.question}</div>}
              {r.comment && <div className="small"><b>Commentaire :</b> {r.comment}</div>}
              <div className="row">
                {r.status !== 'etudie' && <button className="btn secondary sm" onClick={() => vault.put('bible_recs', { id: r.id, status: 'etudie' })}>Marquer étudié</button>}
                <button className="btn ghost sm" onClick={() => vault.put('bible_recs', { id: r.id, status: 'rejete' })}>Retirer</button>
              </div>
            </div>
          );
        })}
      </div>
      <BibleSuggestPanel youth={youth} context={ctx} />
    </div>
  );
}

// ---------- Synthèse ----------
function Synthesis({ youth }: { youth: Youth }) {
  const [text, setText] = useState(youth.synthesis?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!youth.synthesis?.text);
  const av = aiAvailability(youth);
  const gen = async (ai: boolean) => {
    setBusy(true);
    try {
      if (ai) { const r = await generateSynthesis(youth); setText(r.text); await vault.put('youth', { id: youth.id, synthesis: { text: r.text, generatedAt: new Date().toISOString(), source: r.provider } }); }
      else { const t = manualSynthesis(youth); setText(t); await vault.put('youth', { id: youth.id, synthesis: { text: t, generatedAt: new Date().toISOString(), source: 'données du dossier (sans IA)' } }); }
      setEditing(true);
      toast('Brouillon de synthèse prêt : relisez-le puis validez.');
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="card stack">
      <div className="card-head">
        <div><h2>Synthèse du parcours</h2>{youth.synthesis?.generatedAt && <p className="tiny muted">Générée le {fmtDate(youth.synthesis.generatedAt)} ({youth.synthesis.source}) · {youth.synthesis.validatedAt ? `validée le ${fmtDate(youth.synthesis.validatedAt)}` : 'non validée'}</p>}</div>
        <div className="row wrap">
          <button className="btn ghost sm" disabled={busy} onClick={() => gen(false)}>Assembler depuis le dossier</button>
          <button className="btn secondary sm" disabled={busy || !av.ok} title={av.reason} onClick={() => gen(true)}><Sparkles size={14} /> {busy ? 'Génération…' : 'Rédiger avec l’IA'}</button>
        </div>
      </div>
      {!av.ok && <p className="tiny faint">{av.reason}</p>}
      {editing ? (
        <>
          <textarea className="input" style={{ minHeight: 320 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Situation initiale, sujets abordés, objectifs, actions réalisées, progrès, prochaines étapes…" />
          <div className="row"><button className="btn" onClick={async () => { await vault.put('youth', { id: youth.id, synthesis: { ...(youth.synthesis ?? {}), text, validatedAt: new Date().toISOString() } }); setEditing(false); toast('Synthèse validée'); }}>Valider la synthèse</button></div>
        </>
      ) : (
        <><Md text={text} /><div><button className="btn ghost sm" onClick={() => setEditing(true)}><Pencil size={14} /> Modifier</button></div></>
      )}
    </div>
  );
}

// ---------- Consentements ----------
const CONSENT_TYPES: [Consent['type'], string, string][] = [
  ['enregistrement_audio', 'Enregistrement audio des échanges', 'Requis avant toute note vocale enregistrant le jeune.'],
  ['traitement_ia', 'Traitement automatisé (IA, transcription)', 'Requis avant tout envoi à un fournisseur d’IA ou de transcription. Données pseudonymisées et minimisées.'],
  ['messages_whatsapp', 'Messages WhatsApp programmés', 'Requis pour les envois automatiques par l’API WhatsApp Business.'],
  ['autorisation_parentale', 'Autorisation parentale', 'Pour les mineurs, selon le contexte légal.'],
  ['conservation_donnees', 'Conservation des données', 'Accord sur la conservation du dossier pendant l’accompagnement.'],
];
function Consents({ youth }: { youth: Youth }) {
  const list = useCollection('consents', (c) => c.youthId === youth.id, [youth.id]);
  const [by, setBy] = useState('Le jeune, oralement');
  const record = async (type: Consent['type'], granted: boolean) => {
    await vault.put('consents', { youthId: youth.id, type, granted, by, date: new Date().toISOString() });
    toast(granted ? 'Consentement enregistré' : 'Retrait enregistré');
  };
  return (
    <div className="card stack">
      <div className="row"><ShieldCheck size={18} color="var(--green)" /><h2>Consentements</h2></div>
      <p className="small muted">Chaque accord ou retrait est horodaté et conservé. Le dernier enregistrement fait foi.</p>
      <Field label="Recueilli auprès de / par"><input className="input" value={by} onChange={(e) => setBy(e.target.value)} /></Field>
      {CONSENT_TYPES.map(([t, l, h]) => {
        const history = list.filter((c) => c.type === t).sort((a, b) => b.date.localeCompare(a.date));
        const on = hasConsent(youth.id, t);
        return (
          <div key={t} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="row"><b className="small">{l}</b><span className={`badge ${on ? 'green' : 'grey'}`}>{on ? 'Accordé' : 'Non accordé'}</span></div>
              <div className="tiny muted">{h}</div>
              {history[0] && <div className="tiny faint">Dernier : {history[0].granted ? 'accord' : 'retrait'} le {fmtDateTime(history[0].date)} — {history[0].by}</div>}
            </div>
            {on ? <button className="btn ghost sm" onClick={() => record(t, false)}>Retirer</button> : <button className="btn sm" onClick={() => record(t, true)}>Enregistrer l’accord</button>}
          </div>
        );
      })}
    </div>
  );
}
