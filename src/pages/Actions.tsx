import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, CalendarClock, Pencil } from 'lucide-react';
import { useCollection, vault } from '../lib/store';
import type { ActionItem } from '../lib/types';
import { isOverdue, youthName } from '../lib/alerts';
import { fmtDate, relative, addDays } from '../lib/dates';
import { Tabs, Badge, Empty, ACTION_STATUS, toast } from '../components/ui';
import { ActionForm } from './Session';

type View = 'a_faire' | 'en_cours' | 'retard' | 'terminees';

export default function ActionsPage() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('a_faire');
  const [form, setForm] = useState<ActionItem | 'new' | null>(params.get('nouveau') ? 'new' : null);
  useEffect(() => { if (params.get('nouveau')) setForm('new'); }, [params]);
  const all = useCollection('actions');
  const groups: Record<View, ActionItem[]> = {
    a_faire: all.filter((a) => a.status === 'a_faire' && !isOverdue(a)),
    en_cours: all.filter((a) => a.status === 'en_cours' && !isOverdue(a)),
    retard: all.filter((a) => isOverdue(a)),
    terminees: all.filter((a) => a.status === 'terminee' || a.status === 'annulee'),
  };
  const list = groups[view].sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const prio = { haute: 'red', normale: 'blue', basse: 'grey' } as const;
  const postpone = async (a: ActionItem, days: number) => {
    await vault.put('actions', { id: a.id, dueDate: addDays(new Date(a.dueDate ?? Date.now()), days).toISOString(), followUp: `${a.followUp ? `${a.followUp}\n` : ''}Reportée de ${days} j le ${fmtDate(new Date().toISOString())}` });
    toast(`Reportée de ${days} jour(s)`);
  };
  return (
    <div className="stack s18">
      <div className="page-head"><div><h1>Actions</h1><p>Actions de l’accompagnateur et des jeunes, issues des rencontres</p></div><button className="btn" onClick={() => setForm('new')}><Plus size={16} /> Nouvelle action</button></div>
      <Tabs value={view} onChange={setView} options={[['a_faire', 'À faire', groups.a_faire.length], ['en_cours', 'En cours', groups.en_cours.length], ['retard', 'En retard', groups.retard.length], ['terminees', 'Terminées']]} />
      {list.length === 0 ? <div className="card"><Empty title="Rien ici" /></div> : (
        <div className="list">
          {list.map((a) => {
            const y = vault.get('youth', a.youthId);
            return (
              <div key={a.id} className="card flat row wrap" style={{ padding: 14 }}>
                <input type="checkbox" aria-label="Terminer" checked={a.status === 'terminee'} onChange={(e) => vault.put('actions', { id: a.id, status: e.target.checked ? 'terminee' : 'a_faire' })} style={{ accentColor: 'var(--primary)', width: 18, height: 18 }} />
                <div className="grow" style={{ minWidth: 200 }}>
                  <div className="bold">{a.title}</div>
                  <div className="small muted">
                    {y ? <Link to={`/jeunes/${y.id}`}>{youthName(y)}</Link> : 'Sans jeune'} · {a.owner === 'jeune' ? 'pour le jeune' : 'pour moi'}
                    {a.dueDate && <> · <span style={isOverdue(a) ? { color: 'var(--red)' } : undefined}>{fmtDate(a.dueDate)} ({relative(a.dueDate)})</span></>}
                    {a.sessionId && <> · <Link to={`/rencontres/${a.sessionId}`}>rencontre d’origine</Link></>}
                  </div>
                  {a.result && <div className="small mt8"><b>Résultat :</b> {a.result}</div>}
                </div>
                <span className={`badge ${prio[a.priority]}`}>{a.priority}</span>
                <Badge map={ACTION_STATUS} v={a.status} />
                {a.status === 'a_faire' && <button className="btn ghost sm" onClick={() => vault.put('actions', { id: a.id, status: 'en_cours' })}>Démarrer</button>}
                {(a.status === 'a_faire' || a.status === 'en_cours') && <button className="btn ghost sm" title="Reporter d’une semaine" onClick={() => postpone(a, 7)}><CalendarClock size={14} /> +7 j</button>}
                <button className="btn ghost sm icon" aria-label="Modifier" onClick={() => setForm(a)}><Pencil size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
      {form && <ActionForm action={form === 'new' ? undefined : form} onClose={() => { setForm(null); if (params.get('nouveau')) setParams({}); }} />}
    </div>
  );
}
