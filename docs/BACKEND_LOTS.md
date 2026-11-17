# Backend — découpage en 5 lots

Chaque lot est livrable et testable seul. Un lot ne dépend que des lots précédents. Le schéma SQL complet est déjà dans `apps/api/migrations/001_init.sql` ; chaque lot ajoute ses routes, ses règles et ses tests, et complète `packages/contract/openapi.yaml`.

| Lot | Contenu | Dépend de | Tables |
|---|---|---|---|
| **1. Fondations et comptes** *(écrit)* | Config, couche PostgreSQL/PGlite, migrations, erreurs, inscription, connexion (mot de passe et code à 4 chiffres), jetons avec rotation, verrouillage, profil, zones, annuaire vétérinaires, validation des vétérinaires, Idempotency-Key, journal d'audit | — | zones, users, vets, refresh_tokens, idempotency_keys, audit_log |
| **2. Animaux et lots** *(écrit)* | Création d'un animal ou d'un lot (volaille, lapin, poisson), code public `CI-…`, QR, boucle RFID unique (RG8), photos (10 max, RG10), liste avec recherche, filtres et tri, fiche, modification, recherche par code ou RFID (scan), visibilité par rôle. Le changement de statut (vente, abattage, décès, vol) passe par un mouvement : lot 4 | 1 | animals, animal_photos |
| **3. Santé et accès vétérinaire** *(écrit)* | Actes de santé en ajout seul (RG2), correction par nouvel acte, délai d'attente avant vente (RG6), calendrier des rappels, signalement de maladie ou de mortalité, mortalité d'un lot (RG5), accès temporaire 30 jours accordé par l'éleveur (RG1), historique conservé après changement de vétérinaire (RG3) | 2 | health_events, cases, access_grants |
| **4. Mouvements, vol et alertes** *(écrit)* | Ventes (refusées pendant un délai d'attente : `withdrawalUntil()` existe déjà), abattages, transferts de propriété avec historique conservé, déclaration de vol et blocage (RG4), annonces du marché, alertes sanitaires par zone, maladies à déclaration obligatoire notifiées à l'autorité (RG7), vue agent de terrain | 3 | flows, transfers, alerts |
| **5. Synchronisation, indicateurs et mise en production** *(écrit)* | Envoi groupé des écritures faites hors-ligne avec rejeu sûr (RG9), résolution des conflits, indicateurs par zone pour l'autorité, export CSV, limites de débit finales, sauvegardes, déploiement Docker, supervision | 4 | client_ops |

## Définition de « terminé » d'un lot

1. Les routes du lot sont décrites dans `openapi.yaml`.
2. Chaque règle de gestion du lot a au moins un test qui échoue si la règle est cassée.
3. `pnpm typecheck` et `pnpm test` passent sans base externe (PGlite en mémoire).
4. Les écritures acceptent `Idempotency-Key`.
5. Le seed de démonstration couvre les nouveaux cas.

## Règles de gestion et lot qui les porte

| Règle | Lot |
|---|---|
| RG1 Accès vétérinaire limité à 30 jours | 3 |
| RG2 Historique en ajout seul | 3 (déclencheurs SQL déjà posés au lot 1) |
| RG3 L'historique survit au changement de vétérinaire ou de propriétaire | 3 et 4 |
| RG4 Un animal volé est bloqué | 4 |
| RG5 Effectif d'un lot jamais négatif | 2 et 3 (contrainte SQL déjà posée) |
| RG6 Délai d'attente avant vente | 3 |
| RG7 Maladie à déclaration obligatoire : alerte et autorité | 4 |
| RG8 Une boucle RFID, une seule fiche | 2 (contrainte SQL déjà posée) |
| RG9 Écritures hors-ligne rejouables | 1 (mécanisme) et 5 (envoi groupé) |
| RG10 Dix photos au maximum | 2 |

## Conventions communes

- Dossier par module : `src/modules/<nom>/{schemas.ts, service.ts, routes.ts}`. Le service ne connaît pas Fastify.
- SQL paramétré uniquement ; toute écriture multiple dans `db.tx`.
- Toute action sensible écrit dans `audit_log` dans la même transaction.
- Erreurs : `AppError` ; le gestionnaire central les met sous la forme `{ code, message, details? }`.
- Autorisation : `authenticate` puis `requireRole(...)` ; les droits sur un animal précis se vérifient dans le service.
- Routes d'écriture : `preHandler: [authenticate, idempotent]`.
