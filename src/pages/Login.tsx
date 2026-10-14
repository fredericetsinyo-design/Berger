import { useEffect, useState } from 'react';
import { Lock, Server, ShieldCheck, WifiOff } from 'lucide-react';
import {
  login, registerLocal, signUpSupabase, requestPasswordReset, resetLocalWithRecovery, logout, getUser,
  recoverLocalAccess, setNewServerPassword, AuthError, pendingCountFor, deviceAccounts,
} from '../lib/auth';
import { getSupabaseConfig, setSupabaseConfig } from '../lib/supabase';
import { Field, Pills, Modal, toastError, toast } from '../components/ui';

function AuthSide() {
  return (
    <div className="auth-side" aria-hidden="true">
      <div className="mosaic">
        <img src="img/joie.webp" alt="" />
        <img src="img/duo.webp" alt="" />
        <img src="img/mentorat.webp" alt="" />
      </div>
      <div className="quote-card">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600 }}>Chaque jeune a une histoire.</div>
        <div className="small" style={{ opacity: .9 }}>Écoutez, notez, suivez — et gardez du temps pour la relation.</div>
      </div>
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [needOld, setNeedOld] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [resetMode, setResetMode] = useState(location.hash.includes('reinitialisation'));
  const [, force] = useState(0);
  useEffect(() => {
    // Pré-remplit l'e-mail du dernier compte utilisé sur cet appareil (reconnexion hors ligne facilitée).
    deviceAccounts().then((a) => { const last = a.filter((x) => x.lastLoginAt).sort((x, y) => y.lastLoginAt!.localeCompare(x.lastLoginAt!))[0]; if (last) setEmail((e) => e || last.email); });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'connexion') {
        const r = await login(email, password);
        if (r.offline) toast('Connexion hors ligne : vos données locales sont accessibles. La synchronisation reprendra avec le réseau.');
      } else if (mode === 'creation') {
        if (hasServer) {
          await signUpSupabase(email, password, name);
          toast('Compte créé. Confirmez votre e-mail si demandé, puis connectez-vous.');
          setMode('connexion');
        } else {
          await registerLocal(email, password, name);
        }
      } else {
        if (hasServer) { await requestPasswordReset(email); toast('Un e-mail de réinitialisation a été envoyé.'); }
        else { await resetLocalWithRecovery(email, recovery, newPwd); toast('Mot de passe modifié. Connectez-vous.'); setMode('connexion'); }
      }
    } catch (err) {
      if (err instanceof AuthError && err.code === 'cle_locale' && hasServer) setNeedOld(true);
      toastError(err);
    } finally { setBusy(false); }
  };

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
        <form className="card stack" onSubmit={submit}>
          <Pills value={mode} onChange={setMode} options={[['connexion', 'Connexion'], ['creation', 'Créer un compte'], ['oubli', 'Mot de passe oublié']]} />
          {mode === 'creation' && <Field label="Nom affiché"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
          <Field label="E-mail"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
          {mode !== 'oubli' && (
            <Field label="Mot de passe" hint={mode === 'creation' ? '10 caractères minimum. Il protège aussi le chiffrement de vos dossiers.' : undefined}>
              <input className="input" type="password" required minLength={mode === 'creation' ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'creation' ? 'new-password' : 'current-password'} />
            </Field>
          )}
          {mode === 'oubli' && !hasServer && (
            <>
              <Field label="Clé de secours"><input className="input" required value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXX-XXXX-…" /></Field>
              <Field label="Nouveau mot de passe"><input className="input" type="password" minLength={10} required value={newPwd} onChange={(e) => setNewPwd(e.target.value)} /></Field>
            </>
          )}
          {mode === 'oubli' && hasServer && <p className="small muted">Un lien vous sera envoyé par e-mail. Sur cet appareil, vos données locales resteront accessibles avec votre ancien mot de passe ou votre clé de secours.</p>}
          <button className="btn" disabled={busy}>{busy ? 'Patientez…' : mode === 'connexion' ? 'Se connecter' : mode === 'creation' ? 'Créer le compte' : 'Réinitialiser'}</button>
        </form>
        <div className="card flat stack s6 small">
          <div className="row"><ShieldCheck size={16} color="var(--green)" /><span>Dossiers chiffrés sur l’appareil (AES-256).</span></div>
          <div className="row"><WifiOff size={16} color="var(--primary)" /><span>Fonctionne hors ligne après la première connexion.</span></div>
          <div className="row between">
            <span className="row"><Server size={16} color="var(--muted)" />{hasServer ? 'Synchronisation : serveur configuré' : 'Mode local (sans serveur)'}</span>
            <button type="button" className="btn ghost sm" onClick={() => setServerOpen(true)}>Configurer</button>
          </div>
        </div>
      </div>
      </div>

      {serverOpen && <ServerConfig onClose={() => { setServerOpen(false); force((x) => x + 1); }} />}
      {needOld && (
        <OldPasswordModal email={email} newPassword={password} onClose={() => setNeedOld(false)} />
      )}
      {resetMode && hasServer && <ServerResetModal onClose={() => { setResetMode(false); location.hash = '#/'; }} />}
    </div>
  );
}

function OldPasswordModal({ email, newPassword, onClose }: { email: string; newPassword: string; onClose: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal title="Déverrouiller les données de cet appareil" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await recoverLocalAccess(email, newPassword, v); onClose(); } catch (err) { toastError(err); } }}>
        <p className="small muted">Votre mot de passe a changé sur le serveur. Les dossiers enregistrés sur cet appareil sont encore protégés par l’ancien. Saisissez l’ancien mot de passe ou votre clé de secours.</p>
        <Field label="Ancien mot de passe ou clé de secours"><input className="input" type="password" required value={v} onChange={(e) => setV(e.target.value)} /></Field>
        <button className="btn">Déverrouiller</button>
      </form>
    </Modal>
  );
}

function ServerResetModal({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState('');
  return (
    <Modal title="Nouveau mot de passe" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await setNewServerPassword(p); toast('Mot de passe modifié.'); onClose(); } catch (err) { toastError(err); } }}>
        <Field label="Nouveau mot de passe"><input className="input" type="password" minLength={10} required value={p} onChange={(e) => setP(e.target.value)} /></Field>
        <button className="btn">Enregistrer</button>
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
  useEffect(() => { pendingCountFor(user.id).then(setPending); }, [user.id]);
  return (
    <div className="auth-wrap">
      <AuthSide />
      <div className="auth-main">
      <form className="card auth-card stack page" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await login(user.email, pwd); } catch (err) { toastError(err); } finally { setBusy(false); } }}>
        <div className="row"><Lock size={20} color="var(--primary)" /><h2>Session verrouillée</h2></div>
        <p className="muted small">Connecté en tant que <b>{user.displayName}</b> ({user.email}).</p>
        <Field label="Mot de passe"><input className="input" type="password" autoFocus required value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field>
        <button className="btn" disabled={busy}>Déverrouiller</button>
        <hr className="sep" />
        {pending > 0 && <p className="small" style={{ color: 'var(--amber)' }}>{pending} modification(s) non synchronisée(s) : elles restent chiffrées sur l’appareil et seront envoyées à la prochaine connexion de ce compte.</p>}
        <button type="button" className="btn ghost" onClick={() => logout()}>Changer d’utilisateur</button>
      </form>
      </div>
    </div>
  );
}
