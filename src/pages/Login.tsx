import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Mail, Server, ShieldCheck, WifiOff } from 'lucide-react';
import {
  login, registerLocal, signUpSupabase, requestPasswordReset, resetLocalWithRecovery, logout, getUser,
  recoverLocalAccess, setNewServerPassword, AuthError, pendingCountFor, deviceAccounts, unlock,
  getEmailLink, clearEmailLink,
} from '../lib/auth';
import { getSupabaseConfig, setSupabaseConfig } from '../lib/supabase';
import { Field, Pills, Modal, toastError, toast } from '../components/ui';

function AuthSide() {
  return (
    <div className="auth-side" aria-hidden="true">
      <img className="hero" src="img/mentorat.webp" alt="" decoding="async" />
      <div className="quote-card">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600 }}>Chaque jeune a une histoire.</div>
        <div className="small" style={{ opacity: .9 }}>Écoutez, notez, suivez — et gardez du temps pour la relation.</div>
      </div>
    </div>
  );
}

/** Champ mot de passe avec bouton « afficher » : évite les erreurs de saisie et de remplissage automatique. */
export function PasswordInput({ value, onChange, isNew, autoFocus, minLength }: { value: string; onChange: (v: string) => void; isNew?: boolean; autoFocus?: boolean; minLength?: number }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pwd">
      <input className="input" type={show ? 'text' : 'password'} required minLength={minLength} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} autoComplete={isNew ? 'new-password' : 'current-password'}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="eye" onClick={() => setShow((x) => !x)} aria-label={show ? 'Masquer' : 'Afficher'} title={show ? 'Masquer' : 'Afficher'}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export function RecoveryCodeModal({ code, onDone }: { code: string; onDone: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <Modal title="Votre clé de secours" onClose={() => ok && onDone()}>
      <div className="stack">
        <p>Vos dossiers sont chiffrés sur cet appareil. Si vous oubliez votre mot de passe, <b>seule cette clé</b> permettra de les récupérer. Elle ne sera plus jamais affichée.</p>
        <div className="recovery">{code}</div>
        <div className="row">
          <button className="btn secondary sm" onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Clé copiée'))}>Copier</button>
        </div>
        <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> J’ai conservé cette clé dans un endroit sûr (papier, gestionnaire de mots de passe).</label>
        <button className="btn" disabled={!ok} onClick={onDone}>Continuer</button>
      </div>
    </Modal>
  );
}

