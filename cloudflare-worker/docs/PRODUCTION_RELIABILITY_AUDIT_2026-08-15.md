# Audit de fiabilité OP Watch — 15 août 2026

Ce rapport accompagne la branche `fix/op-watch-prod-reliability`. Il distingue systématiquement six niveaux : **présent dans le code**, **configuré**, **déployé**, **testé**, **observé en production** et **opérationnel pour détecter une offre**.

## Résumé de l'incident

| Élément | Preuve au 15 août | Verdict |
|---|---|---|
| Worker HTTP | endpoints de production accessibles ; action manuelle réussie | accessible |
| Discord | heartbeat manuel livré | webhook fonctionnel |
| Durable Objects | cycle marchand manuel terminé | accessibles |
| Cron | API Cloudflare : `* * * * *` | configuré |
| Scheduled Events | aucun événement pendant deux fenêtres de 190 s de tail | non observés récemment |
| Limites runtime | 113 invocations `exceededResources`, toutes entre le 13/08 16:13 et 18:33 UTC | plafond CPU atteint |
| Health boutiques | état manuel puis vieillissement global | non renouvelé automatiquement |
| Web Scout | dernier état lisible `2026-08-14T17:07:01Z` | en retard |

Le déploiement de production est toujours le commit `e7cebd273c9d45ab0127ecbc9c93d1165ac1fb66`, version Cloudflare `da6539b1-3b2a-482d-9563-21d0c5b2d3a7`. Aucun commit postérieur n'a été trouvé en production.

### Cause du scheduler — niveau de preuve atteint

Deux défauts distincts sont prouvés.

1. La télémétrie GraphQL Cloudflare compte **113 invocations `exceededResources`**. Elles se concentrent du `2026-08-13T16:13:26Z` au `2026-08-13T18:33:26Z`, avec une métrique CPU presque toujours plafonnée à `10000`. Ce plateau correspond à la limite actuelle documentée de 10 ms du Cron Workers Free. L'ancien Scheduled Handler orchestrait et désérialisait lui-même toutes les réponses boutiques : il dépassait donc réellement son budget CPU.
2. Au moment de l'incident, le trigger production reste déclaré mais n'est plus livré régulièrement au handler. Deux tails séparés de 190 secondes n'ont reçu aucun événement. La dernière invocation réussie visible avant le second tail était `2026-08-15T13:00:56Z`, puis aucun des trois ticks attendus pendant le tail. C'est ce silence d'entrée qui explique simultanément l'absence de heartbeat automatique, Discovery, Fast Watch et Web Scout.

La livraison Cron du compte s'est révélée **intermittente**, et non définitivement arrêtée :

- des essais isolés ont reçu de vrais ticks successifs plus tôt dans la journée ;
- deux réenregistrements suivants n'ont reçu aucun nouveau tick en 16 puis 20 minutes, alors que l'API confirmait le trigger `* * * * *` ;
- la CI #171 a finalement reçu deux nouveaux événements successifs (`15:29:58Z` et `15:30:58Z`), terminé les cycles en 6,16 s et 29,66 s sans boutique en incident, puis supprimé le trigger avec vérification API.

La page de statut Cloudflare confirme en outre un incident Durable Objects du 14/08 de `19:27Z` à `20:05Z`, exactement pendant le heartbeat attendu à 22 h Paris. Cela explique solidement ce créneau, mais pas le silence du 15/08 ni les deux essais Cron isolés sans livraison. Le redéploiement devra réenregistrer le trigger et observer plusieurs cycles ; le motif fournisseur interne de l'intermittence ne doit pas être inventé.

Les éléments disponibles excluent à ce stade :

- `SCHEDULER_MODE` désactivé ;
- cron absent ;
- Worker entièrement indisponible ;
- webhook Discord cassé ;
- panne générale permanente des Durable Objects ;
- régression de code ou nouveau déploiement postérieur à la dernière activation connue.

Le token de déploiement ne peut toujours pas lire l'API Workers Observability (`403`) et l'interface Cloudflare est bloquée par une vérification humaine. Le détail interne de Past Events expliquant pourquoi le trigger production a cessé d'être régulièrement livré n'est donc pas accessible. L'audit ne l'invente pas : le dépassement CPU est chiffré, la non-livraison récente est observée, mais le motif interne de cette seconde défaillance reste à confirmer côté Cloudflare.

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
- Web Scout pouvait dépenser ses quatre places de vérification sur les premiers résultats déjà bloqués (marketplaces/sources interdites), sans atteindre un marchand valable placé plus bas ;
- Web Scout considérait à tort l'absence de langue étrangère comme une preuve française.

