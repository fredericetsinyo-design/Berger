// Convertit la Bible Louis Segond 1910 (domaine public, source : github.com/midvash/bible-data)
// en un fichier compact public/bible/lsg.json utilisé par l'application.
// Usage : node scripts/prepare-bible.mjs <chemin vers lsg.json> <chemin vers metadata.json>
import fs from 'node:fs';
import path from 'node:path';

const [src, metaSrc] = process.argv.slice(2);
if (!src) { console.error('Usage: node scripts/prepare-bible.mjs lsg.json metadata.json'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const meta = metaSrc ? JSON.parse(fs.readFileSync(metaSrc, 'utf8')) : {};

// L'export source double les apostrophes (échappement SQL) : on les rétablit.
const clean = (t) => t.replace(/''/g, '’').replace(/'/g, '’').replace(/\s+/g, ' ').trim();

const books = raw.books.map((b) => ({
  id: b.bookId,
  osis: b.book,
  testament: b.testament,
  chapters: b.chapters.map((c) => {
    const arr = [];
    for (const v of c.verses) arr[v.number - 1] = clean(v.text);
    return arr.map((x) => x ?? '');
  }),
}));

const verses = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.length, 0), 0);
const out = {
  translation: {
    code: 'LSG1910',
    name: meta.name || 'Louis Segond 1910',
    language: 'fr',
    year: 1910,
    license: 'Domaine public',
    licenseNote: meta.licenseNote || 'Public domain (1910 revision of the Louis Segond translation).',
    source: 'https://github.com/midvash/bible-data (versions/fr/lsg)',
    canDisplayText: true,
    verses,
  },
  books,
};
const dest = path.resolve('public/bible/lsg.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`OK : ${books.length} livres, ${verses} versets → ${dest}`);
