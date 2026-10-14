import { vault } from './store';
import { getSupabaseConfig } from './supabase';
import type { Settings, UserProfile } from './types';

export const DEFAULT_TEMPLATES: { name: string; body: string }[] = [
  { name: 'Confirmation de rendez-vous', body: 'Bonjour {prenom}, je te confirme notre rencontre le {date} à {heure} ({lieu}). Est-ce toujours bon pour toi ?' },
  { name: 'Rappel de rendez-vous', body: 'Bonjour {prenom}, petit rappel : nous nous voyons {date} à {heure}. À bientôt !' },
  { name: 'Proposition de nouvelle date', body: 'Bonjour {prenom}, je dois déplacer notre rencontre. Serais-tu disponible {date} à {heure} ?' },
  { name: 'Prise de nouvelles', body: 'Bonjour {prenom}, je voulais prendre de tes nouvelles depuis notre dernier échange. Comment ça va ?' },
  { name: 'Relance sur une action convenue', body: 'Bonjour {prenom}, où en es-tu avec « {action} » dont nous avions parlé ? Je reste disponible si besoin.' },
  { name: 'Message personnalisé', body: 'Bonjour {prenom}, ' },
];

export function defaultSettings(): Partial<Settings> {
  return {
    appName: 'Berger',
    primary: '',
    theme: 'systeme',
    // Avec un serveur configuré, l'IA passe par la fonction serveur (clé jamais présente dans le navigateur).
    ai: { provider: getSupabaseConfig() ? 'serveur' : 'aucun' },
    stt: { provider: 'aucun' },
    whatsapp: { mode: 'lien', countryCode: '228' },
    autoLockMinutes: 15,
    audioEnabled: true,
    notifications: true,
    defaultReminders: [1440, 60],
  };
}

export function getSettings(): Settings {
  const s = vault.all('settings')[0];
  return { ...(defaultSettings() as Settings), ...(s ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>) {
  const s = vault.all('settings')[0];
  return vault.put('settings', { ...(s ?? defaultSettings()), ...patch, id: s?.id });
}

export async function ensureDefaults(_u: UserProfile) {
  if (!vault.all('settings').length) await vault.put('settings', defaultSettings());
  if (!vault.all('templates').length) for (const t of DEFAULT_TEMPLATES) await vault.put('templates', t);
}
