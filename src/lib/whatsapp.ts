import { vault } from './store';
import { getSettings } from './defaults';
import { supabase, isOnline } from './supabase';
import { fmtDate, fmtTime } from './dates';
import { hasConsent } from './ai';
import type { Message, Youth, Appointment, ActionItem, MessageStatus } from './types';

// Relances WhatsApp
// - Mode « lien » (fonctionnel sans configuration) : ouvre WhatsApp avec un message prérempli.
//   Statut enregistré : « lien ouvert » — JAMAIS « envoyé », car l'application ne peut pas le savoir.
// - Mode « API » (WhatsApp Business Platform) : file d'attente côté serveur, traitée par une
//   fonction Supabase ; les statuts proviennent des webhooks officiels.

export function fillTemplate(body: string, ctx: { youth?: Youth; appointment?: Appointment; action?: ActionItem }) {
  return body
    .replace(/\{prenom\}/g, ctx.youth?.firstName ?? '')
    .replace(/\{date\}/g, ctx.appointment ? fmtDate(ctx.appointment.start) : '…')
    .replace(/\{heure\}/g, ctx.appointment ? fmtTime(ctx.appointment.start) : '…')
    .replace(/\{lieu\}/g, ctx.appointment?.place || ctx.appointment?.mode || '…')
    .replace(/\{action\}/g, ctx.action?.title ?? '…');
}

export function normalizePhone(phone: string, countryCode = '228') {
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  d = d.replace(/^0+/, '');
  return d.startsWith(countryCode) && d.length > 8 ? d : `${countryCode}${d}`;
}

export function waLink(phone: string, text: string) {
  return `https://wa.me/${normalizePhone(phone, getSettings().whatsapp.countryCode)}?text=${encodeURIComponent(text)}`;
}

export function canMessage(youth: Youth): { ok: boolean; reason?: string } {
  if (!youth.phone) return { ok: false, reason: 'Aucun numéro de téléphone.' };
  if (youth.allowWhatsApp === false) return { ok: false, reason: 'Le jeune ne souhaite pas être contacté par WhatsApp.' };
  return { ok: true };
}

const logEntry = (status: MessageStatus, detail?: string) => ({ at: new Date().toISOString(), status, detail });

/** Prépare un message validé par l'accompagnateur et ouvre WhatsApp. */
export async function openWhatsApp(youth: Youth, body: string, templateId?: string): Promise<Message> {
  const ok = canMessage(youth);
  if (!ok.ok) throw new Error(ok.reason);
  const msg = await vault.put('messages', {
    youthId: youth.id, templateId, body, channel: 'whatsapp_lien', status: 'lien_ouvert', validatedAt: new Date().toISOString(),
    log: [logEntry('prepare', 'Validé par l’accompagnateur'), logEntry('lien_ouvert', 'WhatsApp ouvert ; l’envoi effectif se fait dans WhatsApp et n’est pas vérifiable ici')],
  });
  if (typeof window !== 'undefined' && !import.meta.env.VITEST) window.open(waLink(youth.phone!, body), '_blank', 'noopener');
  return msg;
}

/** Programme un envoi via l'API (mode avancé). Dédoublonné, annulable, transmis seulement si possible. */
export async function scheduleApiMessage(youth: Youth, body: string, scheduledAt: string, dedupeKey?: string): Promise<Message> {
  const ok = canMessage(youth);
  if (!ok.ok) throw new Error(ok.reason);
  if (!hasConsent(youth.id, 'messages_whatsapp')) throw new Error('Consentement aux messages WhatsApp non enregistré : envoi automatique impossible.');
  const key = dedupeKey ?? `${youth.id}:${scheduledAt}:${body.slice(0, 40)}`;
  const dup = vault.all('messages').find((m) => m.dedupeKey === key && m.status !== 'annule');
  if (dup) return dup;
  return vault.put('messages', {
    youthId: youth.id, body, channel: 'whatsapp_api', status: 'en_file', scheduledAt, validatedAt: new Date().toISOString(), dedupeKey: key,
    log: [logEntry('prepare', 'Validé par l’accompagnateur'), logEntry('en_file', isOnline() ? 'En file : transmis au serveur à la prochaine synchronisation' : 'Hors ligne : en attente du réseau')],
  });
}

export async function cancelMessage(m: Message) {
  if (!['en_file', 'prepare', 'brouillon'].includes(m.status)) throw new Error('Ce message ne peut plus être annulé.');
  return vault.put('messages', { id: m.id, status: 'annule', log: [...m.log, logEntry('annule', 'Annulé par l’accompagnateur')] });
}

export const apiConfigured = () => getSettings().whatsapp.mode === 'api' && !!supabase();

export const STATUS_LABEL: Record<MessageStatus, string> = {
  brouillon: 'Brouillon', prepare: 'Préparé', lien_ouvert: 'WhatsApp ouvert (envoi non vérifiable)', en_file: 'En file d’attente', envoi_en_cours: 'Envoi en cours (serveur)',
  envoye: 'Envoyé (confirmé par l’API)', remis: 'Remis', lu: 'Lu', echec: 'Échec', annule: 'Annulé',
};
