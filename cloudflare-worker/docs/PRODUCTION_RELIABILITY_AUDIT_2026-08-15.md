# Audit de fiabilité OP Watch — 15 août 2026

Ce rapport accompagne la branche `fix/op-watch-prod-reliability`. Il distingue systématiquement six niveaux : **présent dans le code**, **configuré**, **déployé**, **testé**, **observé en production** et **opérationnel pour détecter une offre**.

## Résumé de l'incident

| Élément | Preuve au 15 août | Verdict |
|---|---|---|
| Worker HTTP | endpoints de production accessibles ; action manuelle réussie | accessible |
| Discord | heartbeat manuel livré | webhook fonctionnel |
| Durable Objects | cycle marchand manuel terminé | accessibles |
| Cron | API Cloudflare : `* * * * *` | configuré |
| Scheduled Events | aucun événement pendant 190 s de tail | non observés |
| Health boutiques | état manuel puis vieillissement global | non renouvelé automatiquement |
| Web Scout | dernier état lisible `2026-08-14T17:07:01Z` | en retard |

Le déploiement de production est toujours le commit `e7cebd273c9d45ab0127ecbc9c93d1165ac1fb66`, version Cloudflare `da6539b1-3b2a-482d-9563-21d0c5b2d3a7`. Aucun commit postérieur n'a été trouvé en production.

### Cause du scheduler — niveau de preuve actuel

Le Scheduled Event n'atteint pas le handler de production pendant la fenêtre observée, malgré un trigger présent. Cela explique simultanément l'absence de heartbeat automatique, Discovery, Fast Watch et Web Scout : les quatre dépendaient du même événement.

Les éléments disponibles excluent à ce stade :

- `SCHEDULER_MODE` désactivé ;
- cron absent ;
- Worker entièrement indisponible ;
- webhook Discord cassé ;
- panne générale des Durable Objects ;
- régression de code ou nouveau déploiement postérieur à la dernière activation connue.

Le token de diagnostic ne peut pas lire la télémétrie Observability (`403`) et l'interface Cloudflare est bloquée par une vérification humaine. Past Events, exception/limit précis et métriques compte ne sont donc pas encore une preuve accessible. L'audit ne transforme pas ce manque d'accès en hypothèse : la cause racine démontrée est la **non-livraison/non-observation du Scheduled Event avant le code applicatif** ; son motif Cloudflare exact reste une inconnue de compte à fermer par les métriques ou par le test cron isolé de la PR.

### Cause du bug login/body

Deux défauts indépendants étaient présents :

1. Calendar Coordinator et Web Scout partageaient entre appels concurrents une même `Response`. Son body est un flux mono-lecture : le second `.json()` produit exactement `Body has already been used`.
2. Le cockpit empilait l'ancien login `x-op-watch-admin-password` + `sessionStorage` et le nouveau login email/mot de passe/cookie, avec interception d'événements. Deux stratégies concurrentes pouvaient lancer des chemins fragiles.

Le proxy Pages transmettait aussi `request.body` directement. Il n'est pas la seule cause démontrée, mais il augmentait le risque de réutilisation d'un flux déjà consommé.

Le correctif partage maintenant un snapshot immuable, bufferise une seule fois les petits JSON (64 Kio maximum) et conserve une seule authentification cookie.

### Cause du silence des alertes

Le facteur principal observé est l'arrêt global de la cadence automatique. Le diagnostic a aussi trouvé trois facteurs fonctionnels :

- `minimumAlertConfidence=90` existait dans la configuration mais n'était pas appliqué de façon explicite et traçable ;
- le cockpit comptait surtout les réveils de Durable Objects, pas les candidats observés, filtrés, qualifiés, dédupliqués et livrés ;
- six routes partenaires sont volontairement fail-closed sans feed et plusieurs routes exploitables peuvent retourner zéro candidat commercial.

La branche rend chaque rejet explicable : référence, format, langue/confiance, disponibilité, vendeur/éligibilité commerciale, accessoire/carte unitaire, baseline, déduplication, tentative et livraison Discord.

## Architecture corrigée

- cron marchand minute conservé ;
- heartbeat pré-cycle 10 h/22 h Paris conservé ;
- tick reçu, cycle automatique terminé, Discovery, Fast Watch, Web Scout, heartbeat automatique et heartbeat manuel persistés séparément ;
- alarme Calendar Coordinator après trois minutes sans tick ;
- watchdog GitHub toutes les cinq minutes, indépendant du scheduler Cloudflare, avec une alerte au maximum par heure ;
- smoke final de production exigeant deux ticks distincts et un cycle automatique terminé ;
- test PR sur Worker isolé avec vrai cron, Discord dry-run puis suppression vérifiée du trigger ;
- Web Scout détaché du chemin marchand par `waitUntil` et métriques searched/candidates/verified/rejected/alerted/reasons ;
- health boutique vert seulement après une vraie lecture Fast Watch récente ; Discovery récente sans fiche promue reste orange.

## Circuits fonctionnels

