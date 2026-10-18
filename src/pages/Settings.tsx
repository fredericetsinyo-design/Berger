import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Trash2, Download } from 'lucide-react';
import { getSettings, saveSettings } from '../lib/defaults';
import { getUser, changePassword, logout } from '../lib/auth';
import { vault, useVaultTick } from '../lib/store';
import { db, type OutboxOp } from '../lib/db';
import { syncEngine, useSyncStatus, listConflicts, resolveConflict, type ConflictView } from '../lib/sync';
import { supabase, getSupabaseConfig } from '../lib/supabase';
import { requestNotificationPermission } from '../lib/reminders';
import { DEFAULT_MODELS, getProvider, testProvider } from '../lib/ai';
import { fmtDateTime } from '../lib/dates';
import { Tabs, Field, toast, toastError, Empty, Confirm } from '../components/ui';
import { ServerConfig } from './Login';
import type { Settings, Role } from '../lib/types';

type Tab = 'profil' | 'apparence' | 'ia' | 'transcription' | 'whatsapp' | 'securite' | 'sync' | 'journal' | 'equipe';

export default function SettingsPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('onglet') as Tab) || 'profil');
  useVaultTick();
  const s = getSettings();
  const user = getUser()!;
  const set = (patch: Partial<Settings>) => saveSettings(patch).then(() => toast('Réglage enregistré'));
  const opts: [Tab, string][] = [['profil', 'Profil'], ['apparence', 'Apparence'], ['ia', 'Intelligence artificielle'], ['transcription', 'Transcription'], ['whatsapp', 'WhatsApp'], ['securite', 'Sécurité & données'], ['sync', 'Synchronisation'], ['journal', 'Journal']];
  if (user.mode === 'supabase' && user.role === 'admin') opts.push(['equipe', 'Équipe & accès']);
  return (
    <div className="stack s18">
      <div className="page-head"><div><h1>Réglages</h1><p>{user.displayName} · {user.email} · {user.mode === 'local' ? 'compte local' : `compte serveur (${user.role})`}</p></div></div>
      <Tabs value={tab} onChange={setTab} options={opts} />
      {tab === 'profil' && <Profile />}
      {tab === 'apparence' && (
        <div className="card stack" style={{ maxWidth: 560 }}>
          <Field label="Nom de l’application"><input className="input" defaultValue={s.appName} onBlur={(e) => set({ appName: e.target.value || 'Berger' })} /></Field>
          <Field label="Couleur principale"><div className="row"><input type="color" value={s.primary && s.primary.toLowerCase() !== '#6c5ce7' ? s.primary : '#f7891f'} onChange={(e) => set({ primary: e.target.value })} /><button className="btn ghost sm" onClick={() => set({ primary: '' })}>Par défaut (orange)</button></div></Field>
          <Field label="Logo">
            <div className="row">
              <img src={s.logo || 'icon.svg'} alt="" width={40} height={40} style={{ borderRadius: 10 }} />
              <label className="btn ghost sm">Changer<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => set({ logo: r.result as string }); r.readAsDataURL(f); }} /></label>
              {s.logo && <button className="btn ghost sm" onClick={() => set({ logo: undefined })}>Retirer</button>}
            </div>
          </Field>
          <Field label="Thème"><select className="input" value={s.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}><option value="systeme">Selon l’appareil</option><option value="clair">Clair</option><option value="sombre">Sombre</option></select></Field>
          <p className="tiny faint">Fuseau horaire : Africa/Lome (UTC+0).</p>
        </div>
      )}
      {tab === 'ia' && <AISettings />}
      {tab === 'transcription' && <STTSettings />}
      {tab === 'whatsapp' && (
        <div className="card stack" style={{ maxWidth: 620 }}>
          <Field label="Indicatif pays par défaut"><input className="input" defaultValue={s.whatsapp.countryCode} onBlur={(e) => set({ whatsapp: { ...s.whatsapp, countryCode: e.target.value.replace(/\D/g, '') || '228' } })} /></Field>
          <Field label="Mode">
            <select className="input" value={s.whatsapp.mode} onChange={(e) => set({ whatsapp: { ...s.whatsapp, mode: e.target.value as 'lien' | 'api' } })}>
              <option value="lien">Lien WhatsApp (fonctionne sans configuration)</option>
              <option value="api" disabled={!getSupabaseConfig()}>WhatsApp Business Platform (API officielle, via le serveur)</option>
            </select>
          </Field>
          <p className="small muted">Le mode API nécessite : un serveur Supabase, un compte WhatsApp Business Platform vérifié, un numéro professionnel, des modèles de messages approuvés par Meta pour les messages initiés hors fenêtre de 24 h, et le consentement de chaque destinataire. Voir docs/CONFIGURATION.md § WhatsApp.</p>
        </div>
      )}
      {tab === 'securite' && <Security />}
      {tab === 'sync' && <SyncPanel />}
      {tab === 'journal' && <AuditLog />}
      {tab === 'equipe' && <Team />}
    </div>
  );
}

