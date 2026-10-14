import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, FilePlus, CalendarPlus, CheckSquare, Mic, Contact } from 'lucide-react';
import { vault } from '../lib/store';
import { Modal, Field } from '../components/ui';
import { youthName } from '../lib/alerts';

export async function newSession(youthId: string, extra: Record<string, unknown> = {}) {
  return vault.put('sessions', { youthId, date: new Date().toISOString(), type: 'presentiel', theme: '', topics: [], notes: '', verses: [], attachments: [], reportStatus: 'brouillon', ...extra });
}

export function QuickCreate({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const youth = vault.all('youth').sort((a, b) => a.firstName.localeCompare(b.firstName));
  const [youthId, setYouthId] = useState(youth[0]?.id ?? '');
  const go = (to: string) => { onClose(); nav(to); };
  const items = [
    { icon: UserPlus, label: 'Nouveau jeune', run: () => go('/jeunes?nouveau=1'), needsYouth: false },
    { icon: Contact, label: 'Importer des contacts', run: () => go('/jeunes?importer=1'), needsYouth: false },
    { icon: FilePlus, label: 'Nouvelle rencontre', run: async () => { const s = await newSession(youthId); go(`/rencontres/${s.id}`); }, needsYouth: true },
    { icon: Mic, label: 'Note vocale rapide', run: async () => { const s = await newSession(youthId, { theme: 'Note vocale' }); go(`/rencontres/${s.id}?enregistrer=1`); }, needsYouth: true },
    { icon: CalendarPlus, label: 'Rendez-vous', run: () => go(`/agenda?nouveau=1&jeune=${youthId}`), needsYouth: false },
    { icon: CheckSquare, label: 'Action', run: () => go('/actions?nouveau=1'), needsYouth: false },
  ];
  return (
    <Modal title="Créer" onClose={onClose}>
      <div className="stack">
        {youth.length > 0 && (
          <Field label="Jeune concerné">
            <select className="input" value={youthId} onChange={(e) => setYouthId(e.target.value)}>
              {youth.map((y) => <option key={y.id} value={y.id}>{youthName(y)}</option>)}
            </select>
          </Field>
        )}
        <div className="grid g2 stagger">
          {items.map(({ icon: Icon, label, run, needsYouth }) => (
            <button key={label} className="list-item" style={{ border: 0, cursor: 'pointer', padding: 16 }} disabled={needsYouth && !youthId} onClick={run}>
              <Icon size={20} color="var(--primary)" /> <span className="bold">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
