#!/usr/bin/env bash
# Teste le mécanisme de langues : phase « vide » (état réel) puis phase « rempli » avec des traductions factices, qui sont retirées ensuite.
set -e
cd "$(dirname "$0")/.."
cp src/i18n/dyu.json /tmp/dyu.bak
trap 'cp /tmp/dyu.bak src/i18n/dyu.json; node scripts/build.mjs >/dev/null' EXIT
node scripts/build.mjs >/dev/null && node test/i18n.mjs vide
cat > src/i18n/dyu.json <<'JSON'
{ "nav.home": "[dyu] Accueil", "auth.login": "[dyu] Connexion", "sym.fièvre": "[dyu] fièvre", "sick.submit": "[dyu] Signaler", "common.language": "Langue" }
JSON
node scripts/build.mjs >/dev/null && node test/i18n.mjs rempli
