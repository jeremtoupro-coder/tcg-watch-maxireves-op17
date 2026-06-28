# Prévisualisation du gestionnaire planifié

Cette version contient le gestionnaire `scheduled`, mais il reste inactif :

- aucun Cron Trigger configuré ;
- `MONITORING_ENABLED=false` ;
- `WRITE_STATE=false` ;
- Discord en `dry-run` ;
- binding KV généré automatiquement au déploiement.

Les boutiques Cloudflare sont réparties une par minute lorsque la surveillance sera activée, afin de réduire le temps CPU de chaque invocation.
