import { db } from './db';

// Module biblique : texte Louis Segond 1910 (domaine public), stocké dans IndexedDB
// pour la consultation hors ligne. Toutes les références affichées par l'application
// sont résolues dans cette base : une référence introuvable n'est jamais affichée comme valide.

export interface BookInfo { id: number; osis: string; name: string; abbr: string[]; testament: 'AT' | 'NT'; chapters: number[] }
export interface TranslationMeta { code: string; name: string; language: string; year: number; license: string; licenseNote: string; source: string; canDisplayText: boolean; verses: number }

const NAMES: [string, string, string[]][] = [
  ['Gen', 'Genèse', ['gn', 'gen', 'ge']], ['Exod', 'Exode', ['ex', 'exo']], ['Lev', 'Lévitique', ['lv', 'lev', 'le']],
  ['Num', 'Nombres', ['nb', 'nom', 'no']], ['Deut', 'Deutéronome', ['dt', 'deut', 'de']], ['Josh', 'Josué', ['jos', 'js']],
  ['Judg', 'Juges', ['jg', 'jug']], ['Ruth', 'Ruth', ['rt', 'ru']], ['1Sam', '1 Samuel', ['1s', '1sam', '1sa']],
  ['2Sam', '2 Samuel', ['2s', '2sam', '2sa']], ['1Kgs', '1 Rois', ['1r', '1rois', '1ro']], ['2Kgs', '2 Rois', ['2r', '2rois', '2ro']],
  ['1Chr', '1 Chroniques', ['1ch', '1chr']], ['2Chr', '2 Chroniques', ['2ch', '2chr']], ['Ezra', 'Esdras', ['esd', 'esdr']],
  ['Neh', 'Néhémie', ['ne', 'neh']], ['Esth', 'Esther', ['est', 'esth']], ['Job', 'Job', ['jb']],
  ['Ps', 'Psaumes', ['ps', 'psaume', 'psa']], ['Prov', 'Proverbes', ['pr', 'pro', 'prov']], ['Eccl', 'Ecclésiaste', ['ec', 'ecc', 'qo', 'eccl']],
  ['Song', 'Cantique des cantiques', ['ct', 'cant', 'cantique']], ['Isa', 'Ésaïe', ['es', 'esa', 'is', 'isaie']], ['Jer', 'Jérémie', ['jr', 'jer']],
  ['Lam', 'Lamentations', ['lm', 'lam']], ['Ezek', 'Ézéchiel', ['ez', 'eze', 'ezech']], ['Dan', 'Daniel', ['dn', 'da', 'dan']],
  ['Hos', 'Osée', ['os']], ['Joel', 'Joël', ['jl', 'joe']], ['Amos', 'Amos', ['am']], ['Obad', 'Abdias', ['ab', 'abd']],
  ['Jonah', 'Jonas', ['jon']], ['Mic', 'Michée', ['mi', 'mic']], ['Nah', 'Nahum', ['na', 'nah']], ['Hab', 'Habacuc', ['ha', 'hab']],
  ['Zeph', 'Sophonie', ['so', 'soph']], ['Hag', 'Aggée', ['ag', 'agg']], ['Zech', 'Zacharie', ['za', 'zach']], ['Mal', 'Malachie', ['ml', 'mal']],
  ['Matt', 'Matthieu', ['mt', 'mat', 'matt']], ['Mark', 'Marc', ['mc', 'mr', 'marc']], ['Luke', 'Luc', ['lc', 'lu']],
  ['John', 'Jean', ['jn', 'jean']], ['Acts', 'Actes', ['ac', 'act', 'actes']], ['Rom', 'Romains', ['rm', 'ro', 'rom']],
  ['1Cor', '1 Corinthiens', ['1co', '1cor']], ['2Cor', '2 Corinthiens', ['2co', '2cor']], ['Gal', 'Galates', ['ga', 'gal']],
  ['Eph', 'Éphésiens', ['ep', 'eph']], ['Phil', 'Philippiens', ['ph', 'phil', 'php']], ['Col', 'Colossiens', ['col']],
  ['1Thess', '1 Thessaloniciens', ['1th', '1thes']], ['2Thess', '2 Thessaloniciens', ['2th', '2thes']], ['1Tim', '1 Timothée', ['1tm', '1tim', '1ti']],
  ['2Tim', '2 Timothée', ['2tm', '2tim', '2ti']], ['Titus', 'Tite', ['tt', 'tit']], ['Phlm', 'Philémon', ['phm', 'philem']],
  ['Heb', 'Hébreux', ['he', 'heb']], ['Jas', 'Jacques', ['jc', 'ja', 'jac']], ['1Pet', '1 Pierre', ['1p', '1pi', '1pie']],
  ['2Pet', '2 Pierre', ['2p', '2pi', '2pie']], ['1John', '1 Jean', ['1jn', '1jean']], ['2John', '2 Jean', ['2jn', '2jean']],
  ['3John', '3 Jean', ['3jn', '3jean']], ['Jude', 'Jude', ['jud']], ['Rev', 'Apocalypse', ['ap', 'apo', 'apoc']],
];

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');

