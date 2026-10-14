// Dates et heures affichées dans le fuseau Africa/Lome (UTC+0) par défaut.
export const TZ = 'Africa/Lome';
const loc = 'fr-FR';

const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { timeZone: TZ, ...o });
const fDate = f({ day: 'numeric', month: 'long', year: 'numeric' });
const fShort = f({ day: '2-digit', month: 'short' });
const fTime = f({ hour: '2-digit', minute: '2-digit' });
const fDay = f({ weekday: 'long', day: 'numeric', month: 'long' });
const fParts = f({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const fmtDate = (iso?: string) => (iso ? fDate.format(new Date(iso)) : '—');
export const fmtShort = (iso?: string) => (iso ? fShort.format(new Date(iso)) : '—');
export const fmtTime = (iso?: string) => (iso ? fTime.format(new Date(iso)) : '');
export const fmtDay = (iso: string) => fDay.format(new Date(iso));
export const fmtDateTime = (iso?: string) => (iso ? `${fmtDate(iso)} à ${fmtTime(iso)}` : '—');

/** Clé jour AAAA-MM-JJ dans le fuseau de l'application. */
export function dayKey(d: Date | string) {
  const p = Object.fromEntries(fParts.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Valeur pour <input type="datetime-local"> dans le fuseau de l'application. */
export function toInputDT(iso?: string) {
  if (!iso) return '';
  const p = Object.fromEntries(fParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Lecture d'un <input type="datetime-local"> (Africa/Lome = UTC+0, sans heure d'été). */
export function fromInputDT(v: string) { return v ? new Date(`${v}:00Z`).toISOString() : ''; }
export function toInputDate(iso?: string) { return iso ? dayKey(iso) : ''; }
export function fromInputDate(v: string) { return v ? new Date(`${v}T12:00:00Z`).toISOString() : ''; }

export const daysBetween = (a: string | Date, b: string | Date) =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

export function relative(iso: string) {
  const d = daysBetween(dayKey(new Date()), dayKey(iso));
  if (d === 0) return 'aujourd’hui';
  if (d === 1) return 'demain';
  if (d === -1) return 'hier';
  return d > 0 ? `dans ${d} j` : `il y a ${-d} j`;
}

export function startOfWeek(d: Date) {
  const x = new Date(`${dayKey(d)}T00:00:00Z`);
  const wd = (x.getUTCDay() + 6) % 7; // lundi = 0
  x.setUTCDate(x.getUTCDate() - wd);
  return x;
}
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
