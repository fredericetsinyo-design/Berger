import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Clock, X, Pencil, Plus, Info } from 'lucide-react';
import { vault, useCollection } from '../lib/store';
import type { Youth, Appointment, ActionItem, Template } from '../lib/types';
import { fillTemplate, openWhatsApp, scheduleApiMessage, cancelMessage, canMessage, apiConfigured, STATUS_LABEL } from '../lib/whatsapp';
import { fmtDateTime, toInputDT, fromInputDT } from '../lib/dates';
import { youthName } from '../lib/alerts';
import { Field, Modal, Empty, Tabs, toast, toastError } from '../components/ui';

export function WhatsAppComposer({ youth, appointment, action, onClose }: { youth: Youth; appointment?: Appointment; action?: ActionItem; onClose: () => void }) {
  const templates = vault.all('templates');
  const [tpl, setTpl] = useState<Template | undefined>(appointment ? templates.find((t) => t.name.startsWith('Rappel')) : action ? templates.find((t) => t.name.startsWith('Relance')) : templates[0]);
  const [body, setBody] = useState(tpl ? fillTemplate(tpl.body, { youth, appointment, action }) : '');
  const [when, setWhen] = useState(appointment ? new Date(new Date(appointment.start).getTime() - 86_400_000).toISOString() : new Date(Date.now() + 3_600_000).toISOString());
  const [validated, setValidated] = useState(false);
  const ok = canMessage(youth);
  const api = apiConfigured();
  return (
    <Modal title={`Message à ${youth.firstName}`} onClose={onClose}>
      {!ok.ok ? <p className="muted">{ok.reason}</p> : (
        <div className="stack">
          <Field label="Modèle">
            <select className="input" value={tpl?.id ?? ''} onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); setTpl(t); if (t) setBody(fillTemplate(t.body, { youth, appointment, action })); setValidated(false); }}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Message (modifiable)"><textarea className="input" value={body} onChange={(e) => { setBody(e.target.value); setValidated(false); }} /></Field>
          <label className="check small"><input type="checkbox" checked={validated} onChange={(e) => setValidated(e.target.checked)} /> J’ai relu et je valide ce message.</label>
          <div className="row wrap">
            <button className="btn wa" disabled={!validated || !body.trim()} onClick={async () => { try { await openWhatsApp(youth, body, tpl?.id); toast('WhatsApp ouvert. Envoyez le message depuis WhatsApp.'); onClose(); } catch (e) { toastError(e); } }}><MessageCircle size={16} /> Ouvrir dans WhatsApp</button>
          </div>
          <p className="tiny faint">L’application ouvre WhatsApp avec le message prérempli ; elle ne peut pas savoir s’il a été envoyé. Le statut enregistré sera « WhatsApp ouvert ».</p>
          <hr className="sep" />
          <div className="stack s6">
            <b className="small">Envoi programmé (WhatsApp Business API)</b>
            {api ? (
              <>
                <Field label="Envoyer le"><input className="input" type="datetime-local" value={toInputDT(when)} onChange={(e) => setWhen(fromInputDT(e.target.value))} /></Field>
                <button className="btn secondary" disabled={!validated} onClick={async () => { try { await scheduleApiMessage(youth, body, when); toast('Message placé en file d’attente'); onClose(); } catch (e) { toastError(e); } }}><Clock size={16} /> Programmer</button>
              </>
            ) : <p className="tiny muted">Non configuré. Nécessite un serveur Supabase, un compte WhatsApp Business Platform et le consentement du jeune (voir docs/CONFIGURATION.md).</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function MessagesPage() {
  const [tab, setTab] = useState<'historique' | 'file' | 'modeles'>('historique');
  const messages = useCollection('messages');
  const templates = useCollection('templates');
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  const [compose, setCompose] = useState<Youth | null>(null);
  const [pick, setPick] = useState('');
  const youth = vault.all('youth');
  const queue = messages.filter((m) => m.channel === 'whatsapp_api').sort((a, b) => (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? ''));
  const history = [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="stack s18">
      <div className="page-head">
        <div><h1>Relances</h1><p>Messages WhatsApp préparés et programmés</p></div>
        <div className="row">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 200 }}><option value="">Choisir un jeune…</option>{youth.map((y) => <option key={y.id} value={y.id}>{youthName(y)}</option>)}</select>
          <button className="btn wa" disabled={!pick} onClick={() => setCompose(vault.get('youth', pick)!)}><MessageCircle size={16} /> Écrire</button>
        </div>
      </div>
      <div className="alert small"><Info size={16} color="var(--blue)" /><span>Aucun message n’est envoyé sans votre validation. En mode lien, l’envoi se fait dans WhatsApp ; l’application ne l’affiche jamais comme « envoyé ».</span></div>
      <Tabs value={tab} onChange={setTab} options={[['historique', 'Historique'], ['file', 'File d’attente', queue.filter((m) => m.status === 'en_file').length], ['modeles', 'Modèles']]} />
      {tab !== 'modeles' && ((tab === 'file' ? queue : history).length === 0 ? <div className="card"><Empty title="Aucun message" /></div> : (
        <div className="list">
          {(tab === 'file' ? queue : history).map((m) => {
            const y = vault.get('youth', m.youthId);
            return (
              <div key={m.id} className="card flat stack s6" style={{ padding: 14 }}>
                <div className="row wrap"><Link to={`/jeunes/${m.youthId}`} className="bold">{youthName(y)}</Link><span className={`badge ${m.status === 'annule' ? 'grey' : m.status === 'echec' ? 'red' : m.status === 'en_file' ? 'amber' : 'blue'}`}>{STATUS_LABEL[m.status]}</span><span className="grow" /><span className="tiny muted">{m.scheduledAt ? `prévu ${fmtDateTime(m.scheduledAt)}` : fmtDateTime(m.createdAt)}</span></div>
                <div className="small pre">{m.body}</div>
                <details className="tiny muted"><summary>Journal ({m.log.length})</summary>{m.log.map((l, i) => <div key={i}>{fmtDateTime(l.at)} — {STATUS_LABEL[l.status]}{l.detail ? ` : ${l.detail}` : ''}</div>)}</details>
                {m.status === 'en_file' && <div><button className="btn danger sm" onClick={async () => { try { await cancelMessage(m); toast('Envoi annulé'); } catch (e) { toastError(e); } }}><X size={14} /> Annuler l’envoi</button></div>}
              </div>
            );
          })}
        </div>
      ))}
      {tab === 'modeles' && (
        <div className="stack">
          <div><button className="btn" onClick={() => setEdit({ name: '', body: 'Bonjour {prenom}, ' })}><Plus size={16} /> Nouveau modèle</button></div>
          <p className="small muted">Variables : {'{prenom}'}, {'{date}'}, {'{heure}'}, {'{lieu}'}, {'{action}'}</p>
          <div className="grid g2">{templates.map((t) => <div key={t.id} className="card stack s6"><div className="row between"><b>{t.name}</b><button className="btn ghost sm icon" onClick={() => setEdit(t)}><Pencil size={14} /></button></div><p className="small muted">{t.body}</p></div>)}</div>
        </div>
      )}
      {edit && (
        <Modal title="Modèle de message" onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); await vault.put('templates', edit as Template); setEdit(null); }}>
            <Field label="Nom"><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Texte"><textarea className="input" required value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <div className="row"><button className="btn">Enregistrer</button>{edit.id && <button type="button" className="btn danger" onClick={async () => { await vault.remove('templates', edit.id!); setEdit(null); }}>Supprimer</button>}</div>
          </form>
        </Modal>
      )}
      {compose && <WhatsAppComposer youth={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}
