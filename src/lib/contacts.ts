// Import de contacts : fichier vCard (.vcf), fichier CSV (Google Contacts, Outlook, tableur)
// ou carnet d'adresses du téléphone (Contact Picker API — Chrome sur Android).
// Seules les informations utiles sont reprises : nom, prénom, téléphone, e-mail, photo éventuelle.

export interface ContactDraft { firstName: string; lastName: string; phone?: string; email?: string; photo?: string; source: 'vcard' | 'csv' | 'telephone' }

/** Déplie les lignes vCard repliées (RFC 6350 : une ligne commençant par espace/tab prolonge la précédente). */
function unfold(text: string) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }

function decodeQP(v: string) {
  return decodeURIComponent(v.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, '%$1').replace(/%(?![0-9A-F]{2})/gi, '%25'));
}

function unescape(v: string) { return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export function parseVCard(text: string): ContactDraft[] {
  const out: ContactDraft[] = [];
  const cards = unfold(text).split(/BEGIN:VCARD/i).slice(1);
  for (const card of cards) {
    const c: ContactDraft = { firstName: '', lastName: '', source: 'vcard' };
    let fn = '';
    for (const line of card.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const head = line.slice(0, idx);
      let value = line.slice(idx + 1);
      const [rawProp, ...params] = head.split(';');
      const prop = rawProp.replace(/^item\d+\./i, '').toUpperCase();
      const p = params.join(';').toUpperCase();
      if (p.includes('QUOTED-PRINTABLE')) { try { value = decodeQP(value); } catch { /* garder brut */ } }
      if (prop === 'FN') fn = unescape(value);
      else if (prop === 'N') {
        const [last = '', first = '', middle = ''] = value.split(';').map(unescape);
        c.lastName = last; c.firstName = [first, middle].filter(Boolean).join(' ');
      } else if (prop === 'TEL' && !c.phone) c.phone = value.replace(/^tel:/i, '').trim();
      else if (prop === 'TEL' && /CELL|MOBILE/.test(p)) c.phone = value.replace(/^tel:/i, '').trim(); // le mobile est prioritaire
      else if (prop === 'EMAIL' && !c.email) c.email = value.trim();
      else if (prop === 'PHOTO' && !c.photo) {
        const v = value.trim();
        if (v.startsWith('data:image')) c.photo = v;
        else if (p.includes('ENCODING=B') || p.includes('BASE64')) {
          const type = (p.match(/TYPE=(JPEG|JPG|PNG|GIF)/)?.[1] ?? 'JPEG').toLowerCase().replace('jpg', 'jpeg');
          c.photo = `data:image/${type};base64,${v.replace(/\s/g, '')}`;
        }
      }
    }
    if (!c.firstName && !c.lastName && fn) Object.assign(c, splitName(fn));
    if (c.firstName || c.lastName || c.phone) out.push(c);
  }
  return out;
}

/** Analyse CSV avec guillemets, séparateur , ou ; détecté automatiquement. */
export function parseCSVRows(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split('\n')[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function parseCSV(text: string): ContactDraft[] {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];
  const h = rows[0].map(norm);
  const find = (...names: RegExp[]) => {
    // Les motifs sont essayés dans l'ordre ; les colonnes « type » ou « label » (ex. « Phone 1 - Type ») sont ignorées.
    for (const n of names) { const i = h.findIndex((x) => n.test(x) && !/type|label/.test(x)); if (i >= 0) return i; }
    return -1;
  };
  const iFirst = find(/^first name$/, /^given name$/, /^prenom$/, /^prénom$/);
  const iLast = find(/^last name$/, /^family name$/, /^nom( de famille)?$/, /^surname$/);
  const iFull = find(/^name$/, /^nom complet$/, /^display name$/, /^full name$/);
  const iPhone = find(/^phone 1 - value$/, /mobile phone/, /^telephone/, /^tel/, /^phone/, /portable/, /^numero/);
  const iMail = find(/^e-?mail 1 - value$/, /^e-?mail( address)?$/, /^courriel$/, /^adresse e-?mail$/);
  const out: ContactDraft[] = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    let firstName = get(iFirst), lastName = get(iLast);
    if (!firstName && !lastName && get(iFull)) ({ firstName, lastName } = splitName(get(iFull)));
    const phone = get(iPhone).split(':::')[0].trim(); // Google sépare plusieurs numéros par « ::: »
    const email = get(iMail).split(':::')[0].trim();
    if (firstName || lastName || phone) out.push({ firstName, lastName, phone: phone || undefined, email: email || undefined, source: 'csv' });
  }
  return out;
}

export function parseContactFile(name: string, text: string): ContactDraft[] {
  if (/\.vcf$|\.vcard$/i.test(name) || /BEGIN:VCARD/i.test(text)) return parseVCard(text);
  return parseCSV(text);
}

export const phoneKey = (p?: string) => (p ? p.replace(/\D/g, '').slice(-8) : '');

/** Marque les doublons : même numéro (8 derniers chiffres) ou même nom + prénom qu'une fiche existante. */
export function markDuplicates<T extends { firstName: string; lastName: string; phone?: string }>(drafts: ContactDraft[], existing: T[]) {
  const phones = new Set(existing.map((e) => phoneKey(e.phone)).filter(Boolean));
  const names = new Set(existing.map((e) => norm(`${e.firstName} ${e.lastName}`)));
  const seen = new Set<string>();
  return drafts.map((d) => {
    const k = phoneKey(d.phone) || norm(`${d.firstName} ${d.lastName}`);
    const duplicate = (!!phoneKey(d.phone) && phones.has(phoneKey(d.phone))) || names.has(norm(`${d.firstName} ${d.lastName}`)) || seen.has(k);
    seen.add(k);
    return { ...d, duplicate };
  });
}

// ---- Carnet d'adresses du téléphone ----
interface PickerContact { name?: string[]; tel?: string[]; email?: string[]; icon?: Blob[] }
interface ContactsManager { select(props: string[], opts?: { multiple?: boolean }): Promise<PickerContact[]>; getProperties(): Promise<string[]> }

export function phonePickerSupported() {
  return typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;
}

async function blobToSmallDataUrl(b: Blob): Promise<string | undefined> {
  try {
    const img = await createImageBitmap(b);
    const s = 160 / Math.max(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch { return undefined; }
}

export async function pickFromPhone(): Promise<ContactDraft[]> {
  const mgr = (navigator as unknown as { contacts: ContactsManager }).contacts;
  const available = await mgr.getProperties().catch(() => ['name', 'tel', 'email']);
  const props = ['name', 'tel', 'email', 'icon'].filter((p) => available.includes(p));
  const picked = await mgr.select(props, { multiple: true });
  const out: ContactDraft[] = [];
  for (const p of picked) {
    const { firstName, lastName } = splitName(p.name?.[0] ?? '');
    out.push({ firstName, lastName, phone: p.tel?.[0], email: p.email?.[0], photo: p.icon?.[0] ? await blobToSmallDataUrl(p.icon[0]) : undefined, source: 'telephone' });
  }
  return out;
}
