// Connexion avec serveur : l'accès aux dossiers de l'appareil ne doit jamais dépendre du serveur.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Faux serveur Supabase, piloté par les tests.
const server = {
  password: 'motdepasse-solide',
  confirmed: true,
  reachable: true,
  session: null as null | { user: { id: string } },
  calls: 0,
};
const USER_ID = '40d78e38-0000-4000-8000-000000000001';
const fake = {
  auth: {
    async signInWithPassword({ password }: { email: string; password: string }) {
      server.calls++;
      if (!server.reachable) throw new TypeError('Failed to fetch');
      if (!server.confirmed) return { data: { user: null, session: null }, error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 } };
      if (password !== server.password) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } };
      server.session = { user: { id: USER_ID } };
      return { data: { user: { id: USER_ID }, session: server.session }, error: null };
    },
    async getSession() { return { data: { session: server.session } }; },
    async signOut() { server.session = null; return { error: null }; },
    async setSession() { server.session = { user: { id: USER_ID } }; return { error: null }; },
  },
  from() {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { display_name: 'Frédéric', role: 'admin', active: true } }) };
    return q;
  },
};
vi.mock('../src/lib/supabase', () => ({
  supabase: () => fake,
  getSupabaseConfig: () => ({ url: 'https://x.supabase.co', anonKey: 'k' }),
  setSupabaseConfig: () => undefined,
  isOnline: () => true,
}));

const { resetDb } = await import('../src/lib/db');
const { vault } = await import('../src/lib/store');
const auth = await import('../src/lib/auth');
const { SupabaseAdapter } = await import('../src/lib/sync');