export default function LoginPage() {
  const hasServer = !!getSupabaseConfig();
  const [mode, setMode] = useState<'connexion' | 'creation' | 'oubli'>('connexion');
  const [oubli, setOubli] = useState<'email' | 'cle'>(hasServer ? 'email' : 'cle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [recovery, setRecovery] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [needOld, setNeedOld] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const link = getEmailLink();
  const [, force] = useState(0);
  useEffect(() => {
    // Pré-remplit l'e-mail du dernier compte utilisé sur cet appareil.
    deviceAccounts().then((a) => { const last = a.filter((x) => x.lastLoginAt).sort((x, y) => y.lastLoginAt!.localeCompare(x.lastLoginAt!))[0]; if (last) setEmail((e) => e || last.email); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (link?.kind === 'erreur') { setError(link.message); clearEmailLink(); }
    else if (link?.kind === 'signup') { setInfo('E-mail confirmé. Vous pouvez vous connecter.'); clearEmailLink(); }
  }, [link]);
  const go = (m: typeof mode) => { setMode(m); setError(''); setInfo(''); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setInfo('');
    try {
      if (mode === 'connexion') {
        const r = await login(email, password);
        if (r.offline) toast('Connexion hors ligne : vos dossiers sont accessibles. La synchronisation reprendra avec le réseau.');
      } else if (mode === 'creation') {
        if (hasServer) {
          const r = await signUpSupabase(email, password, name);
          if (!r) { setMode('connexion'); setInfo('Compte créé. Un e-mail de confirmation vous a été envoyé : ouvrez le lien (vérifiez les spams), puis connectez-vous ici.'); }
        } else {
          await registerLocal(email, password, name);
        }
      } else if (oubli === 'email') {
        await requestPasswordReset(email);
        setInfo('Si un compte existe pour cette adresse, un e-mail avec un lien vient d’être envoyé. Ouvrez-le sur cet appareil.');
      } else {
        await resetLocalWithRecovery(email, recovery, newPwd);
        setPassword(newPwd); setNewPwd(''); setRecovery('');
        setMode('connexion');
        setInfo(hasServer ? 'Mot de passe de l’appareil modifié. Connectez-vous avec le nouveau. Si le serveur demande l’ancien, utilisez « Recevoir un lien par e-mail ».' : 'Mot de passe modifié. Connectez-vous avec le nouveau.');
      }
    } catch (err) {
      if (err instanceof AuthError && err.code === 'cle_locale' && hasServer) setNeedOld(true);
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };

  const label = mode === 'connexion' ? 'Se connecter' : mode === 'creation' ? 'Créer le compte' : oubli === 'email' ? 'Recevoir le lien' : 'Changer le mot de passe';

  return (
    <div className="auth-wrap">
      <AuthSide />
      <div className="auth-main">
      <div className="auth-card stack s18 page">
        <div className="row" style={{ gap: 12 }}>
          <img src="icon.svg" alt="" width={52} height={52} style={{ borderRadius: 16, boxShadow: 'var(--shadow)' }} />
          <div>
            <h1>Berger</h1>
            <p className="muted small">Assistant d’accompagnement des jeunes</p>
          </div>
        </div>
        <form className="card stack" onSubmit={submit} noValidate={false}>
          <Pills value={mode} onChange={go} options={[['connexion', 'Connexion'], ['creation', 'Créer un compte']]} />
          {mode === 'oubli' && <h3 style={{ margin: 0 }}>Mot de passe oublié</h3>}
          {mode === 'creation' && <Field label="Nom affiché"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
          <Field label="E-mail">
            <input className="input" type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" />
          </Field>
          {mode !== 'oubli' && (
            <Field label="Mot de passe" hint={mode === 'creation' ? '10 caractères minimum. Il protège aussi le chiffrement de vos dossiers.' : undefined}>
              <PasswordInput value={password} onChange={setPassword} isNew={mode === 'creation'} minLength={mode === 'creation' ? 10 : undefined} />
            </Field>
          )}
          {mode === 'oubli' && (
            <>
              {hasServer && <Pills value={oubli} onChange={(v) => { setOubli(v); setError(''); setInfo(''); }} options={[['email', 'Lien par e-mail'], ['cle', 'Clé de secours']]} />}
              {oubli === 'email'
                ? <p className="small muted"><Mail size={14} style={{ verticalAlign: -2 }} /> Vous recevrez un lien pour choisir un nouveau mot de passe. Ouvrez-le sur cet appareil.</p>
                : <>
                    <p className="small muted"><KeyRound size={14} style={{ verticalAlign: -2 }} /> La clé de secours affichée à la création du compte permet de rouvrir les dossiers de cet appareil, même hors ligne.</p>
                    <Field label="Clé de secours"><input className="input" required value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXX-XXXX-…" autoCapitalize="characters" autoCorrect="off" spellCheck={false} /></Field>
                    <Field label="Nouveau mot de passe" hint="10 caractères minimum."><PasswordInput value={newPwd} onChange={setNewPwd} isNew minLength={10} /></Field>
                  </>}
            </>
          )}
          {error && <p className="auth-msg err" role="alert">{error}</p>}
          {info && <p className="auth-msg ok" role="status">{info}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Patientez…' : label}</button>
          {mode === 'connexion'
            ? <button type="button" className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => go('oubli')}>Mot de passe oublié ?</button>
            : mode === 'oubli' && <button type="button" className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => go('connexion')}>Retour à la connexion</button>}
        </form>
        <div className="card flat stack s6 small">
          <div className="row"><ShieldCheck size={16} color="var(--green)" /><span>Dossiers chiffrés sur l’appareil (AES-256).</span></div>
          <div className="row"><WifiOff size={16} color="var(--primary)" /><span>Fonctionne hors ligne après la première connexion.</span></div>
          <div className="row between">
            <span className="row"><Server size={16} color="var(--muted)" />{hasServer ? 'Synchronisation : serveur configuré' : 'Mode local (sans serveur)'}</span>
            <button type="button" className="btn ghost sm" onClick={() => setServerOpen(true)}>Détails</button>
          </div>
        </div>
      </div>
      </div>

      {serverOpen && <ServerConfig onClose={() => { setServerOpen(false); force((x) => x + 1); }} />}
      {needOld && (
        <OldPasswordModal email={email} newPassword={password} onClose={() => setNeedOld(false)} />
      )}
      {link?.kind === 'recovery' && hasServer && <ServerResetModal onClose={(pwd) => { clearEmailLink(); if (pwd) { setPassword(pwd); setMode('connexion'); setInfo('Nouveau mot de passe enregistré. Touchez « Se connecter ».'); } }} />}
    </div>
  );
}

function OldPasswordModal({ email, newPassword, onClose }: { email: string; newPassword: string; onClose: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal title="Déverrouiller les données de cet appareil" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await recoverLocalAccess(email, newPassword, v); onClose(); } catch { toastError(new Error('Ni l’ancien mot de passe ni la clé de secours ne correspondent.')); } }}>
        <p className="small muted">Votre mot de passe a changé sur le serveur. Les dossiers enregistrés sur cet appareil sont encore protégés par l’ancien. Saisissez l’ancien mot de passe ou votre clé de secours.</p>
        <Field label="Ancien mot de passe ou clé de secours"><PasswordInput value={v} onChange={setV} autoFocus /></Field>
        <button className="btn">Déverrouiller</button>
      </form>
    </Modal>
  );
}

function ServerResetModal({ onClose }: { onClose: (newPassword?: string) => void }) {
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Choisir un nouveau mot de passe" onClose={() => onClose()}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await setNewServerPassword(p); onClose(p); } catch (err) { toastError(err); } finally { setBusy(false); } }}>
        <p className="small muted">Ensuite, connectez-vous avec ce nouveau mot de passe. Si des dossiers sont déjà enregistrés sur cet appareil, l’application vous demandera une seule fois l’ancien mot de passe ou votre clé de secours pour les rouvrir.</p>
        <Field label="Nouveau mot de passe" hint="10 caractères minimum."><PasswordInput value={p} onChange={setP} isNew minLength={10} autoFocus /></Field>
        <button className="btn" disabled={busy}>{busy ? 'Patientez…' : 'Enregistrer'}</button>
      </form>
    </Modal>
  );
}

