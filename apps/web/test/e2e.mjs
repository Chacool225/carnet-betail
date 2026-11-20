// Test de bout en bout dans un vrai Chromium, contre le faux serveur (test/mock-server.mjs).
// Usage : node test/e2e.mjs   (après `pnpm build`). Sortie 0 = tout passe.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mock = createMock({ staticDir: join(root, 'dist') });
await new Promise((r) => mock.server.listen(0, r));
const base = `http://localhost:${mock.server.address().port}`;
const browser = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/401|404|409|422|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const toastText = () => page.locator('.toast').allInnerTexts();

try {
  await page.goto(base);
  await page.waitForURL('**/#/connexion');
  ok(true, 'non connecté → page de connexion');
  await page.fill('input[type=tel], input[name=phone], input[autocomplete=username]', '0712345678');
  await page.fill('input[type=password]', 'mauvais');
  await page.click('button.pri');
  await page.getByText('Identifiants incorrects', { exact: false }).waitFor();
  ok(true, 'mauvais mot de passe → message');
  await page.fill('input[type=password]', 'Demo1234!');
  await page.click('button.pri');
  await page.getByText('Bonjour Awa').waitFor();
  ok(true, 'connexion éleveur → accueil');

  // création d'un animal
  await page.goto(base + '/#/animaux/nouveau');
  await page.getByLabel("Nom de l'animal").fill('Kouadio');
  await page.getByLabel('Zone').selectOption({ label: 'Korhogo' });
  await page.getByRole('button', { name: 'Créer la fiche' }).click();
  await page.getByRole('heading', { name: 'Kouadio' }).waitFor();
  ok(mock.animals.length === 1, 'création animal → fiche ouverte');
  const animalUrl = page.url();

  // acte de santé avec délai d'attente → vente refusée
  await page.getByRole('button', { name: /Acte de santé/ }).click();
  await page.getByLabel('Intitulé').fill('Antibiotique');
  await page.getByLabel('Type').selectOption('soin');
  await page.getByLabel("Délai d'attente (jours)").fill('7');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText("Délai d'attente jusqu'au").first().waitFor();
  ok(true, "soin avec délai → bandeau d'attente");
  await page.getByRole('button', { name: 'Vente', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await page.getByText("Délai d'attente en cours").waitFor();
  ok(true, 'vente pendant délai → refusée avec explication');
  await page.keyboard.press('Escape');

  await page.goto(base + '/#/animaux/nouveau'); await page.getByLabel('Zone').selectOption({ label: 'Korhogo' });
  // hors-ligne : saisie en file, puis rejeu sans doublon
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(() => { location.hash = '#/animaux/nouveau'; });
  await page.getByLabel("Nom de l'animal").fill('Hors-ligne 1');
  await page.getByLabel('Zone').selectOption({ label: 'Korhogo' });
  await page.getByRole('button', { name: 'Créer la fiche' }).click();
  await page.waitForURL('**/#/envoi');
  await page.getByText('Hors-ligne 1', { exact: false }).first().waitFor();
  ok(mock.animals.length === 1, 'hors-ligne → mis en file, rien envoyé');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('Tout est envoyé').waitFor({ timeout: 8000 });
  ok(mock.animals.length === 2, 'retour réseau → envoyé une seule fois');
  const queued = JSON.parse(await page.evaluate(() => localStorage.getItem('carnet.queue') ?? '[]'));
  ok(queued.length === 0, 'file vide après envoi');

  // lot + mortalité > stock
  await page.goto(base + '/#/animaux/nouveau');
  await page.getByLabel('Espèce').selectOption('volaille');
  await page.getByLabel('Nom du lot').fill('Bande 1');
  await page.getByLabel('Effectif').fill('50');
  await page.getByLabel('Zone').selectOption({ label: 'Korhogo' });
  await page.getByRole('button', { name: 'Créer la fiche' }).click();
  await page.getByRole('heading', { name: 'Bande 1' }).waitFor();
  await page.getByRole('button', { name: /Mortalité/ }).click();
  await page.getByLabel('Nombre de morts').fill('80');
  await page.getByRole('button', { name: 'Déclarer', exact: true }).click();
  await page.getByText('Il ne reste que 50').waitFor();
  ok(true, 'mortalité > stock → message en français');
  await page.keyboard.press('Escape');

  // mise en vente à l'unité avec prix réduit
  await page.getByRole('button', { name: /Mettre en vente/ }).click();
  await page.getByLabel(/Combien en mettre en vente/).fill('30');
  await page.getByLabel(/^Prix à l'unité en FCFA/).fill('2000');
  await page.getByLabel(/Prix réduit à partir/).check();
  await page.getByLabel('À partir de combien ?').fill('10');
  await page.getByLabel(/Prix réduit à l'unité/).fill('2500');
  await page.getByText('Doit être inférieur au prix normal.').waitFor();
  ok(await page.getByRole('button', { name: "Publier l'annonce" }).isDisabled(), 'annonce : prix réduit supérieur au prix normal refusé');
  await page.getByLabel(/Prix réduit à l'unité/).fill('1700');
  const sum = (await page.locator('.banner.info').innerText()).replace(/[\u202f\u00a0\s]+/g, ' ');
  ok(sum.includes('30 volailles × 2 000 FCFA = 60 000 FCFA') && sum.includes('Dès 10 : 1 700 FCFA'), 'annonce : récapitulatif quantité × prix et palier');
  await page.getByRole('button', { name: "Publier l'annonce" }).click();
  await page.getByText(/En vente :/).waitFor();
  const ll = mock.stats.lastListing;
  ok(ll.price === 2000 && ll.qty === 30 && ll.bulkMinQty === 10 && ll.bulkPrice === 1700, 'annonce : prix, quantité et palier envoyés');
  await page.getByRole('button', { name: "Modifier l'annonce" }).waitFor();

  // liste + recherche
  await page.goto(base + '/#/animaux');
  await page.getByText('Kouadio').first().waitFor();
  await page.getByLabel('Rechercher').fill('Bande');
  await page.waitForTimeout(500);
  ok((await page.locator('ul.rows li').count()) === 1, 'recherche filtre la liste');

  // les filtres vivent dans l'adresse
  ok(page.url().includes('q=Bande'), 'le filtre de recherche est dans l\'adresse');
  await page.reload(); await page.getByText('Bande').first().waitFor();
  ok((await page.getByLabel('Rechercher').inputValue()) === 'Bande', 'recherche retrouvée après rechargement');
  await page.getByLabel('Rechercher').fill(''); await page.waitForTimeout(500);

  // cheptel complet : l'animal vendu à un autre reste consultable, en lecture seule
  ok(!(await page.getByText('Tacheté').count()), 'animal sorti absent du cheptel courant');
  await page.getByRole('radio', { name: /Cheptel complet/ }).click();
  await page.getByText('Tacheté').waitFor();
  ok(true, 'cheptel complet affiche l\'animal vendu');
  ok((await page.getByText('Sorti du cheptel le').count()) === 1, 'date de sortie affichée');
  await page.getByText('Tacheté').click();
  await page.getByText('Dossier archivé, en lecture seule').waitFor();
  ok((await page.getByText('Charbon symptomatique').count()) === 1, 'archive : actes visibles');
  ok(!(await page.getByRole('button', { name: /Acte de santé|Vente|Transférer/ }).count()), 'archive : aucune action possible');
  await page.getByLabel('Rechercher').fill('vermifuge'); await page.waitForTimeout(500);
  ok((await page.getByText('Charbon symptomatique').count()) === 0 && (await page.getByText('Vermifuge').count()) === 1, 'archive : recherche dans le dossier');
  await page.getByLabel('Rechercher').fill('');
  await page.getByLabel('Période : du').fill('2026-04-01'); await page.waitForTimeout(200);
  ok((await page.getByText('Charbon symptomatique').count()) === 0, 'archive : filtre de date');
  // l'ancienne adresse de la fiche renvoie vers l'archive
  await page.goto(base + '/#/animaux/00000000-0000-4000-8000-0000000000aa');
  await page.getByText('Dossier archivé, en lecture seule').waitFor();
  ok(page.url().includes('/archives/'), 'fiche inaccessible → redirigé vers l\'archive');

  // journal du compte
  await page.goto(base + '/#/historique');
  await page.getByText('Création de la fiche').first().waitFor();
  ok((await page.locator('ul.journal .day').count()) >= 1, 'journal : regroupé par jour');
  await page.getByLabel('Catégorie').selectOption('sante'); await page.waitForTimeout(300);
  ok((await page.getByText('Création de la fiche').count()) === 0, 'journal : filtre par catégorie');
  await page.getByLabel('Catégorie').selectOption(''); await page.getByLabel('Période : du').fill('2099-01-01'); await page.waitForTimeout(300);
  await page.getByText('Aucun évènement ne correspond').waitFor();
  ok(true, 'journal : période sans résultat → message');
  ok(mock.stats.queries.some((x) => x.startsWith('/me/history') && x.includes('from=2099-01-01')), 'journal : la date part vers le serveur');

  // photo envoyée depuis le téléphone : réduite avant l'envoi
  await page.goto(base + '/#/animaux');
  await page.getByText('Bande').first().click();
  await page.getByRole('tab', { name: 'Photos' }).click();
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await page.locator('input[type=file]').setInputFiles('/tmp/claude-0/photo.png');
  await page.getByRole('button', { name: 'Ajouter' }).last().click();
  await page.waitForTimeout(600);
  ok(mock.stats.uploads === 1 && mock.stats.lastUploadBytes > 100, 'photo : envoyée vers /photos/upload');
  ok(mock.stats.lastUploadBytes < 60000, `photo : 2000×1500 réduite avant l'envoi (${mock.stats.lastUploadBytes} car.)`);

  // carnet imprimable
  const animalHref = page.url().split('#')[1];
  await page.goto(base + '/#/imprimer/carnet/' + animalHref.split('/').pop());
  await page.getByRole('heading', { name: 'Carnet de santé' }).waitFor();
  ok((await page.getByRole('button', { name: /Imprimer ou enregistrer en PDF/ }).count()) === 1, 'carnet imprimable : bouton PDF');
  const pdf = await page.pdf({ format: 'A4' });
  ok(pdf.length > 3000 && pdf.subarray(0, 4).toString() === '%PDF', 'carnet : PDF généré');

  // inscription d'un particulier qui achète pour un restaurant
  const norm = (s) => s.replace(/[  \s]+/g, ' ');
  await page.goto(base + '/#/profil');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForURL('**/#/connexion');
  await page.goto(base + '/#/inscription');
  await page.getByRole('radio', { name: /Particulier/ }).click();
  ok((await page.getByLabel(/Profession/).count()) === 1, 'inscription particulier : champ profession');
  await page.getByLabel('Nom complet').fill('Resto Le Baobab');
  await page.getByLabel('Téléphone', { exact: true }).fill('0700000055');
  await page.getByLabel('Mot de passe').fill('Motdepasse1!');
  await page.getByLabel(/Profession/).fill('Restaurateur');
  await page.getByLabel(/Localité/).fill('Cocody');
  ok((await page.getByLabel("Nom de l'organisation").count()) === 0, 'organisation masquée tant que non cochée');
  await page.getByLabel(/J'achète pour une organisation/).check();
  await page.getByLabel("Nom de l'organisation").fill('Le Baobab');
  await page.getByLabel('Nom du responsable').fill('Mme Koné');
  await page.getByLabel('Téléphone du responsable').fill('0711223344');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByText('Acheter un animal').waitFor();
  ok(mock.stats.registeredProfile?.orgName === 'Le Baobab' && mock.stats.registeredProfile.orgKind === 'restaurant' && mock.stats.registeredProfile.contactPhone === '0711223344' && mock.stats.registeredProfile.profession === 'Restaurateur', 'inscription : profil acheteur envoyé');
  ok(!(await page.getByRole('link', { name: 'Scanner' }).count()), 'particulier : pas de menu éleveur');

  // fiche annonce : prix à l'unité, palier, quantité
  await page.getByRole('link', { name: 'Voir le marché' }).click();
  await page.getByText('Poulets de chair').first().waitFor();
  const card = norm(await page.locator('ul.rows li').first().innerText());
  ok(card.includes('1 500 FCFA') && card.includes('/ unité') && card.includes('1 200 FCFA dès 100') && card.includes('120 volailles à vendre'), 'marché : prix à l\'unité, palier et quantité à vendre');
  await page.getByText('Poulets de chair').first().click();
  await page.getByText('Vaccins faits').waitFor();
  ok(norm(await page.locator('main').innerText()).includes('Prix réduit : 1 200 FCFA l\'unité dès 100') && (await page.getByText('0712345678').count()) === 0, 'fiche : palier visible, téléphone du vendeur caché');
  await page.getByRole('button', { name: 'Demander à acheter' }).click();
  const total = async () => norm(await page.locator('.banner.info').innerText());
  await page.getByLabel(/Combien en voulez-vous/).fill('100');
  ok((await total()).includes('100 volailles × 1 200 FCFA = 120 000 FCFA') && (await total()).includes('Prix réduit appliqué'), 'demande : prix réduit appliqué dès 100');
  await page.getByLabel(/Combien en voulez-vous/).fill('50');
  ok((await total()).includes('50 volailles × 1 500 FCFA = 75 000 FCFA'), 'demande : prix normal sous le seuil');
  await page.getByLabel(/Combien en voulez-vous/).fill('130');
  await page.getByText('Entre 1 et 120.').waitFor();
  ok(await page.getByRole('button', { name: 'Envoyer la demande' }).isDisabled(), 'demande : quantité au-delà du disponible refusée');
  await page.getByLabel(/Combien en voulez-vous/).fill('100');
  await page.getByLabel(/Votre message/).fill('Pour mon restaurant, livraison samedi.');
  await page.getByRole('button', { name: 'Envoyer la demande' }).click();

  // modal de discussion côté acheteur
  await page.getByText('Votre proposition').waitFor();
  ok(page.url().includes('ouvrir='), 'la discussion s\'ouvre directement dans un modal');
  await page.locator('.chat').getByText('Pour mon restaurant, livraison samedi.').waitFor();
  ok(norm(await page.locator('.chat').innerText()).includes('100 volailles × 1 200 FCFA = 120 000 FCFA'), 'la demande apparaît comme première proposition');
  await page.getByLabel('Votre message').fill('Je peux passer samedi matin.');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await page.locator('.chat').getByText('Je peux passer samedi matin.').waitFor();
  ok(true, 'acheteur : message envoyé dans la conversation');
  await page.getByLabel(/Prix à l'unité \(FCFA\)/).fill('1250');
  await page.getByRole('button', { name: 'Valider mon accord' }).click();
  await page.locator('.deal').getByText(/125\D000 FCFA/).first().waitFor();
  ok(true, 'acheteur : sa proposition (100 × 1 250) est enregistrée');
  await page.keyboard.press('Escape');
  await page.goto(base + '/#/demandes');
  await page.locator('ul.rows').getByText('En attente').waitFor();
  ok((await page.getByText('0712345678').count()) === 0, 'téléphone du vendeur caché avant l\'accord');

  // l'éleveur répond
  await page.goto(base + '/#/profil');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForURL('**/#/connexion');
  await page.fill('input[type=tel], input[name=phone], input[autocomplete=username]', '0712345678');
  await page.fill('input[type=password]', 'Demo1234!');
  await page.click('button.pri');
  await page.getByRole('link', { name: /Notifications/ }).waitFor();
  await page.waitForFunction(() => document.querySelector('.bell .count'));
  ok(true, 'éleveur : cloche avec notification non lue');
  await page.goto(base + '/#/demandes');
  await page.getByText('Resto Le Baobab').first().waitFor();
  const rowTxt = norm(await page.locator('ul.rows li').first().innerText());
  ok(rowTxt.includes('Restaurant Le Baobab') && rowTxt.includes('Restaurateur') && rowTxt.includes('Cocody'), 'éleveur : profession, organisation et localité de l\'acheteur');
  ok((await page.getByText('0700000055').count()) === 0, 'téléphone acheteur caché avant l\'accord');
  await page.getByRole('button', { name: 'Ouvrir la discussion' }).click();
  await page.getByText(/Proposition de Resto Le Baobab/).waitFor();
  ok(norm(await page.locator('.deal').innerText()).includes('100 volailles × 1 250 FCFA = 125 000 FCFA') && (await page.getByText('07 11 22 33 44').count()) === 0, 'éleveur : proposition de l\'acheteur visible, numéro du responsable caché');
  await page.getByLabel(/Prix à l'unité \(FCFA\)/).fill('1300');
  await page.getByRole('button', { name: 'Valider mon accord' }).click();
  await page.locator('.deal').getByText(/130\D000 FCFA/).first().waitFor();
  ok((await page.locator('.msg.recap').count()) === 0 && (await page.getByText('Accord conclu :').count()) === 0, 'propositions différentes : pas d\'accord');
  await page.getByRole('button', { name: 'Reprendre sa proposition' }).click();
  ok((await page.getByLabel(/Prix à l'unité \(FCFA\)/).inputValue()) === '1250', 'reprendre sa proposition remplit les champs');
  await page.getByRole('button', { name: 'Valider mon accord' }).click();
  await page.locator('.msg.recap').waitFor();
  const recap = norm(await page.locator('.msg.recap').innerText());
  ok(recap.includes('Accord conclu') && recap.includes('100 volailles') && recap.includes('1 250 FCFA') && recap.includes('125 000 FCFA') && recap.includes('Poulets de chair'), 'récapitulatif dans le chat : quantité, prix à l\'unité, total');
  await page.getByText('0700000055').first().waitFor();
  ok((await page.getByText('07 11 22 33 44').count()) === 1, 'après l\'accord : téléphones de l\'acheteur et du responsable visibles');
  await page.getByRole('button', { name: /conclure la vente/ }).click();
  await page.getByText(/Un nouveau lot, avec les vaccins/).waitFor();
  ok(norm(await page.locator('.banner.warn').innerText()).includes('Il vous restera 50 volailles'), 'vente partielle : explication du lot scindé');
  await page.getByRole('button', { name: 'Conclure la vente', exact: true }).click();
  await page.getByText(/Vente conclue :/).waitFor();
  ok(mock.stats.sold === 100, 'éleveur : vente de 100 conclue');
  await page.keyboard.press('Escape');
  await page.locator('ul.rows').getByText('Vente conclue').waitFor();
  ok(true, 'liste : demande conclue');
  await page.goto(base + '/#/notifications');
  await page.getByRole('heading', { name: 'Notifications' }).waitFor();
  ok(true, 'page notifications');

  // mode simple
  await page.goto(base + '/#/profil');
  await page.getByLabel(/Mode simple/).click();
  await page.locator('.app.simple').waitFor();
  await page.goto(base + '/#/');
  await page.locator('.tile').first().waitFor();
  ok((await page.locator('.tile').count()) >= 4, 'mode simple → grandes tuiles');
  await page.goto(base + '/#/profil'); await page.getByLabel(/Mode simple/).click(); await page.locator('.app:not(.simple)').waitFor();

  // téléphone
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(base + '/#/animaux');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'pas de défilement horizontal à 375 px');
  ok(await page.locator('nav.bar').isVisible(), 'barre de navigation basse sur mobile');

  // déconnexion
  await page.goto(base + '/#/profil');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForURL('**/#/connexion');
  ok(true, 'déconnexion → connexion');

  // autorité : validation d'un vétérinaire
  await page.fill('input[autocomplete=username]', '0505050505');
  await page.fill('input[type=password]', 'Demo1234!');
  await page.click('button.pri');
  await page.getByText('Vue nationale').waitFor();
  await page.goto(base + '/#/veterinaires');
  await page.getByText('ONV-1').waitFor();
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.getByText('Aucune demande en attente').waitFor();
  ok(true, 'autorité valide un vétérinaire');

  // carte sanitaire et journal d'audit (autorité)
  await page.goto(base + '/#/stats');
  await page.getByText('Carte sanitaire').waitFor();
  await page.locator('svg.zonemap circle').first().waitFor();
  ok((await page.locator('svg.zonemap circle').count()) === 2 && (await page.locator('svg.curve path.line').count()) === 1, 'carte sanitaire : bulles par zone + courbe');
  await page.getByLabel('Maladie').selectOption('rage'); await page.waitForTimeout(300);
  await page.getByText('Aucun cas sur cette période').waitFor();
  ok(true, 'carte sanitaire : filtre maladie sans cas → message');
  await page.goto(base + '/#/audit');
  await page.getByRole('heading', { name: "Journal d'audit" }).waitFor();
  await page.getByText('Connexion').first().waitFor();
  ok(true, 'journal d\'audit visible pour l\'autorité');

  // mot de passe oublié
  await page.goto(base + '/#/profil');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForURL('**/#/connexion');
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await page.getByLabel('Votre numéro de téléphone').fill('0712345678');
  await page.getByRole('button', { name: 'Recevoir un code' }).click();
  await page.getByLabel(/Code reçu/).fill('000000');
  await page.getByLabel('Nouveau mot de passe').fill('NouveauMdp1!');
  await page.getByRole('button', { name: 'Changer mon mot de passe' }).click();
  await page.getByText('Code incorrect ou expiré').waitFor();
  ok(mock.stats.forgot === '0712345678', 'mot de passe oublié : mauvais code → message');
  await page.getByLabel(/Code reçu/).fill('123456');
  await page.getByRole('button', { name: 'Changer mon mot de passe' }).click();
  await page.getByText('Mot de passe changé').waitFor();
  ok(mock.stats.resetDone === true, 'mot de passe oublié : bon code → retour à la connexion');
  ok(!errors.length, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
  fails++; console.log('FAIL exception :', e.message.split('\n')[0]);
  await page.screenshot({ path: join(root, 'test/fail.png') }).catch(() => {});
}
await browser.close(); mock.server.close();
console.log(fails ? `\n${fails} échec(s)` : '\nTout passe');
process.exit(fails ? 1 : 0);
