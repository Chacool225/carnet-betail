# Déploiement

> Ces fichiers (Dockerfile, docker-compose.prod.yml, scripts de sauvegarde) n'ont pas pu être exécutés dans l'environnement où ils ont été écrits (pas de Docker). Faites un premier essai sur une machine de test avant la démonstration.

## 1. Préparer

```bash
cp .env.example .env.prod
```

Dans `.env.prod`, renseigner au minimum :

| Variable | Rôle |
|---|---|
| `POSTGRES_PASSWORD` | mot de passe de la base (longue chaîne aléatoire) |
| `JWT_SECRET` | secret de signature des jetons, 32 caractères ou plus : `openssl rand -base64 48` |
| `CORS_ORIGINS` | adresses autorisées pour l'application web, séparées par des virgules (ex. `https://carnet.exemple.ci`) |

Facultatives : `ACCESS_TTL_SECONDS` (900), `REFRESH_TTL_DAYS` (30), `LOGIN_MAX_ATTEMPTS` (5), `LOCK_MINUTES` (15), `RATE_LIMIT_ENABLED` (true).

## 2. Lancer

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
curl http://127.0.0.1:3000/health        # {"status":"ok","db":"pg"}
```

Les migrations s'appliquent toutes seules au démarrage de l'API (table `schema_migrations`). Le seed de démonstration n'est **pas** lancé en production ; pour une démonstration publique, lancez-le une fois à la main (`pnpm --filter @carnet/api seed` avec `DATABASE_URL` pointant vers la base) et **supprimez ces comptes ensuite** : leur mot de passe est public.

## 3. HTTPS

L'API écoute en local seulement (`127.0.0.1:3000`). Placez un proxy HTTPS devant. Exemple avec Caddy (certificat automatique) :

```
carnet.exemple.ci {
    reverse_proxy 127.0.0.1:3000
}
```

L'API fait confiance à l'en-tête `X-Forwarded-For` en production : ne l'exposez jamais directement sans proxy, sinon la limite de débit par adresse peut être contournée.

## 4. Sauvegarde et restauration

```bash
scripts/backup.sh /var/backups/carnet 14      # une sauvegarde, 14 jours conservés
scripts/restore.sh /var/backups/carnet/carnet-20261120-021500.dump
```

À planifier avec cron. **Testez une restauration** avant de compter dessus.

## 5. Exploitation

- Santé : `GET /health` (503 si la base est injoignable). Le conteneur a un `HEALTHCHECK`.
- Journaux au format JSON, chaque réponse porte `x-request-id` ; l'en-tête `Authorization` est masqué dans les journaux.
- Ménage : toutes les heures, l'API supprime les clés d'idempotence, jetons expirés et opérations de synchronisation anciens. L'historique métier n'est jamais supprimé.
- Changer `JWT_SECRET` invalide tous les jetons d'accès (15 minutes) ; les sessions se renouvellent avec les jetons de renouvellement.
- Contrat de l'API : `GET /openapi.yaml`.

## 6. Limites à connaître

- **Une seule instance de l'API.** La limite de débit et l'anti-doublon des envois simultanés de synchronisation vivent en mémoire du processus. Pour plusieurs instances, il faudra un stockage partagé (Redis) pour la limite de débit ; le rejeu à retardement reste sûr grâce à la base.
- **Photos** : l'API enregistre des adresses, pas des fichiers. Choisir un stockage (disque monté, S3, Cloudinary) est à faire avant d'ouvrir l'envoi de photos.
- **Maladies à déclaration obligatoire** : liste de travail (`apps/api/src/lib/diseases.ts`), à faire valider par la direction des services vétérinaires.
- Pas de notification (SMS, e-mail, push) : les alertes se consultent via `GET /alerts`.
