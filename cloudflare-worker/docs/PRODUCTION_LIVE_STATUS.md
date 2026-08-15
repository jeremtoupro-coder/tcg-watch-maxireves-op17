# OP Watch — état de production

Dernière vérification factuelle : **15 août 2026**.

## Verdict actuel

**Le Worker répond, mais la surveillance automatique n'est pas démontrée opérationnelle.**

Ce document remplace le verdict historique du 10 août. Une variable `SCHEDULER_MODE=live`, un cron déclaré ou un déploiement réussi ne prouvent pas qu'un Scheduled Event a été reçu et qu'un cycle marchand a terminé.

## Ce qui est réellement déployé

- branche de référence : `main` ;
- commit Worker : `e7cebd273c9d45ab0127ecbc9c93d1165ac1fb66` ;
- version Cloudflare : `da6539b1-3b2a-482d-9563-21d0c5b2d3a7` ;
- activation GitHub Actions : run `31678217854`, succès ;
- Worker : `tcg-watch-one-piece` ;
- cockpit : `https://op-watch-tcg-fr.pages.dev/cockpit/` ;
- cron déclaré par l'API Cloudflare : `* * * * *` ;
- quatre Durable Objects : Calendar Coordinator, Store Monitor, Web Scout et Cockpit Auth ;
- configuration déclarée : monitoring/écriture/scheduler/Discord `live`, runtime test désactivé.

Aucun déploiement de production postérieur à ce commit n'a été trouvé lors du diagnostic en lecture seule.

## Incident observé

- le heartbeat automatique pré-cycle du 13 août à 10 h Paris a été reçu ;
- ceux du 14 août à 22 h et du 15 août à 10 h n'ont pas été reçus ;
- un heartbeat manuel du 15 août a exécuté un cycle marchand et a été livré par Discord ;
- après ce cycle manuel, les health marchands ne se sont pas renouvelés automatiquement ;
- 190 secondes de tail sur le Worker de production n'ont montré aucun Scheduled Event, alors que trois événements au minimum étaient attendus ;
- le dernier état Web Scout lisible datait du `2026-08-14T17:07:01Z`.

Le cron est donc **configuré**, mais son exécution automatique récente n'est pas **observée**. La cause technique détaillée et les limites des preuves accessibles sont consignées dans [l'audit de fiabilité du 15 août](PRODUCTION_RELIABILITY_AUDIT_2026-08-15.md).

## Correctif en préparation

La branche `fix/op-watch-prod-reliability` et la PR brouillon #29 ajoutent notamment :

- santé persistante des Scheduled Events et de chaque circuit ;
- alarme Durable Object de secours ;
- watchdog GitHub indépendant du cron Cloudflare ;
- smoke d'activation exigeant deux événements automatiques successifs ;
- auth cockpit unique et corps JSON à lecture unique ;
- health marchand fondé sur une vraie lecture de source ;
- raisons de filtrage et résultats Web Scout visibles ;
- tests isolés avec cron réel, Discord dry-run et état de test séparé.

Ces changements sont **présents sur la branche de test**, pas en production. Ils ne deviendront déployés puis opérationnels qu'après validation explicite, merge, activation manuelle et observation réelle de plusieurs cycles de production.

## Règle d'exploitation

Tant qu'un déploiement corrigé n'a pas produit plusieurs cycles automatiques observés, le cockpit de production et les heartbeats manuels ne doivent pas être interprétés comme une preuve de surveillance continue.
