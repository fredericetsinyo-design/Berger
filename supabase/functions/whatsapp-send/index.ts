// Fonction « whatsapp-send » : traite la file d'attente des messages programmés
// (WhatsApp Business Platform — Cloud API). À appeler chaque minute (pg_cron ou planificateur Supabase)
// avec l'en-tête Authorization: Bearer <CRON_SECRET>.
//
// Garanties :
//  - un message n'est envoyé que s'il est « en_file », échu, validé, et si le consentement
//    « messages_whatsapp » du jeune est toujours accordé au moment de l'envoi ;
//  - verrouillage par mise à jour conditionnelle (status en_file → envoi_en_cours) : pas de double envoi,
//    même si deux exécutions se chevauchent ; un message annulé entre-temps n'est pas envoyé ;
//  - le statut « envoye » n'est écrit que sur réponse positive de l'API (le statut « remis »/« lu »
//    arrive ensuite par le webhook).
//
// Variables : WA_TOKEN, WA_PHONE_NUMBER_ID, WA_DEFAULT_COUNTRY (228), CRON_SECRET,
//             WA_TEMPLATE_NAME / WA_TEMPLATE_LANG (modèle approuvé pour les messages hors fenêtre de 24 h)
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

function phone(p: string) {
  const cc = Deno.env.get('WA_DEFAULT_COUNTRY') ?? '228';
  let d = p.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  d = d.replace(/^0+/, '');
  return d.startsWith(cc) && d.length > 8 ? d : cc + d;
}

async function log(id: string, status: string, detail?: string, providerId?: string) {
  await admin.from('message_delivery_logs').insert({ message_id: id, status, detail, provider_message_id: providerId });
}

async function setStatus(row: { id: string; data: Record<string, unknown>; version: number }, status: string, detail: string) {
  const data = { ...row.data, status, log: [...((row.data.log as unknown[]) ?? []), { at: new Date().toISOString(), status, detail }] };
  await admin.from('message_queue').update({ data, version: row.version + 1, server_updated_at: new Date().toISOString() }).eq('id', row.id).eq('version', row.version);
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) return new Response('Interdit', { status: 403 });
  const now = new Date().toISOString();
  const { data: due } = await admin.from('message_queue').select('*').eq('status', 'en_file').eq('channel', 'whatsapp_api').eq('deleted', false).lte('scheduled_at_text', now).limit(50);
  let sent = 0;
  for (const m of due ?? []) {
    // 1. Verrou : seule l'exécution qui fait passer la version gagne.
    const lockData = { ...m.data, status: 'envoi_en_cours' };
    const { data: locked } = await admin.from('message_queue').update({ data: lockData, version: m.version + 1, server_updated_at: new Date().toISOString() }).eq('id', m.id).eq('version', m.version).eq('status', 'en_file').select('*');
    if (!locked?.length) continue;
    const row = locked[0];
    // 2. Consentement et numéro vérifiés au moment de l'envoi
    const { data: consents } = await admin.from('consent_records').select('data').eq('youth_id', m.youth_id).eq('deleted', false);
    const last = (consents ?? []).map((c) => c.data).filter((c) => c.type === 'messages_whatsapp').sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const { data: youth } = await admin.from('youth_profiles').select('data').eq('id', m.youth_id).maybeSingle();
    if (!last?.granted || !youth?.data?.phone || youth.data.allowWhatsApp === false) {
      await setStatus(row, 'echec', 'Consentement ou numéro absent au moment de l’envoi');
      await log(m.id, 'echec', 'consentement/numéro');
      continue;
    }
    // 3. Envoi (modèle approuvé si configuré, sinon texte libre — valable seulement dans la fenêtre de 24 h)
    const template = Deno.env.get('WA_TEMPLATE_NAME');
    const payload = template
      ? { messaging_product: 'whatsapp', to: phone(youth.data.phone), type: 'template', template: { name: template, language: { code: Deno.env.get('WA_TEMPLATE_LANG') ?? 'fr' }, components: [{ type: 'body', parameters: [{ type: 'text', text: String(m.data.body).slice(0, 1000) }] }] } }
      : { messaging_product: 'whatsapp', to: phone(youth.data.phone), type: 'text', text: { body: String(m.data.body) } };
    const r = await fetch(`https://graph.facebook.com/v21.0/${Deno.env.get('WA_PHONE_NUMBER_ID')}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${Deno.env.get('WA_TOKEN')}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.messages?.[0]?.id) {
      await setStatus(row, 'envoye', 'Accepté par l’API WhatsApp');
      await log(m.id, 'envoye', undefined, j.messages[0].id);
      sent++;
    } else {
      await setStatus(row, 'echec', `API WhatsApp : ${j.error?.message ?? r.status}`);
      await log(m.id, 'echec', JSON.stringify(j.error ?? r.status));
    }
  }
  return new Response(JSON.stringify({ traites: due?.length ?? 0, envoyes: sent }), { headers: { 'content-type': 'application/json' } });
});
