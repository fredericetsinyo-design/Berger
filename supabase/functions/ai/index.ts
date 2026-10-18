// Fonction « ai » : relaie une requête IA vers le fournisseur configuré côté serveur.
// La clé n'est jamais exposée au navigateur. Le contenu reçu est déjà pseudonymisé par le client.
// Variables : GEMINI_API_KEY (suffit pour Gemini) ou AI_PROVIDER (gemini | anthropic | openai), AI_API_KEY, AI_MODEL, AI_BASE_URL
// Aucune donnée n'est stockée ni journalisée ici (seulement la taille de la requête).
import { cors, json, requireUser } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    await requireUser(req);
    const { system, user } = await req.json();
    if (typeof system !== 'string' || typeof user !== 'string' || user.length > 60_000) return json({ error: 'Requête invalide' }, 400);
    const gemKey = Deno.env.get('GEMINI_API_KEY');
    const provider = Deno.env.get('AI_PROVIDER') ?? (gemKey ? 'gemini' : 'anthropic');
    const key = provider === 'gemini' ? (gemKey ?? Deno.env.get('AI_API_KEY')) : Deno.env.get('AI_API_KEY');
    if (!key) return json({ error: 'IA non configurée sur le serveur (secret GEMINI_API_KEY manquant)' }, 503);
    let text = '';
    if (provider === 'gemini') {
      const model = Deno.env.get('AI_MODEL') ?? 'gemini-flash-latest';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 4096 },
        }),
      });
      if (!r.ok) {
        const b = await r.text();
        if (/API_KEY_INVALID|API key not valid/i.test(b)) return json({ error: 'Clé Gemini du serveur invalide' }, 502);
        if (r.status === 429) return json({ error: 'Quota Gemini atteint, réessayez dans une minute' }, 429);
        return json({ error: `Gemini : ${r.status}` }, 502);
      }
      const j = await r.json();
      text = (j.candidates?.[0]?.content?.parts ?? []).map((c: { text?: string }) => c.text ?? '').join('');
      if (!text) return json({ error: 'Réponse Gemini vide ou filtrée' }, 502);
    } else if (provider === 'anthropic') {
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
