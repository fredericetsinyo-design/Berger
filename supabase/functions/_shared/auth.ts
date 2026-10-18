// Vérifie que l'appelant est un utilisateur connecté et actif.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function requireUser(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Response('Non authentifié', { status: 401, headers: cors });
  const { data: prof } = await sb.from('profiles').select('active').eq('id', data.user.id).maybeSingle();
  if (!prof?.active) throw new Response('Compte inactif', { status: 403, headers: cors });
  return { user: data.user, sb };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
