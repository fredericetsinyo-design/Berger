import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Configuration : variables d'environnement (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
// ou saisie dans l'écran de connexion (« Serveur de synchronisation »).
const LS_KEY = 'berger.supabase';

export interface SupabaseConfig { url: string; anonKey: string }

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && anonKey) return { url, anonKey };
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SupabaseConfig) : null;
  } catch { return null; }
}

export function setSupabaseConfig(cfg: SupabaseConfig | null) {
  try {
    if (cfg) localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(LS_KEY);
  } catch { /* stockage indisponible */ }
  client = null;
}

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  if (!client) client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export function isOnline() { return typeof navigator === 'undefined' ? true : navigator.onLine; }
