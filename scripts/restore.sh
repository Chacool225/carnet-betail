#!/usr/bin/env bash
# Restauration d'une sauvegarde dans la base de production. ATTENTION : remplace les données actuelles.
# Usage : scripts/restore.sh chemin/vers/carnet-AAAAMMJJ-HHMMSS.dump
set -euo pipefail
[ $# -eq 1 ] && [ -f "$1" ] || { echo "Usage : $0 fichier.dump" >&2; exit 1; }
read -r -p "Remplacer la base actuelle par $1 ? Tapez OUI : " ok
[ "$ok" = "OUI" ] || { echo "Annulé."; exit 1; }
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.prod)
"${COMPOSE[@]}" stop api
"${COMPOSE[@]}" exec -T db pg_restore -U carnet -d carnet --clean --if-exists --no-owner < "$1"
"${COMPOSE[@]}" start api
echo "Restauration terminée."
