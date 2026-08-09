# Déploiement SAFE Preview

Date de mise à jour : 2026-08-09.

La branche `op-watch-v1-test` déclenche uniquement le workflow `OP Watch Test CI and Safe Preview`.

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

`ALLOW_PUBLIC_AUDIT=true` n'ouvre pas les routes : `/audit` et `/evaluate` exigent aussi `PREVIEW_AUDIT_TOKEN`, généré aléatoirement à chaque run et installé comme secret Cloudflare. Sans ce jeton, la réponse doit être HTTP 401.

## Gates du workflow

1. installation via `npm ci` ;
2. TypeScript ;
3. tous les tests Vitest ;
4. build Wrangler `--dry-run` ;
5. génération de config et assertion de sûreté ;
6. déploiement du Worker dédié ;
7. smoke test sémantique de `/`, `/health`, `/config`, `/opwatch/v1/calendar` et de l'authentification `/audit` ;
8. audit réel en lecture seule des 21 boutiques ;
9. conservation du rapport comme artifact GitHub.

Le workflow ne contient aucun job `deploy-live`, aucune initialisation de KV et aucune simulation sur l'état de production.
