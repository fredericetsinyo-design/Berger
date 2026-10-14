// Fonction « whatsapp-webhook » : reçoit les statuts de remise (sent, delivered, read, failed)
// envoyés par Meta et met à jour le journal + le statut du message.
// Variables : WA_VERIFY_TOKEN, WA_APP_SECRET (vérification de la signature X-Hub-Signature-256)
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const MAP: Record<string, string> = { sent: 'envoye', delivered: 'remis', read: 'lu', failed: 'echec' };

async function validSignature(req: Request, body: string) {
  const sig = req.headers.get('x-hub-signature-256')?.replace('sha256=', '');
  const secret = Deno.env.get('WA_APP_SECRET');
  if (!sig || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('') === sig;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    // Vérification de l'abonnement par Meta
    if (url.searchParams.get('hub.verify_token') === Deno.env.get('WA_VERIFY_TOKEN')) return new Response(url.searchParams.get('hub.challenge') ?? '');
    return new Response('Interdit', { status: 403 });
  }
  const body = await req.text();
  if (!(await validSignature(req, body))) return new Response('Signature invalide', { status: 401 });
  const payload = JSON.parse(body);
  for (const entry of payload.entry ?? []) for (const ch of entry.changes ?? []) for (const st of ch.value?.statuses ?? []) {
    const status = MAP[st.status];
    if (!status) continue;
    const { data: logRow } = await admin.from('message_delivery_logs').select('message_id').eq('provider_message_id', st.id).limit(1).maybeSingle();
    if (!logRow) continue;
    await admin.from('message_delivery_logs').insert({ message_id: logRow.message_id, status, provider_message_id: st.id, detail: st.errors?.[0]?.title });
    const { data: m } = await admin.from('message_queue').select('id, data, version').eq('id', logRow.message_id).maybeSingle();
    if (m) {
      const data = { ...m.data, status, log: [...(m.data.log ?? []), { at: new Date().toISOString(), status, detail: 'Statut WhatsApp' }] };
      await admin.from('message_queue').update({ data, version: m.version + 1, server_updated_at: new Date().toISOString() }).eq('id', m.id).eq('version', m.version);
    }
  }
  return new Response('ok');
});
