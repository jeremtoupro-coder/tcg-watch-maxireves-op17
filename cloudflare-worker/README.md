# TCG Watch — prototype Cloudflare en lecture seule

Ce dossier est isolé du watcher Python actuellement actif sur `main`.

## État de sécurité

Le prototype est volontairement limité :

- aucun cron Cloudflare ;
- aucun binding KV ou D1 ;
- aucun secret Discord ;
- aucun envoi de webhook ;
- aucun achat, panier ou connexion client ;
- aucun déploiement automatique.

Il effectue uniquement des requêtes HTTP GET publiques lorsqu'un audit est lancé manuellement.

## Boutiques configurées

- Maxi Rêves ;
- Ludotrotter ;
- Oupi ;
- Fantasy Sphere.

L'audit mesuré est disponible dans `docs/audit-2026-06-27.md`.

## Références reconnues

- Illustration Box Vol.7 / IB-07 / IB07 ;
- Illustration Box Vol.8 / IB-08 / IB08 ;
- OP17 / OP-17 / OP 17 ;
- OP18 / OP-18 / OP 18.

## Routes du prototype

```text
GET /
GET /audit
GET /audit?store=maxireves
GET /audit?store=ludotrotter
GET /audit?store=oupi
GET /audit?store=fantasy-sphere
```

Chaque résultat indique notamment :

- statut HTTP ;
- taille réelle de la réponse ;
- durée de la requête ;
- type de contenu ;
- ETag et Last-Modified lorsqu'ils existent ;
- nombre de liens produit observés ;
- produits ciblés détectés ;
- prix, disponibilité et langue estimés.

## Validation

Les contrôles suivants réussissent dans GitHub Actions :

```text
npm install
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

Aucune de ces commandes ne déploie le Worker.

## Architecture retenue après audit

- Maxi Rêves, Ludotrotter et Oupi : connecteurs Cloudflare directs.
- Fantasy Sphere : catégorie visible contrôlée par Cloudflare, découverte exhaustive du sitemap assurée à fréquence plus lente par GitHub Actions.
- Le watcher historique Maxi Rêves sur `main` reste la solution de secours.

## Prochaine phase

- ajouter l'état et l'anti-doublon ;
- préparer les messages Discord sans envoyer de vraie alerte ;
- déployer ensuite une prévisualisation Cloudflare manuelle sans cron ;
- mesurer le CPU de chaque connecteur avant toute fréquence d'une minute.