const EMAIL = 'frederic@exemple.tg';
let n = 0;
async function freshDevice() {
  await auth.logout();
  resetDb(`login${++n}`);
  Object.assign(server, { password: 'motdepasse-solide', confirmed: true, reachable: true, session: null, calls: 0 });
}
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('Connexion avec serveur', () => {
  beforeEach(freshDevice);

  it('première connexion sur un appareil : le compte suffit, sans clé de secours', async () => {
    const r = await auth.login(' Frederic@Exemple.tg ', 'motdepasse-solide');
    expect(r.user.email).toBe(EMAIL);
    expect(vault.unlocked).toBe(true);
    expect(auth.getServerAuthState()).toBe('ok');
  });

  it('les dossiers s’ouvrent avec le mot de passe local même si le serveur est injoignable', async () => {
    await auth.login(EMAIL, 'motdepasse-solide');
    await auth.logout();
    server.reachable = false;
    await auth.login(EMAIL, 'motdepasse-solide');
    expect(vault.unlocked).toBe(true);
    await settle();
    expect(auth.getServerAuthState()).toBe('hors_ligne');
  });

  it('serveur qui refuse : dossiers ouverts, synchronisation en pause, reconnexion possible', async () => {
    await auth.login(EMAIL, 'motdepasse-solide');
    await auth.logout();
    server.password = 'nouveau-mot-de-passe';
    await auth.login(EMAIL, 'motdepasse-solide');
    expect(vault.unlocked).toBe(true);
    await settle();
    expect(auth.getServerAuthState()).toBe('mot_de_passe');
    expect(await new SupabaseAdapter().ready(vault.ownerId!)).toBe(false);
    expect(await auth.reconnectServer('nouveau-mot-de-passe')).toBe('ok');
    expect(await new SupabaseAdapter().ready(vault.ownerId!)).toBe(true);
  });

  it('session serveur encore valide : aucun nouvel envoi du mot de passe', async () => {
    await auth.login(EMAIL, 'motdepasse-solide');
    auth.lockSession();
    server.calls = 0;
    await auth.unlock('motdepasse-solide');
    await settle();
    expect(vault.unlocked).toBe(true);
    expect(server.calls).toBe(0);
  });

  it('déverrouillage : mauvais mot de passe refusé avec un message clair', async () => {
    await auth.login(EMAIL, 'motdepasse-solide');
    auth.lockSession();
    await expect(auth.unlock('faux')).rejects.toThrow('Mot de passe incorrect.');
  });

  it('mauvais mot de passe partout : message clair', async () => {
    await auth.login(EMAIL, 'motdepasse-solide');
    await auth.logout();
    await expect(auth.login(EMAIL, 'pas-le-bon')).rejects.toThrow('E-mail ou mot de passe incorrect.');
    expect(vault.unlocked).toBe(false);
  });

  it('e-mail non confirmé : le message le dit', async () => {
    server.confirmed = false;
    await expect(auth.login(EMAIL, 'motdepasse-solide')).rejects.toThrow(/pas encore confirmé/);
  });

  it('mot de passe changé sur le serveur : dossiers conservés, rien à ressaisir', async () => {
    await auth.login(EMAIL, 'motdepasse-solide');
    await vault.put('youth', { firstName: 'Afi', lastName: 'K', status: 'actif', startDate: new Date().toISOString(), initial: { items: [] } } as never);
    await auth.logout();
    server.password = 'nouveau-mot-de-passe';
    const r = await auth.login(EMAIL, 'nouveau-mot-de-passe');
    expect(r.refreshed).toBeFalsy();
    expect(vault.all('youth')).toHaveLength(1);
    await auth.logout();
    server.reachable = false; // hors ligne : le nouveau mot de passe est reconnu par l'appareil
    await auth.login(EMAIL, 'nouveau-mot-de-passe');
    expect(vault.all('youth')).toHaveLength(1);
  });

  it('ancien format + mot de passe changé : la copie est remplacée par celle du serveur', async () => {
    // Compte créé par l'ancienne version (clé protégée par l'ancien mot de passe).
    const { deriveKey, seal, randomBytes, toB64 } = await import('../src/lib/crypto');
    const { db } = await import('../src/lib/db');
    const salt = randomBytes(16);
    await db.accounts.put({ id: USER_ID, email: EMAIL, displayName: 'F', role: 'admin', mode: 'supabase', iterations: 1000,
      salt: toB64(salt), wrappedKey: await seal(await deriveKey('ancien-mdp', salt, 1000), 'AAAA'), createdAt: new Date().toISOString() });
    server.password = 'nouveau-mot-de-passe';
    const r = await auth.login(EMAIL, 'nouveau-mot-de-passe');
    expect(r.refreshed).toBe(true);
    expect(vault.unlocked).toBe(true);
    const acc = await db.accounts.get(USER_ID);
    expect(acc?.wrappedKey).toBeUndefined();
    expect(acc?.rawKey).toBeTruthy();
  });

  it('ancien format avec modifications non envoyées : on demande avant d’effacer', async () => {
    const { deriveKey, seal, randomBytes, toB64 } = await import('../src/lib/crypto');
    const { db } = await import('../src/lib/db');
    const salt = randomBytes(16);
    await db.accounts.put({ id: USER_ID, email: EMAIL, displayName: 'F', role: 'admin', mode: 'supabase', iterations: 1000,
      salt: toB64(salt), wrappedKey: await seal(await deriveKey('ancien-mdp', salt, 1000), 'AAAA'), createdAt: new Date().toISOString() });
    await db.outbox.put({ opId: 'op1', ownerId: USER_ID, table: 'youth', recordId: 'r1', kind: 'upsert', baseVersion: 0, base: null, createdAt: new Date().toISOString(), attempts: 0, status: 'en_attente' });
    const err = await auth.login(EMAIL, 'motdepasse-solide').catch((e) => e);
    expect(err.code).toBe('cle_locale');
    expect(err.pending).toBe(1);
    await auth.login(EMAIL, 'motdepasse-solide', true);
    expect(vault.unlocked).toBe(true);
    expect(await db.outbox.get('op1')).toBeUndefined();
  });

  it('lien de réinitialisation reçu par e-mail : reconnu avant le routeur', async () => {
    location.hash = '#access_token=a&refresh_token=b&type=recovery';
    const r = await auth.handleEmailLink();
    expect(r).toEqual({ kind: 'recovery' });
    expect(location.hash).toBe('#/');
    location.hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid';
    const e = await auth.handleEmailLink();
    expect(e && e.kind === 'erreur' && e.message).toMatch(/expiré/);
  });
});
