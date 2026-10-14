// Fonction « ai » : relaie une requête IA vers le fournisseur configuré côté serveur.
// La clé n'est jamais exposée au navigateur. Le contenu reçu est déjà pseudonymisé par le client.
// Variables : AI_PROVIDER (anthropic | openai), AI_API_KEY, AI_MODEL, AI_BASE_URL (openai compatible)
// Aucune donnée n'est stockée ni journalisée ici (seulement la taille de la requête).
import { cors, json, requireUser } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    await requireUser(req);
    const { system, user } = await req.json();
    if (typeof system !== 'string' || typeof user !== 'string' || user.length > 60_000) return json({ error: 'Requête invalide' }, 400);
    const provider = Deno.env.get('AI_PROVIDER') ?? 'anthropic';
    const key = Deno.env.get('AI_API_KEY');
    if (!key) return json({ error: 'IA non configurée sur le serveur' }, 503);
    let text = '';
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: Deno.env.get('AI_MODEL') ?? 'claude-sonnet-5-5', max_tokens: 2500, system, messages: [{ role: 'user', content: user }] }),
      });
      if (!r.ok) return json({ error: `Fournisseur : ${r.status}` }, 502);
      const j = await r.json();
      text = (j.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
    } else {
      const base = Deno.env.get('AI_BASE_URL') ?? 'https://api.openai.com/v1';
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: Deno.env.get('AI_MODEL') ?? 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } }),
      });
      if (!r.ok) return json({ error: `Fournisseur : ${r.status}` }, 502);
      text = (await r.json()).choices?.[0]?.message?.content ?? '';
    }
    console.log(`ai: requête ${user.length} caractères traitée`);
    return json({ text });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: 'Erreur interne' }, 500);
  }
});
