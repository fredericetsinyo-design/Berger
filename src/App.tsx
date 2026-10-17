import { useEffect, useState, useSyncExternalStore, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, NavLink, useNavigate, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, CalendarDays, CheckSquare, BookOpen, Sparkles, MessageCircle, Settings as SettingsIcon,
  Search, Plus, Lock, Moon, Sun, Menu, Bell,
} from 'lucide-react';
import { getUser, onAuthChange, lockSession, getPendingRecovery, clearPendingRecovery, getServerAuthState, getEmailLink, reconnectServer, requestPasswordReset } from './lib/auth';
import { vault, useVaultTick, usePendingOps } from './lib/store';
import { getSettings, saveSettings } from './lib/defaults';
import { useSyncStatus, startAutoSync, syncEngine } from './lib/sync';
import { startReminderLoop, subscribeReminders, getInAppReminders, dismissReminder } from './lib/reminders';
import { processPendingTranscriptions } from './lib/transcription';
import { Toasts, Modal, toast, toastError } from './components/ui';
import LoginPage, { LockScreen, RecoveryCodeModal, PasswordInput } from './pages/Login';
import Dashboard from './pages/Dashboard';
import { YouthList, YouthDetail } from './pages/Youth';
import SessionPage from './pages/Session';
import ActionsPage from './pages/Actions';
import AgendaPage from './pages/Agenda';
import MessagesPage from './pages/Messages';
import SettingsPage from './pages/Settings';
import SearchPage from './pages/SearchPage';
import { QuickCreate } from './pages/QuickCreate';

const BiblePage = lazy(() => import('./pages/Bible'));
const AssistantPage = lazy(() => import('./pages/Assistant'));

const authSnap = () => `${getUser()?.id ?? ''}|${getUser()?.role ?? ''}|${getPendingRecovery() ?? ''}|${getServerAuthState()}|${getEmailLink()?.kind ?? ''}`;
function useAuth() {
  useSyncExternalStore(onAuthChange, authSnap, authSnap);
  return getUser();
}

function applyTheme() {
  const s = vault.unlocked ? getSettings() : null;
  const root = document.documentElement;
  if (!s || s.theme === 'systeme') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme === 'sombre' ? 'dark' : 'light');
  // L'ancienne couleur par défaut (violet) est traitée comme « thème par défaut ».
  const custom = s?.primary && s.primary.toLowerCase() !== '#6c5ce7' ? s.primary : '';
  if (custom) root.style.setProperty('--primary', custom); else root.style.removeProperty('--primary');
  document.title = s?.appName || 'Berger';
}

function SyncBadge() {
  const st = useSyncStatus();
  const ops = usePendingOps();
  const nav = useNavigate();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  let cls = 'ok', label = 'Synchronisé';
  if (st.state === 'local') { cls = online ? 'ok' : 'warn'; label = online ? 'Données locales' : 'Hors ligne'; }
  else if (!online || st.state === 'hors_ligne') { cls = 'warn'; label = ops.pending ? `Hors ligne · ${ops.pending} en attente` : 'Hors ligne'; }
  else if (st.state === 'synchronisation') { cls = 'busy'; label = 'Synchronisation…'; }
  else if (ops.conflicts) { cls = 'err'; label = `${ops.conflicts} conflit(s)`; }
  else if (st.state === 'erreur' || ops.failed) { cls = 'err'; label = 'Erreur de synchronisation'; }
  else if (ops.pending) { cls = 'warn'; label = `${ops.pending} modification(s) en attente`; }
  else if (st.state === 'en_ligne') { label = 'En ligne'; }
  return (
    <button className={`sync ${cls}`} title={st.message ?? label} onClick={() => { syncEngine.run().catch(() => undefined); nav('/reglages?onglet=sync'); }}>
      <span className="dot" /> <span className="hide-mobile">{label}</span>
    </button>
  );
}

