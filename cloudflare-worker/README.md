# OP Watch — runtime Cloudflare

Ce dossier contient le Worker TypeScript réellement utilisé par OP Watch. Le runtime de production s'appuie sur quatre Durable Objects : Calendar Coordinator, Store Monitor, Web Scout et Cockpit Auth.

## Circuits

1. **Calendrier officiel** : toute référence Bandai OP/EB/PRB/ST/DP/TS publiée est active immédiatement, jusqu'à un mois calendaire après sa sortie. Une date mois/année utilise provisoirement le premier jour du mois. Les anciens champs J-120/J+30 restent lisibles pour compatibilité mais ne pilotent plus l'activation.
2. **Discovery** : catégories, feeds et fiches connues sont explorés toutes les 15 minutes. Les mêmes lectures alimentent Nouvelles sorties et ONE PIECE ALL.
3. **Fast Watch** : une source structurée authoritative ou une fiche directe déjà qualifiée est relue toutes les minutes.
4. **ONE PIECE ALL** : état séparé des sorties actives ; seules une nouvelle fiche déjà disponible et un `back_in_stock` historique peuvent alerter. Les références encore actives sont baselinées dans ALL mais exclues de ses alertes.
5. **Web Scout** : une recherche Brave par heure, à la minute `:07`, avec validation du marchand et raisons de rejet persistées.
6. **Discord** : baseline silencieuse, fingerprint, claim et receipt. Un échec de livraison laisse la transition éligible au cycle suivant.

## Scheduler et watchdogs

Le cron marchand est `* * * * *`. Son handler limité à 10 ms ne fait qu'un hand-off vers Calendar Coordinator ; l'orchestration monitoring et le déclenchement horaire du Web Scout restent dans les Durable Objects. Chaque événement reçu et chaque circuit terminé sont persistés séparément : Fast Watch, Discovery, Web Scout et heartbeats 10h/22h Paris.

Deux sécurités ne dépendent pas du bon déroulement du cycle marchand :

- une alarme du Calendar Coordinator vérifie l'absence de tick après trois minutes et peut assurer une cadence de secours ;
- un workflow GitHub indépendant interroge la santé observée toutes les cinq minutes et limite ses alertes à une par heure.

Le smoke final d'activation refuse la production si deux nouveaux Scheduled Events et un cycle automatique terminé ne sont pas réellement observés.

## Cockpit

L'authentification unique est email + mot de passe + cookie de session géré par Cockpit Auth. L'ancien header `x-op-watch-admin-password` et le mot de passe `sessionStorage` ne sont plus utilisés.

Les corps JSON cockpit sont bufferisés une seule fois, avec une limite de 64 Kio, dans Pages puis dans le Worker. Les single-flights Calendar et Web Scout partagent un snapshot immuable, jamais une même `Response` mono-lecture.

Le health d'une boutique distingue :

- réveil du Durable Object ;
- lecture marchande réellement réussie ;
- dernière Discovery ;
- dernier Fast Watch ;
- candidats observés, qualifiés et rejetés ;
- tentatives/livraisons Discord ;
- raisons de filtrage et incidents de feed.

Une boutique n'est verte qu'après une vraie lecture Fast Watch récente. Une Discovery saine sans fiche promue au polling minute reste orange.

## Connecteurs

Les 24 connecteurs sont assemblés explicitement dans `src/connectors/index.ts`. Six routes sont fail-closed sans flux partenaire :

```text
AUTHORIZED_FEED_PLAYIN_URL
AUTHORIZED_FEED_CULTURA_URL
AUTHORIZED_FEED_MICROMANIA_URL
AUTHORIZED_FEED_FNAC_URL
AUTHORIZED_FEED_CARREFOUR_URL
AUTHORIZED_FEED_KING_JOUET_URL
```

JouéClub, La Grande Récré et BCD Jeux utilisent leur feed autorisé pendant Discovery, puis les fiches directes actives et qualifiées alimentent le Fast Watch minute. Les catalogues volumineux sont lus en streaming. Un feed qui fournit `ETag`/`Last-Modified` peut être revalidé par HTTP 304 ; sans validateur, il n'est jamais retéléchargé toutes les minutes et attend la prochaine Discovery. Les origines protégées restent fail-closed : leur feed autorisé est la seule source et, sans validateur, leur couverture est explicitement affichée comme Discovery plutôt que faussement verte.

## Commandes

```bash
npm ci
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

Les scripts `smoke-preview`, `audit-preview`, `smoke-runtime` et `smoke-scheduler` sont réservés aux environnements isolés GitHub Actions.

## Déploiements

- Worker LIVE : workflow `OP Watch - Production Activation (manual only)`, uniquement depuis `main`, avec confirmation explicite.
- Pages/cockpit : workflow `OP Watch Cockpit Pages (manual)`, même garde-fou.
- Pull Request : preview et runtime-test séparés, Discord dry-run, aucun état de production.
