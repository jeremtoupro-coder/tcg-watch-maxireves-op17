# Initialisation de la base KV

Cette opération ponctuelle initialise silencieusement les boutiques suivantes :

- Maxi Rêves ;
- Ludotrotter ;
- Oupi.

Garanties :

- aucun message Discord envoyé ;
- aucune activation de cron ;
- aucune initialisation Fantasy Sphere tant que son pipeline sitemap n'est pas finalisé ;
- une réexécution est sans effet si les marqueurs de base sont déjà présents.