function ReminderBell() {
  const list = useSyncExternalStore(subscribeReminders, getInAppReminders);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <>
      <button className="btn ghost icon" aria-label="Rappels" onClick={() => setOpen(true)} style={{ position: 'relative' }}>
        <Bell size={18} />
        {list.length > 0 && <span className="badge red" style={{ position: 'absolute', top: -4, right: -4, padding: '0 6px' }}>{list.length}</span>}
      </button>
      {open && (
        <Modal title="Rappels" onClose={() => setOpen(false)}>
          {list.length === 0 ? <p className="muted">Aucun rappel pour le moment.</p> : (
            <div className="list">
              {list.map((r) => (
                <div key={r.id} className="list-item">
                  <Bell size={16} />
                  <button className="grow" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }} onClick={() => { setOpen(false); nav(r.link); }}>{r.text}</button>
                  <button className="btn ghost sm" onClick={() => dismissReminder(r.id)}>Vu</button>
                </div>
              ))}
            </div>
          )}
          <p className="tiny faint mt16">Les rappels s’affichent quand l’application est ouverte. Le texte des notifications ne révèle aucune information sur les jeunes.</p>
        </Modal>
      )}
    </>
  );
}

const NAV = [
  ['/', 'Tableau de bord', LayoutDashboard],
  ['/jeunes', 'Jeunes', Users],
  ['/agenda', 'Agenda', CalendarDays],
  ['/actions', 'Actions', CheckSquare],
  ['/bible', 'Bible', BookOpen],
  ['/assistant', 'Assistant IA', Sparkles],
  ['/relances', 'Relances', MessageCircle],
  ['/reglages', 'Réglages', SettingsIcon],
] as const;

function Shell() {
  useVaultTick();
  const s = getSettings();
  const user = getUser()!;
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { applyTheme(); });
  useEffect(() => { setMore(false); }, [loc.pathname]);
  const pendingActions = vault.all('actions').filter((a) => a.status === 'a_faire' || a.status === 'en_cours').length;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (s.theme === 'systeme' && matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          {s.logo ? <img src={s.logo} alt="" /> : <img className="logo" src="icon.svg" alt="" />}
          <div>{s.appName || 'Berger'}<small>Assistant d’accompagnement</small></div>
        </div>
        {NAV.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon size={18} /> {label}
            {to === '/actions' && pendingActions > 0 && <span className="count">{pendingActions}</span>}
          </NavLink>
        ))}
        <div className="spacer" />
        <button className="btn" onClick={() => setQuick(true)}><Plus size={16} /> Nouveau</button>
        <div className="row small muted mt8" style={{ padding: '0 6px' }}>
          <span className="grow ellipsis">{user.displayName}</span>
          <button className="btn ghost sm icon" title="Verrouiller" onClick={lockSession}><Lock size={14} /></button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <img src={s.logo || 'icon.svg'} alt="" className="show-mobile" style={{ width: 34, height: 34, borderRadius: 10 }} />
          <form className="search-box" onSubmit={(e) => { e.preventDefault(); nav(`/recherche?q=${encodeURIComponent(q)}`); }}>
            <Search size={16} />
            <input placeholder="Rechercher un jeune, une note, un verset…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Recherche globale" />
          </form>
          <SyncBadge />
          <ReminderBell />
          <button className="btn ghost icon hide-mobile" aria-label="Changer de thème" onClick={() => saveSettings({ theme: dark ? 'clair' : 'sombre' })}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        </header>
        <main className="content">
          <Suspense fallback={<div className="stack"><div className="skeleton" style={{ height: 40, width: 220 }} /><div className="skeleton" style={{ height: 180 }} /></div>}>
            <div className="page" key={loc.pathname}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/jeunes" element={<YouthList />} />
              <Route path="/jeunes/:id" element={<YouthDetail />} />
              <Route path="/rencontres/:id" element={<SessionPage />} />
              <Route path="/actions" element={<ActionsPage />} />
              <Route path="/agenda" element={<AgendaPage />} />
              <Route path="/bible" element={<BiblePage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/relances" element={<MessagesPage />} />
              <Route path="/reglages" element={<SettingsPage />} />
              <Route path="/recherche" element={<SearchPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
            </div>
          </Suspense>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navigation principale">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><LayoutDashboard size={20} />Accueil</NavLink>
        <NavLink to="/jeunes" className={({ isActive }) => (isActive ? 'active' : '')}><Users size={20} />Jeunes</NavLink>
        <button className="fab" aria-label="Nouveau" onClick={() => setQuick(true)}><Plus size={24} /></button>
        <NavLink to="/agenda" className={({ isActive }) => (isActive ? 'active' : '')}><CalendarDays size={20} />Agenda</NavLink>
        <button onClick={() => setMore(true)}><Menu size={20} />Plus</button>
      </nav>

      {more && (
        <Modal title="Menu" onClose={() => setMore(false)}>
          <div className="grid g2">
            {NAV.slice(3).map(([to, label, Icon]) => (
              <NavLink key={to} to={to} className="list-item"><Icon size={18} /> {label}</NavLink>
            ))}
            <button className="list-item" style={{ border: 0, cursor: 'pointer' }} onClick={() => saveSettings({ theme: dark ? 'clair' : 'sombre' })}>{dark ? <Sun size={18} /> : <Moon size={18} />} Thème {dark ? 'clair' : 'sombre'}</button>
            <button className="list-item" style={{ border: 0, cursor: 'pointer' }} onClick={lockSession}><Lock size={18} /> Verrouiller</button>
          </div>
        </Modal>
      )}
      {quick && <QuickCreate onClose={() => setQuick(false)} />}
    </div>
  );
}