La branche rend chaque rejet explicable : référence, format, langue/confiance, disponibilité, vendeur/éligibilité commerciale, accessoire/carte unitaire, baseline, déduplication, tentative et livraison Discord.

Web Scout compte désormais les résultats bloqués dans ses rejets sans leur faire consommer le plafond de quatre vraies vérifications. Une publication sociale reste fail-closed : référence, One Piece, signal commercial FR et rattachement à une boutique connue ou à un domaine légalement vérifié sont tous obligatoires. Il conserve la requête, le dernier appel Brave, le budget et l'erreur de livraison dans son health. Une piste Discord échouée n'est pas marquée comme vue et reste donc éligible.

## Architecture corrigée

- cron marchand minute conservé, mais réduit à un hand-off vers le Durable Object scheduler afin de rester sous ses 10 ms de CPU ;
- orchestration, agrégation des boutiques et heartbeat pré-cycle exécutés dans le Durable Object (budget CPU 30 s) ;
- heartbeat pré-cycle 10 h/22 h Paris conservé ;
- tick reçu, cycle automatique terminé, Discovery, Fast Watch, Web Scout, heartbeat automatique et heartbeat manuel persistés séparément ;
- alarme Calendar Coordinator après trois minutes sans tick, puis cadence de secours minute ;
- watchdog GitHub toutes les cinq minutes, indépendant du scheduler Cloudflare, avec une alerte au maximum par heure ;
- smoke final de production exigeant deux ticks distincts et un cycle automatique terminé, avec une fenêtre de 20 minutes : jusqu'à 15 minutes de propagation documentée, puis deux frontières de minute et une marge ;
- test PR sur Worker isolé avec vrai cron, Discord dry-run puis suppression vérifiée du trigger ;
- test PR séparé sans aucun Cron Trigger : deux alarmes Durable Object ont terminé deux cycles de secours ;
- heartbeat 10 h/22 h également pré-cycle sur le chemin d'alarme de secours ;
- Web Scout remis au même orchestrateur Durable Object que le monitoring, mais dans une exécution et un état séparés : le Scheduled Handler Free n'effectue ainsi qu'un seul hand-off et ne peut plus dépasser ses 10 ms à `:07` en orchestrant lui-même plusieurs tâches ;
- health boutique vert seulement après une vraie lecture Fast Watch récente ; Discovery récente sans fiche promue reste orange ;
- dernier calendrier Bandai vérifié conservé si son rafraîchissement échoue, avec cache de secours et erreur visibles dans le cockpit au lieu d'arrêter les 24 veilles ;
- catalogues partenaires parcourus en streaming, avec 40 Mo de transfert maximum mais sans bufferiser le fichier complet en mémoire ;
- revalidation conditionnelle des feeds par `ETag`/`Last-Modified` lorsqu'ils existent : un `304` est un contrôle sain, sans retéléchargement, reparsing, faux OOS ni exposition de l'URL secrète ;
- feeds publics volumineux limités à Discovery, puis fiches directes actives qualifiées relues en Fast Watch ; pour une origine protégée, un feed sans validateur est reporté à Discovery et le cockpit reste orange au lieu de retélécharger silencieusement le catalogue complet ;
- suppression de deux écritures DO redondantes par Discovery (forçage via métadonnée puis réécriture du même cache Fast Watch) et arrêt des remises à zéro de backoff déjà nulles ; la projection de lignes écrites reste ainsi nettement sous les 100 000/jour du niveau Free ;
- plafond de 50 sous-requêtes appliqué par Store Monitor, y compris Esprit Jeu : les sorties Bandai actives sont prioritaires et les anciennes fiches excédentaires sont reportées avec un warning explicite.

## Circuits fonctionnels

