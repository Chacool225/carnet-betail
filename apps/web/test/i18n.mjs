// Test des langues dans un vrai Chromium. Deux phases, pilotées par scripts/test-i18n.sh :
//   node test/i18n.mjs vide     (dioula et baoulé sans traduction)  -> la langue est grisée, tout reste en français
//   node test/i18n.mjs rempli   (traductions factices « [dyu] … »)  -> la langue s'active, repli sur le français pour le reste
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const phase = process.argv[2] ?? 'vide';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mock = createMock({ staticDir: join(root, 'dist') });
await new Promise((r) => mock.server.listen(0, r));
const base = `http://localhost:${mock.server.address().port}`;
const browser = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(base); await page.waitForURL('**/#/connexion');
  const sel = page.locator('.langpick select');
  const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, d: o.disabled, t: o.textContent })));
  if (phase === 'vide') {
    ok(opts.length === 3 && opts.find((o) => o.v === 'dyu')?.d && opts.find((o) => o.v === 'bci')?.d, 'dioula et baoulé grisés tant qu\'ils n\'ont aucune traduction');
    ok(opts.find((o) => o.v === 'dyu').t.includes('bientôt'), 'mention « bientôt »');
    await page.evaluate(() => localStorage.setItem('carnet.lang', 'dyu')); await page.reload();
    await page.getByRole('heading', { name: 'Connexion' }).waitFor();
    ok(true, 'langue sans traduction mémorisée par erreur → retour au français');
  } else {
    ok(opts.find((o) => o.v === 'dyu') && !opts.find((o) => o.v === 'dyu').d, 'dioula disponible une fois traduit');
    ok(opts.find((o) => o.v === 'bci').d, 'baoulé reste grisé (aucune traduction)');
    await sel.selectOption('dyu');
    await page.getByRole('heading', { name: '[dyu] Connexion' }).waitFor();
    ok(true, 'page de connexion traduite');
    ok(await page.getByText('Suivez la santé de votre bétail').count() === 1, 'phrase non traduite → repli sur le français');
    ok(await page.evaluate(() => document.documentElement.lang) === 'dyu', 'attribut lang de la page mis à jour');
    await page.fill('input[autocomplete=username]', '0712345678'); await page.fill('input[type=password]', 'Demo1234!'); await page.click('button.pri');
    await page.getByText('[dyu] Accueil').first().waitFor();
    ok(true, 'menu traduit après connexion');
    await page.reload(); await page.getByText('[dyu] Accueil').first().waitFor();
    ok(true, 'langue mémorisée après rechargement');
    // signalement : on garde la valeur française envoyée à l'API, seul l'affichage change
    await page.goto(base + '/#/animaux/nouveau'); await page.getByLabel("Nom de l'animal").fill('Test'); await page.getByLabel('Zone').selectOption({ label: 'Korhogo' });
    await page.getByRole('button', { name: 'Créer la fiche' }).click(); await page.getByRole('heading', { name: 'Test' }).waitFor();
    await page.getByRole('button', { name: /malad/i }).first().click();
    await page.getByText('[dyu] fièvre').waitFor();
    await page.getByText('[dyu] fièvre').click(); await page.getByRole('button', { name: '[dyu] Signaler' }).click();
    await page.waitForTimeout(600);
    const c = mock.cases[0];
    ok(!!c && c.symptoms.includes('fièvre'), 'symptôme envoyé à l\'API en français (valeur stable)');
  }
  ok(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) { console.log('FAIL exception :', e.message.split('\n')[0]); fails++; await page.screenshot({ path: 'test/fail.png' }); }
await browser.close(); mock.server.close();
console.log(fails ? `${fails} échec(s)` : 'Tout passe'); process.exit(fails ? 1 : 0);
