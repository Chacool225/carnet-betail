# @carnet/web : interface Carnet Bétail

React 19 + TypeScript, empaqueté par esbuild. Pas de routeur ni de bibliothèque de requêtes tierces : routeur à hash (`src/lib/router.tsx`) et client `fetch` maison (`src/api/client.ts`).

## Lancer
```bash
pnpm install
pnpm --filter @carnet/api dev          # API sur :3000
pnpm --filter @carnet/web dev          # interface sur :5173, /api est relayé vers l'API
pnpm --filter @carnet/web build        # dist/ prêt à servir (nginx, Caddy, ou le même domaine que l'API sous /api)
pnpm --filter @carnet/web test:e2e     # Chromium (Playwright) contre un FAUX serveur d'API
```
`API_TARGET` (dev) et `API_URL` (build, défaut `/api`) changent l'adresse de l'API.

## Comment ça marche
- **Connexion** : jeton d'accès en mémoire, jeton de renouvellement dans `localStorage` (compromis XSS assumé), renouvellement unique même avec plusieurs onglets.
- **Hors-ligne** : toute écriture métier passe par `POST /sync` avec un `clientId`. En ligne le résultat est immédiat ; sans réseau l'opération attend dans la file (`/envoi`) et part seule au retour du réseau, sans doublon. Les lectures consultées sont gardées en cache local.
- **Mode simple** (Profil) : grosses tuiles, emojis, lecture à voix haute, connexion par code à 4 chiffres. Parité partielle avec la maquette Alpha.
- **Photos** : par adresse https uniquement (pas d'envoi de fichier).
- Rôles : éleveur, vétérinaire, agent, autorité ; menus et pages adaptés.

## Ce qui est vérifié et ce qui ne l'est pas
Vérifié : le bundle se compile, et `test/e2e.mjs` déroule 18 contrôles dans un vrai Chromium contre `test/mock-server.mjs` (connexion, création, soin avec délai d'attente, file hors-ligne et rejeu unique, lot, recherche, mode simple, mobile 375 px, validation d'un vétérinaire).
Non vérifié : le typage TypeScript (typecheck à lancer avec `pnpm typecheck` après installation) et tout test contre le vrai backend.
