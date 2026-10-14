import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play, Square, Trash2, RotateCcw, FileAudio, Pencil } from 'lucide-react';
import { vault, useCollection } from '../lib/store';
import { transcribeAudio, sttAvailability } from '../lib/transcription';
import { hasConsent } from '../lib/ai';
import { getSettings } from '../lib/defaults';
import { fmtDateTime } from '../lib/dates';
import { toast, toastError, Confirm } from './ui';
import type { Audio } from '../lib/types';

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Recorder({ youthId, sessionId, autoStart }: { youthId?: string; sessionId?: string; autoStart?: boolean }) {
  const [state, setState] = useState<'idle' | 'rec' | 'paused'>('idle');
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const settings = getSettings();
  const consent = youthId ? hasConsent(youthId, 'enregistrement_audio') : true;
  const supported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const tick = () => { timer.current = setInterval(() => setSecs((s) => s + 1), 1000); };
  const stopTimer = () => { if (timer.current) clearInterval(timer.current); };

  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.start(1000);
      rec.current = r;
      setSecs(0); setState('rec'); tick();
    } catch (e) { toastError(new Error(`Micro inaccessible : ${(e as Error).message}`)); }
  };
  const pause = () => { rec.current?.pause(); stopTimer(); setState('paused'); };
  const resume = () => { rec.current?.resume(); tick(); setState('rec'); };
  const stop = () => new Promise<void>((res) => {
    const r = rec.current;
    if (!r) return res();
    r.onstop = async () => {
      stopTimer();
      stream.current?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
      try {
        const blobId = await vault.putBlob(blob);
        const a = await vault.put('audios', { youthId, sessionId, durationSec: secs, mime: blob.type, blobId, status: 'enregistre', consent: youthId ? 'Consentement audio enregistré dans la fiche' : 'Note personnelle de l’accompagnateur' });
        toast('Enregistrement sauvegardé (chiffré sur l’appareil)');
        if (sttAvailability(youthId).ok) transcribeAudio(a).then((x) => x.status === 'transcrit' && toast('Transcription terminée'));
        else await vault.put('audios', { id: a.id, status: 'en_attente', error: sttAvailability(youthId).reason });
      } catch (e) { toastError(e); }
      setState('idle'); rec.current = null; res();
    };
    r.stop();
  });
  useEffect(() => () => { stopTimer(); stream.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (autoStart && consent && supported && settings.audioEnabled) start(); }, []); // eslint-disable-line

  if (!settings.audioEnabled) return <p className="small muted">Enregistrement audio désactivé dans les réglages : prenez des notes écrites.</p>;
  if (!supported) return <p className="small muted">Ce navigateur ne permet pas l’enregistrement audio. Utilisez les notes écrites.</p>;
  if (!consent) return <p className="small" style={{ color: 'var(--amber)' }}>Le consentement à l’enregistrement audio n’est pas enregistré pour ce jeune (onglet Consentements). Vous pouvez prendre des notes écrites.</p>;

  return (
    <div className="rec">
      {state === 'idle' ? (
        <button className="btn" onClick={start}><Mic size={16} /> Enregistrer une note vocale</button>
      ) : (
        <>
          <span className="live" style={state === 'paused' ? { animation: 'none', opacity: .4 } : undefined} />
          <span className="time">{fmt(secs)}</span>
          {state === 'rec' ? <button className="btn ghost sm" onClick={pause}><Pause size={14} /> Pause</button> : <button className="btn ghost sm" onClick={resume}><Play size={14} /> Reprendre</button>}
          <button className="btn sm" onClick={stop}><Square size={14} /> Arrêter</button>
        </>
      )}
    </div>
  );
}

const AUDIO_STATUS: Record<Audio['status'], [string, string]> = {
  enregistre: ['Enregistré', 'grey'], en_attente: ['Transcription en attente', 'amber'], en_cours: ['Transcription…', 'blue'], transcrit: ['Transcrit', 'green'], echec: ['Échec de transcription', 'red'], manuel: ['Notes manuelles', 'grey'],
};

