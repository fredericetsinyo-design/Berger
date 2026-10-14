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
  const existing = await db.accounts.where('email').equals(email.toLowerCase()).first();
  if (existing) throw new AuthError('Un compte existe déjà avec cet e-mail sur cet appareil.', 'existe');
  const { account, key, recoveryCode } = await createDeviceAccount({ id: uuid(), email, displayName, role: 'admin', mode: 'local', password });
  pendingRecovery = recoveryCode;
  await startSession(account, key);
  return { recoveryCode };
}

// ---------------- Connexion (les deux modes) ----------------
export async function login(email: string, password: string): Promise<{ user: UserProfile; recoveryCode?: string; offline?: boolean }> {
  const sb = supabase();
  const local = await db.accounts.where('email').equals(email.toLowerCase()).first();

  if (local?.mode === 'local' || (!sb && local)) {
    const key = await unwrapWithPassword(local!, password);
    return { user: await startSession(local!, key) };
  }
  if (!sb) throw new AuthError('Aucun compte trouvé sur cet appareil. Créez un compte local ou configurez le serveur.', 'identifiants');

  if (!isOnline()) {
    if (local?.locked) throw new AuthError('Accès suspendu : reconnectez-vous en ligne pour vérifier vos autorisations.', 'identifiants');
    if (!local) throw new AuthError('Première connexion impossible hors ligne : une connexion Internet est nécessaire.', 'reseau');
    const key = await unwrapWithPassword(local, password);
    return { user: await startSession(local, key), offline: true };
  }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error && /fetch|network/i.test(error.message) && local) {
      const key = await unwrapWithPassword(local, password);
      return { user: await startSession(local, key), offline: true };
    }
    throw new AuthError('E-mail ou mot de passe incorrect.', 'identifiants');
  }
  const { data: prof } = await sb.from('profiles').select('display_name, role, active').eq('id', data.user.id).maybeSingle();
  if (prof && prof.active === false) {
    await sb.auth.signOut();
    throw new AuthError('Ce compte a été désactivé par un administrateur.', 'identifiants');
  }
  const role = (prof?.role as Role) ?? 'accompagnateur';
  const displayName = prof?.display_name ?? email.split('@')[0];

  if (local && local.id === data.user.id) {
    await db.accounts.update(local.id, { role, displayName });
    const key = await unwrapWithPassword({ ...local }, password); // lève 'cle_locale' si le mot de passe a changé côté serveur
    return { user: await startSession({ ...local, role, displayName }, key) };
  }
  const created = await createDeviceAccount({ id: data.user.id, email, displayName, role, mode: 'supabase', password });
  pendingRecovery = created.recoveryCode;
  return { user: await startSession(created.account, created.key), recoveryCode: created.recoveryCode };
}

/** Après un changement de mot de passe côté serveur : déverrouille avec l'ancien mot de passe ou la clé de secours. */
export async function recoverLocalAccess(email: string, newPassword: string, oldPasswordOrCode: string) {
  const account = await db.accounts.where('email').equals(email.toLowerCase()).first();
  if (!account) throw new AuthError('Compte introuvable sur cet appareil');
  let key: CryptoKey;
  try { key = await unwrapWithPassword(account, oldPasswordOrCode); }
  catch { key = await unwrapWithRecovery(account, oldPasswordOrCode); }
  await rewrapPassword(account.id, key, newPassword);
  return startSession((await db.accounts.get(account.id))!, key);
}

export async function signUpSupabase(email: string, password: string, displayName: string) {
  const sb = supabase();
  if (!sb) throw new AuthError('Serveur non configuré');
  const { error } = await sb.auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo: `${location.origin}${location.pathname}` } });
  if (error) throw new AuthError(error.message);
}

export async function requestPasswordReset(email: string) {
  const sb = supabase();
  if (!sb) throw new AuthError('En mode local, utilisez votre clé de secours.');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}#/reinitialisation` });
  if (error) throw new AuthError(error.message, 'reseau');
}

export async function setNewServerPassword(password: string) {
  const sb = supabase();
  if (!sb) throw new AuthError('Serveur non configuré');
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new AuthError(error.message);
}

/** Mode local : nouveau mot de passe grâce à la clé de secours. */
export async function resetLocalWithRecovery(email: string, code: string, newPassword: string) {
  const account = await db.accounts.where('email').equals(email.toLowerCase()).first();
  if (!account) throw new AuthError('Compte introuvable sur cet appareil');
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
