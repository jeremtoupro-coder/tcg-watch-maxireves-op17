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

## Test local prévu

```bash
cd cloudflare-worker
npm install
npm run typecheck
npm test
npm run dev
```

Ces commandes ne déploient rien sur Cloudflare. Le déploiement et le cron resteront désactivés jusqu'à validation explicite de l'audit.

## Limites actuelles

- Le parsing HTML est volontairement générique : chaque connecteur devra être renforcé après observation des résultats réels.
- Oupi utilise pour l'instant une catégorie volumineuse ; une source plus légère est recherchée.
- Fantasy Sphere peut posséder des fiches publiques absentes de sa catégorie ; la découverte de ces fiches reste à sécuriser.
- Aucun état ni anti-doublon n'est encore implémenté.
