# OP Watch — état de production LIVE

Dernière vérification complète : 2026-08-10.

## Verdict

**PRODUCTION LIVE : OUI.**

Le verdict ne repose pas uniquement sur GitHub : le Worker de production, le cockpit Pages, les Durable Objects, la sonde runtime et l'API Cloudflare ont été contrôlés après le dernier déploiement.

## Déploiement final vérifié

- Worker de production : `tcg-watch-one-piece`
- Run de preuve cockpit final : `31425038364`
- Job de preuve cockpit final : `93574591659`
- Conclusion : `success`
- Version Cloudflare finale : `4f2e28a7-ecb1-46c6-a1bc-5ce22a20a743`
- Tests sur la révision finale : `164/164 PASS` (`26/26` fichiers)
- Cron Cloudflare confirmé par API : `* * * * *`
- Cockpit : `https://op-watch-tcg-fr.pages.dev/cockpit/`

## État Cloudflare confirmé indépendamment

Après le dernier déploiement, l'API Cloudflare a confirmé :

- `MONITORING_ENABLED=true`
- `WRITE_STATE=true`
- `DISCORD_MODE=live`
- `SCHEDULER_MODE=live`
- `RUNTIME_TEST_MODE=false`
- cron unique : `* * * * *`
- secret Discord présent
- Durable Object `STORE_MONITORS` présent
- Durable Object `CALENDAR_COORDINATOR` présent

## Heartbeat Discord

Le heartbeat de production est actif à :

- **10h00 Europe/Paris**
- **22h00 Europe/Paris**

La conversion Europe/Paris est faite au runtime, donc le changement heure d'été / heure d'hiver est pris en compte automatiquement.

Un heartbeat réel a également été forcé après son premier déploiement : Discord a accepté exactement un message (`attempted=1`, `sent=1`, aucune erreur).

Le heartbeat n'est envoyé qu'après l'exécution d'un cycle réel du moteur.

## Cockpit personnel

Le cockpit est une interface responsive téléphone / ordinateur servie sur :

`https://op-watch-tcg-fr.pages.dev/cockpit/`

L'accès aux données et aux mutations est protégé. L'API cockpit refuse une requête anonyme avec HTTP 401.

Le test bout-en-bout final a confirmé :

- page cockpit réellement servie ;
- proxy Pages -> Worker de production fonctionnel ;
- runtime `live=true` ;
- `runtimeTest=false` ;
- 21 boutiques présentes ;
- 6 boutiques en attente de flux partenaire ;
- Amazon FR affiché rouge lorsqu'aucune source exploitable n'est qualifiée ;
- télémétrie de boutique issue des Durable Objects ;
- heartbeat affiché à 10h00 / 22h00 Paris.

Le cockpit permet réellement de :

- voir les 21 boutiques en vert / orange / rouge ;
- voir le dernier cycle, son état et le nombre de candidats ;
- forcer un contrôle d'une boutique ;
- activer / désactiver une référence ;
- définir une date de fin de recherche anticipée ;
- ajouter une référence manuelle ;
- supprimer une référence manuelle ;
- choisir les langues Français / Anglais / Japonais ;
- ajouter des URLs directes par boutique à une référence manuelle ;
- ajouter un produit d'un autre jeu, par exemple Pokémon ;
- envoyer un heartbeat Discord à la demande ;
- enregistrer une demande complexe dans la file Assistant.

Les réglages structurés sont stockés dans le Calendar Coordinator Durable Object et sont relus par le moteur. Ils ne sont donc pas de simples préférences d'affichage.

### Assistant / ChatGPT

La file de demandes complexes existe dans le cockpit, mais l'exécution événementielle automatique par ChatGPT n'est **pas encore branchée**. Les boutons structurés appliquent directement leurs changements au runtime ; les demandes complexes sont seulement mises en file pour l'instant. Il ne faut pas présenter cette file comme un agent ChatGPT autonome tant que l'intégration dédiée n'est pas ajoutée.

## État réel des boutiques au contrôle final

Le contrôle final du cockpit a retourné :

- **9 vertes** ;
- **8 orange** ;
- **4 rouges** ;
- **0 grise**.

Ces couleurs sont volontaires : le cockpit doit montrer les problèmes réels plutôt que masquer un incident pour afficher artificiellement « tout vert ».

### Orange attendu

Six boutiques restent `pending_authorized_feed` :

- Playin
- Cultura
- Micromania
- Fnac
- Carrefour
- King Jouet

Ludiworld et Otakuland restent dans leur régime discovery-only / limité ; Otakuland a notamment remonté des HTTP 503 lors des contrôles.

### Rouge confirmé

- **Amazon FR** : rouge `Non opérationnel` tant qu'aucune source / candidat exploitable n'est qualifié. Amazon reste volontairement différé / fail-closed.
- **Philibert** : un contrôle forcé réel a confirmé un **HTTP 403** ; il doit donc rester rouge tant que ce problème n'est pas résolu.

Les autres rouges éventuels sont calculés dynamiquement à partir de la télémétrie persistante : cycle absent, trop ancien, backoff, erreur ou source dégradée.

## Parkage — correctif LIVE

OP Watch utilise l'API catalogue publique structurée de Parkage en lecture seule :

- catalogue filtré `lang=fr` ;
- source structurée authoritative ;
- Discovery et Fast Watch utilisent la même source ;
- prix, stock et langue restent disponibles à chaque cycle.

Audit réel du correctif : **47 produits FR reconnus**, avec prix et disponibilité connus pour les 47. Les ST-31 à ST-36 étaient notamment présents.

## E.Leclerc — correctif LIVE

Le vendeur inconnu n'est plus un motif automatique de rejet.

- vendeur connu : il est affiché ;
- vendeur inconnu : l'offre peut continuer dans le pipeline ;
- Discord affiche `Vendeur non confirmé (Marketplace E.Leclerc)` ;
- OP Watch ne prétend jamais que l'offre est vendue directement par E.Leclerc lorsqu'il ne le sait pas.

## Isolation TEST / PREVIEW

Les environnements de test restent séparés :

- Worker preview distinct : `tcg-watch-one-piece-preview` ;
- Worker runtime-test distinct : `tcg-watch-one-piece-runtime-test` ;
- la production a été vérifiée avec `RUNTIME_TEST_MODE=false` ;
- le cron confirmé appartient au Worker de production.

## Nettoyage après activation

Les workflows one-shot utilisés pour créer, déployer et diagnostiquer le cockpit ont été supprimés après les contrôles finaux. Ils ne peuvent donc plus redéployer automatiquement le Worker.

Le workflow permanent de production reste manuel pour les futures opérations sensibles.
