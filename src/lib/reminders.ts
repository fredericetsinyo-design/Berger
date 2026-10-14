import { vault } from './store';
import { getSettings } from './defaults';
import { fmtTime } from './dates';

// Rappels locaux.
// Limites (documentées dans docs/LIMITES.md) : une PWA ne peut pas programmer de notification
// fiable lorsque l'application est complètement fermée (pas d'API de déclenchement planifié
// standard). Les rappels sont vérifiés à l'ouverture et toutes les 30 secondes tant que
// l'application est ouverte ou en arrière-plan. Pour des rappels garantis : Web Push via le serveur.
// Le texte des notifications ne contient jamais le nom du jeune ni le sujet (écran verrouillé).

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

async function notify(title: string, body: string, tag: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) await reg.showNotification(title, { body, tag, icon: 'icon-192.png' });
  else new Notification(title, { body, tag });
  return true;
}

export interface InAppReminder { id: string; text: string; at: string; link: string }
let inApp: InAppReminder[] = [];
const ls = new Set<() => void>();
export const subscribeReminders = (l: () => void) => { ls.add(l); return () => ls.delete(l); };
export const getInAppReminders = () => inApp;
export const dismissReminder = (id: string) => { inApp = inApp.filter((r) => r.id !== id); ls.forEach((l) => l()); };

export async function checkReminders(now = new Date()) {
  if (!vault.unlocked) return;
  const s = getSettings();
  const t = now.getTime();
  for (const a of vault.all('appointments')) {
    if (a.status === 'annule' || a.status === 'effectue' || a.status === 'reporte') continue;
    for (const m of a.reminders ?? []) {
      const due = new Date(a.start).getTime() - m * 60_000;
      const tag = `${a.id}:${m}`;
      if (t >= due && t < new Date(a.start).getTime() && !(a.notifiedAt ?? []).includes(tag)) {
        const text = `Rendez-vous à ${fmtTime(a.start)}`;
        if (s.notifications) await notify(s.appName || 'Berger', text, tag);
        inApp = [...inApp.filter((r) => r.id !== tag), { id: tag, text, at: a.start, link: `/agenda?rdv=${a.id}` }];
        await vault.put('appointments', { id: a.id, notifiedAt: [...(a.notifiedAt ?? []), tag] });
      }
    }
  }
  for (const act of vault.all('actions')) {
    if (!act.reminderAt || act.status === 'terminee' || act.status === 'annulee') continue;
    const tag = `act:${act.id}:${act.reminderAt}`;
    if (t >= new Date(act.reminderAt).getTime() && !inApp.some((r) => r.id === tag)) {
      if (s.notifications) await notify(s.appName || 'Berger', 'Une action de suivi arrive à échéance', tag);
      inApp = [...inApp, { id: tag, text: `Rappel : ${act.title}`, at: act.reminderAt, link: '/actions' }];
    }
  }
  ls.forEach((l) => l());
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startReminderLoop() {
  if (timer) clearInterval(timer);
  checkReminders();
  timer = setInterval(() => checkReminders(), 30_000);
}
