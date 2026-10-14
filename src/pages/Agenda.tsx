import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, FilePlus, MessageCircle, Wand2 } from 'lucide-react';
import { vault, useCollection } from '../lib/store';
import type { Appointment } from '../lib/types';
import { fmtTime, fmtDay, fmtDateTime, toInputDT, fromInputDT, dayKey, startOfWeek, addDays, fmtDate } from '../lib/dates';
import { findConflicts, youthName } from '../lib/alerts';
import { getSettings } from '../lib/defaults';
import { Field, Modal, Pills, Badge, Empty, toast, APPT_STATUS, SESSION_TYPES, typeLabel } from '../components/ui';
import { newSession } from './QuickCreate';
import { WhatsAppComposer } from './Messages';

const REMINDER_OPTS: [number, string][] = [[10, '10 min'], [30, '30 min'], [60, '1 h'], [180, '3 h'], [1440, '1 jour'], [2880, '2 jours']];

export function prepareSessionSheet(youthId: string) {
  const goals = vault.all('goals').filter((g) => g.youthId === youthId && g.status === 'en_cours');
  const actions = vault.all('actions').filter((a) => a.youthId === youthId && (a.status === 'a_faire' || a.status === 'en_cours'));
  const last = vault.all('sessions').filter((s) => s.youthId === youthId).sort((a, b) => b.date.localeCompare(a.date))[0];
  const lines = ['## Fiche de séance (préparée automatiquement, à relire)'];
  if (last) lines.push(`Dernière rencontre : ${fmtDate(last.date)} — ${last.theme || typeLabel(last.type)}`, last.summary?.draft?.next ? `Proposition notée : ${last.summary.draft.next}` : '');
  if (goals.length) lines.push('## Objectifs à faire le point', ...goals.map((g) => `- ${g.title}${g.lastEvaluated ? ` (évalué le ${fmtDate(g.lastEvaluated)})` : ' (jamais évalué)'}`));
  if (actions.length) lines.push('## Actions à vérifier', ...actions.map((a) => `- ${a.title} (${a.owner === 'jeune' ? 'jeune' : 'moi'})`));
  if (last?.summary?.draft?.toDeepen?.length) lines.push('## Points à approfondir', ...last.summary.draft.toDeepen.map((x) => `- ${x}`));
  return lines.filter(Boolean).join('\n');
}

