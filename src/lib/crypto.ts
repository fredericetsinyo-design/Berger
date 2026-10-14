// Chiffrement local des dossiers : AES-GCM 256 bits, clé dérivée du mot de passe (PBKDF2-SHA256).
// La clé ne quitte jamais la mémoire vive : elle est oubliée au verrouillage ou à la déconnexion.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_ITERATIONS = 310_000;

const subtle = () => globalThis.crypto.subtle;

export type Bytes = Uint8Array<ArrayBuffer>;

export function randomBytes(n: number): Bytes {
  const b = new Uint8Array(new ArrayBuffer(n));
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveKey(password: string, salt: Bytes, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface Sealed { iv: string; ct: string }

export async function sealBytes(key: CryptoKey, data: BufferSource): Promise<{ iv: string; ct: ArrayBuffer }> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: toB64(iv), ct };
}

export async function openBytes(key: CryptoKey, iv: string, ct: ArrayBuffer): Promise<ArrayBuffer> {
  return subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, ct);
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const { iv, ct } = await sealBytes(key, enc.encode(JSON.stringify(value)));
  return { iv, ct: toB64(ct) };
}

export async function open<T = unknown>(key: CryptoKey, s: Sealed): Promise<T> {
  const buf = await openBytes(key, s.iv, fromB64(s.ct).buffer);
  return JSON.parse(dec.decode(buf)) as T;
}

export function uuid(): string {
  return globalThis.crypto.randomUUID();
}