export function ServerConfig({ onClose }: { onClose: () => void }) {
  const cur = getSupabaseConfig();
  const [url, setUrl] = useState(cur?.url ?? '');
  const [key, setKey] = useState(cur?.anonKey ?? '');
  const fromEnv = !!import.meta.env.VITE_SUPABASE_URL;
  return (
    <Modal title="Serveur de synchronisation" onClose={onClose}>
      <div className="stack">
        <p className="small muted">Optionnel. Sans serveur, l’application fonctionne entièrement sur cet appareil. Avec Supabase, vos dossiers sont synchronisés entre appareils et partagés selon les rôles. Voir docs/CONFIGURATION.md.</p>
        {fromEnv && <p className="badge blue">Configuré par l’administrateur (variables d’environnement)</p>}
        <Field label="URL du projet Supabase"><input className="input" value={url} disabled={fromEnv} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></Field>
        <Field label="Clé publique (anon)"><input className="input" value={key} disabled={fromEnv} onChange={(e) => setKey(e.target.value)} /></Field>
        <div className="row">
          <button className="btn" disabled={fromEnv || !url || !key} onClick={() => { setSupabaseConfig({ url: url.trim(), anonKey: key.trim() }); onClose(); }}>Enregistrer</button>
          {cur && !fromEnv && <button className="btn danger" onClick={() => { setSupabaseConfig(null); onClose(); }}>Revenir au mode local</button>}
        </div>
      </div>
    </Modal>
  );
}

export function LockScreen() {
  const user = getUser()!;
  const [pwd, setPwd] = useState('');
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { pendingCountFor(user.id).then(setPending); }, [user.id]);
  return (
    <div className="auth-wrap">
      <AuthSide />
      <div className="auth-main">
      <form className="card auth-card stack page" onSubmit={async (e) => { e.preventDefault(); if (busy) return; setBusy(true); setErr(''); try { await unlock(pwd); } catch (er) { setErr((er as Error).message); } finally { setBusy(false); } }}>
        <div className="row"><Lock size={20} color="var(--primary)" /><h2>Session verrouillée</h2></div>
        <p className="muted small">Connecté en tant que <b>{user.displayName}</b> ({user.email}).</p>
        <Field label="Mot de passe"><PasswordInput value={pwd} onChange={setPwd} autoFocus /></Field>
        {err && <p className="auth-msg err" role="alert">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Patientez…' : 'Déverrouiller'}</button>
        <hr className="sep" />
        {pending > 0 && <p className="small" style={{ color: 'var(--amber)' }}>{pending} modification(s) non synchronisée(s) : elles restent chiffrées sur l’appareil et seront envoyées à la prochaine connexion de ce compte.</p>}
        <button type="button" className="btn ghost" onClick={() => logout()}>Changer d’utilisateur ou mot de passe oublié</button>
      </form>
      </div>
    </div>
  );
}
