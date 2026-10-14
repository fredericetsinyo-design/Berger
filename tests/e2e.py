"""Tests de bout en bout dans Chromium (Playwright).
Usage : python3 tests/e2e.py [url] [dossier_captures]
Couvre : 1, 2, 3, 5, 6, 7, 8, 10, 11, 15, 18 du cahier des charges, dans un vrai navigateur."""
import sys, re, os
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173/'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'shots'
os.makedirs(OUT, exist_ok=True)
results = []

def step(name):
    def deco(fn):
        def run(*a):
            try:
                fn(*a); results.append(('OK', name))
            except Exception as e:
                try: globals()['pg'].screenshot(path=f'{OUT}/echec.png')
                except Exception: pass
                results.append(('ÉCHEC', f'{name} : {str(e).splitlines()[0][:200]}')); raise
        return run
    return deco

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}, locale='fr-FR', timezone_id='Africa/Lome', permissions=['notifications'])
    ctx.route('https://wa.me/**', lambda r: r.fulfill(body='WhatsApp (simulé)'))
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL)

    @step('1. Création de compte et connexion')
    def t1():
        pg.get_by_role('tab', name='Créer un compte').click()
        pg.get_by_label('Nom affiché').fill('Frédéric E.')
        pg.get_by_label('E-mail').fill('fred@berger.tg')
        pg.get_by_label('Mot de passe').fill('un-mot-de-passe-solide')
        pg.get_by_role('button', name='Créer le compte').click()
        expect(pg.locator('.recovery')).to_be_visible(timeout=20000)
        pg.screenshot(path=f'{OUT}/01-cle-secours.png')
        pg.get_by_label(re.compile('conservé cette clé')).check()
        pg.get_by_role('button', name='Continuer').click()
        expect(pg.get_by_role('heading', name=re.compile('Bonjour|Bon après-midi|Bonsoir'))).to_be_visible(timeout=20000)
    t1()

    @step('2. Création d’une fiche de jeune')
    def t2():
        pg.goto(URL + '#/jeunes?nouveau=1')
        pg.get_by_label('Prénom *').fill('Kossi')
        pg.get_by_label('Nom', exact=True).fill('Amegah')
        pg.get_by_label('Téléphone').fill('90 12 34 56')
        pg.get_by_label('Ville ou zone (si nécessaire)').fill('Bè')
        pg.get_by_role('button', name='Enregistrer').click()
        expect(pg.get_by_role('heading', name='Kossi Amegah')).to_be_visible()
        pg.get_by_role('tab', name='Consentements').click()
        for label in ['Enregistrement audio', 'Traitement automatisé']:
            pg.locator('.list-item', has_text=label).get_by_role('button', name='Enregistrer l’accord').click()
            expect(pg.locator('.list-item', has_text=label).get_by_text('Accordé', exact=True)).to_be_visible()
        pg.get_by_role('tab', name='Situation initiale').click()
        pg.get_by_label('Attentes exprimées par le jeune').fill('Être aidé pour son orientation')
        pg.get_by_label('Besoins prioritaires').click()
        pg.get_by_placeholder('Fait rapporté par le jeune').fill('Dit hésiter entre deux filières')
        pg.get_by_role('button', name='Ajouter').click()
        expect(pg.get_by_text('Dit hésiter entre deux filières')).to_be_visible()
        pg.screenshot(path=f'{OUT}/02-fiche.png', full_page=True)
    t2()

    @step('3 & 5. Rencontre, notes, actions')
    def t3():
        pg.get_by_role('button', name='Nouvelle rencontre').click()
        expect(pg.get_by_label('Thème principal')).to_be_visible()
        pg.get_by_label('Thème principal').fill('Orientation scolaire')
        pg.get_by_placeholder(re.compile('Ce qui a été dit')).fill('Hésite entre informatique et gestion. Souhaite prier pour ce choix.')
        pg.get_by_label('Décisions prises (une par ligne)').fill('Rencontrer un conseiller d’orientation')
        pg.get_by_placeholder('Ex. Jacques 1:5').fill('Jc 1:5')
        pg.get_by_placeholder('Ex. Jacques 1:5').press('Enter')
        expect(pg.get_by_text('Jacques 1:5', exact=True)).to_be_visible(timeout=20000)
        pg.get_by_placeholder('Ex. Jacques 1:5').fill('Jean 99:1')
        pg.get_by_placeholder('Ex. Jacques 1:5').press('Enter')
        expect(pg.get_by_text(re.compile('Référence introuvable'))).to_be_visible()
        pg.get_by_role('button', name='Ajouter').first.click()
        pg.get_by_label('Intitulé').fill('Contacter le jeune')
        pg.get_by_label('Priorité').select_option('haute')
        pg.locator('.modal').get_by_role('button', name='Enregistrer').click()
        expect(pg.get_by_text('Contacter le jeune')).to_be_visible()
        pg.get_by_role('button', name='Structurer sans IA').click()
        pg.get_by_role('button', name='Mettre en forme').click()
        pg.get_by_role('button', name='Valider le compte rendu').click()
        expect(pg.get_by_text('Validé', exact=True)).to_be_visible()
        pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/03-rencontre.png', full_page=True)
    t3()

    @step('Import de contacts (vCard) avec détection des doublons')
    def timport():
        import tempfile
        f = tempfile.NamedTemporaryFile('w', suffix='.vcf', delete=False)
        f.write('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Mawuli Dossou\r\nTEL;TYPE=CELL:+228 92 45 67 89\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nN:Amegah;Kossi;;;\r\nTEL:90123456\r\nEND:VCARD\r\n'); f.close()
        pg.goto(URL + '#/jeunes?importer=1')
        pg.locator('.modal input[type=file]').set_input_files(f.name)
        expect(pg.get_by_text('Déjà présent')).to_be_visible()
        pg.get_by_label('Rechercher dans les contacts').fill('mawu')
        expect(pg.get_by_text('1 affiché(s)')).to_be_visible()
        expect(pg.locator('.modal').get_by_text('Kossi Amegah')).to_be_hidden()
        pg.get_by_label('Rechercher dans les contacts').fill('')
        pg.get_by_role('button', name=re.compile('Créer 1 fiche')).click()
        expect(pg.get_by_text('Mawuli Dossou')).to_be_visible()
        pg.screenshot(path=f'{OUT}/04-jeunes.png', full_page=True)
    timport()

    @step('Sélection multiple et suppression groupée')
    def tdelete():
        pg.goto(URL + '#/jeunes')
        pg.get_by_role('button', name='Nouveau jeune').click()
        pg.get_by_label('Prénom *').fill('Temporaire')
        pg.locator('.modal').get_by_role('button', name='Enregistrer').click()
        expect(pg.get_by_role('heading', name='Temporaire', exact=True)).to_be_visible()
        pg.goto(URL + '#/jeunes')
        pg.get_by_role('button', name='Sélectionner').click()
        pg.get_by_role('checkbox', name=re.compile('Temporaire')).click()
        pg.get_by_role('checkbox', name=re.compile('Mawuli')).click()
        expect(pg.get_by_text('2 sélectionnés')).to_be_visible()
        pg.get_by_role('button', name='Supprimer (2)').click()
        pg.get_by_role('button', name='Supprimer définitivement').click()
        expect(pg.get_by_text('2 dossiers supprimés')).to_be_visible()
        expect(pg.get_by_text('Kossi Amegah')).to_be_visible()
        expect(pg.get_by_text('Mawuli Dossou')).to_be_hidden()
        # « Tout supprimer » exige de taper SUPPRIMER : on vérifie le garde-fou puis on annule
        pg.get_by_role('button', name='Sélectionner').click()
        pg.get_by_role('button', name='Tout supprimer').click()
        expect(pg.get_by_role('button', name='Supprimer définitivement')).to_be_disabled()
        pg.get_by_label('Pour confirmer, tapez SUPPRIMER').fill('supprimer')
        expect(pg.get_by_role('button', name='Supprimer définitivement')).to_be_enabled()
        pg.get_by_role('button', name='Annuler').click()
        pg.get_by_role('button', name='Quitter la sélection').click()
    tdelete()

    @step('6. Bible : lecture, recherche, suggestions vérifiées')
    def t6():
        pg.goto(URL + '#/bible')
        expect(pg.get_by_role('heading', name='Jean 1')).to_be_visible(timeout=30000)
        pg.get_by_label('Rechercher dans la Bible').fill('berger ne manquerai')
        expect(pg.get_by_text('Psaumes 23:1')).to_be_visible()
        expect(pg.locator('mark', has_text='berger').first).to_be_visible()
        pg.get_by_label('Rechercher dans la Bible').fill('Jn 3:16')
        expect(pg.get_by_text('Jean 3:16', exact=True)).to_be_visible()
        pg.get_by_role('button', name='Effacer').click()
        pg.get_by_role('tab', name='Par thème').click()
        pg.get_by_role('button', name='Sagesse et prise de décision').click()
        pg.get_by_role('button', name='Rechercher').click()
        expect(pg.get_by_text('Jacques 1:5', exact=True)).to_be_visible()
        pg.screenshot(path=f'{OUT}/06-bible.png', full_page=True)
    t6()

    @step('7. Rendez-vous, conflit horaire, préparation de séance')
    def t7():
        pg.goto(URL + '#/agenda?nouveau=1')
        pg.get_by_label('Sujet prévu').fill('Point orientation')
        pg.get_by_role('button', name='Préparer la fiche de séance').click()
        expect(pg.get_by_label('Notes préparatoires')).to_contain_text('Contacter le jeune')
        pg.get_by_role('button', name=re.compile('^Enregistrer')).click()
        expect(pg.locator('.modal')).to_be_hidden()
        pg.goto(URL + '#/agenda?nouveau=1')
        expect(pg.get_by_text(re.compile('Conflit horaire'))).to_be_visible()
        pg.get_by_role('button', name='Annuler').click()
        pg.get_by_role('tab', name='Mois').click()
        pg.screenshot(path=f'{OUT}/07-agenda.png')
    t7()

    @step('8. Préparation d’une relance WhatsApp')
    def t8():
        pg.goto(URL + '#/relances')
        pg.locator('select').first.select_option(label='Kossi Amegah')
        pg.get_by_role('button', name='Écrire').click()
        ow = pg.get_by_role('button', name='Ouvrir dans WhatsApp')
        expect(ow).to_be_disabled()
        pg.get_by_label(re.compile('relu et je valide')).check()
        with ctx.expect_page() as popup:
            ow.click()
        assert 'wa.me/22890123456' in popup.value.url or 'whatsapp' in popup.value.url, popup.value.url
        popup.value.close()
        expect(pg.locator('.badge', has_text='WhatsApp ouvert (envoi non vérifiable)')).to_be_visible()
    t8()

    @step('Tableau de bord')
    def tdash():
        pg.goto(URL + '#/')
        expect(pg.get_by_text('Jeunes suivis')).to_be_visible()
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/00-tableau-de-bord.png', full_page=True)
    tdash()

    @step('10 & 11. Hors ligne : création, fermeture, réouverture')
    def t10():
        ctx.set_offline(True)
        pg.goto(URL + '#/actions?nouveau=1')
        pg.get_by_label('Intitulé').fill('Action créée hors ligne')
        pg.locator('.modal').get_by_role('button', name='Enregistrer').click()
        expect(pg.get_by_text('Action créée hors ligne')).to_be_visible()
        expect(pg.locator('.sync')).to_contain_text('Hors ligne')
        pg.close()
        pg2 = ctx.new_page()
        pg2.goto(URL)  # rechargé depuis le service worker, sans réseau
        expect(pg2.get_by_label('E-mail')).to_have_value('fred@berger.tg', timeout=20000)
        pg2.get_by_label('Mot de passe').fill('un-mot-de-passe-solide')
        pg2.get_by_role('button', name='Se connecter').click()
        expect(pg2.get_by_text('Jeunes suivis')).to_be_visible(timeout=20000)
        pg2.goto(URL + '#/actions')
        expect(pg2.get_by_text('Action créée hors ligne')).to_be_visible(timeout=20000)
        pg2.goto(URL + '#/bible')
        expect(pg2.get_by_role('heading', name='Jean 1')).to_be_visible(timeout=20000)
        ctx.set_offline(False)
        globals()['pg'] = pg2
    t10()

    @step('15. Changement d’utilisateur sur le même appareil')
    def t15():
        pg = globals()['pg']
        pg.goto(URL + '#/reglages')
        pg.get_by_role('button', name=re.compile('changer d’utilisateur')).click()
        pg.get_by_role('tab', name='Créer un compte').click()
        pg.get_by_label('Nom affiché').fill('Autre')
        pg.get_by_label('E-mail').fill('autre@berger.tg')
        pg.get_by_label('Mot de passe').fill('autre-mot-de-passe')
        pg.get_by_role('button', name='Créer le compte').click()
        pg.get_by_label(re.compile('conservé cette clé')).check()
        pg.get_by_role('button', name='Continuer').click()
        pg.goto(URL + '#/jeunes')
        expect(pg.get_by_text('Aucune fiche')).to_be_visible()
    t15()

    @step('18. Affichage smartphone')
    def t18():
        m = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='fr-FR', timezone_id='Africa/Lome')
        mp = m.new_page()
        mp.goto(URL)
        mp.get_by_label('E-mail').fill('fred@berger.tg')
        mp.screenshot(path=f'{OUT}/18-mobile-connexion.png')
        m.close()
        pg = globals()['pg']
        pg.set_viewport_size({'width': 390, 'height': 844})
        pg.goto(URL + '#/')
        expect(pg.locator('.bottom-nav')).to_be_visible()
        expect(pg.locator('.sidebar')).to_be_hidden()
        overflow = pg.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
        assert not overflow, 'défilement horizontal sur mobile'
        pg.screenshot(path=f'{OUT}/18-mobile-accueil.png', full_page=True)
    t18()

    b.close()

for s, n in results: print(f'[{s}] {n}')
print('Erreurs JS :', errors or 'aucune')
