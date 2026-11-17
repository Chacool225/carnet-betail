#!/usr/bin/env bash
# Sauvegarde quotidienne de la base (format compressé) avec rotation.
# Usage : scripts/backup.sh [dossier] [jours de conservation]
# Planification (cron) : 15 2 * * * cd /chemin/du/projet && scripts/backup.sh /var/backups/carnet 14
set -euo pipefail
DIR="${1:-./backups}"
KEEP_DAYS="${2:-14}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.prod)
mkdir -p "$DIR"
FILE="$DIR/carnet-$(date +%Y%m%d-%H%M%S).dump"
"${COMPOSE[@]}" exec -T db pg_dump -U carnet -d carnet --format=custom --no-owner > "$FILE.tmp"
[ -s "$FILE.tmp" ] || { echo "Sauvegarde vide : abandon" >&2; rm -f "$FILE.tmp"; exit 1; }
mv "$FILE.tmp" "$FILE"
find "$DIR" -name 'carnet-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde écrite : $FILE"