function Profile() {
  const user = getUser()!;
  const [o, setO] = useState(''); const [n, setN] = useState('');
  return (
    <div className="grid g2">
      <div className="card stack">
        <h3>Changer de mot de passe</h3>
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await changePassword(o, n); toast('Mot de passe modifié'); setO(''); setN(''); } catch (err) { toastError(err); } }}>
          <Field label="Mot de passe actuel"><input className="input" type="password" required value={o} onChange={(e) => setO(e.target.value)} /></Field>
          <Field label="Nouveau mot de passe" hint="10 caractères minimum"><input className="input" type="password" minLength={10} required value={n} onChange={(e) => setN(e.target.value)} /></Field>
          <button className="btn">Modifier</button>
        </form>
      </div>
      <div className="card stack">
        <h3>Session</h3>
        <p className="small muted">Rôle : {user.role === 'admin' ? 'Administrateur' : user.role === 'responsable' ? 'Responsable d’accompagnement' : 'Accompagnateur'}</p>
        <button className="btn ghost" onClick={() => logout()}>Se déconnecter / changer d’utilisateur</button>
        <p className="tiny faint">Les modifications non synchronisées restent chiffrées sur l’appareil et ne sont jamais supprimées à la déconnexion.</p>
      </div>
    </div>
  );
}

