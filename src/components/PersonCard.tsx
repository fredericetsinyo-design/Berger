import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, MessageCircle, Plus, Sparkles } from 'lucide-react';
import type { Youth } from '../lib/types';
import { vault } from '../lib/store';
import { relative } from '../lib/dates';
import { STATUS_YOUTH, typeLabel } from './ui';
import { newSession } from '../pages/QuickCreate';

export const initials = (y: Pick<Youth, 'firstName' | 'lastName'>) => `${y.firstName?.[0] ?? ''}${y.lastName?.[0] ?? ''}`.toUpperCase();

export function youthStats(y: Youth) {
  const sessions = vault.all('sessions').filter((s) => s.youthId === y.id).sort((a, b) => b.date.localeCompare(a.date));
  const goals = vault.all('goals').filter((g) => g.youthId === y.id);
  const done = goals.filter((g) => g.status === 'atteint').length;
  const next = vault.all('appointments').filter((a) => a.youthId === y.id && a.start > new Date().toISOString() && (a.status === 'planifie' || a.status === 'confirme')).sort((a, b) => a.start.localeCompare(b.start))[0];
  const months = Math.max(0, Math.round((Date.now() - new Date(y.startDate).getTime()) / (30 * 86_400_000)));
  return { sessions, last: sessions[0], goals: goals.length, done, next, months };
}

/** Carte horizontale : photo à gauche, puces d'état, actions rapides (inspirée de la liste de l'écran de référence). */
export function PersonCard({ y, onWhatsApp }: { y: Youth; onWhatsApp?: (y: Youth) => void }) {
  const nav = useNavigate();
  const st = youthStats(y);
  const [label, color] = STATUS_YOUTH[y.status];
  return (
    <Link to={`/jeunes/${y.id}`} className="person">
      <div className="ph">
        {y.photo ? <img src={y.photo} alt="" loading="lazy" /> : initials(y)}
        <span className={`badge ${color === 'grey' ? 'frost' : color}`}>{label}</span>
      </div>
      <div className="info">
        <span className="kicker"><Sparkles size={12} /> {st.last ? `${st.last.theme || typeLabel(st.last.type)}` : 'Nouveau parcours'}{y.isSample ? ' · exemple' : ''}</span>
        <span className="name ellipsis">{y.firstName} {y.lastName}</span>
        <span className="meta">{st.months ? `Suivi depuis ${st.months} mois` : 'Suivi depuis ce mois-ci'} · {st.sessions.length} rencontre{st.sessions.length > 1 ? 's' : ''}</span>
        <span className="meta row" style={{ gap: 4 }}>
          <CalendarDays size={12} />
          {st.next ? `Prochain RDV ${relative(st.next.start)}` : st.last ? `Vu ${relative(st.last.date)}` : 'Pas encore rencontré'}
        </span>
        <div className="row mt8" style={{ gap: 6 }}>
          {st.goals > 0 && <span className="price">{st.done}/{st.goals} objectif{st.goals > 1 ? 's' : ''}</span>}
          <button className="btn ghost sm icon" title="Nouvelle rencontre" aria-label="Nouvelle rencontre" onClick={async (e) => { e.preventDefault(); const s = await newSession(y.id); nav(`/rencontres/${s.id}`); }}><Plus size={15} /></button>
          {onWhatsApp && y.phone && y.allowWhatsApp !== false && (
            <button className="btn ghost sm icon" title="Message WhatsApp" aria-label="Message WhatsApp" onClick={(e) => { e.preventDefault(); onWhatsApp(y); }}><MessageCircle size={15} color="#25d366" /></button>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Vignette verticale à grande photo (inspirée de « Our services »). */
export function PersonTile({ y }: { y: Youth }) {
  const st = youthStats(y);
  const pct = st.goals ? Math.round((st.done / st.goals) * 100) : null;
  return (
    <Link to={`/jeunes/${y.id}`} className="tile">
      <div className="img">
        {y.photo ? <img src={y.photo} alt="" loading="lazy" /> : initials(y)}
        <span className="badge frost" style={{ position: 'absolute', top: 8, left: 8 }}>{STATUS_YOUTH[y.status][0]}</span>
      </div>
      <div className="body">
        <div className="name ellipsis">{y.firstName} {y.lastName}</div>
        <div className="tiny muted ellipsis">{st.last ? `Vu ${relative(st.last.date)}` : 'Pas encore rencontré'}</div>
        {pct !== null && <div className="progress mt8"><i style={{ width: `${pct}%` }} /></div>}
      </div>
    </Link>
  );
}
