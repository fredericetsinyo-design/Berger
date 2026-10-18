// Fournisseur Gemini : forme de la requête et messages d'erreur compréhensibles.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { geminiComplete, AIError } from '../src/lib/ai';

afterEach(() => vi.unstubAllGlobals());

describe('Gemini', () => {
  it('envoie consignes, contenu et demande une réponse JSON', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":' }, { text: 'true}' }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const out = await geminiComplete('AIza-test', 'gemini-flash-latest', 'SYSTEME', 'CONTENU');
    expect(out).toBe('{"ok":true}');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('SYSTEME');
    expect(body.contents[0].parts[0].text).toBe('CONTENU');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('clé invalide, quota et modèle inconnu : messages clairs', async () => {
    const reply = (status: number, msg: string) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: msg, status: 'X', details: [{ reason: msg }] } }), { status }));
    reply(400, 'API key not valid. Please pass a valid API key.');
    await expect(geminiComplete('x', 'm', 's', 'u')).rejects.toThrow(/Clé Gemini invalide/);
    reply(429, 'Resource exhausted');
    await expect(geminiComplete('x', 'm', 's', 'u')).rejects.toThrow(/Quota Gemini/);
    reply(404, 'models/m is not found');
    await expect(geminiComplete('x', 'm', 's', 'u')).rejects.toThrow(/introuvable/);
  });

  it('contenu bloqué ou réseau absent', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }));
    await expect(geminiComplete('x', 'm', 's', 'u')).rejects.toThrow(/filtre de sécurité/);
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(geminiComplete('x', 'm', 's', 'u')).rejects.toBeInstanceOf(AIError);
  });
});
