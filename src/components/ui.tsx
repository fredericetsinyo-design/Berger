import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { X, Inbox } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Youth } from '../lib/types';

// ---------- Notifications éphémères ----------
type ToastT = { id: number; text: string; error?: boolean };
let toasts: ToastT[] = [];
const tl = new Set<() => void>();
export function toast(text: string, error = false) {
  const t = { id: Date.now() + Math.random(), text, error };
  toasts = [...toasts, t];
  tl.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); tl.forEach((l) => l()); }, error ? 7000 : 3500);
}
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), true);
export function Toasts() {
  const list = useSyncExternalStore((l) => { tl.add(l); return () => tl.delete(l); }, () => toasts);
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>{t.text}</div>)}
    </div>
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // Rendu dans <body> : les surfaces en verre (backdrop-filter) piégeraient sinon une modale fixe.
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </div>
        {children}
        {footer && <div className="row mt24" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <em className="hint">{hint}</em>}</label>;
}

export function Pills<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="pills" role="tablist">
      {options.map(([v, l]) => <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string, number?][]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([v, l, n]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {l}{n ? <span className="badge" style={{ marginLeft: 6 }}>{n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox size={32} />}<div className="bold" style={{ color: 'var(--text)' }}>{title}</div>{children && <div className="small mt8">{children}</div>}</div>;
}

export function Avatar({ youth, size = '' }: { youth?: Pick<Youth, 'firstName' | 'lastName' | 'photo'>; size?: '' | 'lg' | 'sm' }) {
  const initials = `${youth?.firstName?.[0] ?? ''}${youth?.lastName?.[0] ?? ''}`.toUpperCase() || '?';
  const hue = [...initials].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360;
  return (
    <span className={`avatar ${size}`} style={youth?.photo ? undefined : { background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 45% 38%)` }}>
      {youth?.photo ? <img src={youth.photo} alt="" /> : initials}
    </span>
  );
}

export function Confirm({ text, onYes, onClose, yes = 'Confirmer', danger }: { text: ReactNode; onYes: () => void; onClose: () => void; yes?: string; danger?: boolean }) {
  return (
    <Modal title="Confirmation" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annuler</button><button className={`btn ${danger ? 'danger' : ''}`} onClick={() => { onYes(); onClose(); }}>{yes}</button></>}>
      <div className="muted">{text}</div>
    </Modal>
  );
}

/** Rendu markdown minimal et sûr (titres, listes, gras) — pas de HTML injecté. */
export function Md({ text }: { text: string }) {
  const lines = (text || '').split('\n');
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
  for (const l of lines) {
    if (/^\s*[-*] /.test(l)) { list.push(l.replace(/^\s*[-*] /, '')); continue; }
    flush();
    if (/^#{1,3} /.test(l)) out.push(<h2 key={out.length}>{l.replace(/^#+ /, '')}</h2>);
    else if (l.trim()) out.push(<p key={out.length}>{inline(l)}</p>);
  }
  flush();
  return <div className="md">{out}</div>;
}

export function useDebounced<T>(value: T, ms = 600) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export const STATUS_YOUTH: Record<string, [string, string]> = {
  nouveau: ['Nouveau', 'blue'], actif: ['Actif', 'green'], pause: ['En pause', 'amber'], termine: ['Terminé', 'grey'],
};
export const SESSION_TYPES: [string, string][] = [['presentiel', 'Présentiel'], ['telephone', 'Téléphone'], ['visio', 'Visioconférence'], ['messagerie', 'Messagerie']];
export const typeLabel = (t: string) => SESSION_TYPES.find(([v]) => v === t)?.[1] ?? t;
export const REPORT: Record<string, [string, string]> = { brouillon: ['Brouillon', 'grey'], a_valider: ['À valider', 'amber'], valide: ['Validé', 'green'] };
export const ACTION_STATUS: Record<string, [string, string]> = { a_faire: ['À faire', 'blue'], en_cours: ['En cours', 'amber'], terminee: ['Terminée', 'green'], annulee: ['Annulée', 'grey'] };
export const APPT_STATUS: Record<string, [string, string]> = { planifie: ['Planifié', 'blue'], confirme: ['Confirmé', 'green'], effectue: ['Effectué', 'grey'], annule: ['Annulé', 'red'], reporte: ['Reporté', 'amber'] };
export const GOAL_STATUS: Record<string, [string, string]> = { en_cours: ['En cours', 'blue'], atteint: ['Atteint', 'green'], en_pause: ['En pause', 'amber'], abandonne: ['Abandonné', 'grey'] };
export function Badge({ map, v }: { map: Record<string, [string, string]>; v: string }) {
  const [l, c] = map[v] ?? [v, 'grey'];
  return <span className={`badge ${c}`}>{l}</span>;
}