export function AudioList({ sessionId }: { sessionId: string }) {
  const audios = useCollection('audios', (a) => a.sessionId === sessionId, [sessionId]);
  const transcripts = useCollection('transcriptions', (t) => t.sessionId === sessionId, [sessionId]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [del, setDel] = useState<Audio | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const load = async (a: Audio) => {
    const b = await vault.getBlob(a.blobId);
    if (b) setUrls((u) => ({ ...u, [a.id]: URL.createObjectURL(b) }));
    else toastError(new Error('Audio absent de cet appareil (non synchronisé : les enregistrements restent sur l’appareil qui les a créés).'));
  };
  if (!audios.length) return null;
  return (
    <div className="list">
      {audios.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((a) => {
        const t = transcripts.find((x) => x.audioId === a.id);
        const [l, c] = AUDIO_STATUS[a.status];
        return (
          <div key={a.id} className="card flat stack s6" style={{ padding: 14, background: 'var(--surface-2)' }}>
            <div className="row wrap">
              <FileAudio size={18} color="var(--primary)" />
              <span className="small bold">{fmtDateTime(a.createdAt)} · {fmt(a.durationSec)}</span>
              <span className={`badge ${c}`}>{l}</span>
              <span className="grow" />
              {!urls[a.id] && <button className="btn ghost sm" onClick={() => load(a)}><Play size={14} /> Écouter</button>}
              {(a.status === 'echec' || a.status === 'en_attente' || a.status === 'enregistre') && (
                <button className="btn secondary sm" onClick={async () => { const r = await transcribeAudio(a); toast(r.status === 'transcrit' ? 'Transcription terminée' : r.error ?? 'Mise en attente'); }}><RotateCcw size={14} /> {a.status === 'echec' ? 'Relancer' : 'Transcrire'}</button>
              )}
              <button className="btn ghost sm icon" aria-label="Supprimer" onClick={() => setDel(a)}><Trash2 size={14} /></button>
            </div>
            {urls[a.id] && <audio controls src={urls[a.id]} style={{ width: '100%' }} />}
            {a.error && a.status !== 'transcrit' && <div className="tiny" style={{ color: a.status === 'echec' ? 'var(--red)' : 'var(--amber)' }}>{a.error}</div>}
            {t && (
              <div className="stack s6">
                <div className="row between tiny muted"><span>Transcription brute ({t.provider}{t.language ? `, langue : ${t.language}` : ''}) — conservée telle quelle</span></div>
                <div className="quote small" style={{ fontFamily: 'inherit' }}>{t.raw || '(vide)'}</div>
                {!!t.uncertain?.length && <div className="tiny" style={{ color: 'var(--amber)' }}>Passages incertains : {t.uncertain.map((u) => `« ${u} »`).join(', ')}</div>}
                {editing === t.id ? (
                  <>
                    <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <div className="row"><button className="btn sm" onClick={async () => { await vault.put('transcriptions', { id: t.id, corrected: draft }); setEditing(null); }}>Enregistrer la correction</button><button className="btn ghost sm" onClick={() => setEditing(null)}>Annuler</button></div>
                  </>
                ) : (
                  <>
                    {t.corrected && <div className="small"><b>Version corrigée :</b> <span className="pre">{t.corrected}</span></div>}
                    <div><button className="btn ghost sm" onClick={() => { setDraft(t.corrected ?? t.raw); setEditing(t.id); }}><Pencil size={14} /> Corriger</button></div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {del && <Confirm danger yes="Supprimer" text="L’enregistrement audio et sa transcription seront supprimés." onClose={() => setDel(null)} onYes={async () => {
        await vault.deleteBlob(del.blobId);
        for (const t of vault.all('transcriptions').filter((x) => x.audioId === del.id)) await vault.remove('transcriptions', t.id);
        await vault.remove('audios', del.id);
      }} />}
    </div>
  );
}