let books: BookInfo[] | null = null;
let meta: TranslationMeta | null = null;
let memText: Map<string, string> | null = null; // `${b}.${c}.${v}` → texte
let normIndex: { k: string; n: string }[] | null = null;
let loading: Promise<void> | null = null;

export const bibleSourceUrl = () => `${import.meta.env.BASE_URL ?? '/'}bible/lsg.json`;

/** Charge la Bible (depuis IndexedDB, sinon téléchargement unique puis stockage local). */
export function loadBible(fetcher: () => Promise<unknown> = async () => (await fetch(bibleSourceUrl())).json()): Promise<void> {
  if (books && memText) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const stored = await db.meta.get('bible:LSG1910');
    if (stored) {
      const s = stored.value as { meta: TranslationMeta; chapters: Record<number, number[]> };
      meta = s.meta;
      books = NAMES.map(([osis, name, abbr], i) => ({ id: i + 1, osis, name, abbr, testament: i < 39 ? 'AT' : 'NT', chapters: s.chapters[i + 1] }));
      const rows = await db.bible.toArray();
      memText = new Map(rows.map((r) => [r.k, r.t]));
    } else {
      const data = (await fetcher()) as { translation: TranslationMeta; books: { id: number; chapters: string[][] }[] };
      meta = data.translation;
      const chapters: Record<number, number[]> = {};
      const rows: { k: string; b: number; c: number; v: number; t: string }[] = [];
      for (const b of data.books) {
        chapters[b.id] = b.chapters.map((c) => c.length);
        b.chapters.forEach((c, ci) => c.forEach((t, vi) => rows.push({ k: `${b.id}.${ci + 1}.${vi + 1}`, b: b.id, c: ci + 1, v: vi + 1, t })));
      }
      await db.bible.bulkPut(rows);
      await db.meta.put({ key: 'bible:LSG1910', value: { meta, chapters } });
      books = NAMES.map(([osis, name, abbr], i) => ({ id: i + 1, osis, name, abbr, testament: i < 39 ? 'AT' : 'NT', chapters: chapters[i + 1] }));
      memText = new Map(rows.map((r) => [r.k, r.t]));
    }
    normIndex = [...memText.entries()].map(([k, t]) => ({ k, n: norm(t) }));
  })().finally(() => { loading = null; });
  return loading;
}

export const bibleReady = () => !!books && !!memText;
export const getBooks = () => books ?? NAMES.map(([osis, name, abbr], i) => ({ id: i + 1, osis, name, abbr, testament: (i < 39 ? 'AT' : 'NT') as 'AT' | 'NT', chapters: [] }));
export const getMeta = () => meta;
export const bookName = (id: number) => NAMES[id - 1]?.[1] ?? '?';

export interface Ref { book: number; chapter: number; from?: number; to?: number }

function findBook(token: string): number | null {
  const t = norm(token).replace(/\s+/g, '').replace(/\.$/, '');
  for (let i = 0; i < NAMES.length; i++) {
    const [osis, name, abbr] = NAMES[i];
    if (norm(name).replace(/\s+/g, '') === t || norm(osis) === t || abbr.includes(t)) return i + 1;
  }
  // préfixe non ambigu (ex. « philipp »)
  const cands = NAMES.map(([, n], i) => ({ i, n: norm(n).replace(/\s+/g, '') })).filter((x) => t.length >= 3 && x.n.startsWith(t));
  return cands.length === 1 ? cands[0].i + 1 : null;
}