function AISettings() {
  const s = getSettings();
  const [v, setV] = useState(s.ai);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card stack" style={{ maxWidth: 680 }}>
      <p className="small muted">L’IA sert aux comptes rendus, suggestions d’accompagnement et sélection de passages bibliques. Elle n’est utilisée que pour les jeunes ayant donné leur consentement, avec des données pseudonymisées. Les résultats restent des propositions à valider.</p>
      <Field label="Fournisseur">
        <select className="input" value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value as Settings['ai']['provider'] })}>
          <option value="aucun">Aucun (fonctions IA désactivées)</option>
          <option value="gemini">Google Gemini — clé personnelle</option>
          <option value="anthropic">Anthropic (Claude) — clé personnelle</option>
          <option value="openai_compatible">Compatible OpenAI (OpenAI, Mistral, Ollama…) — clé personnelle</option>
          <option value="serveur" disabled={!getSupabaseConfig()}>Fonction serveur (clé conservée côté serveur — recommandé en équipe)</option>
        </select>
      </Field>
      {v.provider === 'gemini' && (
        <>
          <p className="small muted">Créez une clé gratuite sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> (bouton « Create API key »), puis collez-la ici.</p>
          <Field label="Clé d’API Gemini" hint="Stockée chiffrée sur cet appareil uniquement ; jamais synchronisée. À saisir sur chaque appareil (ou utilisez « Fonction serveur »)."><input className="input" type="password" value={v.apiKey ?? ''} onChange={(e) => setV({ ...v, apiKey: e.target.value })} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="AIza…" /></Field>
          <Field label="Modèle (facultatif)"><input className="input" value={v.model ?? ''} onChange={(e) => setV({ ...v, model: e.target.value })} placeholder={DEFAULT_MODELS.gemini} autoCapitalize="none" /></Field>
          <p className="tiny" style={{ color: 'var(--amber)' }}>Offre gratuite de Gemini : Google peut utiliser les textes envoyés pour améliorer ses services. Les noms, téléphones et e-mails sont retirés avant l’envoi, mais pour des dossiers sensibles, activez la facturation dans Google AI Studio (offre payante, sans réutilisation des données).</p>
        </>
      )}
      {(v.provider === 'anthropic' || v.provider === 'openai_compatible') && (
        <>
          {v.provider === 'openai_compatible' && <Field label="URL de base de l’API"><input className="input" value={v.baseUrl ?? ''} onChange={(e) => setV({ ...v, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>}
          <Field label="Clé d’API" hint="Stockée chiffrée sur cet appareil uniquement ; jamais synchronisée."><input className="input" type="password" value={v.apiKey ?? ''} onChange={(e) => setV({ ...v, apiKey: e.target.value })} /></Field>
          <Field label="Modèle"><input className="input" value={v.model ?? ''} onChange={(e) => setV({ ...v, model: e.target.value })} placeholder={v.provider === 'anthropic' ? DEFAULT_MODELS.anthropic : DEFAULT_MODELS.openai_compatible} /></Field>
        </>
      )}
      <div className="row wrap">
        <button className="btn" disabled={busy} onClick={() => saveSettings({ ai: { ...v, apiKey: v.apiKey?.trim() } }).then(() => toast('Configuration IA enregistrée'))}>Enregistrer</button>
        {v.provider !== 'aucun' && <button className="btn secondary" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await saveSettings({ ai: { ...v, apiKey: v.apiKey?.trim() } });
            const p = getProvider();
            if (!p) throw new Error('Configuration incomplète : saisissez la clé.');
            await testProvider(p);
            toast(`L’IA répond (${p.name}). Configuration enregistrée.`);
          } catch (e) { toastError(e); } finally { setBusy(false); }
        }}>{busy ? 'Test en cours…' : 'Tester et enregistrer'}</button>}
      </div>
      <p className="tiny faint">Coûts : facturés par le fournisseur selon le volume de texte traité (voir docs/LIMITES.md). Vérifiez les conditions du fournisseur : les données ne doivent pas servir à entraîner ses modèles.</p>
    </div>
  );
}

