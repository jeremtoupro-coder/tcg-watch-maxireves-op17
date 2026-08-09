# OP Watch V1 — moteur TypeScript

Ce dossier contient le moteur de la V1 TEST. Le calendrier officiel français détermine dynamiquement les références actives ; il n'existe plus de liste commerciale statique concurrente.

## Flux de traitement

1. Charger toutes les pages du catalogue officiel `fr.onepiece-cardgame.com`.
2. Rejeter toute page d'erreur ou de challenge, même en HTTP 200.
3. Extraire les références OP, EB, PRB, ST, DP et TS ayant une date exacte.
4. Garder les produits dans la fenêtre J-120/J+30.
5. Exécuter Discovery toutes les 15 minutes et mémoriser les fiches directes reconnues.
6. Relire uniquement ces fiches en Fast Watch entre deux découvertes.
7. Exiger format ciblé, stock déterminé et français confirmé.
8. Comparer avec l'état persistant, construire au plus une alerte par produit et par cycle, puis valider l'état seulement après livraison Discord.

Une erreur réseau, un challenge, une fiche ambiguë ou un vendeur marketplace non confirmé ne peut jamais devenir une rupture, une disparition ou une alerte commerciale.

## Sécurité de la Preview

Le workflow de test génère une configuration dédiée :

- Worker : `tcg-watch-one-piece-preview` ;
- `MONITORING_ENABLED=false` ;
- `WRITE_STATE=false` ;
- `DISCORD_MODE=dry-run` ;
- aucun binding KV ;
- aucun cron ;
- `/audit` et `/evaluate` protégées par un secret éphémère ;
- aucune URL de flux autorisé dans les réponses ou les logs.

Routes publiques :

```text
GET /
GET /health
GET /config
GET /opwatch/v1/calendar
```

Routes authentifiées de test :

```text
GET /audit?store=<id>
GET /evaluate?store=<id>
```

Toutes les autres méthodes sont refusées.

## État et anti-doublon

- `product:v3:*` : identité commerciale stable, indépendante d'une réécriture d'URL ;
- `baseline:config-v3:<store>` : première collecte silencieuse ;
- `delivery-claim:*` et `delivery-receipt:*` : anti-doublon de livraison ;
- `discovery:v1:<store>` : fiches directes actives découvertes ;
- `official-calendar:fr:v1` : cache officiel de 15 minutes.

Un état inchangé n'est pas réécrit. En cas d'échec Discord, la transition produit n'est pas validée et redevient immédiatement éligible au cycle suivant.

## Boutiques et flux autorisés

Les 21 connecteurs sont définis dans `src/connectors`. Les six origines protégées ne sont jamais interrogées sans flux autorisé :

```text
AUTHORIZED_FEED_PLAYIN_URL
AUTHORIZED_FEED_CULTURA_URL
AUTHORIZED_FEED_MICROMANIA_URL
AUTHORIZED_FEED_FNAC_URL
AUTHORIZED_FEED_CARREFOUR_URL
AUTHORIZED_FEED_KING_JOUET_URL
```

Le parseur accepte CSV, TSV, JSON et XML. Les URL de flux doivent être HTTPS, ne peuvent pas cibler une adresse locale/privée et sont remplacées par `authorized-feed:<store>` dans les diagnostics.

## Commandes

```bash
npm ci
npm run typecheck
npm test
npm audit
npx wrangler deploy --dry-run
```

`npm run smoke-preview` et `npm run audit-preview` sont réservées au workflow après déploiement. Elles nécessitent `PREVIEW_URL` et `PREVIEW_AUDIT_TOKEN`.

## Production

Le moteur Node peut être appelé par un ordonnanceur externe. Aucun cron Cloudflare n'est utilisé. Le workflow `watch-maxireves.yml` offre un fallback GitHub toutes les cinq minutes et un événement `op-watch-fast-watch`, mais le job entier reste bloqué tant que `OP_WATCH_PRODUCTION_ENABLED != true`.

Cette branche ne doit pas activer cette variable, installer un webhook LIVE, fusionner `main` ou déclencher le workflow de production.
