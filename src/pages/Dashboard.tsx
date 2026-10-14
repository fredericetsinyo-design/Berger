import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Info, CalendarCheck, FileText, Mic, CheckCircle2, Clock, Users, MessagesSquare, ListChecks, CalendarDays, Sparkles, Plus, Contact } from 'lucide-react';
import { useVaultTick, vault, usePendingOps } from '../lib/store';
import { computeDashboard, youthName } from '../lib/alerts';
import { getUser } from '../lib/auth';
import { fmtTime, fmtDay, fmtShort, relative, dayKey } from '../lib/dates';
import { Avatar, Empty, typeLabel, toast, toastError } from '../components/ui';
import { PersonTile } from '../components/PersonCard';
import { getSupabaseConfig } from '../lib/supabase';
import { loadSamples } from '../lib/samples';
import type { Youth } from '../lib/types';

/** Compteur animé (respecte « réduire les animations »). */
function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || target === 0) { setV(target); return; }
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => { const k = Math.min(1, (t - t0) / ms); setV(Math.round(target * (1 - (1 - k) ** 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Stat({ value, label, sub, icon, tone, accent, to }: { value: number; label: string; sub: React.ReactNode; icon: React.ReactNode; tone: string; accent?: boolean; to: string }) {
  const v = useCountUp(value);
  return (
    <Link to={to} className={`stat ${accent ? 'accent' : ''} card lift`} style={{ color: 'inherit', padding: 16 }}>
      <span className="ico" style={accent ? undefined : { background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>{icon}</span>
      <b>{v}</b>
      <span className="bold" style={{ color: accent ? '#fff' : 'var(--text)', fontSize: 13 }}>{label}</span>
      <span>{sub}</span>
    </Link>
  );
}

export default function Dashboard() {
  const tick = useVaultTick();
  const ops = usePendingOps();
  const nav = useNavigate();
  const d = useMemo(() => computeDashboard(), [tick]);
  const user = getUser()!;
  const [filter, setFilter] = useState<'tous' | Youth['status']>('tous');
  const [busy, setBusy] = useState(false);
  const hour = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Lome', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const y = (id?: string) => vault.get('youth', id);
  const s = d.stats;
  const allYouth = vault.all('youth');
  const tiles = allYouth.filter((x) => (filter === 'tous' ? x.status !== 'termine' : x.status === filter)).sort((a, b) => Number(!!b.photo) - Number(!!a.photo));

  const dayItems = [
    ...d.day.rdv.map((a) => ({ at: a.start, done: a.status === 'effectue', title: `Rendez-vous — ${youthName(y(a.youthId))}`, sub: `${typeLabel(a.mode)}${a.subject ? ` · ${a.subject}` : ''}`, link: `/agenda?rdv=${a.id}`, who: y(a.youthId) })),
    ...d.day.rappels.map((a) => ({ at: a.reminderAt!, done: false, title: a.title, sub: 'Rappel', link: '/actions', who: y(a.youthId) })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const nextFocus = dayItems.findIndex((i) => i.at >= new Date().toISOString() && !i.done);
  const todo = [...new Map([...d.day.enRetard, ...d.day.prioritaires, ...d.day.aContacter].map((a) => [a.id, a])).values()].slice(0, 5);

  const samples = async () => { setBusy(true); try { await loadSamples(); toast('8 fiches d’exemple ajoutées'); } catch (e) { toastError(e); } finally { setBusy(false); } };

  return (
    <div className="stack s18">
      <div className="row between">
        <div>
          <h1>{hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'}, {user.displayName.split(' ')[0]}</h1>
          <p className="muted" style={{ textTransform: 'capitalize' }}>{fmtDay(new Date().toISOString())}</p>
        </div>
        <div className="avatars hide-mobile">
          {allYouth.filter((x) => x.photo).slice(0, 4).map((x) => <Avatar key={x.id} youth={x} size="sm" />)}
        </div>
      </div>

      <section className="banner">
        <div className="txt">
          <span className="badge frost" style={{ alignSelf: 'flex-start' }}><Sparkles size={12} /> Aujourd’hui</span>
          <h2>Accompagner, écouter,<br />faire grandir.</h2>
          <p style={{ opacity: .9 }} className="small">
            {d.day.rdv.length ? `${d.day.rdv.length} rendez-vous aujourd’hui` : 'Aucun rendez-vous aujourd’hui'} · {todo.length ? `${todo.length} action(s) à traiter` : 'rien d’urgent'}
          </p>
          <div className="row wrap">
            <button className="btn white" onClick={() => nav(allYouth.length ? '/jeunes' : '/jeunes?nouveau=1')}><Plus size={16} /> {allYouth.length ? 'Nouvelle rencontre' : 'Première fiche'}</button>
            <Link to="/agenda" className="btn frost"><CalendarDays size={16} /> Agenda</Link>
          </div>
        </div>
        <div className="pic">
          <img src="img/groupe.webp" alt="" />
          <div className="float"><Users size={14} /> {s.actifs} jeune{s.actifs > 1 ? 's' : ''} en chemin</div>
        </div>
      </section>

      <div className="grid g4 stagger">
        <Stat accent value={s.total} label="Jeunes suivis" sub={`${s.actifs} actifs · ${s.pause} en pause · ${s.nouveaux} nouveaux`} icon={<Users size={18} />} tone="primary" to="/jeunes" />
        <Stat value={s.rencontresSemaine} label="Rencontres (7 j)" sub={`${s.rencontresMois} sur 30 jours`} icon={<MessagesSquare size={18} />} tone="teal" to="/jeunes" />
        <Stat value={s.rdvAVenir} label="Rendez-vous à venir" sub={s.rdvManques ? <b style={{ color: 'var(--red)' }}>{s.rdvManques} à clôturer</b> : 'tout est à jour'} icon={<CalendarDays size={18} />} tone="sky" to="/agenda" />
        <Stat value={s.actionsEnAttente} label="Actions en attente" sub={`${s.relances} relance(s) à faire`} icon={<ListChecks size={18} />} tone="pink" to="/actions" />
      </div>
      <div className="chips">
        <Link to="/jeunes" className="chip"><FileText size={13} /> {s.crAFinaliser} compte(s) rendu(s) à finaliser</Link>
        <Link to="/jeunes" className="chip"><Mic size={13} /> {s.audiosATranscrire} note(s) audio à transcrire</Link>
        <Link to="/reglages?onglet=sync" className="chip"><Clock size={13} /> {getSupabaseConfig() ? `${ops.pending} synchronisation(s) en attente` : 'Données sur cet appareil'}</Link>
        {s.messagesEnFile > 0 && <Link to="/relances" className="chip">{s.messagesEnFile} message(s) en file</Link>}
      </div>

      <section className="stack">
        <div className="row between"><h2>Jeunes en accompagnement</h2><Link to="/jeunes" className="small">Voir tout</Link></div>
        <div className="chips">
          {([['tous', 'Tous'], ['actif', 'Actifs'], ['nouveau', 'Nouveaux'], ['pause', 'En pause']] as const).map(([v, l]) => <button key={v} className={`chip ${filter === v ? 'on' : ''}`} onClick={() => setFilter(v)}>{l}</button>)}
        </div>
        {allYouth.length === 0 ? (
          <div className="card">
            <Empty icon={<img className="art" src="img/mentorat.webp" alt="" />} title="Votre premier accompagnement commence ici">
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                <Link className="btn sm" to="/jeunes?nouveau=1"><Plus size={14} /> Créer une fiche</Link>
                <Link className="btn ghost sm" to="/jeunes?importer=1"><Contact size={14} /> Importer des contacts</Link>
                <button className="btn secondary sm" disabled={busy} onClick={samples}><Sparkles size={14} /> Voir avec des exemples</button>
              </div>
            </Empty>
          </div>
        ) : tiles.length === 0 ? <p className="small muted">Aucun jeune dans cette catégorie.</p> : (
          <div className="hscroll stagger" key={filter}>{tiles.map((x) => <PersonTile key={x.id} y={x} />)}</div>
        )}
      </section>

      <div className="grid dash">
        <section className="day-band" style={{ alignSelf: 'start' }}>
          <div className="row between" style={{ marginBottom: 14, position: 'relative', zIndex: 1 }}>
            <h2>Ma journée</h2>
            <span className="badge frost">{dayItems.length} élément{dayItems.length > 1 ? 's' : ''}</span>
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            {dayItems.length === 0 ? <p className="muted">Aucun rendez-vous ni rappel aujourd’hui.</p> : (
              <div className="timeline stagger">
                {dayItems.map((i, k) => (
                  <div key={k} className={`tl-item ${i.done ? 'done' : ''}`}>
                    <div className="when">{fmtTime(i.at)}</div>
                    <Link to={i.link} className={`tl-card row ${k === nextFocus ? 'focus' : ''}`} style={k === nextFocus ? undefined : { color: 'inherit' }}>
                      {i.who && <Avatar youth={i.who} size="sm" />}
                      <span className="grow"><span className="bold" style={{ display: 'block' }}>{i.title}</span><span className="small" style={{ opacity: .8 }}>{i.sub}</span></span>
                    </Link>
                  </div>
                ))}
              </div>
            )}
            {todo.length > 0 && (
              <div className="stack s6 mt16">
                <div className="small bold" style={{ opacity: .9 }}>À traiter</div>
                {todo.map((a) => (
                  <Link key={a.id} to="/actions" className="tl-card row" style={{ color: '#fff' }}>
                    <CheckCircle2 size={16} />
                    <span className="grow ellipsis">{a.title}{a.youthId ? ` — ${youthName(y(a.youthId))}` : ''}</span>
                    {a.dueDate && <span className="tiny">{relative(a.dueDate)}</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="stack s18">
          <section className="card">
            <div className="card-head"><h2>Alertes</h2><span className="badge">{d.alerts.length}</span></div>
            <p className="tiny faint" style={{ marginTop: -8, marginBottom: 10 }}>Des invitations à vérifier la situation, pas des constats.</p>
            {d.alerts.length === 0 ? <p className="muted small">Rien à signaler.</p> : (
              <div className="list stagger">
                {d.alerts.slice(0, 6).map((a) => (
                  <Link key={a.id} to={a.link} className={`alert ${a.level}`} style={{ color: 'inherit' }}>
                    {a.youthId && y(a.youthId)?.photo ? <Avatar youth={y(a.youthId)} size="sm" /> : a.level === 'attention' ? <AlertCircle size={16} color="var(--amber)" /> : <Info size={16} color="var(--sky)" />}
                    <span className="small">{a.text}</span>
                  </Link>
                ))}
                {d.alerts.length > 6 && <span className="small muted">+ {d.alerts.length - 6} autre(s)</span>}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head"><h2>Prochains rendez-vous</h2><Link to="/agenda">Agenda</Link></div>
            {d.upcoming.length === 0 ? <p className="muted small">Aucun rendez-vous planifié.</p> : (
              <div className="list stagger">
                {d.upcoming.slice(0, 5).map((a) => (
                  <Link key={a.id} to={`/agenda?rdv=${a.id}`} className="list-item">
                    <Avatar youth={y(a.youthId)} />
                    <div className="grow"><div className="bold ellipsis">{youthName(y(a.youthId))}</div><div className="tiny muted ellipsis">{fmtShort(a.start)} · {fmtTime(a.start)} · {a.subject || typeLabel(a.mode)}</div></div>
                    {a.status === 'confirme' ? <CalendarCheck size={16} color="var(--teal)" /> : <span className="badge amber">À confirmer</span>}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {d.day.aValider.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>Comptes rendus à valider</h2></div>
              <div className="list">
                {d.day.aValider.map((s2) => <Link key={s2.id} to={`/rencontres/${s2.id}`} className="list-item"><FileText size={16} /><span className="grow ellipsis">{youthName(y(s2.youthId))} — {s2.theme || 'Rencontre'}</span><span className="tiny muted">{dayKey(s2.date)}</span></Link>)}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
