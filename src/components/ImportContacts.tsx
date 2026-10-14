import { useState } from 'react';
import { Smartphone, FileUp, Check, AlertTriangle, Search } from 'lucide-react';
import { Modal, toast, toastError } from './ui';
import { vault } from '../lib/store';
import { parseContactFile, markDuplicates, phonePickerSupported, pickFromPhone, type ContactDraft } from '../lib/contacts';

type Row = ContactDraft & { duplicate: boolean; selected: boolean };

export function ImportContacts({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [q, setQ] = useState('');
  const phone = phonePickerSupported();

  const load = (drafts: ContactDraft[]) => {
    if (!drafts.length) return toastError(new Error('Aucun contact reconnu. Formats acceptés : .vcf (vCard) ou .csv avec des colonnes nom, prénom, téléphone.'));
    setRows(markDuplicates(drafts, vault.all('youth')).map((d) => ({ ...d, selected: !d.duplicate })));
  };
  const readFile = async (f: File) => {
    if (f.size > 20 * 1024 * 1024) return toastError(new Error('Fichier trop volumineux (20 Mo max).'));
    load(parseContactFile(f.name, await f.text()));
  };
  const fromPhone = async () => {
    try { load(await pickFromPhone()); } catch (e) { if ((e as Error).name !== 'AbortError') toastError(e); }
  };
  const doImport = async () => {
    const chosen = rows!.filter((r) => r.selected);
    setBusy(true);
    try {
      for (const r of chosen) {
        await vault.put('youth', {
          firstName: r.firstName || '(sans prénom)', lastName: r.lastName, phone: r.phone, email: r.email, photo: r.photo,
          status: 'nouveau', startDate: new Date().toISOString(), contactMode: 'whatsapp', importedFrom: r.source, initial: { items: [] },
        });
      }
      await vault.audit(`import_contacts:${chosen.length}`, 'youth');
      toast(`${chosen.length} fiche(s) créée(s). Complétez les autorisations de contact dans chaque fiche.`);
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const count = rows?.filter((r) => r.selected).length ?? 0;
  const nq = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const digits = q.replace(/\D/g, '');
  const visible = (rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => !nq
    || `${r.firstName} ${r.lastName} ${r.email ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(nq)
    || (digits.length >= 3 && (r.phone ?? '').replace(/\D/g, '').includes(digits)));
  const setVisible = (v: boolean) => { const idx = new Set(visible.map((x) => x.i)); setRows(rows!.map((r, j) => (idx.has(j) ? { ...r, selected: v } : r))); };

  return (
    <Modal title="Importer des contacts" onClose={onClose} wide>
      {!rows ? (
        <div className="stack s18">
          <p className="small muted">Créez des fiches à partir de votre carnet d’adresses. Seuls le nom, le prénom, le téléphone, l’e-mail et la photo sont repris. Les contacts déjà présents sont signalés.</p>
          <div className="grid g2">
            <button className="card lift stack" style={{ textAlign: 'left', cursor: phone ? 'pointer' : 'not-allowed', opacity: phone ? 1 : .55 }} disabled={!phone} onClick={fromPhone}>
              <span className="avatar" style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}><Smartphone size={20} /></span>
              <b>Depuis le téléphone</b>
              <span className="small muted">{phone ? 'Choisissez les contacts dans le carnet de votre téléphone.' : 'Non disponible sur ce navigateur (fonctionne sur Chrome Android). Utilisez un fichier.'}</span>
            </button>
            <label className="card lift stack" style={{ cursor: 'pointer', outline: dragOver ? '2px dashed var(--primary)' : undefined }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}>
              <span className="avatar" style={{ background: 'var(--pink-soft)', color: 'var(--pink)' }}><FileUp size={20} /></span>
              <b>Depuis un fichier</b>
              <span className="small muted">vCard (.vcf) exportée du téléphone, ou CSV de Google Contacts / Outlook / tableur. Glissez-déposez ou touchez pour choisir.</span>
              <input type="file" accept=".vcf,.vcard,.csv,text/vcard,text/csv" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
            </label>
          </div>
          <details className="small muted">
            <summary>Comment exporter mes contacts ?</summary>
            <p className="mt8"><b>Android :</b> application Contacts → menu → Gérer les contacts → Exporter → fichier .vcf.<br /><b>iPhone :</b> icloud.com → Contacts → sélectionner → Exporter la vCard.<br /><b>Google :</b> contacts.google.com → Exporter → Google CSV.</p>
          </details>
        </div>
      ) : (
        <div className="stack">
          <div className="search-box" style={{ maxWidth: 'none', boxShadow: 'none' }}>
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un nom, un numéro, un e-mail…" aria-label="Rechercher dans les contacts" autoFocus />
          </div>
          <div className="row between wrap">
            <span className="small"><b>{rows.length}</b> contact(s){q ? <> · <b>{visible.length}</b> affiché(s)</> : null} · <b>{count}</b> sélectionné(s)</span>
            <div className="row">
              <button className="btn ghost sm" onClick={() => setVisible(true)}>{q ? 'Cocher les résultats' : 'Tout'}</button>
              <button className="btn ghost sm" onClick={() => setVisible(false)}>{q ? 'Décocher les résultats' : 'Aucun'}</button>
            </div>
          </div>
          <div className="list" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {visible.length === 0 && <p className="small muted">Aucun contact ne correspond à « {q} ».</p>}
            {visible.map(({ r, i }) => (
              <label key={i} className="list-item" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={r.selected} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))} style={{ accentColor: 'var(--primary)', width: 18, height: 18 }} />
                <span className="avatar sm">{r.photo ? <img src={r.photo} alt="" /> : `${r.firstName[0] ?? ''}${r.lastName[0] ?? ''}`.toUpperCase()}</span>
                <span className="grow"><span className="bold small">{r.firstName} {r.lastName}</span><span className="tiny muted" style={{ display: 'block' }}>{[r.phone, r.email].filter(Boolean).join(' · ') || 'Aucune coordonnée'}</span></span>
                {r.duplicate && <span className="badge amber"><AlertTriangle size={11} /> Déjà présent</span>}
              </label>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setRows(null)}>Retour</button>
            <button className="btn" disabled={!count || busy} onClick={doImport}><Check size={16} /> Créer {count} fiche(s)</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
