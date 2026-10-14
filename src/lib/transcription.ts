import { getSettings } from './defaults';
import { supabase, isOnline } from './supabase';
import { vault } from './store';
import { hasConsent } from './ai';
import type { Audio } from './types';

// Transcription : moteur interchangeable. Aucun moteur hors ligne n'est intégré :
// hors connexion, l'audio est conservé chiffré et mis en file d'attente.

export interface STTResult { text: string; language?: string; uncertain?: string[] }
export interface STTEngine { name: string; transcribe(audio: Blob): Promise<STTResult> }

export function getEngine(): STTEngine | null {
  const s = getSettings().stt;
  if (s.provider === 'openai_compatible' && s.apiKey && s.baseUrl) {
    return {
      name: `whisper:${s.model || 'whisper-1'}`,
      async transcribe(audio) {
        const fd = new FormData();
        fd.append('file', audio, `note.${audio.type.includes('mp4') ? 'mp4' : 'webm'}`);
        fd.append('model', s.model || 'whisper-1');
        fd.append('response_format', 'verbose_json');
        fd.append('language', 'fr');
        const r = await fetch(`${s.baseUrl!.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${s.apiKey}` }, body: fd });
        if (!r.ok) throw new Error(`Transcription : erreur ${r.status}`);
        const j = await r.json();
        // Segments dont la confiance est faible → signalés comme incertains
        const uncertain = (j.segments ?? []).filter((x: { avg_logprob?: number; no_speech_prob?: number }) => (x.avg_logprob ?? 0) < -1 || (x.no_speech_prob ?? 0) > 0.5).map((x: { text: string }) => x.text.trim());
        return { text: j.text ?? '', language: j.language, uncertain };
      },
    };
  }
  if (s.provider === 'serveur' && supabase()) {
    return {
      name: 'serveur',
      async transcribe(audio) {
        const fd = new FormData();
        fd.append('file', audio, 'note.webm');
        const { data, error } = await supabase()!.functions.invoke('transcribe', { body: fd });
        if (error) throw new Error(error.message);
        return data as STTResult;
      },
    };
  }
  return null;
}

let engineOverride: STTEngine | null | undefined;
export function setEngineOverride(e: STTEngine | null | undefined) { engineOverride = e; }
const engine = () => (engineOverride !== undefined ? engineOverride : getEngine());

export function sttAvailability(youthId?: string): { ok: boolean; reason?: string } {
  if (!engine()) return { ok: false, reason: 'Aucun service de transcription configuré.' };
  if (!isOnline() && engineOverride === undefined) return { ok: false, reason: 'Hors ligne : transcription mise en attente.' };
  if (youthId && !hasConsent(youthId, 'traitement_ia')) return { ok: false, reason: 'Consentement au traitement automatisé non enregistré pour ce jeune.' };
  return { ok: true };
}

/** Transcrit un audio ; en cas d'impossibilité, le marque « en attente » ou « échec » sans perdre l'enregistrement. */
export async function transcribeAudio(audio: Audio): Promise<Audio> {
  const av = sttAvailability(audio.youthId);
  if (!av.ok) {
    return vault.put('audios', { id: audio.id, status: 'en_attente', error: av.reason });
  }
  await vault.put('audios', { id: audio.id, status: 'en_cours', error: undefined });
  try {
    const blob = await vault.getBlob(audio.blobId);
    if (!blob) throw new Error('Fichier audio introuvable sur cet appareil');
    const e = engine()!;
    const res = await e.transcribe(blob);
    await vault.put('transcriptions', { audioId: audio.id, sessionId: audio.sessionId, raw: res.text, language: res.language, uncertain: res.uncertain ?? [], provider: e.name });
    return vault.put('audios', { id: audio.id, status: 'transcrit', error: undefined });
  } catch (err) {
    return vault.put('audios', { id: audio.id, status: 'echec', error: (err as Error).message });
  }
}

/** Relance les transcriptions en attente (appelé au retour du réseau). */
export async function processPendingTranscriptions() {
  const pending = vault.all('audios').filter((a) => a.status === 'en_attente');
  for (const a of pending) if (sttAvailability(a.youthId).ok) await transcribeAudio(a);
}
