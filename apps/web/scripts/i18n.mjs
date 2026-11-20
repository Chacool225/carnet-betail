// Outils de traduction.
//   node scripts/i18n.mjs export   -> écrit src/i18n/translations.csv (clé ; français ; dioula ; baoulé) à faire remplir par un locuteur
//   node scripts/i18n.mjs import   -> relit translations.csv et met à jour dyu.json et bci.json (les cases vides sont ignorées)
//   node scripts/i18n.mjs check    -> affiche l'avancement de chaque langue
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/i18n');
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const csvPath = join(dir, 'translations.csv');
const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;

function parseCsv(text) {
  const rows = []; let row = [], cell = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inq = false; else cell += c; }
    else if (c === '"') inq = true;
    else if (c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const cmd = process.argv[2];
if (cmd === 'export') {
  const fr = read('fr.json'), dyu = read('dyu.json'), bci = read('bci.json');
  const lines = ['clé;français;dioula;baoulé', ...Object.keys(fr).map((k) => [q(k), q(fr[k]), q(dyu[k]), q(bci[k])].join(';'))];
  writeFileSync(csvPath, '﻿' + lines.join('\r\n') + '\r\n'); // BOM + point-virgule : s'ouvre correctement dans Excel
  console.log(`${Object.keys(fr).length} phrases écrites dans src/i18n/translations.csv`);
} else if (cmd === 'import') {
  const fr = read('fr.json'), rows = parseCsv(readFileSync(csvPath, 'utf8').replace(/^﻿/, '')).slice(1);
  const dyu = {}, bci = {}; let unknown = 0;
  for (const [k, , d, b] of rows) {
    if (!(k in fr)) { unknown++; continue; }
    if (d?.trim()) dyu[k] = d.trim();
    if (b?.trim()) bci[k] = b.trim();
  }
  writeFileSync(join(dir, 'dyu.json'), JSON.stringify(dyu, null, 1) + '\n');
  writeFileSync(join(dir, 'bci.json'), JSON.stringify(bci, null, 1) + '\n');
  console.log(`dioula : ${Object.keys(dyu).length} · baoulé : ${Object.keys(bci).length}${unknown ? ` · ${unknown} clé(s) inconnue(s) ignorée(s)` : ''}`);
} else if (cmd === 'check') {
  const fr = read('fr.json'), total = Object.keys(fr).length;
  for (const [n, f] of [['dioula', 'dyu.json'], ['baoulé', 'bci.json']]) {
    const d = read(f), done = Object.keys(fr).filter((k) => (d[k] ?? '').trim()).length;
    console.log(`${n} : ${done}/${total} (${Math.round((done * 100) / total)} %)`);
  }
} else { console.log('Usage : node scripts/i18n.mjs export | import | check'); process.exit(1); }