| Circuit | Présent/configuré sur `main` | Correctif de branche | Preuve restant requise après déploiement |
|---|---|---|---|
| Calendrier Bandai | source officielle et politique presence + 1 mois | tests d'activation OP/EB/PRB/ST/DP/TS et date mois/année | rafraîchissement production récent |
| Nouvelles sorties | Discovery 15 min + événements complets | motifs de qualification et compteurs persistés | transitions réelles de production |
| Fast Watch | cible 60 s | vraie lecture distinguée du réveil DO | plusieurs cycles minute successifs |
| ONE PIECE ALL | état séparé, `new_listing` disponible et `back_in_stock` | test de relais sans faux listing et sans double alerte | cycle production et offre historique réelle |
| Web Scout | Brave à `:07`, un appel/h | métriques et rejets persistés ; DO séparé, déclenché par l'orchestrateur et non plus par le handler 10 ms | appels horaires observés sans dépassement |
| Discord | fingerprint/claim/receipt | échec encore éligible ; tests de doublon croisé | livraison live après approbation |
| Heartbeat | 10 h/22 h pré-cycle | état auto/manu séparé + watchdog externe | créneau réel après déploiement |
| Cockpit | email/password/cookie | auth unique, snapshot body, health observé | login Pages et session réels |

La baseline initiale reste silencieuse. ONE PIECE ALL n'alerte ni rupture, ni prix, ni précommande. Une source challenge/403/429/5xx reste dégradée et n'est jamais interprétée comme une rupture.

### Calendrier Bandai contrôlé le 15 août

La page FR officielle publie actuellement OP-17 (28 août 2026), DP-12 (28 août 2026), EB-05 (octobre 2026) et ST-31 à ST-36 (31 juillet 2026). EB-05 utilise donc provisoirement le 1er octobre jusqu'à ce que Bandai publie un jour exact. OP-18 n'apparaît pas dans le catalogue officiel FR au moment du contrôle : ses fiches marchandes sont découvertables, mais elle ne doit pas devenir une « Nouvelle sortie » avant publication Bandai.

Deux protections ont été ajoutées à la suite de ce contrôle :

- `[OP15-EB04]` attribue désormais la date officielle aux deux codes, au lieu de perdre OP-15 ;
- ONE PIECE ALL accepte uniquement une référence déjà présente dans le catalogue officiel complet. Une OP-18 marchande anticipée ne peut donc plus être mal étiquetée comme ancienne référence. Lors de sa publication Bandai, elle est baselinée dans ALL tout en restant exclue de ses alertes, puis peut basculer après sa fenêtre sans faux `new_listing`.

## Audit des 24 boutiques en preview isolée

Audit final isolé du 15 août (`2026-08-15T15:26:07Z`) : 24 connecteurs appelés, 272 produits observés, 164 en français et 124 commercialement éligibles. Le statut de source est de 18 saines, 0 dégradée et 6 en attente. « Source accessible » ne signifie pas « capable d'alerter ».

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
| E.Leclerc | 6 produits, 2 FR, mais aucun vendeur E.Leclerc confirmé | source saine ; aucune alerte tant que le vendeur n'est pas prouvé |
| Carrefour | feed absent | en attente de flux partenaire |
| King Jouet | feed absent | en attente de flux partenaire |
| JouéClub | feed configuré de 27,7 Mo, 4 candidats, 1 FR/commercial | feed limité à Discovery puis fiches directes qualifiées en Fast Watch |
| Amazon FR | 28 produits observés, 8 FR, disponibilité inconnue et aucun vendeur Amazon confirmé | source saine sur ce passage, 0 offre commerciale ; fail-closed et jamais interprétée comme rupture |
| Mystic-Ambre | 6 produits, 3 FR/commerciaux | exploitable |
| Ludiworld | zéro candidat | discovery-only, alertes commerciales désactivées |
| VegaStore | une fiche OP17 FR commerciale | exploitable mais couverture étroite |
| Otakuland | 28 produits, 24 FR, 12 commerciaux sur le domaine actuel | exploitable selon l'audit ; ancienne description merchandising obsolète |
| Esprit Jeu | 24 produits, zéro FR commercial | source accessible, non démontrée commerciale |
| La Grande Récré | feed de 5,3 Mo lu sans erreur, zéro candidat One Piece courant | source saine ; aucune offre actuelle démontrée |
| BCD Jeux | feed de 15,5 Mo lu sans erreur, zéro candidat One Piece courant | source saine ; aucune offre actuelle démontrée |

