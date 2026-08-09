# OP Watch

OP Watch surveille les sorties françaises du One Piece Card Game et prépare des alertes de nouvelle fiche, précommande, stock, rupture et prix.

La V1 en cours est développée uniquement sur `op-watch-v1-test` dans la PR #4. `main` et le LIVE ne doivent pas être modifiés ou activés avant une validation distincte.

## État de la version test

- source calendrier : catalogue officiel français One Piece Card Game ;
- fenêtre : J-120 à J+30 ;
- formats : booster, display, case, double pack et starter deck ;
- langue commerciale : français explicitement confirmé uniquement ;
- boutiques : 21/21 déclarées, sans retrait silencieux ;
- anti-bot : aucun contournement ; les challenges HTTP 200 sont des erreurs source ;
- marketplaces : vendeur officiel obligatoire ;
- première collecte : baseline silencieuse ;
- Preview : Worker Cloudflare séparé, sans KV, cron ni Discord live ;
- production : non activée ; le workflow de production actuellement présent sur `main` a été désactivé manuellement dans GitHub Actions le 2026-08-09, et sa version de branche est en plus protégée par `OP_WATCH_PRODUCTION_ENABLED`.

Le moteur TypeScript se trouve dans [`cloudflare-worker`](cloudflare-worker/README.md). Le watcher Python historique reste présent comme archive de la première version Maxi Rêves ; ce n'est plus la source d'architecture de la V1.

## Vérification locale

```bash
cd cloudflare-worker
npm ci
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

Le lockfile est versionné et les dépendances sont épinglées. Aucun secret ne doit être placé dans Git.

## Workflows

- `OP Watch Test CI and Safe Preview` (`.github/workflows/op-watch-test-preview.yml`) : validation de la branche test, déploiement du Worker `tcg-watch-one-piece-preview`, smoke test et audit réel des 21 boutiques.
- `OP Watch - Production Monitor (gated)` : reste inactif tant que la variable GitHub `OP_WATCH_PRODUCTION_ENABLED` n'est pas explicitement égale à `true` sur `main`.

L'ancien workflow `Cloudflare Audit CI` est séparé de la branche TEST et doit être désactivé tant que le LIVE est interdit.

Le workflow test ne contient aucun chemin de déploiement LIVE.

## Documentation de référence

- [Architecture et exploitation](cloudflare-worker/README.md)
- [État des 21 boutiques](cloudflare-worker/docs/STORES_21_AUDIT.md)
- [Check-list binaire VERSION TEST](cloudflare-worker/docs/TEST_GATES.md)
- [Flux partenaires autorisés](cloudflare-worker/docs/PARTNER_FEEDS.md)
- [Déploiement SAFE Preview](cloudflare-worker/docs/deploiement-preview.md)
- [Politique des alertes](cloudflare-worker/docs/gestion-alertes.md)

Les autres rapports datés du dossier `docs/` sont des preuves historiques et peuvent décrire un état antérieur.