function STTSettings() {
  const s = getSettings();
  const [v, setV] = useState(s.stt);
  return (
    <div className="card stack" style={{ maxWidth: 680 }}>
      <p className="small muted">Aucun moteur de transcription n’est intégré hors ligne. Sans connexion, les audios sont conservés chiffrés et la transcription est mise en attente.</p>
      <Field label="Service de transcription">
        <select className="input" value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value as Settings['stt']['provider'] })}>
          <option value="aucun">Aucun</option>
          <option value="openai_compatible">API compatible Whisper (OpenAI, Groq, serveur local…)</option>
          <option value="serveur" disabled={!getSupabaseConfig()}>Fonction serveur</option>
        </select>
      </Field>
      {v.provider === 'openai_compatible' && (
        <>
          <Field label="URL de base"><input className="input" value={v.baseUrl ?? ''} onChange={(e) => setV({ ...v, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>
          <Field label="Clé d’API"><input className="input" type="password" value={v.apiKey ?? ''} onChange={(e) => setV({ ...v, apiKey: e.target.value })} /></Field>
          <Field label="Modèle"><input className="input" value={v.model ?? ''} onChange={(e) => setV({ ...v, model: e.target.value })} placeholder="whisper-1" /></Field>
        </>
      )}
      <label className="check"><input type="checkbox" checked={s.audioEnabled} onChange={(e) => saveSettings({ audioEnabled: e.target.checked })} /> Autoriser l’enregistrement audio (désactiver pour n’utiliser que les notes écrites)</label>
      <div><button className="btn" onClick={() => saveSettings({ stt: v }).then(() => toast('Configuration enregistrée'))}>Enregistrer</button></div>
    </div>
  );
}

function Security() {
  const s = getSettings();
  const [wipe, setWipe] = useState(false);
  const exportAll = async () => {
    const out: Record<string, unknown> = { exportéLe: new Date().toISOString(), compte: getUser()?.email };
    for (const t of ['youth', 'sessions', 'notes', 'goals', 'actions', 'appointments', 'events', 'bible_recs', 'messages', 'templates', 'consents', 'transcriptions'] as const) out[t] = vault.all(t);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    a.download = `berger-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    await vault.audit('export_complet');
  };
  return (
    <div className="grid g2">
      <div className="card stack">
        <h3>Protection locale</h3>
        <p className="small muted">Toutes les données (fiches, notes, transcriptions, audios, pièces jointes) sont chiffrées sur l’appareil avec AES-256-GCM. La clé est déverrouillée par votre mot de passe et n’existe qu’en mémoire pendant la session.</p>
        <Field label="Verrouillage automatique après inactivité">
          <select className="input" value={s.autoLockMinutes} onChange={(e) => saveSettings({ autoLockMinutes: +e.target.value })}>
            {[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 heure'], [0, 'Jamais (déconseillé)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <label className="check"><input type="checkbox" checked={s.notifications} onChange={async (e) => { if (e.target.checked) await requestNotificationPermission(); saveSettings({ notifications: e.target.checked }); }} /> Notifications de rappel (sans aucune information sensible)</label>
      </div>
      <div className="card stack">
        <h3>Vos données</h3>
        <button className="btn ghost" onClick={exportAll}><Download size={16} /> Exporter toutes mes données (JSON)</button>
        <p className="small muted">Les dossiers individuels peuvent être exportés ou supprimés depuis la fiche de chaque jeune. Conservation recommandée : définir avec votre structure une durée après la fin de l’accompagnement (voir docs/SECURITE.md).</p>
        <button className="btn danger" onClick={() => setWipe(true)}><Trash2 size={16} /> Effacer les données de cet appareil</button>
      </div>
      {wipe && <WipeConfirm onClose={() => setWipe(false)} />}
    </div>
  );
}

function WipeConfirm({ onClose }: { onClose: () => void }) {
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => { db.outbox.where('ownerId').equals(vault.ownerId!).count().then(setPending); }, []);
  if (pending === null) return null;
  return (
    <Confirm danger yes={pending ? 'Effacer quand même (modifications perdues)' : 'Effacer'} onClose={onClose}
      text={pending ? <><b style={{ color: 'var(--red)' }}>{pending} modification(s) ne sont pas synchronisées</b> et seraient définitivement perdues. Synchronisez ou exportez d’abord.</> : 'Les données de votre compte seront effacées de cet appareil. Celles déjà synchronisées restent sur le serveur.'}
      onYes={async () => {
        const id = vault.ownerId!;
        await db.records.where('ownerId').equals(id).delete();
        await db.blobs.where('ownerId').equals(id).delete();
        await db.outbox.where('ownerId').equals(id).delete();
        await db.conflicts.where('ownerId').equals(id).delete();
        await db.accounts.delete(id);
        await logout();
      }} />
  );
}

function SyncPanel() {
  const st = useSyncStatus();
  const tick = useVaultTick();
  const [ops, setOps] = useState<OutboxOp[]>([]);
  const [conflicts, setConflicts] = useState<ConflictView[]>([]);
  const [server, setServer] = useState(false);
  const reload = async () => { setOps(vault.ownerId ? await db.outbox.where('ownerId').equals(vault.ownerId).toArray() : []); setConflicts(await listConflicts()); };
  useEffect(() => { reload(); }, [tick, st]);
  const configured = !!getSupabaseConfig();
  const LABEL: Record<string, string> = { hors_ligne: 'Hors ligne', en_ligne: 'En ligne', synchronisation: 'Synchronisation en cours', en_attente: 'Modifications en attente', synchronise: 'Synchronisé', erreur: 'Erreur de synchronisation', local: 'Mode local (pas de serveur)' };
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row wrap between">
          <div><b>{LABEL[st.state]}</b>{st.lastSync && <div className="small muted">Dernière synchronisation : {fmtDateTime(st.lastSync)}</div>}{st.message && <div className="small" style={{ color: 'var(--amber)' }}>{st.message}</div>}</div>
          <div className="row">
            <button className="btn ghost" onClick={() => setServer(true)}>Serveur…</button>
            <button className="btn" disabled={!configured} onClick={async () => { try { const r = await syncEngine.run(); toast(`Envoyés : ${r.pushed} · reçus : ${r.pulled}${r.conflicts ? ` · conflits : ${r.conflicts}` : ''}`); reload(); } catch (e) { toastError(e); } }}><RefreshCw size={16} /> Synchroniser</button>
          </div>
        </div>
        {!configured && <p className="small muted">Aucun serveur configuré : les données restent sur cet appareil. Les {ops.length} opération(s) enregistrées seront envoyées si un serveur est configuré.</p>}
      </div>
      {conflicts.length > 0 && (
        <div className="card stack">
          <h2>Conflits à arbitrer</h2>
          <p className="small muted">Le même élément a été modifié sur deux appareils. Rien n’a été écrasé : choisissez la version à conserver pour chaque champ, ou fusionnez.</p>
          {conflicts.map((c) => <ConflictCard key={c.key} c={c} onDone={reload} />)}
        </div>
      )}
      <div className="card stack">
        <h3>File d’opérations ({ops.length})</h3>
        {ops.length === 0 ? <p className="small muted">Aucune opération en attente.</p> : (
          <div className="scroll-x"><table className="t"><thead><tr><th>Type</th><th>Élément</th><th>Statut</th><th>Essais</th><th>Erreur</th></tr></thead><tbody>
            {ops.map((o) => <tr key={o.opId}><td>{o.table}</td><td className="tiny">{o.recordId.slice(0, 8)}</td><td>{o.status}</td><td>{o.attempts}</td><td className="tiny">{o.lastError ?? ''}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
      {server && <ServerConfig onClose={() => { setServer(false); location.reload(); }} />}
    </div>
  );
}

function ConflictCard({ c, onDone }: { c: ConflictView; onDone: () => void }) {
  const [choice, setChoice] = useState<Record<string, unknown>>(Object.fromEntries(c.fields.map((f) => [f, c.local[f]])));
  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  return (
    <div className="card flat stack" style={{ background: 'var(--surface-2)' }}>
      <div className="small"><b>{c.table}</b> · détecté le {fmtDateTime(c.detectedAt)}</div>
      {c.fields.map((f) => (
        <div key={f} className="stack s6">
          <b className="small">Champ « {f} »</b>
          <div className="grid g2">
            <label className="card flat small" style={{ cursor: 'pointer', borderColor: choice[f] === c.local[f] ? 'var(--primary)' : undefined }}><input type="radio" checked={choice[f] === c.local[f]} onChange={() => setChoice({ ...choice, [f]: c.local[f] })} /> <b>Cet appareil</b><div className="pre">{show(c.local[f])}</div></label>
            <label className="card flat small" style={{ cursor: 'pointer', borderColor: choice[f] === c.server[f] ? 'var(--primary)' : undefined }}><input type="radio" checked={choice[f] === c.server[f]} onChange={() => setChoice({ ...choice, [f]: c.server[f] })} /> <b>Autre appareil</b><div className="pre">{show(c.server[f])}</div></label>
          </div>
          {typeof c.local[f] === 'string' && <button className="btn ghost sm" onClick={() => setChoice({ ...choice, [f]: `${c.server[f]}\n\n---\n\n${c.local[f]}` })}>Fusionner les deux textes</button>}
        </div>
      ))}
      <div><button className="btn" onClick={async () => { await resolveConflict(c, choice); toast('Conflit résolu'); onDone(); }}>Appliquer</button></div>
    </div>
  );
}

function AuditLog() {
  const [rows, setRows] = useState<{ at: string; action: string; table?: string; recordId?: string }[]>([]);
  useEffect(() => { db.audit.where('ownerId').equals(vault.ownerId!).reverse().limit(300).toArray().then(setRows); }, []);
  return (
    <div className="card stack">
      <p className="small muted">Journal local des accès et modifications sur cet appareil (300 derniers). En mode serveur, un journal côté serveur est aussi tenu (table audit_logs).</p>
      {rows.length === 0 ? <Empty title="Journal vide" /> : (
        <div className="scroll-x"><table className="t"><thead><tr><th>Date</th><th>Action</th><th>Élément</th></tr></thead><tbody>
          {rows.map((r, i) => <tr key={i}><td>{fmtDateTime(r.at)}</td><td>{r.action}</td><td className="tiny">{r.table}{r.recordId ? ` · ${r.recordId.slice(0, 8)}` : ''}</td></tr>)}
        </tbody></table></div>
      )}
    </div>
  );
}

function Team() {
  const [profiles, setProfiles] = useState<{ id: string; display_name: string; role: Role; active: boolean; email?: string }[]>([]);
  const [assign, setAssign] = useState<{ youth_id: string; user_id: string; access: string }[]>([]);
  const [err, setErr] = useState('');
  const load = async () => {
    const sb = supabase();
    if (!sb) return;
    const p = await sb.from('profiles').select('id, display_name, role, active, email');
    const a = await sb.from('accompaniment_assignments').select('youth_id, user_id, access');
    if (p.error) setErr(p.error.message);
    setProfiles(p.data ?? []); setAssign(a.data ?? []);
  };
  useEffect(() => { load(); }, []);
  const youth = vault.all('youth');
  const [yid, setYid] = useState(''); const [uid, setUid] = useState(''); const [acc, setAcc] = useState('accompagnateur');
  return (
    <div className="stack">
      {err && <p className="small" style={{ color: 'var(--red)' }}>{err}</p>}
      <div className="card stack">
        <h3>Utilisateurs</h3>
        <p className="small muted">Les comptes se créent depuis l’écran de connexion ; l’administrateur attribue ensuite les rôles. Principe du moindre privilège : par défaut, un accompagnateur ne voit que ses propres dossiers.</p>
        <div className="scroll-x"><table className="t"><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Actif</th></tr></thead><tbody>
          {profiles.map((p) => (
            <tr key={p.id}><td>{p.display_name}</td><td>{p.email}</td>
              <td><select className="input" value={p.role} onChange={async (e) => { const { error } = await supabase()!.from('profiles').update({ role: e.target.value }).eq('id', p.id); if (error) toastError(error.message); load(); }}><option value="accompagnateur">Accompagnateur</option><option value="responsable">Responsable</option><option value="admin">Administrateur</option></select></td>
              <td><input type="checkbox" checked={p.active} onChange={async (e) => { await supabase()!.from('profiles').update({ active: e.target.checked }).eq('id', p.id); load(); }} /></td></tr>
          ))}
        </tbody></table></div>
      </div>
      <div className="card stack">
        <h3>Accès explicites aux dossiers</h3>
        <p className="small muted">Un responsable ne supervise que les dossiers qui lui sont explicitement attribués ici.</p>
        <div className="row wrap">
          <select className="input" style={{ width: 200 }} value={yid} onChange={(e) => setYid(e.target.value)}><option value="">Dossier…</option>{youth.map((y) => <option key={y.id} value={y.id}>{y.firstName} {y.lastName}</option>)}</select>
          <select className="input" style={{ width: 200 }} value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Utilisateur…</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select>
          <select className="input" style={{ width: 170 }} value={acc} onChange={(e) => setAcc(e.target.value)}><option value="accompagnateur">Accompagnateur</option><option value="superviseur">Supervision (lecture)</option></select>
          <button className="btn" disabled={!yid || !uid} onClick={async () => { const { error } = await supabase()!.from('accompaniment_assignments').upsert({ youth_id: yid, user_id: uid, access: acc }); if (error) toastError(error.message); else toast('Accès attribué'); load(); }}>Attribuer</button>
        </div>
        {assign.map((a, i) => (
          <div key={i} className="list-item small"><span className="grow">{youth.find((y) => y.id === a.youth_id)?.firstName ?? a.youth_id.slice(0, 8)} → {profiles.find((p) => p.id === a.user_id)?.display_name ?? a.user_id.slice(0, 8)} ({a.access})</span>
            <button className="btn ghost sm" onClick={async () => { await supabase()!.from('accompaniment_assignments').delete().eq('youth_id', a.youth_id).eq('user_id', a.user_id); load(); }}>Retirer</button></div>
        ))}
      </div>
    </div>
  );
}
