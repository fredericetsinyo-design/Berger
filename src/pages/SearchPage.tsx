import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, FileText, StickyNote, CheckSquare, BookOpen } from 'lucide-react';
import { vault, useVaultTick } from '../lib/store';
import { loadBible, search as bibleSearch, norm } from '../lib/bible';
import { youthName } from '../lib/alerts';
import { fmtDate } from '../lib/dates';
import { Empty } from '../components/ui';

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const tick = useVaultTick();
  const [bibleOk, setBibleOk] = useState(false);
  useEffect(() => { loadBible().then(() => setBibleOk(true)).catch(() => undefined); }, []);
  const r = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return null;
    const has = (...s: (string | undefined)[]) => s.some((x) => x && norm(x).includes(n));
    return {
      youth: vault.all('youth').filter((y) => has(y.firstName, y.lastName, y.zone, y.phone, y.email)),
      sessions: vault.all('sessions').filter((s) => has(s.theme, s.notes, s.summary?.text, ...s.topics)),
      notes: vault.all('notes').filter((x) => has(x.title, x.content, ...x.tags)),
      actions: vault.all('actions').filter((a) => has(a.title, a.description, a.result)),
      bible: bibleOk ? bibleSearch(q, 10) : null,
    };
  }, [q, tick, bibleOk]);
  if (!r) return <Empty title="Saisissez un terme de recherche" />;
  const total = r.youth.length + r.sessions.length + r.notes.length + r.actions.length;
  const snippet = (t?: string) => { if (!t) return ''; const i = norm(t).indexOf(norm(q)); return i < 0 ? t.slice(0, 120) : `${i > 40 ? '…' : ''}${t.slice(Math.max(0, i - 40), i + 80)}…`; };
  return (
    <div className="stack s18">
      <div className="page-head"><div><h1>Résultats pour « {q} »</h1><p>{total} élément(s) dans vos dossiers</p></div></div>
      {r.youth.length > 0 && <section className="card stack"><h3 className="row"><Users size={16} /> Jeunes</h3>{r.youth.map((y) => <Link key={y.id} to={`/jeunes/${y.id}`} className="list-item">{youthName(y)}</Link>)}</section>}
      {r.sessions.length > 0 && <section className="card stack"><h3 className="row"><FileText size={16} /> Rencontres</h3>{r.sessions.map((s) => <Link key={s.id} to={`/rencontres/${s.id}`} className="list-item"><div><b className="small">{youthName(vault.get('youth', s.youthId))} — {s.theme || 'Rencontre'} ({fmtDate(s.date)})</b><div className="tiny muted">{snippet(s.notes || s.summary?.text)}</div></div></Link>)}</section>}
      {r.notes.length > 0 && <section className="card stack"><h3 className="row"><StickyNote size={16} /> Notes</h3>{r.notes.map((x) => <Link key={x.id} to={x.sessionId ? `/rencontres/${x.sessionId}` : x.youthId ? `/jeunes/${x.youthId}` : '/'} className="list-item"><div><b className="small">{x.title || 'Note'}</b><div className="tiny muted">{snippet(x.content)}</div></div></Link>)}</section>}
      {r.actions.length > 0 && <section className="card stack"><h3 className="row"><CheckSquare size={16} /> Actions</h3>{r.actions.map((a) => <Link key={a.id} to="/actions" className="list-item small">{a.title}</Link>)}</section>}
      {r.bible && (r.bible.passage || r.bible.hits.length > 0) && (
        <section className="card stack"><h3 className="row"><BookOpen size={16} /> Bible</h3>
          {r.bible.passage && <Link to="/bible" className="list-item"><div><b className="small">{r.bible.passage.ref}</b><div className="small verse" style={{ fontSize: 14 }}>{r.bible.passage.text.slice(0, 300)}</div></div></Link>}
          {r.bible.hits.map((h) => <div key={h.ref} className="list-item"><div><b className="small">{h.ref}</b><div className="small verse" style={{ fontSize: 14 }}>{h.text}</div></div></div>)}
        </section>
      )}
      {total === 0 && !r.bible?.hits.length && !r.bible?.passage && <Empty title="Aucun résultat" />}
    </div>
  );
}
