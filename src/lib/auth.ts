import { db, type DeviceAccount } from './db';
import { deriveKey, fromB64, open, randomBytes, toB64, uuid, PBKDF2_ITERATIONS } from './crypto';
import { vault } from './store';
import { supabase, isOnline } from './supabase';
import type { UserProfile, Role } from './types';
import { ensureDefaults } from './defaults';

// Authentification — un seul secret : le mot de passe du compte.
// - Mode « supabase » : le serveur vérifie le mot de passe ; les dossiers sont synchronisés,
//   donc on les retrouve sur tout appareil où l'on se connecte avec le même compte.
// - Hors ligne, l'appareil vérifie le mot de passe grâce à une empreinte (PBKDF2) gardée localement.
// - Plus de clé de secours : les données de l'appareil ne sont plus verrouillées par une clé
//   à conserver. Si le mot de passe change, l'appareil se met à jour à la connexion suivante.

export class AuthError extends Error {
  constructor(message: string, public code: 'identifiants' | 'cle_locale' | 'reseau' | 'existe' | 'inconnu' = 'inconnu', public pending = 0) { super(message); }
}

let currentUser: UserProfile | null = null;
const listeners = new Set<() => void>();
export const onAuthChange = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const emit = () => listeners.forEach((l) => l());
export const getUser = () => currentUser;

// Conservés pour compatibilité : il n'y a plus de clé de secours à afficher.
export const getPendingRecovery = (): string | null => null;
export function clearPendingRecovery() { emit(); }

const normEmail = (e: string) => e.trim().toLowerCase();

