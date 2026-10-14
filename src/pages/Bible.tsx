import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, Star, StickyNote, Link2, ChevronLeft, ChevronRight, Info, BookOpen, X, ArrowRight, History } from 'lucide-react';
import { loadBible, bibleReady, getBooks, getMeta, chapterText, search, searchText, formatRef, highlight, resolve } from '../lib/bible';
import { vault, useCollection } from '../lib/store';
import { Tabs, Field, Modal, Empty, toast, toastError, useDebounced } from '../components/ui';
import { BibleSuggestPanel } from './BibleSuggest';
import { youthName } from '../lib/alerts';

const SUGGESTIONS = ['Jean 3:16', 'Psaume 23', 'paix', 'pardon', 'sagesse', 'ne crains point', 'Romains 8:28', 'espérance'];
type Scope = 'tout' | 'AT' | 'NT' | 'livre';

function Hl({ text, q }: { text: string; q: string }) {
  return <>{highlight(text, q).map((s, i) => (s.on ? <mark key={i}>{s.t}</mark> : <span key={i}>{s.t}</span>))}</>;
}

export default function BiblePage() {
  const [params] = useSearchParams();
  const sessionId = params.get('rencontre') ?? undefined;
  const youthId = params.get('jeune') ?? undefined;
  const youth = vault.get('youth', youthId);
  const [ready, setReady] = useState(bibleReady());
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'lire' | 'themes' | 'favoris' | 'historique'>('lire');
  const [book, setBook] = useState(43);
  const [chapter, setChapter] = useState(1);
  const [sel, setSel] = useState<number[]>([]);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [scope, setScope] = useState<Scope>('tout');
  const [limit, setLimit] = useState(40);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const favs = useCollection('bible_favs');
  const dq = useDebounced(q.trim(), 220);

  useEffect(() => { loadBible().then(() => setReady(true)).catch((e) => setErr(`Impossible de charger la Bible : ${(e as Error).message}. Une connexion est nécessaire pour le premier téléchargement (≈4 Mo) ; ensuite elle reste disponible hors ligne.`)); }, []);
  useEffect(() => { setLimit(40); }, [dq, scope]);
  const passage = useMemo(() => (ready ? chapterText(book, chapter) : null), [ready, book, chapter]);
  useEffect(() => {
    setSel([]);
    if (!ready) return;
    const ref = formatRef({ book, chapter });
    const hist = vault.all('bible_favs').filter((f) => f.kind === 'historique');
    const ex = hist.find((h) => h.ref === ref);
    vault.put('bible_favs', { id: ex?.id, ref, kind: 'historique' });
    for (const old of hist.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(40)) vault.remove('bible_favs', old.id);
  }, [ready, book, chapter]);

  // Recherche instantanée : référence exacte ou mots (tous présents), filtrée par portée
  const results = useMemo(() => {
    if (!ready || dq.length < 2) return null;
    const asRef = resolve(dq);
    const filter = scope === 'AT' ? (b: number) => b <= 39 : scope === 'NT' ? (b: number) => b >= 40 : scope === 'livre' ? book : undefined;
    const hits = searchText(dq, 400, filter);
    const byBook = new Map<number, number>();
    hits.forEach((h) => byBook.set(h.book, (byBook.get(h.book) ?? 0) + 1));
    return { asRef, hits, byBook };
  }, [ready, dq, scope, book]);

  const books = getBooks();
  const nChapters = books[book - 1]?.chapters.length ?? 1;
  const selRef = sel.length ? formatRef({ book, chapter, from: Math.min(...sel), to: Math.max(...sel) }) : formatRef({ book, chapter });
  const goRef = (ref: string) => {
    const r = search(ref).passage;
    if (!r) return;
    setBook(r.parsed.book); setChapter(r.parsed.chapter);
    setSel(r.parsed.from ? Array.from({ length: (r.parsed.to ?? r.parsed.from) - r.parsed.from + 1 }, (_, i) => r.parsed.from! + i) : []);
    setTab('lire'); setQ('');
    requestAnimationFrame(() => document.querySelector(`[data-v="${r.parsed.from ?? 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const associate = async () => {
    const s = vault.get('sessions', sessionId);
    if (!s) return;
    await vault.put('sessions', { id: s.id, verses: [...new Set([...s.verses, selRef])] });
    await vault.put('bible_recs', { youthId: s.youthId, sessionId: s.id, ref: selRef, status: 'etudie', source: 'manuel', theme: s.theme });
    toast(`${selRef} associé à la rencontre`);
  };
  const meta = getMeta();

  if (err) return <div className="card"><Empty icon={<BookOpen size={32} />} title="Bible indisponible">{err}</Empty></div>;

  return (
    <div className="stack s18">
      <div className="page-head">
        <div><h1>Bible</h1><p>{meta?.name ?? 'Louis Segond 1910'} · {meta?.license ?? 'Domaine public'}</p></div>
        {sessionId && youth && <Link to={`/rencontres/${sessionId}`} className="badge">Rencontre avec {youthName(youth)} — les passages peuvent y être associés</Link>}
      </div>

      {/* Barre de recherche toujours visible */}
      <div className="stack s6">
        <form className="bible-search" onSubmit={(e) => { e.preventDefault(); if (results?.asRef) goRef(results.asRef.ref); }}>
          <Search size={20} color="var(--primary)" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder="Rechercher : Jean 3:16, Psaume 23, paix, pardon…" aria-label="Rechercher dans la Bible" disabled={!ready} />
          {q && <button type="button" className="btn ghost sm icon round" aria-label="Effacer" onClick={() => { setQ(''); inputRef.current?.focus(); }}><X size={14} /></button>}
        </form>
        {!q && (
          <div className="chips">
            {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => setQ(s)}>{s}</button>)}
          </div>
        )}
      </div>

      {!ready ? (
        <div className="card stack"><div className="skeleton" style={{ height: 22, width: 160 }} /><div className="skeleton" style={{ height: 14 }} /><div className="skeleton" style={{ height: 14, width: '92%' }} /><div className="skeleton" style={{ height: 14, width: '80%' }} /><p className="small muted">Premier chargement : la Bible est téléchargée puis conservée sur l’appareil pour l’usage hors ligne.</p></div>
      ) : q.trim().length >= 2 ? (
        <section className="stack">
          <div className="row wrap between">
            <div className="chips">
              {([['tout', 'Toute la Bible'], ['AT', 'Ancien Testament'], ['NT', 'Nouveau Testament'], ['livre', books[book - 1]?.name ?? 'Livre']] as [Scope, string][]).map(([v, l]) => (
                <button key={v} className={`chip ${scope === v ? 'on' : ''}`} onClick={() => setScope(v)}>{l}</button>
              ))}
            </div>
            {results && <span className="small muted">{results.hits.length >= 400 ? '400+' : results.hits.length} verset{results.hits.length > 1 ? 's' : ''}</span>}
          </div>
          {results?.asRef && (
            <button className="hit card" style={{ borderColor: 'var(--primary)' }} onClick={() => goRef(results.asRef!.ref)}>
              <div className="row between"><b style={{ color: 'var(--primary-600)' }}>{results.asRef.ref}</b><span className="row small" style={{ color: 'var(--primary-600)' }}>Ouvrir <ArrowRight size={14} /></span></div>
              <div className="verse small mt8" style={{ fontSize: 15 }}>{results.asRef.text.length > 420 ? `${results.asRef.text.slice(0, 420)}…` : results.asRef.text}</div>
            </button>
          )}
          {results && results.byBook.size > 1 && (
            <div className="chips">
              {[...results.byBook.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([b, n]) => (
                <button key={b} className="chip" onClick={() => { setBook(b); setScope('livre'); }}>{books[b - 1].name} <span className="tiny">{n}</span></button>
              ))}
            </div>
          )}
          {results && results.hits.length === 0 && !results.asRef && <div className="card"><Empty icon={<Search size={30} />} title="Aucun verset trouvé">Vérifiez l’orthographe, essayez un synonyme ou élargissez la portée.</Empty></div>}
          <div className="list stagger" key={`${dq}-${scope}`}>
            {results?.hits.slice(0, limit).map((h) => (
              <button key={h.ref} className="hit" onClick={() => goRef(h.ref)}>
                <b className="small" style={{ color: 'var(--primary-600)' }}>{h.ref}</b>
                <div className="verse" style={{ fontSize: 15, lineHeight: 1.6 }}><Hl text={h.text} q={dq} /></div>
              </button>
            ))}
          </div>
          {results && results.hits.length > limit && <button className="btn ghost" onClick={() => setLimit(limit + 40)}>Afficher plus de résultats</button>}
        </section>
      ) : (
        <>
          <Tabs value={tab} onChange={setTab} options={[['lire', 'Lire'], ['themes', 'Par thème'], ['favoris', 'Favoris & notes'], ['historique', 'Historique']]} />

          {tab === 'lire' && passage && (
            <div className="card stack">
              <div className="row wrap">
                <select className="input" style={{ width: 'auto' }} value={book} onChange={(e) => { setBook(+e.target.value); setChapter(1); }} aria-label="Livre">
                  <optgroup label="Ancien Testament">{books.slice(0, 39).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
                  <optgroup label="Nouveau Testament">{books.slice(39).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
                </select>
                <select className="input" style={{ width: 'auto' }} value={chapter} onChange={(e) => setChapter(+e.target.value)} aria-label="Chapitre">{Array.from({ length: nChapters }, (_, i) => <option key={i} value={i + 1}>Chapitre {i + 1}</option>)}</select>
                <span className="grow" />
                <button className="btn ghost icon" disabled={chapter <= 1} onClick={() => setChapter(chapter - 1)} aria-label="Chapitre précédent"><ChevronLeft size={18} /></button>
                <button className="btn ghost icon" disabled={chapter >= nChapters} onClick={() => setChapter(chapter + 1)} aria-label="Chapitre suivant"><ChevronRight size={18} /></button>
              </div>
              <h2 key={passage.ref} className="page">{passage.ref}</h2>
              <div className="verse page" key={`${book}.${chapter}`}>
                {passage.verses.map((v) => (
                  <span key={v.v} data-v={v.v} onClick={() => setSel((s) => (s.includes(v.v) ? s.filter((x) => x !== v.v) : [...s, v.v]))} style={{ cursor: 'pointer', background: sel.includes(v.v) ? 'var(--primary-soft)' : undefined, borderRadius: 4, transition: 'background .2s' }}>
                    <sup>{v.v}</sup>{v.t}{' '}
                  </span>
                ))}
              </div>
              <div className="row wrap glass" style={{ position: 'sticky', bottom: 88, background: 'var(--glass-strong)', padding: '8px 10px', borderRadius: 16, border: '1px solid var(--glass-border)' }}>
                <span className="small bold">{selRef}</span>
                <button className="btn ghost sm" onClick={async () => { await vault.put('bible_favs', { ref: selRef, kind: 'favori' }); toast('Ajouté aux favoris'); }}><Star size={14} /> Favori</button>
                <button className="btn ghost sm" onClick={() => setNote('')}><StickyNote size={14} /> Note</button>
                {sessionId && <button className="btn sm" onClick={associate}><Link2 size={14} /> Associer à la rencontre</button>}
              </div>
              <p className="tiny faint">Touchez des versets pour les sélectionner. Lisez toujours un passage dans son contexte et selon son genre littéraire.</p>
            </div>
          )}

          {tab === 'themes' && <BibleSuggestPanel youth={youth} sessionId={sessionId} context={vault.get('sessions', sessionId)?.notes} />}

          {tab === 'favoris' && (
            <div className="card stack">
              {favs.filter((f) => f.kind === 'favori' || f.kind === 'note').length === 0 ? <Empty icon={<Star size={30} />} title="Aucun favori ni note">Sélectionnez des versets pendant la lecture pour les retrouver ici.</Empty> : (
                <div className="list stagger">
                  {favs.filter((f) => f.kind === 'favori' || f.kind === 'note').map((f) => (
                    <div key={f.id} className="list-item">
                      {f.kind === 'favori' ? <Star size={16} color="var(--star)" fill="var(--star)" /> : <StickyNote size={16} color="var(--primary)" />}
                      <button className="grow" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }} onClick={() => goRef(f.ref)}>
                        <b className="small">{f.ref}</b>
                        {resolve(f.ref) && <div className="small muted ellipsis">{resolve(f.ref)!.text}</div>}
                        {f.note && <div className="small">{f.note}</div>}
                      </button>
                      <button className="btn ghost sm" onClick={() => vault.remove('bible_favs', f.id)}>Retirer</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'historique' && (
            <div className="card list stagger">
              {favs.filter((f) => f.kind === 'historique').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((f) => <button key={f.id} className="list-item" style={{ border: 0, cursor: 'pointer' }} onClick={() => goRef(f.ref)}><History size={15} color="var(--muted)" /> {f.ref}</button>)}
            </div>
          )}
        </>
      )}

      <div className="alert small"><Info size={16} color="var(--sky)" /><span>Texte : {meta?.name ?? 'Louis Segond 1910'} — {meta?.license ?? 'Domaine public'}. Les références sont toujours vérifiées dans cette base : l’application n’affiche jamais un verset reconstitué de mémoire par l’IA.</span></div>

      {note !== null && (
        <Modal title={`Note — ${selRef}`} onClose={() => setNote(null)}>
          <div className="stack">
            <Field label="Note"><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <button className="btn" onClick={async () => { try { await vault.put('bible_favs', { ref: selRef, note, kind: 'note' }); setNote(null); toast('Note enregistrée'); } catch (e) { toastError(e); } }}>Enregistrer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