export function AppointmentForm({ youthId, appt, initialStart, subject, onClose }: { youthId?: string; appt?: Appointment; initialStart?: string; subject?: string; onClose: () => void }) {
  const youth = vault.all('youth');
  const defStart = initialStart ? new Date(new Date(initialStart).setUTCHours(10, 0, 0, 0)) : new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 86_400_000);
  const [v, setV] = useState<Partial<Appointment>>(appt ?? {
    youthId: youthId ?? youth[0]?.id, start: defStart.toISOString(), end: new Date(defStart.getTime() + 3_600_000).toISOString(),
    mode: 'presentiel', status: 'planifie', reminders: getSettings().defaultReminders, subject: subject ?? '',
  });
  const conflicts = v.start && v.end ? findConflicts({ id: v.id ?? '', start: v.start, end: v.end }, vault.all('appointments')) : [];
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.youthId) return;
    if (v.end! <= v.start!) return toast('L’heure de fin doit suivre l’heure de début', true);
    await vault.put('appointments', { ...v, notifiedAt: appt && appt.start !== v.start ? [] : v.notifiedAt } as Appointment);
    toast('Rendez-vous enregistré');
    onClose();
  };
  const setStart = (iso: string) => {
    const dur = new Date(v.end!).getTime() - new Date(v.start!).getTime();
    setV({ ...v, start: iso, end: new Date(new Date(iso).getTime() + (dur > 0 ? dur : 3_600_000)).toISOString() });
  };
  return (
    <Modal title={appt ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="grid g2">
          <Field label="Jeune"><select className="input" required value={v.youthId} onChange={(e) => setV({ ...v, youthId: e.target.value })}>{youth.map((y) => <option key={y.id} value={y.id}>{youthName(y)}</option>)}</select></Field>
          <Field label="Statut"><select className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Appointment['status'] })}>{Object.entries(APPT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Début"><input className="input" type="datetime-local" required value={toInputDT(v.start)} onChange={(e) => setStart(fromInputDT(e.target.value))} /></Field>
          <Field label="Fin"><input className="input" type="datetime-local" required value={toInputDT(v.end)} onChange={(e) => setV({ ...v, end: fromInputDT(e.target.value) })} /></Field>
          <Field label="Mode"><select className="input" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as Appointment['mode'] })}>{SESSION_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Lieu"><input className="input" value={v.place ?? ''} onChange={(e) => setV({ ...v, place: e.target.value })} /></Field>
        </div>
        {conflicts.length > 0 && (
          <div className="alert attention small"><AlertTriangle size={16} color="var(--amber)" /><span>Conflit horaire avec : {conflicts.map((c) => `${youthName(vault.get('youth', c.youthId))} (${fmtTime(c.start)}–${fmtTime(c.end)})`).join(', ')}</span></div>
        )}
        <Field label="Sujet prévu"><input className="input" value={v.subject ?? ''} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
        <Field label="Notes préparatoires">
          <textarea className="input" style={{ minHeight: 120 }} value={v.prepNotes ?? ''} onChange={(e) => setV({ ...v, prepNotes: e.target.value })} />
        </Field>
        <div><button type="button" className="btn ghost sm" disabled={!v.youthId} onClick={() => setV({ ...v, prepNotes: `${v.prepNotes ? `${v.prepNotes}\n\n` : ''}${prepareSessionSheet(v.youthId!)}` })}><Wand2 size={14} /> Préparer la fiche de séance</button></div>
        <div className="field">
          <span>Rappels</span>
          <div className="row wrap">{REMINDER_OPTS.map(([m, l]) => (
            <label key={m} className="check small"><input type="checkbox" checked={(v.reminders ?? []).includes(m)} onChange={(e) => setV({ ...v, reminders: e.target.checked ? [...(v.reminders ?? []), m] : (v.reminders ?? []).filter((x) => x !== m) })} />{l} avant</label>
          ))}</div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {appt && <button type="button" className="btn danger" onClick={async () => { await vault.remove('appointments', appt.id); onClose(); }}>Supprimer</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button className="btn">{conflicts.length ? 'Enregistrer malgré le conflit' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ApptDetail({ a, onClose, onEdit }: { a: Appointment; onClose: () => void; onEdit: () => void }) {
  const y = vault.get('youth', a.youthId);
  const nav = useNavigate();
  const [wa, setWa] = useState(false);
  const setStatus = (status: Appointment['status']) => vault.put('appointments', { id: a.id, status });
  return (
    <Modal title={youthName(y)} onClose={onClose}>
      <div className="stack">
        <div className="row wrap"><Badge map={APPT_STATUS} v={a.status} /><span className="small muted">{fmtDateTime(a.start)} – {fmtTime(a.end)} · {typeLabel(a.mode)}{a.place ? ` · ${a.place}` : ''}</span></div>
        {a.subject && <div><b>Sujet :</b> {a.subject}</div>}
        {a.prepNotes && <div className="quote small pre" style={{ fontFamily: 'inherit' }}>{a.prepNotes}</div>}
        <div className="row wrap">
          {a.status === 'planifie' && <button className="btn secondary sm" onClick={() => setStatus('confirme')}>Confirmé</button>}
          <button className="btn sm" onClick={async () => { await setStatus('effectue'); const s = a.sessionId ? vault.get('sessions', a.sessionId) : await newSession(a.youthId, { date: a.start, type: a.mode, theme: a.subject ?? '', notes: a.prepNotes ? `${a.prepNotes}\n\n## Notes de la rencontre\n` : '' }); if (!a.sessionId && s) await vault.put('appointments', { id: a.id, sessionId: s.id }); nav(`/rencontres/${s!.id}`); }}><FilePlus size={14} /> Effectué → compte rendu</button>
          <button className="btn ghost sm" onClick={onEdit}>Reprogrammer / modifier</button>
          <button className="btn ghost sm" onClick={() => setStatus('annule')}>Annuler le RDV</button>
          {y && <button className="btn wa sm" onClick={() => setWa(true)}><MessageCircle size={14} /> Relancer</button>}
        </div>
      </div>
      {wa && y && <WhatsAppComposer youth={y} appointment={a} onClose={() => setWa(false)} />}
    </Modal>
  );
}

export default function AgendaPage() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'jour' | 'semaine' | 'mois' | 'liste'>(window.innerWidth < 700 ? 'liste' : 'semaine');
  const [cursor, setCursor] = useState(new Date());
  const [form, setForm] = useState<{ appt?: Appointment; start?: string } | null>(params.get('nouveau') ? {} : null);
  useEffect(() => { if (params.get('nouveau')) setForm({}); }, [params]);
  const appts = useCollection('appointments');
  const selected = params.get('rdv') ? vault.get('appointments', params.get('rdv')!) : undefined;
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of [...appts].sort((x, y) => x.start.localeCompare(y.start))) { const k = dayKey(a.start); m.set(k, [...(m.get(k) ?? []), a]); }
    return m;
  }, [appts]);
  const today = dayKey(new Date());
  const move = (n: number) => setCursor((c) => (view === 'mois' ? new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + n, 1)) : addDays(c, view === 'jour' ? n : 7 * n)));
  const open = (a: Appointment) => setParams({ rdv: a.id });
  const label = (a: Appointment) => `${fmtTime(a.start)} ${youthName(vault.get('youth', a.youthId)).split(' ')[0]}`;

  const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const gridStart = startOfWeek(monthStart);
  const weekStart = startOfWeek(cursor);
  const unconfirmed = appts.filter((a) => a.status === 'planifie' && a.start > new Date().toISOString());
  const title = view === 'mois' ? new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthStart)
    : view === 'jour' ? fmtDay(cursor.toISOString()) : view === 'semaine' ? `Semaine du ${fmtDate(weekStart.toISOString())}` : 'Tous les rendez-vous';

  const DayList = ({ k }: { k: string }) => (
    <div className="list">
      {(byDay.get(k) ?? []).map((a) => (
        <button key={a.id} className="list-item" style={{ border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => open(a)}>
          <div style={{ minWidth: 48 }} className="bold">{fmtTime(a.start)}</div>
          <div className="grow"><div className="small bold ellipsis">{youthName(vault.get('youth', a.youthId))}</div><div className="tiny muted ellipsis">{a.subject || typeLabel(a.mode)}</div></div>
          <Badge map={APPT_STATUS} v={a.status} />
        </button>
      ))}
    </div>
  );

  return (
    <div className="stack s18">
      <div className="page-head">
        <div><h1>Agenda</h1><p>{unconfirmed.length} rendez-vous à confirmer</p></div>
        <button className="btn" onClick={() => setForm({})}><Plus size={16} /> Rendez-vous</button>
      </div>
      <div className="row wrap between">
        <Pills value={view} onChange={setView} options={[['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['liste', 'Liste']]} />
        {view !== 'liste' && <div className="row"><button className="btn ghost icon" onClick={() => move(-1)} aria-label="Précédent"><ChevronLeft size={18} /></button><b style={{ minWidth: 180, textAlign: 'center', textTransform: 'capitalize' }}>{title}</b><button className="btn ghost icon" onClick={() => move(1)} aria-label="Suivant"><ChevronRight size={18} /></button><button className="btn ghost sm" onClick={() => setCursor(new Date())}>Aujourd’hui</button></div>}
      </div>

      <div className="card">
        {view === 'mois' && (
          <div className="cal">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => <div key={d} className="dow">{d}</div>)}
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => {
              const k = dayKey(d);
              return (
                <div key={k} className={`cell ${d.getUTCMonth() !== monthStart.getUTCMonth() ? 'other' : ''} ${k === today ? 'today' : ''}`} onClick={() => { setCursor(d); setView('jour'); }}>
                  <span className="num">{d.getUTCDate()}</span>
                  {(byDay.get(k) ?? []).slice(0, 3).map((a) => <span key={a.id} className={`ev ${a.status}`}>{label(a)}</span>)}
                  {(byDay.get(k)?.length ?? 0) > 3 && <span className="tiny muted">+{byDay.get(k)!.length - 3}</span>}
                </div>
              );
            })}
          </div>
        )}
        {view === 'semaine' && (
          <div className="week">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
              const k = dayKey(d);
              return (
                <div key={k} className="stack s6">
                  <button className={`btn ${k === today ? '' : 'ghost'} sm`} onClick={() => { setCursor(d); setView('jour'); }}>{new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)}</button>
                  {(byDay.get(k) ?? []).map((a) => <button key={a.id} className={`ev ${a.status}`} style={{ border: 0, cursor: 'pointer', textAlign: 'left', padding: '6px 8px', fontSize: 12 }} onClick={() => open(a)}>{label(a)}</button>)}
                </div>
              );
            })}
          </div>
        )}
        {view === 'jour' && ((byDay.get(dayKey(cursor))?.length ?? 0) ? <DayList k={dayKey(cursor)} /> : <Empty title="Aucun rendez-vous ce jour"><button className="btn sm mt8" onClick={() => setForm({ start: cursor.toISOString() })}>Planifier</button></Empty>)}
        {view === 'liste' && (
          appts.length === 0 ? <Empty title="Aucun rendez-vous" /> : (
            <div className="stack s18">
              <div className="stack"><h3>À venir</h3>{[...byDay.keys()].filter((k) => k >= today).map((k) => <div key={k} className="stack s6"><div className="small bold" style={{ color: 'var(--primary)' }}>{fmtDay(`${k}T12:00:00Z`)}</div><DayList k={k} /></div>)}</div>
              <div className="stack"><h3>Historique</h3>{[...byDay.keys()].filter((k) => k < today).reverse().slice(0, 30).map((k) => <div key={k} className="stack s6"><div className="small bold muted">{fmtDay(`${k}T12:00:00Z`)}</div><DayList k={k} /></div>)}</div>
            </div>
          )
        )}
      </div>

      {form && <AppointmentForm appt={form.appt} youthId={params.get('jeune') ?? undefined} initialStart={form.start} onClose={() => { setForm(null); if (params.get('nouveau')) setParams({}); }} />}
      {selected && <ApptDetail a={selected} onClose={() => setParams({})} onEdit={() => { setParams({}); setForm({ appt: selected }); }} />}
    </div>
  );
}
