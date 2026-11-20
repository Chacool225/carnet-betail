# Jeu de données complet — « qui a fait quoi »

`seed.ts` reste le jeu **minimal** (5 comptes, 3 animaux). `seed-complet.ts` s'ajoute par-dessus : il charge d'abord le jeu minimal, puis raconte
**environ quatre mois de vie du carnet** avec 14 comptes, 18 fiches, 31 actes de santé, 9 signalements, 44 mouvements, 10 alertes, 7 demandes d'achat
et plus de 200 lignes de journal. Tout est fictif. Les dates sont relatives à aujourd'hui : rien n'est dans le futur, et les rappels
et délais d'attente restent cohérents quel que soit le jour du chargement.

## Lancer

```bash
pnpm --filter @carnet/api migrate
pnpm --filter @carnet/api seed:complet                      # charge le jeu ; ne fait rien s'il est déjà là
pnpm --filter @carnet/api seed:complet -- --reset --yes     # EFFACE tout puis recharge (refusé en production)
```

Mot de passe de tous les comptes : `Demo1234!`. Se connecter avec le numéro de téléphone.

## Les comptes

| Compte | Rôle | Téléphone | Code | Rôle dans l'histoire |
|---|---|---|---|---|
| Awa Koné | éleveur, Korhogo | 07 12 34 56 78 | 1234 | Le plus actif : vend, négocie, déclare la maladie de Newcastle |
| Seydou Traoré | éleveur, Ferkessédougou | 07 23 45 67 89 | 4321 | Suspicion de fièvre aphteuse, vol d'un mouton, achète le zébu |
| Moussa Ouattara | éleveur, Korhogo | 07 34 56 78 90 | 1111 | Foyer de PPR, chèvre volée puis retrouvée, vente bloquée par un délai d'attente |
| Fatou Diallo | éleveur, Bouaké | 07 45 67 89 01 | 2222 | Porcs : contrôle de biosécurité puis abattages |
| Kouamé N'Guessan | éleveur, Daloa | 07 56 78 90 12 | — | Lapins et poissons : mortalités et maladies non notifiables |
| Dr Yao Kouadio | vétérinaire vérifié | 05 01 02 03 04 | — | Vétérinaire principal (26 actions) |
| Dr Aminata Sylla | vétérinaire vérifiée | 05 02 03 04 05 | — | Bouaké / Daloa : biosécurité, suivi des lapins |
| Dr Ibrahim Coulibaly | vétérinaire **non vérifié** | 05 03 04 05 06 | — | Inscrit il y a 3 jours : attend la vérification de l'autorité |
| Agent Bamba | agent, Ferkessédougou | 01 02 03 04 05 | — | Traite l'alerte de fièvre aphteuse |
| Agent Soro | agent, Korhogo | 01 03 04 05 06 | — | Traite le foyer suspect de Newcastle |
| Direction des services vétérinaires | autorité | 05 05 05 05 05 | — | Vérifie les vétérinaires, traite l'alerte PPR |
| Restaurant Le Baobab | particulier (restaurant, Cocody) | 07 88 88 88 01 | — | Achète 100 poulets (lot scindé) |
| Koffi Yao | particulier (éleveur amateur) | 07 88 88 88 02 | — | Achète les pintades, accord en cours pour Noiraud |
| Boucherie Sahel | particulier (boucher, Bouaké) | 07 88 88 88 03 | — | Demande refusée sur Noiraud |

## Ce que fait chaque compte, animal par animal

