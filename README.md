# OP Watch

OP Watch est un radar personnel pour les sorties françaises du One Piece Card Game. Il combine le calendrier officiel Bandai, 24 connecteurs marchands, un Fast Watch minute, une Discovery au quart d'heure, le circuit historique **ONE PIECE ALL**, Web Scout et Discord.

## État de référence

- `main` est la seule source de vérité de production.
- Worker : `tcg-watch-one-piece`.
- Cockpit : `https://op-watch-tcg-fr.pages.dev/cockpit/`.
- L'état `SCHEDULER_MODE=live` ne prouve pas qu'un cron s'exécute. Le cockpit distingue désormais la configuration des événements réellement observés.
- Le rapport d'incident et les preuves datées sont dans [`cloudflare-worker/docs/PRODUCTION_RELIABILITY_AUDIT_2026-08-15.md`](cloudflare-worker/docs/PRODUCTION_RELIABILITY_AUDIT_2026-08-15.md).

Les rapports datés plus anciens sous `cloudflare-worker/docs/` sont conservés comme archives. Ils ne décrivent pas nécessairement la production actuelle.

## Principes de sûreté

- aucun contournement CAPTCHA, Cloudflare ou DataDome ;
- un challenge, HTTP 403/429/5xx ou contenu métier absent dégrade une source et ne devient jamais une rupture ;
- français explicitement confirmé et vendeur marketplace requis lorsqu'il est configuré ;
- première collecte silencieuse ;
- une transition Discord n'est validée qu'après livraison confirmée ;
- aucun déploiement Worker ou Pages automatique après un merge : les deux activations exigent une action manuelle et une phrase de confirmation sur `main`.

## Vérification

```bash
cd cloudflare-worker
npm ci
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

Les Pull Requests déploient uniquement des Workers de test isolés : Discord reste en dry-run, l'état de production n'est pas utilisé et le cron de test est retiré après la preuve de deux événements automatiques successifs.

## Documentation utile

- [Architecture et exploitation](cloudflare-worker/README.md)
- [État de production](cloudflare-worker/docs/PRODUCTION_LIVE_STATUS.md)
- [Flux partenaires](cloudflare-worker/docs/PARTNER_FEEDS.md)
- [Politique d'alertes](cloudflare-worker/docs/gestion-alertes.md)
