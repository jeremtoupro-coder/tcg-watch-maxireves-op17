# OP Watch — état de production LIVE

Dernière activation vérifiée : 2026-08-10.

## Verdict

**PRODUCTION LIVE : OUI.**

Le Worker Cloudflare de production a été déployé via le workflow de production, puis son état réel a été relu indépendamment via l'API Cloudflare. La vérification ne repose donc pas uniquement sur le contenu d'un fichier de configuration généré.

## Déploiement final

- Workflow de production : `OP Watch - Production Activation (manual only)`
- Workflow ID : `293939743`
- Run d'activation réussi : `31402213881`
- Worker : `tcg-watch-one-piece`
- Version Cloudflare finale déployée : `30a8537f-5214-496f-aeb0-ce080637175f`
- Cron réellement déployé : `* * * * *`
- Smoke final : `phase=live`, `readiness=PASS`, 21 connecteurs déclarés.

## État Cloudflare relu après déploiement

Vérification indépendante : workflow one-shot `OP Watch Production Verify`, run `31402506434`, terminé avec succès avant suppression du workflow one-shot.

Valeurs réellement retournées par l'API Cloudflare :

- `MONITORING_ENABLED=true`
- `WRITE_STATE=true`
- `DISCORD_MODE=live`
- `SCHEDULER_MODE=live`
- `RUNTIME_TEST_MODE=false`
- `PRODUCTION_PROBE_MODE=true`
- cron unique : `* * * * *`
- Durable Objects présents : `STORE_MONITORS`, `CALENDAR_COORDINATOR`
- aucun binding KV de production
- secret `DISCORD_WEBHOOK_URL` présent
- secret `PREVIEW_AUDIT_TOKEN` présent

La route privée de readiness du Worker a également répondu :

- `status=ready`
- `mode=live`
- `monitoringEnabled=true`
- `stateWritesEnabled=true`
- `discordMode=live`
- `schedulerMode=live`
- 21 connecteurs déclarés

## Discord

Le webhook Discord a d'abord été validé par un envoi one-shot réel, puis le même secret GitHub a été installé dans le Worker de production. Le Worker de production est actuellement configuré avec `DISCORD_MODE=live`.

## Boutiques protégées / intégrations externes

L'absence d'un flux partenaire ne bloque pas le reste du LIVE. Les connecteurs suivants restent volontairement `pending_authorized_feed` tant que leur flux autorisé n'est pas configuré :

- Playin
- Cultura
- Micromania
- Fnac
- Carrefour
- King Jouet

Leur origine protégée n'est pas interrogée sans autorisation. Elles seront ajoutées au Fast Watch au fur et à mesure de l'obtention des flux Awin / Kwanko / Affilae ou d'un accès partenaire direct.

Amazon FR reste volontairement différé / fail-closed. Ludiworld et Otakuland restent soumis à leurs garde-fous discovery-only / dégradation et ne peuvent pas fabriquer une alerte commerciale.

Toutes les autres boutiques configurées sont exécutées selon leurs garde-fous de qualification : calendrier officiel actif, français confirmé, format cible, disponibilité connue et vendeur officiel lorsque requis.

## Isolation TEST / PREVIEW

Le workflow `OP Watch Test CI and Safe Preview` reste un outil de CI séparé :

- son déploiement preview n'est autorisé que depuis `op-watch-v1-test` ;
- Worker preview distinct : `tcg-watch-one-piece-preview` ;
- `MONITORING_ENABLED=false` ;
- `WRITE_STATE=false` ;
- `DISCORD_MODE=dry-run` ;
- `SCHEDULER_MODE=disabled` ;
- aucun Durable Object ni cron sur la preview.

Le runtime de production, lui, a été vérifié avec `RUNTIME_TEST_MODE=false` et ne partage pas le Worker preview/runtime-test.

## Workflow de production après nettoyage

Le workflow de production a été restauré en `workflow_dispatch` uniquement après l'activation. Les triggers one-shot de bootstrap, activation et vérification ont été supprimés du dépôt. Le workflow de production reste actif pour une future intervention manuelle mais ne redéploie pas automatiquement le Worker sur un push.

L'ancien workflow `Cloudflare Audit CI` (ID `303112857`) est désormais dans l'état GitHub `deleted`.

## Anomalie GitHub sans impact sur Cloudflare

Un ancien run `31401567016`, créé pendant une première tentative de `workflow_dispatch`, reste affiché `queued` sans aucun job. Les endpoints GitHub `cancel` et `force-cancel` renvoient actuellement HTTP 500 pour ce run. Il référence une ancienne révision du workflow dont le hard gate échouait avant checkout ; il n'a jamais déployé Cloudflare. La production actuelle est celle du run `31402213881`, vérifiée indépendamment par l'API Cloudflare.
