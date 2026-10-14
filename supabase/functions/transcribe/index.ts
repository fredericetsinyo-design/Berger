// Fonction « transcribe » : transcription d'une note vocale via une API compatible Whisper.
// L'audio n'est ni stocké ni journalisé. Variables : STT_API_KEY, STT_BASE_URL, STT_MODEL
import { cors, json, requireUser } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    await requireUser(req);
    const key = Deno.env.get('STT_API_KEY');
    if (!key) return json({ error: 'Transcription non configurée sur le serveur' }, 503);
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 25 * 1024 * 1024) return json({ error: 'Fichier audio invalide (25 Mo max)' }, 400);
    const fd = new FormData();
    fd.append('file', file, file.name || 'note.webm');
    fd.append('model', Deno.env.get('STT_MODEL') ?? 'whisper-1');
    fd.append('response_format', 'verbose_json');
    fd.append('language', 'fr');
    const r = await fetch(`${Deno.env.get('STT_BASE_URL') ?? 'https://api.openai.com/v1'}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd });
    if (!r.ok) return json({ error: `Moteur de transcription : ${r.status}` }, 502);
    const j = await r.json();
    const uncertain = (j.segments ?? []).filter((s: { avg_logprob?: number; no_speech_prob?: number }) => (s.avg_logprob ?? 0) < -1 || (s.no_speech_prob ?? 0) > 0.5).map((s: { text: string }) => s.text.trim());
    return json({ text: j.text ?? '', language: j.language, uncertain });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: 'Erreur interne' }, 500);
  }
});