/** Analyse « Jean 3:16 », « Jn 3.16-18 », « 1 Co 13 », « Ps 23:1-4 ». */
export function parseRef(input: string): Ref | null {
  const m = input.trim().match(/^((?:[1-3]\s*)?[A-Za-zÀ-ÿ’' .]+?)\s*(\d+)(?:\s*[:.,]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
  if (!m) return null;
  const book = findBook(m[1]);
  if (!book) return null;
  const ref: Ref = { book, chapter: +m[2] };
  if (m[3]) ref.from = +m[3];
  if (m[4]) ref.to = +m[4];
  return ref;
}

export function formatRef(r: Ref) {
  const base = `${bookName(r.book)} ${r.chapter}`;
  if (!r.from) return base;
  return r.to && r.to !== r.from ? `${base}:${r.from}-${r.to}` : `${base}:${r.from}`;
}

export interface Passage { ref: string; parsed: Ref; verses: { v: number; t: string }[]; text: string }

/** Résout une référence dans la base. Renvoie null si elle n'existe pas : jamais d'invention. */
export function resolve(input: string | Ref): Passage | null {
  if (!memText || !books) return null;
  const r = typeof input === 'string' ? parseRef(input) : input;
  if (!r) return null;
  const b = books[r.book - 1];
  const nv = b?.chapters?.[r.chapter - 1];
  if (!nv) return null;
  const from = r.from ?? 1;
  const to = r.from ? (r.to ?? r.from) : nv;
  if (from < 1 || to > nv || to < from) return null;
  const verses: { v: number; t: string }[] = [];
  for (let v = from; v <= to; v++) verses.push({ v, t: memText.get(`${r.book}.${r.chapter}.${v}`) ?? '' });
  const norm2: Ref = r.from ? { ...r, from, to: to !== from ? to : undefined } : r;
  return { ref: formatRef(norm2), parsed: norm2, verses, text: verses.map((x) => x.t).join(' ') };
}

export function chapterText(book: number, chapter: number) {
  return resolve({ book, chapter });
}

export interface SearchHit { ref: string; text: string; score: number; book: number }

/** Recherche plein texte (insensible aux accents). Tous les mots doivent être présents. */
export function searchText(query: string, limit = 50, bookFilter?: number | ((book: number) => boolean)): SearchHit[] {
  if (!normIndex || !memText) return [];
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const { k, n } of normIndex) {
    if (typeof bookFilter === 'number' && !k.startsWith(`${bookFilter}.`)) continue;
    if (typeof bookFilter === 'function' && !bookFilter(Number(k.slice(0, k.indexOf('.'))))) continue;
    if (words.every((w) => n.includes(w))) {
      const [b, c, v] = k.split('.').map(Number);
      const exact = n.includes(words.join(' ')) ? 2 : 0;
      hits.push({ ref: formatRef({ book: b, chapter: c, from: v }), text: memText.get(k)!, score: exact + words.length, book: b });
      if (hits.length >= Math.max(limit * 4, 400)) break;
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Recherche universelle : référence si l'entrée en est une, sinon texte. */
export function search(query: string, limit = 50): { passage: Passage | null; hits: SearchHit[] } {
  const p = resolve(query);
  if (p) return { passage: p, hits: [] };
  return { passage: null, hits: searchText(query, limit) };
}

/** Découpe un texte en segments pour surligner les mots recherchés (insensible aux accents). */
export function highlight(text: string, query: string): { t: string; on: boolean }[] {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [{ t: text, on: false }];
  const n = norm(text);
  const marks = new Array(text.length).fill(false);
  for (const w of words) { let i = n.indexOf(w); while (i >= 0) { if (i === 0 || !/[a-z0-9]/.test(n[i - 1])) for (let j = i; j < i + w.length; j++) marks[j] = true; i = n.indexOf(w, i + 1); } } // seulement en début de mot
  const out: { t: string; on: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.on === marks[i]) last.t += text[i]; else out.push({ t: text[i], on: marks[i] });
  }
  return out;
}