/** Bandeau discret : les dossiers sont ouverts, mais le serveur attend une reconnexion pour synchroniser. */
function ServerBanner() {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="server-banner" role="status">
        <span>Synchronisation en pause : le serveur demande votre mot de passe.</span>
        <button className="btn sm" onClick={() => setOpen(true)}>Se reconnecter</button>
      </div>
      {open && (
        <Modal title="Reconnexion au serveur" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try { const st = await reconnectServer(pwd); if (st === 'ok') { toast('Reconnecté : la synchronisation reprend.'); setOpen(false); syncEngine.run().catch(() => undefined); } }
            catch (err) { toastError(err); } finally { setBusy(false); }
          }}>
            <p className="small muted">Vos dossiers restent accessibles. Saisissez le mot de passe de votre compte serveur ({getUser()?.email}) pour reprendre la synchronisation.</p>
            <PasswordInput value={pwd} onChange={setPwd} autoFocus />
            <button className="btn" disabled={busy}>{busy ? 'Patientez…' : 'Se reconnecter'}</button>
            <button type="button" className="btn ghost sm" onClick={async () => { try { await requestPasswordReset(getUser()!.email); toast('Un lien de réinitialisation a été envoyé par e-mail.'); } catch (err) { toastError(err); } }}>Mot de passe du serveur oublié ?</button>
          </form>
        </Modal>
      )}
    </>
  );
}

function useAutoLock() {
  useEffect(() => {
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evts = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    evts.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (!vault.unlocked) return;
      const mins = getSettings().autoLockMinutes;
      if (mins > 0 && Date.now() - last > mins * 60_000) lockSession();
    }, 15_000);
    return () => { evts.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); };
  }, []);
}

export default function App() {
  const user = useAuth();
  const tick = useVaultTick();
  useAutoLock();
  useEffect(() => { applyTheme(); }, [tick]);
  useEffect(() => {
    if (!user || !vault.unlocked) return;
    startAutoSync();
    startReminderLoop();
    const online = () => processPendingTranscriptions().catch(() => undefined);
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [user, vault.unlocked]);
  const serverState = getServerAuthState();
  useEffect(() => { if (serverState === 'ok' && vault.unlocked) syncEngine.run().catch(() => undefined); }, [serverState]);

  return (
    <HashRouter>
      {user && vault.unlocked && serverState === 'mot_de_passe' && <ServerBanner />}
      {!user ? <LoginPage /> : !vault.unlocked ? <LockScreen /> : <Shell />}
      {user && getPendingRecovery() && <RecoveryCodeModal code={getPendingRecovery()!} onDone={clearPendingRecovery} />}
      <Toasts />
    </HashRouter>
  );
}
