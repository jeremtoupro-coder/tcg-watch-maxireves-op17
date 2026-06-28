# Déploiement de prévisualisation

Date : 27 juin 2026.

Cette version est déployée avec les protections suivantes :

- aucun cron ;
- aucune écriture KV ;
- Discord en mode `dry-run` ;
- aucune URL de webhook ;
- routes `/audit` et `/evaluate` désactivées publiquement ;
- seules les routes d'information `/`, `/health` et `/config` sont accessibles.

Le déploiement cible le Worker `tcg-watch-one-piece` déjà créé dans le tableau de bord Cloudflare.