// ---------------- Clé de l'appareil et empreinte du mot de passe ----------------
async function newDataKey(): Promise<{ key: CryptoKey; raw: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return { key, raw: toB64(await crypto.subtle.exportKey('raw', key)) };
}
const importDataKey = (raw: string) => crypto.subtle.importKey('raw', fromB64(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

async function fingerprint(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, 256);
  return toB64(bits);
}

async function setPassword(accountId: string, password: string) {
  const vSalt = randomBytes(16);
  await db.accounts.update(accountId, { vSalt: toB64(vSalt), verifier: await fingerprint(password, vSalt), iterations: PBKDF2_ITERATIONS });
}

/** Vrai si le mot de passe correspond à celui connu par cet appareil. */
async function passwordMatches(acc: DeviceAccount, password: string) {
  if (acc.verifier && acc.vSalt) return (await fingerprint(password, fromB64(acc.vSalt), acc.iterations)) === acc.verifier;
  if (acc.wrappedKey && acc.salt) { // ancien format : le mot de passe protégeait la clé
    try { await open<string>(await deriveKey(password, fromB64(acc.salt), acc.iterations), acc.wrappedKey); return true; } catch { return false; }
  }
  return false;
}

/** Clé de l'appareil. Les anciens comptes (clé protégée par le mot de passe) sont convertis au passage. */
async function deviceKey(acc: DeviceAccount, password?: string): Promise<CryptoKey | null> {
  if (acc.rawKey) return importDataKey(acc.rawKey);
  if (password && acc.wrappedKey && acc.salt) {
    try {
      const raw = await open<string>(await deriveKey(password, fromB64(acc.salt), acc.iterations), acc.wrappedKey);
      await db.accounts.update(acc.id, { rawKey: raw, wrappedKey: undefined, wrappedKeyRecovery: undefined, recoverySalt: undefined });
      if (!acc.verifier) await setPassword(acc.id, password);
      return importDataKey(raw);
    } catch { return null; }
  }
  return null;
}

/** Repart d'une copie vide sur l'appareil ; les dossiers reviennent du serveur à la synchronisation. */
async function resetDeviceCopy(accountId: string) {
  await db.transaction('rw', [db.records, db.blobs, db.outbox, db.conflicts, db.meta], async () => {
    await db.records.where('ownerId').equals(accountId).delete();
    await db.blobs.where('ownerId').equals(accountId).delete();
    await db.outbox.where('ownerId').equals(accountId).delete();
    await db.conflicts.where('ownerId').equals(accountId).delete();
    await db.meta.delete(`cursor:${accountId}`);
  });
  const { raw } = await newDataKey();
  await db.accounts.update(accountId, { rawKey: raw, wrappedKey: undefined, wrappedKeyRecovery: undefined, recoverySalt: undefined });
}

async function createDeviceAccount(p: { id: string; email: string; displayName: string; role: Role; mode: 'local' | 'supabase'; password: string }) {
  const { key, raw } = await newDataKey();
  const vSalt = randomBytes(16);
  const account: DeviceAccount = {
    id: p.id, email: normEmail(p.email), displayName: p.displayName, role: p.role, mode: p.mode,
    iterations: PBKDF2_ITERATIONS, rawKey: raw, vSalt: toB64(vSalt), verifier: await fingerprint(p.password, vSalt),
    createdAt: new Date().toISOString(),
  };
  await db.accounts.put(account);
  return { account, key };
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

async function findAccount(email: string) {
  const all = await db.accounts.where('email').equals(normEmail(email)).toArray();
  return all.sort((a, b) => (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? ''))[0];
}

// ---------------- Mode local (sans serveur) ----------------
export async function registerLocal(email: string, password: string, displayName: string) {
  if (password.length < 10) throw new AuthError('Le mot de passe doit contenir au moins 10 caractères.');
  email = normEmail(email);
  if (await findAccount(email)) throw new AuthError('Un compte existe déjà avec cet e-mail sur cet appareil. Utilisez « Connexion ».', 'existe');
  const { account, key } = await createDeviceAccount({ id: uuid(), email, displayName, role: 'admin', mode: 'local', password });
  await startSession(account, key);
  return {};
}

// ---------------- Session serveur ----------------
export type ServerAuthState = 'inutile' | 'verification' | 'ok' | 'mot_de_passe' | 'hors_ligne' | 'desactive';
let serverState: ServerAuthState = 'inutile';
export const getServerAuthState = () => serverState;
function setServerState(s: ServerAuthState) { serverState = s; emit(); }

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

/** Vérifie (ou rétablit) la session serveur du compte ouvert, sans jamais bloquer l'accès. */
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

/** Reconnexion au serveur depuis l'application ; ce mot de passe devient aussi celui de l'appareil. */
export async function reconnectServer(password: string) {
  const sb = supabase();
  const u = currentUser;
  if (!sb || !u) throw new AuthError('Serveur non configuré');
  const r = await sb.auth.signInWithPassword({ email: u.email, password });
  if (r.error) throw serverMessage(r.error);
  if (r.data.user?.id !== u.id) { await sb.auth.signOut({ scope: 'local' }); throw new AuthError('Ce mot de passe correspond à un autre compte du serveur.'); }
  await setPassword(u.id, password);
  return ensureServerSession();
}

// ---------------- Connexion ----------------
export type LoginResult = { user: UserProfile; offline?: boolean; refreshed?: boolean };

async function openLocally(acc: DeviceAccount, password: string, offline: boolean): Promise<LoginResult> {
  if (acc.locked) throw new AuthError('Accès suspendu : reconnectez-vous avec Internet pour vérifier vos autorisations.', 'identifiants');
  if (!(await passwordMatches(acc, password))) throw new AuthError('Mot de passe incorrect.', 'identifiants');
  const key = await deviceKey(acc, password);
  if (!key) throw new AuthError('Mot de passe incorrect.', 'identifiants');
  const user = await startSession(acc, key);
  if (acc.mode === 'supabase') setServerState(offline ? 'hors_ligne' : 'mot_de_passe');
  return { user, offline };
}

/**
 * @param discardUnsynced vrai si l'utilisateur accepte de perdre des modifications jamais envoyées
 *        qui restent illisibles (ancien format protégé par un mot de passe oublié).
 */
export async function login(rawEmail: string, password: string, discardUnsynced = false): Promise<LoginResult> {
  const email = normEmail(rawEmail);
  const sb = supabase();
  const local = await findAccount(email);

  if (!sb || local?.mode === 'local') {
    if (!local) throw new AuthError('Aucun compte trouvé sur cet appareil avec cet e-mail. Vérifiez l’adresse ou créez un compte.', 'identifiants');
    return openLocally(local, password, false);
  }
  if (!isOnline()) {
    if (!local) throw new AuthError('Première connexion sur cet appareil : une connexion Internet est nécessaire.', 'reseau');
    return openLocally(local, password, true);
  }

  // En ligne : le serveur fait foi.
  let res;
  try { res = await sb.auth.signInWithPassword({ email, password }); }
  catch (e) {
    if (local) return openLocally(local, password, true);
    throw serverMessage(e as Error);
  }
  if (res.error || !res.data.user) {
    const err = serverMessage(res.error ?? {});
    if (local && err.code === 'reseau' && !/Trop de tentatives/.test(err.message)) return openLocally(local, password, true);
    // Mot de passe changé depuis un autre appareil mais l'ancien saisi ici : on ouvre la copie de
    // l'appareil et un bandeau propose de se reconnecter au serveur pour reprendre la synchronisation.
    if (local && err.code === 'identifiants' && !/confirmé/.test(err.message) && !local.locked && (await passwordMatches(local, password))) return openLocally(local, password, false);
    throw err;
  }
  const uid = res.data.user.id;
  const prof = await checkProfile(uid).catch(() => null);
  if (prof && prof.active === false) {
    await sb.auth.signOut();
    throw new AuthError('Ce compte a été désactivé par un administrateur.', 'identifiants');
  }
  const role = (prof?.role as Role) ?? 'accompagnateur';
  const displayName = prof?.display_name ?? email.split('@')[0];

  if (local && local.id === uid) {
    let key = await deviceKey(local, password);
    let refreshed = false;
    if (!key) {
      // Ancien format et mot de passe changé : la copie de l'appareil est illisible. On la remplace par
      // celle du serveur, sauf s'il reste des modifications jamais envoyées (on demande d'abord).
      const pending = await db.outbox.where('ownerId').equals(local.id).count();
      if (pending > 0 && !discardUnsynced) {
        throw new AuthError(`Cet appareil contient ${pending} modification(s) jamais envoyée(s), protégée(s) par votre ancien mot de passe.`, 'cle_locale', pending);
      }
      await resetDeviceCopy(local.id);
      key = await deviceKey((await db.accounts.get(local.id))!);
      refreshed = true;
    }
    await setPassword(local.id, password);
    await db.accounts.update(local.id, { role, displayName, locked: false });
    const user = await startSession({ ...(await db.accounts.get(local.id))!, role, displayName }, key!);
    setServerState('ok');
    return { user, refreshed };
  }
  const created = await createDeviceAccount({ id: uid, email, displayName, role, mode: 'supabase', password });
  const user = await startSession(created.account, created.key);
  setServerState('ok');
  return { user };
}

/** Déverrouillage après mise en veille. */
export async function unlock(password: string) {
  if (!currentUser) throw new AuthError('Non connecté');
  const acc = await db.accounts.get(currentUser.id);
  if (!acc) throw new AuthError('Compte introuvable sur cet appareil');
  if (await passwordMatches(acc, password)) {
    const key = await deviceKey(acc, password);
    if (key) {
      await startSession(acc, key);
      if (acc.mode === 'supabase' && serverState !== 'ok') void ensureServerSession(password);
      return;
    }
  }
  // Mot de passe changé depuis un autre appareil : on vérifie auprès du serveur.
  if (acc.mode === 'supabase' && isOnline()) {
    try { await login(acc.email, password); return; }
    catch (e) { if (e instanceof AuthError && e.code !== 'identifiants') throw e; }
  }
  throw new AuthError('Mot de passe incorrect.', 'identifiants');
}

/** Anciens comptes : ouvre la copie de l'appareil avec l'ancien mot de passe ou l'ancienne clé de secours. */
export async function recoverLocalAccess(email: string, newPassword: string, oldPasswordOrCode: string) {
  const acc = await findAccount(email);
  if (!acc) throw new AuthError('Compte introuvable sur cet appareil');
  let raw: string | null = null;
  try { if (acc.wrappedKey && acc.salt) raw = await open<string>(await deriveKey(oldPasswordOrCode, fromB64(acc.salt), acc.iterations), acc.wrappedKey); } catch { /* */ }
  if (!raw && acc.wrappedKeyRecovery && acc.recoverySalt) {
    try { raw = await open<string>(await deriveKey(oldPasswordOrCode.replace(/[-\s]/g, '').toUpperCase(), fromB64(acc.recoverySalt), acc.iterations), acc.wrappedKeyRecovery); } catch { /* */ }
  }
  if (!raw) throw new AuthError('Ni l’ancien mot de passe ni la clé de secours ne correspondent.', 'identifiants');
  await db.accounts.update(acc.id, { rawKey: raw, wrappedKey: undefined, wrappedKeyRecovery: undefined, recoverySalt: undefined });
  return login(email, newPassword);
}

/** Mode local, ancien compte : nouveau mot de passe grâce à l'ancienne clé de secours. */
export async function resetLocalWithRecovery(email: string, code: string, newPassword: string) {
  if (newPassword.length < 10) throw new AuthError('Le mot de passe doit contenir au moins 10 caractères.');
  const acc = await findAccount(email);
  if (!acc) throw new AuthError('Aucun compte avec cet e-mail sur cet appareil.');
  if (!acc.wrappedKeyRecovery || !acc.recoverySalt) throw new AuthError('Ce compte n’a pas de clé de secours.');
  let raw: string;
  try { raw = await open<string>(await deriveKey(code.replace(/[-\s]/g, '').toUpperCase(), fromB64(acc.recoverySalt), acc.iterations), acc.wrappedKeyRecovery); }
  catch { throw new AuthError('Clé de secours incorrecte.', 'identifiants'); }
  await db.accounts.update(acc.id, { rawKey: raw, wrappedKey: undefined });
  await setPassword(acc.id, newPassword);
}

export async function signUpSupabase(email: string, password: string, displayName: string): Promise<LoginResult | null> {
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
  if (!sb) throw new AuthError('Sans serveur, le mot de passe ne peut pas être réinitialisé par e-mail.');
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


export async function changePassword(oldPassword: string, newPassword: string) {
  if (!currentUser) throw new AuthError('Non connecté');
  const acc = (await db.accounts.get(currentUser.id))!;
  if (!(await passwordMatches(acc, oldPassword))) throw new AuthError('Mot de passe actuel incorrect.', 'identifiants');
  await deviceKey(acc, oldPassword); // convertit un ancien compte avant le changement
  if (acc.mode === 'supabase') await setNewServerPassword(newPassword);
  await setPassword(acc.id, newPassword);
}

/** Verrouille l'écran : il faudra ressaisir le mot de passe. */
export function lockSession() {
  vault.lock();
  emit();
}

/** Déconnexion / changement d'utilisateur. Les modifications non synchronisées sont conservées. */
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
