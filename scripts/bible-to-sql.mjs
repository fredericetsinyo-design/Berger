// Génère le fichier SQL d'import de la Bible Louis Segond 1910 (domaine public) pour Supabase.
// Usage : node scripts/bible-to-sql.mjs > supabase/seed_bible_lsg1910.sql
import fs from 'node:fs';
const NAMES = ['Genèse','Exode','Lévitique','Nombres','Deutéronome','Josué','Juges','Ruth','1 Samuel','2 Samuel','1 Rois','2 Rois','1 Chroniques','2 Chroniques','Esdras','Néhémie','Esther','Job','Psaumes','Proverbes','Ecclésiaste','Cantique des cantiques','Ésaïe','Jérémie','Lamentations','Ézéchiel','Daniel','Osée','Joël','Amos','Abdias','Jonas','Michée','Nahum','Habacuc','Sophonie','Aggée','Zacharie','Malachie','Matthieu','Marc','Luc','Jean','Actes','Romains','1 Corinthiens','2 Corinthiens','Galates','Éphésiens','Philippiens','Colossiens','1 Thessaloniciens','2 Thessaloniciens','1 Timothée','2 Timothée','Tite','Philémon','Hébreux','Jacques','1 Pierre','2 Pierre','1 Jean','2 Jean','3 Jean','Jude','Apocalypse'];
const d = JSON.parse(fs.readFileSync(new URL('../public/bible/lsg.json', import.meta.url), 'utf8'));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const t = d.translation;
const out = [`begin;`, `insert into public.bible_translations (code, name, language, year, license, license_note, source_url, can_display_text) values (${q(t.code)}, ${q(t.name)}, 'fr', 1910, ${q(t.license)}, ${q(t.licenseNote)}, ${q(t.source)}, true) on conflict (code) do nothing;`];
for (const b of d.books) out.push(`insert into public.bible_books values (${q(t.code)}, ${b.id}, ${q(b.osis)}, ${q(NAMES[b.id - 1])}, ${b.chapters.length}) on conflict do nothing;`);
for (const b of d.books) b.chapters.forEach((c, ci) => {
  const rows = c.map((txt, vi) => `(${q(t.code)},${b.id},${ci + 1},${vi + 1},${q(txt)})`);
  out.push(`insert into public.bible_verses values ${rows.join(',')} on conflict do nothing;`);
});
out.push('commit;');
process.stdout.write(out.join('\n') + '\n');
