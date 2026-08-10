# OP Watch — état de production LIVE

Dernière vérification complète : 2026-08-10.

## Verdict

**PRODUCTION LIVE : OUI.**

Le verdict ne repose pas seulement sur un workflow GitHub ou un fichier Wrangler : le runtime du Worker, la route `/health` et l'API Cloudflare ont tous été contrôlés après le dernier déploiement.

## Déploiement final vérifié

- Worker de production : `tcg-watch-one-piece`
- Run de preuve final : `31415718695`
- Job de preuve final : `93544126140`
- Conclusion du run/job : `success`
- Version Cloudflare finale : `29a33d8b-09dd-43f9-8b19-ce102986900c`
- Tests sur la révision déployée : `154/154 PASS` (`24/24` fichiers)
- Cron Cloudflare confirmé par API : `* * * * *`

La mutation de production effectuée en dernier est un `wrangler deploy` de la configuration LIVE finale. Aucun `secret put` ni déploiement de test n'a été exécuté après cette mutation.

## État réellement retourné par le Worker

La sonde privée `/runtime-ready` a répondu `LIVE PASS` après propagation.

La route `/health` a ensuite confirmé :

- `mode=LIVE`
- `monitoringEnabled=true`
- `discordMode=live`
- `schedulerMode=live`
- `runtimeTestMode=false`
- `stateBindingPresent=true`
- `stateBackend=durable_objects`
- `automaticPolling=true`
- Parkage : `active_fast_watch`, source `public_structured_feed`
- E.Leclerc : `active_fast_watch`

## État Cloudflare vérifié indépendamment

L'API Cloudflare a été relue après le dernier déploiement et a confirmé :

- `MONITORING_ENABLED=true`
- `WRITE_STATE=true`
- `DISCORD_MODE=live`
- `SCHEDULER_MODE=live`
- `RUNTIME_TEST_MODE=false`
- `PRODUCTION_PROBE_MODE=true`
- cron unique : `* * * * *`
- secret `DISCORD_WEBHOOK_URL` présent
- Durable Object `STORE_MONITORS` présent
- Durable Object `CALENDAR_COORDINATOR` présent

La vérification API a réussi dès la première tentative du run final.

## Parkage — correctif LIVE

L'ancien audit retournait à tort zéro produit parce que la page de catégorie charge ses cartes produits dynamiquement côté navigateur.

OP Watch utilise désormais l'API catalogue publique en lecture seule utilisée par le frontend Parkage :

- catalogue filtré `lang=fr` ;
- source structurée authoritative ;
- Discovery **et** Fast Watch minute utilisent la même source structurée ;
- aucune retombée sur les fiches HTML anglaises pendant le Fast Watch ;
- prix, stock et langue restent disponibles à chaque cycle ;
- seuls les produits `lang=fr` avec une référence One Piece reconnue deviennent candidats.

Audit réel SAFE Preview du correctif : **47 produits FR reconnus**, avec prix et disponibilité connus pour les 47. Les ST-31 à ST-36 étaient notamment présents.

Le test de cadence réel isolé `1 Discovery + 14 Fast Watch` a également passé avant le déploiement du hotfix.

## E.Leclerc — correctif LIVE

Le contrôle `vendeur E.Leclerc obligatoire` a été supprimé du connecteur E.Leclerc.

Désormais :

- un vendeur connu est affiché dans l'alerte ;
- si le vendeur ne peut pas être confirmé, l'offre n'est plus rejetée pour ce seul motif ;
- Discord affiche alors `Vendeur non confirmé (Marketplace E.Leclerc)` ;
- OP Watch ne prétend jamais que le produit est vendu par E.Leclerc si cette information n'est pas connue.

Audit réel du correctif : 7 produits détectés, dont 3 produits FR commercialement admissibles au stade boutique avant les autres filtres de la règle d'alerte.

## Discord

Le webhook Discord a été testé par un envoi réel avant l'activation de production. Le secret est présent dans le Worker final et l'API Cloudflare confirme `DISCORD_MODE=live`.

## Boutiques protégées / intégrations externes

L'absence d'un flux partenaire ne bloque pas le reste du LIVE. Les connecteurs suivants restent volontairement `pending_authorized_feed` tant que leur flux autorisé n'est pas configuré :

- Playin
- Cultura
- Micromania
- Fnac
- Carrefour
- King Jouet

Leur origine protégée n'est pas interrogée sans autorisation. Ils pourront rejoindre le Fast Watch au fur et à mesure de l'obtention des flux Awin / Kwanko / Affilae ou d'un accès partenaire direct.

Amazon FR reste volontairement différé / fail-closed. Ludiworld et Otakuland restent soumis à leurs garde-fous discovery-only / dégradation.

## Isolation TEST / PREVIEW

Les environnements de test restent séparés de la production :

- Worker preview distinct : `tcg-watch-one-piece-preview` ;
- Worker runtime-test distinct : `tcg-watch-one-piece-runtime-test` ;
- la production a été vérifiée avec `RUNTIME_TEST_MODE=false` ;
- la production utilise ses Durable Objects avec le préfixe d'état production ;
- le cron confirmé appartient au Worker de production.

## Nettoyage après activation

Les workflows one-shot utilisés pour le hotfix et sa vérification ont été supprimés après le run final réussi. Ils ne peuvent donc pas redéployer automatiquement le Worker.

Le workflow de production permanent reste un workflow manuel (`workflow_dispatch`) pour les futures opérations de production ; un push de code ordinaire n'est pas censé redéployer automatiquement le Worker.