| Circuit | Présent/configuré sur `main` | Correctif de branche | Preuve restant requise après déploiement |
|---|---|---|---|
| Calendrier Bandai | source officielle et politique presence + 1 mois | tests d'activation OP/EB/PRB/ST/DP/TS et date mois/année | rafraîchissement production récent |
| Nouvelles sorties | Discovery 15 min + événements complets | motifs de qualification et compteurs persistés | transitions réelles de production |
| Fast Watch | cible 60 s | vraie lecture distinguée du réveil DO | plusieurs cycles minute successifs |
| ONE PIECE ALL | état séparé, `new_listing` disponible et `back_in_stock` | test de relais sans faux listing et sans double alerte | cycle production et offre historique réelle |
| Web Scout | Brave à `:07`, un appel/h | métriques et rejets persistés ; tâche séparée | appels horaires observés sans dépassement |
| Discord | fingerprint/claim/receipt | échec encore éligible ; tests de doublon croisé | livraison live après approbation |
| Heartbeat | 10 h/22 h pré-cycle | état auto/manu séparé + watchdog externe | créneau réel après déploiement |
| Cockpit | email/password/cookie | auth unique, snapshot body, health observé | login Pages et session réels |

La baseline initiale reste silencieuse. ONE PIECE ALL n'alerte ni rupture, ni prix, ni précommande. Une source challenge/403/429/5xx reste dégradée et n'est jamais interprétée comme une rupture.

## Audit des 24 boutiques en preview isolée

Audit du 15 août : 24 connecteurs appelés, 269 produits observés, 164 en français, 173 éligibles à la source et 125 commercialement éligibles avant les derniers durcissements. « Source accessible » ne signifie pas « capable d'alerter ».

| Boutique | Observation isolée | Capacité commerciale actuelle |
|---|---|---|
| Maxi Rêves | 7 produits, 7 qualifiables | exploitable |
| Oupi | 37 produits, 20 FR, 5 commerciaux | exploitable |
| PixelHeart | 7 produits, 4 FR, 4 commerciaux | exploitable |
| Fantasy Sphere | 13 produits FR, 10 commerciaux ; cinq URLs OP18 vérifiées | exploitable |
| Ludisphere | 45 produits, 33 FR/commerciaux | exploitable |
| Parkage | 47 produits FR/commerciaux | exploitable |
| UltraJeux | 19 produits, 1 FR/commercial | exploitable, rendement faible |
| Playin | feed absent | en attente de flux partenaire |
| Philibert | zéro candidat | source accessible mais non démontrée commerciale |
| Cultura | feed absent | en attente de flux partenaire |
| Micromania | feed absent | en attente de flux partenaire ; aucun contournement anti-bot |
| Fnac | feed absent | en attente de flux partenaire |
| E.Leclerc | 6 produits, 2 FR lors de l'audit initial | vendeur désormais strict et fail-closed ; nouvel audit requis |
| Carrefour | feed absent | en attente de flux partenaire |
| King Jouet | feed absent | en attente de flux partenaire |
| JouéClub | feed configuré mais fallback public utilisé, zéro candidat | non démontrée commerciale |
| Amazon FR | 28 produits, 9 FR, aucun vendeur Amazon validé | limitée, fail-closed vendeur |
| Mystic-Ambre | 6 produits, 3 FR/commerciaux | exploitable |
| Ludiworld | zéro candidat | discovery-only, alertes commerciales désactivées |
| VegaStore | une fiche OP17 FR commerciale | exploitable mais couverture étroite |
| Otakuland | 28 produits, 24 FR, 12 commerciaux sur le domaine actuel | exploitable selon l'audit ; ancienne description merchandising obsolète |
| Esprit Jeu | 24 produits, zéro FR commercial | source accessible, non démontrée commerciale |
| La Grande Récré | un candidat non-FR, zéro commercial | non démontrée commerciale |
| BCD Jeux | zéro candidat puis HTTP 429 pendant la cadence | dégradée/backoff ; feed à vérifier |

Les six secrets partenaires absents confirmés sont Playin, Cultura, Micromania, Fnac, Carrefour et King Jouet. JouéClub, La Grande Récré et BCD Jeux possèdent un secret configuré, mais un échec de feed ne bascule plus vers du HTML public à chaque minute : le fallback est limité à Discovery.

## Performance et quotas

Le test isolé initial d'un cycle Discovery et quatorze cycles Fast Watch a mesuré :

- 271 requêtes Durable Objects sur 15 minutes ;
- projection de 26 016 requêtes DO/jour ;
- 249 674 ms DO cumulées sur 15 minutes ;
- projection de 3 068 GB-s/jour ;
- marge de 76,4 % sous le repère de 13 000 GB-s/jour utilisé par le test ;
- Web Scout cible 744 recherches pour un mois de 31 jours.

Ces projections sont un budget de test, pas une facture ni la preuve du plan du compte. Le `usage_model` déployé est `standard`, mais le niveau Free/Payé réel n'est pas déduit sans accès au compte. Le rapport de cadence corrigé sépare désormais verdict quota et incidents marchands, et publie le wall time réel en plus du temps DO cumulé.

## Validation exigée avant promotion

- `npm ci`, typecheck, tests complets, Wrangler dry-run ;
- scénarios baseline, stock, rupture, prix, doublon, échec Discord, ALL vs sorties actives, Fast Watch vs Discovery ;
- auth cockpit, limite/body proxy et appels concurrents ;
- classification health 24 boutiques ;
- audit preview sans écriture production ;
- cadence 60 s/15 min ;
- deux Scheduled Events réels consécutifs sur Worker isolé ;
- suppression API-confirmée du cron isolé ;
- diagnostic production en lecture seule.

La PR reste brouillon. Aucun merge et aucun déploiement Worker ou Pages ne sont autorisés sans validation explicite.