Les six secrets partenaires absents confirmés sont Playin, Cultura, Micromania, Fnac, Carrefour et King Jouet. JouéClub, La Grande Récré et BCD Jeux possèdent un secret configuré. Le test cadence a démontré que leurs catalogues dépassaient l'ancienne borne de 5 Mo. La branche les lit en streaming, ne conserve que les lignes One Piece et borne le transfert à 40 Mo, un enregistrement à 750 Ko et les candidats à 2 000. Les trois feeds réels ont été parsés sans erreur au passage final. Un feed public sain sert une seule fois à la Discovery et les fiches directes actives prennent ensuite le relais minute ; un échec ne déclenche jamais un martèlement du fallback public.

## Performance et quotas

Le test isolé CI #171, avec une Discovery puis quatorze Fast Watch, a mesuré :

- 271 requêtes Durable Objects sur 15 minutes ;
- projection de 26 016 requêtes DO/jour ;
- 155 533 ms DO cumulées sur 15 minutes ;
- projection de 1 911,2 GB-s/jour ;
- marge de 85,30 % sous le repère de 13 000 GB-s/jour utilisé par le test ;
- 48 587 031 octets de feeds téléchargés : exactement une réponse complète par feed pendant la Discovery, aucune répétition durant les quatorze Fast Watch et aucun fallback partenaire ;
- Web Scout cible 744 recherches pour un mois de 31 jours.

Ces projections sont un budget de test, pas une facture. Le `usage_model` déployé est `standard`; la télémétrie montre cependant un plafond effectif de 10 ms sur les anciennes invocations cron, identique au plafond Workers Free documenté. Le test échoue si un catalogue complet est retéléchargé plusieurs fois dans l'échantillon.

Le passage CI du SHA `74ee7367` n'a reçu aucun nouveau tick en 16 minutes. Le SHA `d5b0de68` n'en a reçu aucun en 20 minutes. Dans les deux cas, le trigger déclaré a ensuite été retiré et sa suppression API confirmée. Le SHA `c5e57b05` a reçu deux ticks en environ deux minutes et validé les deux cycles. Le résultat exact est donc une intermittence observée, pas une simple propagation lente ni une panne permanente.

Sur ce même SHA, un déploiement distinct avec `CRON_CONFIGURED=true` mais **zéro trigger enregistré** a armé l'alarme Durable Object. Deux cycles de secours ont été observés ; le second a terminé à `15:37:04Z` en 4,95 s, avec 17 boutiques exécutées et 0 incident. Aucun Discord réel ni appel Brave n'a été effectué pendant ce test.

## Validation exigée avant promotion

- `npm ci`, typecheck, tests complets, Wrangler dry-run ;
- scénarios baseline, stock, rupture, prix, doublon, échec Discord, ALL vs sorties actives, Fast Watch vs Discovery ;
- auth cockpit, limite/body proxy et appels concurrents ;
- classification health 24 boutiques ;
- audit preview sans écriture production ;
- cadence 60 s/15 min ;
- deux Scheduled Events réels consécutifs sur Worker isolé — validé CI #171 ;
- deux cycles de secours par alarme sans Cron — validé CI #171 ;
- suppression API-confirmée du cron isolé ;
- diagnostic production en lecture seule.

## Promotion production du 15 août

Après validation explicite :

- la PR #29 a été mergée dans `main` au SHA `ee7e477500f4ddb6220ef47425f42ce3c09acc23` ;
- le run Worker #14900 a terminé avec succès et déployé la version `325fbda5-041b-4467-8436-a7c44a3f04c5` ;
- le smoke Worker a observé deux cycles automatiques successifs, le dernier monitoring automatique terminé, 24 boutiques et l'auth cockpit disponible ;
- le premier run Pages #19 a correctement publié le SHA sur l'alias preview `main.op-watch-tcg-fr.pages.dev`, mais le smoke du domaine principal a échoué ;
- la cause est la configuration historique du projet Direct Upload : sa branche de production était encore `op-watch-v1-test`, tandis que le workflow publiait désormais `main`. Le domaine principal servait donc encore l'ancien HTML avec `sessionStorage` et `x-op-watch-admin-password` ;
- le workflow Pages aligne désormais explicitement `production_branch=main` via l'API Cloudflare avant l'upload, vérifie la réponse API, puis contrôle le domaine principal pendant deux minutes.

Le premier échec Pages n'a pas été requalifié en simple délai de propagation : l'alias `main` servait le nouveau cockpit tandis que le domaine principal servait de façon reproductible l'ancien document avec `cache-control: no-store`.
