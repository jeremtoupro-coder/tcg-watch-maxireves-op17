# Déploiement SAFE Preview

Date de mise à jour : 2026-08-09.

La branche `op-watch-v1-test` déclenche uniquement le workflow `OP Watch Test CI and Safe Preview`, défini dans `.github/workflows/op-watch-test-preview.yml`.

## Cible isolée

- nom Worker : `tcg-watch-one-piece-preview` ;
- URL attendue : `https://tcg-watch-one-piece-preview.jeremie-touitou-pro.workers.dev` ;
- aucun remplacement du Worker `tcg-watch-one-piece` ;
- aucun binding KV ;
- aucun cron ;
- aucun webhook Discord fourni au job.

## Variables forcées

```text
MONITORING_ENABLED=false
WRITE_STATE=false
DISCORD_MODE=dry-run
ALLOW_PUBLIC_AUDIT=true
```

`ALLOW_PUBLIC_AUDIT=true` n'ouvre pas les routes : `/audit` et `/evaluate` exigent aussi `PREVIEW_AUDIT_TOKEN`, installé comme secret Cloudflare. Le jeton est dérivé par HMAC du credential de déploiement avec un contexte dédié : le credential Cloudflare n'est ni transmis au Worker, ni écrit dans un fichier, ni affiché dans les logs. La valeur dédiée reste stable entre deux déploiements afin que les anciennes et nouvelles versions acceptent la même authentification pendant la propagation Cloudflare. Sans ce jeton, la réponse doit être HTTP 401.

## Gates du workflow

1. installation via `npm ci` ;
2. TypeScript ;
3. tous les tests Vitest ;
4. build Wrangler `--dry-run` ;
5. génération de config et assertion de sûreté ;
6. déploiement du Worker dédié et installation du secret d'audit ;
7. huit contrôles authentifiés consécutifs pour exclure une version Cloudflare encore ancienne ;
8. smoke test sémantique de `/`, `/health`, `/config`, `/opwatch/v1/calendar` et de l'authentification `/audit` ;
9. audit réel en lecture seule des 21 boutiques ;
10. conservation du rapport comme artifact GitHub.

Le workflow ne contient aucun job `deploy-live`, aucune initialisation de KV et aucune simulation sur l'état de production.

## Séparation avec les workflows historiques

- Le workflow TEST possède désormais son propre chemin et son propre identifiant GitHub Actions ; un commit de `op-watch-v1-test` ne déclenche aucun chemin LIVE.
- Le workflow `OP Watch - Production Monitor` actuellement visible depuis `main` a été désactivé manuellement dans GitHub Actions le 2026-08-09. Il ne doit pas être réactivé avant une validation LIVE distincte.
- L'ancien workflow `Cloudflare Audit CI`, défini sur `main` dans `.github/workflows/cloudflare-audit-ci.yml` et historiquement lié à `cloudflare-workers-audit`, est indépendant du nouveau workflow TEST. Il doit être désactivé au niveau GitHub avant le verdict final, car son ancien code contient un chemin de déploiement LIVE par commit magique.

Run de référence après isolation : [31335313909](https://github.com/jeremtoupro-coder/tcg-watch-maxireves-op17/actions/runs/31335313909), deux jobs réussis et artifact d'audit `9044161158`.
