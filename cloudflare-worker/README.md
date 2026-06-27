# TCG Watch — moteur d'alertes configurable

Ce dossier est isolé du watcher Python actuellement actif sur `main`.

## État de sécurité

Le projet reste volontairement limité :

- aucun cron Cloudflare ;
- aucun binding KV ou D1 actif ;
- aucun secret Discord ;
- `DISCORD_MODE` fixé à `dry-run` ;
- `WRITE_STATE` fixé à `false` ;
- aucun déploiement automatique ;
- aucun achat, panier ou connexion client.

Il effectue uniquement des requêtes HTTP GET publiques lorsqu'un audit est lancé manuellement.

## Configuration évolutive

Les produits et règles d'alerte sont centralisés ici :

```text
config/alerts.json
```

Il est possible de :

- désactiver une alerte avec `enabled: false` ;
- réactiver une ancienne alerte ;
- ajouter OP19 ou toute autre référence avec ses alias ;
- limiter une règle à certaines boutiques ou langues ;
- choisir les événements surveillés ;
- fixer un prix maximal en centimes.

Guide détaillé : `docs/gestion-alertes.md`.

## Fonctions déjà développées

- détection des fiches ciblées ;
- état produit compatible avec Cloudflare KV ;
- anti-doublon par boutique et URL ;
- première base silencieuse ;
- retour en stock ;
- ouverture des précommandes ;
- baisse et hausse de prix ;
- passage en indisponible ;
- modification de titre, langue ou référence ;
- filtrage par règle ;
- génération de messages Discord ;
- simulation Discord sans envoi réseau.

## Boutiques configurées

- Maxi Rêves ;
- Ludotrotter ;
- Oupi ;
- Fantasy Sphere.

L'audit mesuré est disponible dans `docs/audit-2026-06-27.md`.

## Routes du prototype

```text
GET /
GET /config
GET /audit
GET /audit?store=maxireves
GET /evaluate
GET /evaluate?store=oupi
```

- `/audit` renvoie les résultats bruts des boutiques.
- `/evaluate` applique l'état, les changements, les règles et génère les aperçus Discord.
- `/config` affiche la configuration chargée.

## Validation réelle effectuée

L'évaluation ponctuelle du 27 juin 2026 a trouvé quatre fiches OP17 chez Oupi :

- case anglaise ;
- display anglais ;
- case française ;
- display français.

Résultat de la première base :

- 4 candidats uniques ;
- 4 événements `new_listing` initiaux ;
- 0 règle déclenchée ;
- 0 message Discord construit ;
- 0 message envoyé ;
- 0 écriture persistante.

Ce comportement évite une pluie d'alertes lors de la première mise en service.

## Contrôles automatiques

Les contrôles suivants réussissent dans GitHub Actions :

```text
npm install
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

Aucune de ces commandes ne déploie le Worker.

## Architecture retenue

- Maxi Rêves, Ludotrotter et Oupi : connecteurs Cloudflare directs.
- Fantasy Sphere : catégorie visible contrôlée par Cloudflare, découverte exhaustive du sitemap assurée à fréquence plus lente par GitHub Actions.
- Le watcher historique Maxi Rêves sur `main` reste la solution de secours.

## Ce qui reste avant activation

1. Créer le namespace Cloudflare KV et son binding `TCG_STATE`.
2. Déployer une prévisualisation manuelle sans cron.
3. Construire la base initiale avec Discord toujours en `dry-run`.
4. Tester artificiellement un retour en stock et une baisse de prix.
5. Ajouter le webhook Discord comme secret.
6. Activer l'envoi réel, puis le cron progressivement.
