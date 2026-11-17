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

  // liste + recherche
  await page.goto(base + '/#/animaux');
  await page.getByText('Kouadio').first().waitFor();
  await page.getByLabel('Rechercher').fill('Bande');
  await page.waitForTimeout(500);
  ok((await page.locator('ul.rows li').count()) === 1, 'recherche filtre la liste');

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
  ok(!errors.length, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
  fails++; console.log('FAIL exception :', e.message.split('\n')[0]);
  await page.screenshot({ path: join(root, 'test/fail.png') }).catch(() => {});
}
await browser.close(); mock.server.close();
console.log(fails ? `\n${fails} échec(s)` : '\nTout passe');
process.exit(fails ? 1 : 0);