| Fiche | Propriétaire final | Histoire (acteur → action) |
|---|---|---|
| **Kouadio** (bovin, Seydou) | Seydou | Seydou : identification, 4 pesées. Dr Yao : suspicion de fièvre aphteuse → alerte haute traitée par l'agent Bamba → cas clos → vaccin de précaution. Accès vétérinaire par scan (prolongé), invitation de Seydou à Dr Sylla (expirée). Une photo ajoutée, une autre retirée. |
| **Tacheté** (vache, Awa) | Awa | Vaccin en retard, vaccin saisi avec une mauvaise date puis **corrigé** par Dr Yao (RG : l'événement d'origine n'est jamais modifié), gestation, mammite avec **délai d'attente écoulé**, vermifuge à refaire dans 2 jours (rappel « bientôt »). |
| **Bande 1** (200 poulets, Awa) | Awa (50 restants) | Entrée, Gumboro, Newcastle, mortalité de 12 (sans alerte : 6 %), **vente partielle** de 38, mise en vente avec **prix dégressif** (1 500 FCFA, 1 200 dès 100), **cas de Newcastle** (25 malades) → alerte, vente de 100 à Le Baobab (lot **scindé**, vaccins hérités), nouvelle demande de Seydou pour 20. |
| **Noiraud** (taureau, Awa) | Awa | En vente 250 000 FCFA. Trois acheteurs : Sahel **refusé**, Le Baobab **annule**, Koffi **tombe d'accord** à 235 000 (propositions croisées, message récapitulatif, vente pas encore enregistrée). |
| **Zébu de Gaoua** (Awa → Seydou) | Seydou | Mis en vente, négocié, accord, **vente à un inscrit** : la fiche, l'historique et les vaccins passent chez Seydou, les accès vétérinaires sont retirés. |
| **Taurillon** (Awa → Moussa) | Moussa | Mis en vente puis **retiré du marché**, puis **cédé** à un voisin (transfert sans vente). |
| **Blanchette** (vache, Moussa) | Moussa | Dépistage de brucellose, pesée, boiterie traitée avec **délai d'attente en cours** : toute mise en vente est refusée (`withdrawal_active`). |
| **Troupeau de chèvres** (40, Moussa) | Moussa (27) | Achat, vaccin PPR **en retard**, **peste des petits ruminants** (maladie à déclaration obligatoire) → alerte haute traitée par l'autorité, mortalité de 10 (25 % → alerte de forte mortalité), campagne de vaccination, 3 morts de plus. |
| **Poules pondeuses** (120, Moussa) | Moussa (113) | Newcastle : cas, alerte, mortalité de 7. |
| **Pintades** (30, Awa → Koffi) | Koffi | Newcastle guéri, **foyer suspect** (3 élevages de Korhogo en 14 jours, traité par l'agent Soro), vente de **tout le lot** à un particulier. |
| **Porcs** (25, Fatou) | Fatou (abattu) | Inspection de biosécurité par Dr Sylla, pesées, vermifuge avec délai, **abattage partiel** (10) puis **solde**. |
| **Lapins** (Kouamé) | Kouamé (68) | Naissances (+12), mortalité de 4, diarrhée (non notifiable), traitement, visite de suivi de Dr Sylla. |
| **Tilapias** (800, Kouamé) | Kouamé (600) | Pesées, mortalité de 200 (alerte de forte mortalité), maladie des branchies. |
| **Mouton de la Tabaski** (Seydou) | Seydou (**volé**) | **Vol déclaré** → alerte haute, non résolue. |
| **Chèvre Fatim** (Moussa) | Moussa | **Vol déclaré** puis **retrouvée** (l'alerte est fermée). |
| **Bélier Sahel** (Seydou) | — (**vendu**) | Accès vétérinaire donné puis **retiré**, mise en vente, vente. |
| **Veau Bleuet** (Awa) | — (**décédé**) | Mortalité d'un animal seul. |
| **Poulets de chair — bande 1** (Le Baobab) | Le Baobab | Lot de 100 issu de la Bande 1, avec ses vaccins hérités. |

## Couverture

- **Mouvements** : entrée, identification, pesée, vente (totale, partielle, à un inscrit), mortalité, abattage, vol, retrouvé, transfert.
- **Santé** : vaccin, soin (avec délai d'attente), contrôle, correction d'un acte, signalement (ouvert → suivi → guéri → clos), alertes sanitaire / vol / anomalie.
- **Accès vétérinaire** : scan, invitation, enregistrement, soin ; prolongation, expiration, retrait.
- **Marché** : annonce par unité avec prix dégressif, retrait, demande, discussion, propositions de chaque côté, accord et récapitulatif, refus, annulation, vente, lot scindé.
- **Compte** : inscription, connexions, mot de passe et code modifiés, verrouillage après trop d'essais, réinitialisation par SMS, vérification d'un vétérinaire, profils d'acheteur.
- **Autres** : photos (ajout, retrait), notifications lues et non lues, rappels de vaccins (calculés par la tâche de l'application), appels hors ligne (un réussi, un refusé).
- Les actions du journal d'audit sont toutes celles que l'application écrit, avec les mêmes détails ; chacune a un libellé en français dans l'historique.

## Garanties

À la fin du chargement, `verify()` contrôle que le jeu respecte les règles de gestion et lève une erreur sinon : effectif de chaque lot = entrées − sorties, statut cohérent avec les mouvements, annonces sur des animaux actifs et dans le stock, quantités réservées ≤ annonce, accords complets, aucun accès vétérinaire actif sur une fiche qui a changé de main, aucune action de journal inconnue. Les tables d'historique restent en ajout seul : le journal est écrit trié par date.

## Limites connues

- Il reste 20 poulets en vente sur la Bande 1 alors que le seuil de prix dégressif est à 100 : le prix réduit ne s'applique plus à cette annonce (à relancer en la remettant en vente).
- Les photos sont une image d'un pixel.
- Les codes de réinitialisation et d'autres secrets du jeu sont fictifs ; ne chargez jamais ce jeu en production (`--reset` y est refusé).
