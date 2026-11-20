# Langues de l'application

Le français est la langue de référence. Une phrase sans traduction s'affiche en français ; une langue sans aucune traduction est grisée (« bientôt »).

## Ajouter le dioula ou le baoulé
1. `pnpm --filter @carnet/web i18n:export` écrit `src/i18n/translations.csv` (clé ; français ; dioula ; baoulé). Il s'ouvre dans Excel.
2. Un locuteur remplit les colonnes dioula / baoulé. Ne traduire que le sens : garder `{name}` tel quel dans « Bonjour {name} ».
3. `pnpm --filter @carnet/web i18n:import` met à jour `dyu.json` et `bci.json`. `i18n:check` affiche l'avancement.
4. Audio (mode simple) : déposer `public/audio/dyu/<clé>.mp3` (ex. `say.sick.mp3`). Sans enregistrement, le bouton haut-parleur ne lit rien en dioula ou en baoulé (la voix du téléphone ne sait lire que le français).

## Ajouter un texte à traduire
Ajouter la clé et son texte français dans `fr.json`, puis dans le code : `const { t } = useLang(); t('ma.clé')`. Relancer `i18n:export`.
Les valeurs envoyées à l'API (symptômes, statuts) restent en français : seul l'affichage est traduit.

## Test
`bash scripts/test-i18n.sh` (état réel, puis traductions factices retirées ensuite).
