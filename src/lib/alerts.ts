import { vault } from './store';
import { dayKey, daysBetween } from './dates';
import type { Appointment, ActionItem, Youth } from './types';

// Calculs du tableau de bord. Les alertes sont formulées comme des invitations à vérifier,
// jamais comme un constat sur la situation spirituelle ou personnelle d'un jeune.

export interface Alert { id: string; kind: string; text: string; youthId?: string; link: string; level: 'info' | 'attention' }

export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return a.start < b.end && b.start < a.end;
}

export function findConflicts(appt: Pick<Appointment, 'start' | 'end' | 'id'>, all: Appointment[]) {
  return all.filter((x) => x.id !== appt.id && x.status !== 'annule' && x.status !== 'reporte' && overlaps(appt, x));
}

export const isOverdue = (a: ActionItem, now = new Date()) =>
  !!a.dueDate && (a.status === 'a_faire' || a.status === 'en_cours') && dayKey(a.dueDate) < dayKey(now);

export function youthName(y?: Youth) { return y ? `${y.firstName} ${y.lastName}`.trim() : 'Jeune'; }

export function computeDashboard(now = new Date()) {
  const youth = vault.all('youth');
  const sessions = vault.all('sessions');
  const appts = vault.all('appointments');
  const actions = vault.all('actions');
  const audios = vault.all('audios');
  const goals = vault.all('goals');
  const messages = vault.all('messages');
  const today = dayKey(now);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const nowIso = now.toISOString();

  const upcoming = appts.filter((a) => a.start >= nowIso && (a.status === 'planifie' || a.status === 'confirme')).sort((a, b) => a.start.localeCompare(b.start));
  const missed = appts.filter((a) => a.end < nowIso && (a.status === 'planifie' || a.status === 'confirme'));
  const pendingActions = actions.filter((a) => a.status === 'a_faire' || a.status === 'en_cours');
  const relances = actions.filter((a) => (a.status === 'a_faire' || a.status === 'en_cours') && /contact|relan|appel|nouvelles/i.test(a.title));

  const stats = {
    total: youth.length,
    nouveaux: youth.filter((y) => y.startDate >= monthAgo).length,
    actifs: youth.filter((y) => y.status === 'actif' || y.status === 'nouveau').length,
    pause: youth.filter((y) => y.status === 'pause').length,
    rencontresSemaine: sessions.filter((s) => s.date >= weekAgo && s.date <= nowIso).length,
    rencontresMois: sessions.filter((s) => s.date >= monthAgo && s.date <= nowIso).length,
    rdvAVenir: upcoming.length,
    rdvManques: missed.length,
    actionsEnAttente: pendingActions.length,
    relances: relances.length,
    crAFinaliser: sessions.filter((s) => s.reportStatus !== 'valide').length,
    audiosATranscrire: audios.filter((a) => a.status === 'en_attente' || a.status === 'echec' || a.status === 'enregistre').length,
    messagesEnFile: messages.filter((m) => m.status === 'en_file').length,
  };

  const day = {
    rdv: appts.filter((a) => dayKey(a.start) === today && a.status !== 'annule').sort((a, b) => a.start.localeCompare(b.start)),
    aContacter: relances.filter((a) => !a.dueDate || dayKey(a.dueDate) <= today),
    prioritaires: pendingActions.filter((a) => a.priority === 'haute').slice(0, 8),
    enRetard: pendingActions.filter((a) => isOverdue(a, now)),
    rappels: actions.filter((a) => a.reminderAt && dayKey(a.reminderAt) === today && a.status !== 'terminee'),
    aValider: sessions.filter((s) => s.reportStatus === 'a_valider'),
  };

  const alerts: Alert[] = [];
  const active = youth.filter((y) => y.status === 'actif' || y.status === 'nouveau');
  for (const y of active) {
    const name = youthName(y);
    const hasNext = upcoming.some((a) => a.youthId === y.id);
    if (!hasNext) alerts.push({ id: `next-${y.id}`, kind: 'rdv', youthId: y.id, link: `/jeunes/${y.id}`, level: 'info', text: `Aucun prochain rendez-vous planifié avec ${name}. Faut-il en proposer un ?` });
    const last = sessions.filter((s) => s.youthId === y.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (last && daysBetween(last.date, now) > 30) alerts.push({ id: `gap-${y.id}`, kind: 'reprise', youthId: y.id, link: `/jeunes/${y.id}`, level: 'info', text: `Dernière rencontre avec ${name} il y a ${daysBetween(last.date, now)} jours : prendre des nouvelles pour vérifier où il en est.` });
  }
  for (const a of actions.filter((x) => x.priority === 'haute' && isOverdue(x, now))) {
    alerts.push({ id: `act-${a.id}`, kind: 'action', youthId: a.youthId, link: '/actions', level: 'attention', text: `Action importante sans suite : « ${a.title} » (échéance dépassée). À vérifier.` });
  }
  for (const s of sessions.filter((x) => x.reportStatus === 'brouillon' && daysBetween(x.date, now) >= 2)) {
    alerts.push({ id: `cr-${s.id}`, kind: 'compte_rendu', youthId: s.youthId, link: `/rencontres/${s.id}`, level: 'info', text: `La rencontre du ${s.date.slice(0, 10)} n’a pas encore de compte rendu validé.` });
  }
  for (const g of goals.filter((x) => x.status === 'en_cours')) {
    const ref = g.lastEvaluated ?? g.createdAt;
    if (daysBetween(ref, now) > 45) alerts.push({ id: `goal-${g.id}`, kind: 'objectif', youthId: g.youthId, link: `/jeunes/${g.youthId}?onglet=objectifs`, level: 'info', text: `L’objectif « ${g.title} » n’a pas été réévalué depuis ${daysBetween(ref, now)} jours.` });
  }
  for (const a of missed) {
    alerts.push({ id: `miss-${a.id}`, kind: 'rdv_passe', youthId: a.youthId, link: `/agenda?rdv=${a.id}`, level: 'attention', text: `Rendez-vous passé non clôturé (${a.start.slice(0, 10)}) : effectué, reporté ou à reprogrammer ?` });
  }
  return { stats, day, alerts, upcoming };
}
