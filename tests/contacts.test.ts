import { describe, it, expect } from 'vitest';
import { parseVCard, parseCSV, parseContactFile, markDuplicates } from '../src/lib/contacts';

describe('Import de contacts', () => {
  it('lit un fichier vCard (lignes repliées, encodage, mobile prioritaire, photo)', () => {
    const vcf = [
      'BEGIN:VCARD', 'VERSION:3.0', 'N:Mensah;Afi;;;', 'FN:Afi Mensah', 'TEL;TYPE=HOME:22 21 00 00', 'TEL;TYPE=CELL:+228 90 11 22 33',
      'EMAIL:afi@exemple.tg', 'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQ', ' SkZJRg==', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:2.1', 'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ay=C3=A9l=C3=A9 Koffi', 'TEL;CELL:91234567', 'END:VCARD',
    ].join('\r\n');
    const r = parseVCard(vcf);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ firstName: 'Afi', lastName: 'Mensah', phone: '+228 90 11 22 33', email: 'afi@exemple.tg' });
    expect(r[0].photo).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(r[1]).toMatchObject({ firstName: 'Ayélé', lastName: 'Koffi', phone: '91234567' });
  });

  it('lit un export Google Contacts et un CSV français à point-virgule', () => {
    const google = 'First Name,Middle Name,Last Name,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value\nKossi,,Amegah,kossi@x.tg,Mobile,90 12 34 56 ::: 22 22 22 22\n"Yao, Jr",,Lawson,,Mobile,91000000\n';
    expect(parseCSV(google)).toEqual([
      { firstName: 'Kossi', lastName: 'Amegah', phone: '90 12 34 56', email: 'kossi@x.tg', source: 'csv' },
      { firstName: 'Yao, Jr', lastName: 'Lawson', phone: '91000000', email: undefined, source: 'csv' },
    ]);
    const fr = '﻿Nom;Prénom;Téléphone;Email\nAgbeko;Dzifa;93 33 33 33;dzifa@x.tg\n';
    expect(parseContactFile('jeunes.csv', fr)[0]).toMatchObject({ firstName: 'Dzifa', lastName: 'Agbeko', phone: '93 33 33 33' });
  });

  it('signale les doublons (numéro ou nom déjà présents, ou répétés dans le fichier)', () => {
    const drafts = parseCSV('Name,Phone\nKossi Amegah,+228 90 12 34 56\nNouvelle Personne,99 99 99 99\nNouvelle Personne,99 99 99 99\n');
    const r = markDuplicates(drafts, [{ firstName: 'K.', lastName: 'A.', phone: '90123456' }]);
    expect(r.map((x) => x.duplicate)).toEqual([true, false, true]);
  });
});
