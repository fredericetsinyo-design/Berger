import { db, type DeviceAccount } from './db';
import { deriveKey, fromB64, open, randomBytes, seal, toB64, uuid, PBKDF2_ITERATIONS } from './crypto';
import { vault } from './store';
import { supabase, isOnline } from './supabase';
import type { UserProfile, Role } from './types';
import { ensureDefaults } from './defaults';

// Authentification
// - Mode « local » : comptes propres à l'appareil (aucun serveur). Idéal pour démarrer seul.
// - Mode « supabase » : Supabase Auth + synchronisation. Fonctionne aussi hors ligne
//   après une première connexion (déverrouillage local par le mot de passe).
// Dans les deux modes, une clé de données aléatoire chiffre les dossiers ; elle est protégée
// par le mot de passe ET par une clé de secours affichée une seule fois à la création.

export class AuthError extends Error {
  constructor(message: string, public code: 'identifiants' | 'cle_locale' | 'reseau' | 'existe' | 'inconnu' = 'inconnu') { super(message); }
}

let currentUser: UserProfile | null = null;
const listeners = new Set<() => void>();
export const onAuthChange = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const emit = () => listeners.forEach((l) => l());
export const getUser = () => currentUser;

// Clé de secours à afficher une seule fois après la création du compte sur l'appareil.
let pendingRecovery: string | null = null;
export const getPendingRecovery = () => pendingRecovery;
export function clearPendingRecovery() { pendingRecovery = null; emit(); }

function recoveryCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = randomBytes(24);
  const chars = [...b].map((x) => alphabet[x % alphabet.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

async function newDataKey(): Promise<{ key: CryptoKey; raw: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = toB64(await crypto.subtle.exportKey('raw', key));
  return { key, raw };
}

async function importDataKey(raw: string) {
  return crypto.subtle.importKey('raw', fromB64(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function createDeviceAccount(p: { id: string; email: string; displayName: string; role: Role; mode: 'local' | 'supabase'; password: string }) {
  const { key, raw } = await newDataKey();
  const salt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const code = recoveryCode();
  const kek = await deriveKey(p.password, salt);
  const rek = await deriveKey(code.replace(/-/g, ''), recoverySalt);
  const account: DeviceAccount = {
    id: p.id, email: p.email.toLowerCase(), displayName: p.displayName, role: p.role, mode: p.mode,
    salt: toB64(salt), iterations: PBKDF2_ITERATIONS, wrappedKey: await seal(kek, raw),
    recoverySalt: toB64(recoverySalt), wrappedKeyRecovery: await seal(rek, raw),
    createdAt: new Date().toISOString(),
  };
  await db.accounts.put(account);
  return { account, key, recoveryCode: code };
}

async function unwrapWithPassword(account: DeviceAccount, password: string): Promise<CryptoKey> {
  try {
    const kek = await deriveKey(password, fromB64(account.salt), account.iterations);
    const raw = await open<string>(kek, account.wrappedKey);
    return importDataKey(raw);
  } catch {
    throw new AuthError('Mot de passe incorrect pour les données de cet appareil.', 'cle_locale');
  }
}

export async function unwrapWithRecovery(account: DeviceAccount, code: string): Promise<CryptoKey> {
  try {
    const rek = await deriveKey(code.replace(/[-\s]/g, '').toUpperCase(), fromB64(account.recoverySalt), account.iterations);
    const raw = await open<string>(rek, account.wrappedKeyRecovery);
    return importDataKey(raw);
  } catch {
    throw new AuthError('Clé de secours incorrecte.', 'cle_locale');
  }
}

/** Ré-enveloppe la clé de données avec un nouveau mot de passe (aucune donnée n'est ré-chiffrée). */
export async function rewrapPassword(accountId: string, dataKey: CryptoKey, newPassword: string) {
  const account = await db.accounts.get(accountId);
  if (!account) throw new AuthError('Compte introuvable');
  const salt = randomBytes(16);
  const kek = await deriveKey(newPassword, salt);
  const raw = toB64(await crypto.subtle.exportKey('raw', dataKey));
  await db.accounts.update(accountId, { salt: toB64(salt), iterations: PBKDF2_ITERATIONS, wrappedKey: await seal(kek, raw) });
}

async function startSession(account: DeviceAccount, key: CryptoKey) {
  await vault.unlock(account.id, key);
  await db.accounts.update(account.id, { lastLoginAt: new Date().toISOString(), locked: false });
  currentUser = { id: account.id, email: account.email, displayName: account.displayName, role: account.role, mode: account.mode };
  await ensureDefaults(currentUser);
  await vault.audit('connexion');
  emit();
  return currentUser;
}

// ---------------- Mode local ----------------
export async function registerLocal(email: string, password: string, displayName: string) {
  if (password.length < 10) throw new AuthError('Le mot de passe doit contenir au moins 10 caractères.');
  email = normEmail(email);
  const existing = await findAccount(email);
  if (existing) throw new AuthError('Un compte existe déjà avec cet e-mail sur cet appareil. Utilisez « Connexion ».', 'existe');
  const { account, key, recoveryCode } = await createDeviceAccount({ id: uuid(), email, displayName, role: 'admin', mode: 'local', password });
  pendingRecovery = recoveryCode;
  await startSession(account, key);
  return { recoveryCode };
}

// ---------------- Connexion au serveur (en arrière-plan) ----------------
// L'accès aux dossiers de l'appareil ne dépend jamais du serveur : il suffit du mot de passe local.
// La session serveur sert uniquement à la synchronisation ; si elle manque, on le signale sans bloquer.
export type ServerAuthState = 'inutile' | 'verification' | 'ok' | 'mot_de_passe' | 'hors_ligne' | 'desactive';
let serverState: ServerAuthState = 'inutile';
export const getServerAuthState = () => serverState;
function setServerState(s: ServerAuthState) { serverState = s; emit(); }

const normEmail = (e: string) => e.trim().toLowerCase();

function serverMessage(error: { message?: string; code?: string; status?: number }) {
  const code = error.code ?? '';
  const msg = error.message ?? '';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return new AuthError('Votre e-mail n’est pas encore confirmé. Ouvrez le lien reçu par e-mail (vérifiez les spams), puis reconnectez-vous.', 'identifiants');
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error.status === 429) return new AuthError('Trop de tentatives. Patientez quelques minutes avant de réessayer.', 'reseau');
  if (/fetch|network|Failed to fetch|Load failed/i.test(msg)) return new AuthError('Serveur injoignable. Vérifiez votre connexion Internet.', 'reseau');
  if (code === 'invalid_credentials' || /invalid login/i.test(msg)) return new AuthError('E-mail ou mot de passe incorrect.', 'identifiants');
  return new AuthError(msg || 'Connexion au serveur impossible.', 'inconnu');
}

async function checkProfile(userId: string) {
  const sb = supabase()!;
  const { data: prof } = await sb.from('profiles').select('display_name, role, active').eq('id', userId).maybeSingle();
  return prof as { display_name?: string; role?: Role; active?: boolean } | null;
}

/** Vérifie (ou rétablit) la session serveur du compte déverrouillé, sans jamais bloquer l'accès local. */
export async function ensureServerSession(password?: string): Promise<ServerAuthState> {
  const sb = supabase();
  const u = currentUser;
  if (!sb || !u || u.mode !== 'supabase') { setServerState('inutile'); return serverState; }
  if (!isOnline()) { setServerState('hors_ligne'); return serverState; }
  setServerState('verification');
  try {
    const { data } = await sb.auth.getSession();
    let ok = data.session?.user.id === u.id;
    if (!ok && data.session) await sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
    if (!ok && password) {
      const r = await sb.auth.signInWithPassword({ email: u.email, password });
      if (r.error) {
        const err = serverMessage(r.error);
        setServerState(err.code === 'reseau' ? 'hors_ligne' : 'mot_de_passe');
        return serverState;
      }
      ok = r.data.user?.id === u.id;
    }
    if (!ok) { setServerState('mot_de_passe'); return serverState; }
    const prof = await checkProfile(u.id).catch(() => null);
    if (prof?.active === false) {
      setServerState('desactive');
      await revokeLocalAccess(u.id);
      return serverState;
    }
    if (prof && (prof.role !== u.role || prof.display_name !== u.displayName)) {
      const role = (prof.role as Role) ?? u.role, displayName = prof.display_name ?? u.displayName;
      await db.accounts.update(u.id, { role, displayName });
      currentUser = { ...u, role, displayName };
    }
    setServerState('ok');
  } catch {
    setServerState('hors_ligne');
  }
  return serverState;
}

/** Reconnexion au serveur depuis l'application (si le mot de passe du serveur diffère de celui de l'appareil). */
export async function reconnectServer(password: string) {
  const sb = supabase();
  const u = currentUser;
  if (!sb || !u) throw new AuthError('Serveur non configuré');
  const r = await sb.auth.signInWithPassword({ email: u.email, password });
  if (r.error) throw serverMessage(r.error);
  if (r.data.user?.id !== u.id) { await sb.auth.signOut({ scope: 'local' }); throw new AuthError('Ce mot de passe correspond à un autre compte du serveur.'); }
  return ensureServerSession();
}

// ---------------- Connexion (les deux modes) ----------------
async function findAccount(email: string) {
  const all = await db.accounts.where('email').equals(normEmail(email)).toArray();
  return all.sort((a, b) => (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? ''))[0];
}

export async function login(rawEmail: string, password: string): Promise<{ user: UserProfile; recoveryCode?: string; offline?: boolean }> {
  const email = normEmail(rawEmail);
  const sb = supabase();
  const local = await findAccount(email);

  // 1. Compte présent sur l'appareil : on déverrouille localement, immédiatement, même sans réseau.
  if (local && (local.mode === 'local' || !sb || !local.locked)) {
    let key: CryptoKey | null = null;
    try { key = await unwrapWithPassword(local, password); } catch (e) {
      if (local.mode === 'local' || !sb) throw new AuthError('Mot de passe incorrect.', 'identifiants');
      if (!isOnline()) throw new AuthError('Mot de passe incorrect.', 'identifiants');
      void e; // on tente le serveur : le mot de passe a peut-être été changé ailleurs
    }
    if (key) {
      const user = await startSession(local, key);
      if (local.mode === 'supabase') void ensureServerSession(password);
      return { user, offline: local.mode === 'supabase' && !isOnline() };
    }
  }
  if (!sb) throw new AuthError('Aucun compte trouvé sur cet appareil avec cet e-mail. Vérifiez l’adresse ou créez un compte.', 'identifiants');
  if (!isOnline()) {
    if (local?.locked) throw new AuthError('Accès suspendu : reconnectez-vous en ligne pour vérifier vos autorisations.', 'identifiants');
    throw new AuthError('Première connexion sur cet appareil : une connexion Internet est nécessaire.', 'reseau');
  }

  // 2. Connexion au serveur.
  let res;
  try { res = await sb.auth.signInWithPassword({ email, password }); }
  catch (e) { throw serverMessage(e as Error); }
  if (res.error || !res.data.user) throw serverMessage(res.error ?? {});
  const uid = res.data.user.id;
  const prof = await checkProfile(uid).catch(() => null);
  if (prof && prof.active === false) {
    await sb.auth.signOut();
    throw new AuthError('Ce compte a été désactivé par un administrateur.', 'identifiants');
  }
  const role = (prof?.role as Role) ?? 'accompagnateur';
  const displayName = prof?.display_name ?? email.split('@')[0];

  if (local && local.id === uid) {
    if (local.locked) {
      // Accès confirmé par le serveur : on lève la suspension puis on déverrouille.
      await db.accounts.update(local.id, { locked: false, role, displayName });
      try {
        const key = await unwrapWithPassword(local, password);
        const user = await startSession({ ...local, role, displayName }, key);
        setServerState('ok');
        return { user };
      } catch { /* mot de passe local différent : voir ci-dessous */ }
    }
    // Le serveur accepte ce mot de passe, mais les données de l'appareil sont protégées par l'ancien.
    throw new AuthError('Votre mot de passe a changé. Pour ouvrir les dossiers de cet appareil, saisissez l’ancien mot de passe ou votre clé de secours.', 'cle_locale');
  }
  const created = await createDeviceAccount({ id: uid, email, displayName, role, mode: 'supabase', password });
  pendingRecovery = created.recoveryCode;
  const user = await startSession(created.account, created.key);
  setServerState('ok');
  return { user, recoveryCode: created.recoveryCode };
}

/** Déverrouillage après mise en veille : uniquement local, aucun appel réseau. */
export async function unlock(password: string) {
  if (!currentUser) throw new AuthError('Non connecté');
  const account = await db.accounts.get(currentUser.id);
  if (!account) throw new AuthError('Compte introuvable sur cet appareil');
  let key: CryptoKey;
  try { key = await unwrapWithPassword(account, password); } catch { throw new AuthError('Mot de passe incorrect.', 'identifiants'); }
  await startSession(account, key);
  if (account.mode === 'supabase' && serverState !== 'ok') void ensureServerSession(password);
}

/** Après un changement de mot de passe côté serveur : déverrouille avec l'ancien mot de passe ou la clé de secours. */
export async function recoverLocalAccess(email: string, newPassword: string, oldPasswordOrCode: string) {
  const account = await findAccount(email);
  if (!account) throw new AuthError('Compte introuvable sur cet appareil');
  let key: CryptoKey;
  try { key = await unwrapWithPassword(account, oldPasswordOrCode); }
  catch { key = await unwrapWithRecovery(account, oldPasswordOrCode); }
  await rewrapPassword(account.id, key, newPassword);
  await db.accounts.update(account.id, { locked: false });
  const user = await startSession((await db.accounts.get(account.id))!, key);
  if (account.mode === 'supabase') void ensureServerSession(newPassword);
  return user;
}

export async function signUpSupabase(email: string, password: string, displayName: string): Promise<Awaited<ReturnType<typeof login>> | null> {
  const sb = supabase();
  if (!sb) throw new AuthError('Serveur non configuré');
  if (password.length < 10) throw new AuthError('Le mot de passe doit contenir au moins 10 caractères.');
  const { data, error } = await sb.auth.signUp({ email: normEmail(email), password, options: { data: { display_name: displayName }, emailRedirectTo: `${location.origin}${location.pathname}` } });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) throw new AuthError('Un compte existe déjà avec cet e-mail. Utilisez « Connexion ».', 'existe');
    throw serverMessage(error);
  }
  // Si la confirmation par e-mail est désactivée, la session est ouverte tout de suite.
  if (data.session) return login(email, password);
  return null;
}

export async function requestPasswordReset(email: string) {
  const sb = supabase();
  if (!sb) throw new AuthError('En mode local, utilisez votre clé de secours.');
  const { error } = await sb.auth.resetPasswordForEmail(normEmail(email), { redirectTo: `${location.origin}${location.pathname}` });
  if (error) throw serverMessage(error);
}

export async function setNewServerPassword(password: string) {
  const sb = supabase();
  if (!sb) throw new AuthError('Serveur non configuré');
  if (password.length < 10) throw new AuthError('Le mot de passe doit contenir au moins 10 caractères.');
  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    if (/different from the old|same_password/i.test(error.message)) throw new AuthError('Choisissez un mot de passe différent de l’ancien.');
    throw serverMessage(error);
  }
}

// ---------------- Retour depuis un lien reçu par e-mail ----------------
// Supabase renvoie vers l'application avec « #access_token=…&type=recovery » (ou une erreur).
// On traite ce fragment avant le routeur, qui le prendrait sinon pour une page.
export type EmailLinkResult = { kind: 'recovery' | 'signup' | 'autre' } | { kind: 'erreur'; message: string } | null;
let emailLink: EmailLinkResult = null;
export const getEmailLink = () => emailLink;
export function clearEmailLink() { emailLink = null; emit(); }

export async function handleEmailLink(): Promise<EmailLinkResult> {
  const h = location.hash.replace(/^#\/?/, '');
  if (!/(access_token|error_description|error_code)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  if (p.get('error_description') || p.get('error')) {
    const code = p.get('error_code') ?? '';
    emailLink = { kind: 'erreur', message: code === 'otp_expired' ? 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.' : (p.get('error_description') ?? 'Lien invalide.').replace(/\+/g, ' ') };
    return emailLink;
  }
  const sb = supabase();
  const access_token = p.get('access_token'), refresh_token = p.get('refresh_token');
  if (!sb || !access_token || !refresh_token) return null;
  const { error } = await sb.auth.setSession({ access_token, refresh_token });
  if (error) { emailLink = { kind: 'erreur', message: 'Lien invalide ou expiré. Demandez-en un nouveau.' }; return emailLink; }
  const type = p.get('type');
  emailLink = { kind: type === 'recovery' ? 'recovery' : type === 'signup' || type === 'email' ? 'signup' : 'autre' };
  return emailLink;
}

/** Mode local : nouveau mot de passe grâce à la clé de secours. */
export async function resetLocalWithRecovery(email: string, code: string, newPassword: string) {
  if (newPassword.length < 10) throw new AuthError('Le mot de passe doit contenir au moins 10 caractères.');
  const account = await findAccount(email);
  if (!account) throw new AuthError('Aucun compte avec cet e-mail sur cet appareil.');
  const key = await unwrapWithRecovery(account, code);
  await rewrapPassword(account.id, key, newPassword);
}

export async function changePassword(oldPassword: string, newPassword: string) {
  if (!currentUser) throw new AuthError('Non connecté');
  const account = (await db.accounts.get(currentUser.id))!;
  const key = await unwrapWithPassword(account, oldPassword);
  if (account.mode === 'supabase') await setNewServerPassword(newPassword);
  await rewrapPassword(account.id, key, newPassword);
}

/** Verrouille la session : les dossiers restent chiffrés sur l'appareil. */
export function lockSession() {
  vault.lock();
  emit();
}

/** Déconnexion / changement d'utilisateur. Les modifications non synchronisées sont conservées chiffrées. */
export async function logout() {
  if (currentUser) await vault.audit('deconnexion');
  const sb = supabase();
  if (currentUser?.mode === 'supabase' && sb && isOnline()) await sb.auth.signOut().catch(() => undefined);
  vault.lock();
  currentUser = null;
  serverState = 'inutile';
  emit();
}

/** Perte d'autorisation détectée par le serveur : on verrouille sans rien effacer. */
export async function revokeLocalAccess(accountId: string) {
  await db.accounts.update(accountId, { locked: true });
  await logout();
}

export async function pendingCountFor(accountId: string) {
  return db.outbox.where('ownerId').equals(accountId).count();
}

export async function deviceAccounts() { return db.accounts.toArray(); }
