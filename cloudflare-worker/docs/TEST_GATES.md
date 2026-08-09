# OP Watch V1 — check-list binaire de la VERSION TEST

État au 2026-08-09. Cette check-list ne transforme jamais une dépendance externe en succès.

Verdict courant : **TEST NON VALIDÉ** tant que les lignes `BLOQUÉ` ne sont pas levées.

| Gate | État | Preuve |
|---|---|---|
| A1 — TypeScript valide | PASS | étape `TypeScript check` réussie, run GitHub Actions `31335313909` |
| A2 — build Worker valide | PASS | `wrangler deploy --dry-run` réussi dans le job `Validate code` |
| A3 — dépendances sûres | PASS | `npm audit` : 0 vulnérabilité info/low/moderate/high/critical |
| A4 — aucun secret ou feed privé dans Git | PASS | scan des formats de tokens/webhooks/URLs de feed : aucun résultat ; seuls les noms de secrets sont versionnés |
| A5 — bug critique connu | PASS | aucun bug critique interne connu après correction du prix des fiches indisponibles et nouvel audit réel |
| B1 — tests automatisés | PASS | 118/118, 17 fichiers de tests |
| B2 — langues FR/EN/JP et ambiguïtés | PASS | `matching.test.ts`, `opwatch-v1.test.ts`, `authorized-feed.test.ts` |
| B3 — booster/display/case/double pack/starter | PASS | matrice de qualification dans `opwatch-v1.test.ts` |
| B4 — stock/précommande/rupture/prix | PASS | cycle complet dans `lifecycle-e2e.test.ts` et prix en rupture dans `store-rollout.test.ts` |
| B5 — vendeurs marketplaces fail-closed | PASS | Fnac, Cultura, E.Leclerc, Carrefour et Amazon couverts par les tests feed/rollout |
| B6 — challenges et faux HTTP 200 | PASS | Cloudflare, DataDome, Amazon Robot Check et contenu métier absent dans `challenge-validation.test.ts` |
| B7 — baseline, déduplication et erreurs Discord | PASS | `lifecycle-e2e.test.ts`, `delivery.test.ts`, `state.test.ts` |
| B8 — erreurs réseau/source | PASS | erreurs isolées ; aucun faux changement commercial ; tests audit/Preview |
| C1 — workflow TEST isolé | PASS | `.github/workflows/op-watch-test-preview.yml`, aucun job LIVE, aucun déclencheur `main` |
| C2 — SAFE Preview réellement déployée | PASS | Worker `tcg-watch-one-piece-preview`, job de déploiement réussi dans le run `31335313909` |
| C3 — Preview verrouillée | PASS | `MONITORING_ENABLED=false`, `WRITE_STATE=false`, `DISCORD_MODE=dry-run`, aucun KV, aucun cron |
| C4 — workflow de production | PASS | `TCG Watch - Production Monitor` est `disabled_manually` depuis 2026-08-09 20:01:14 UTC |
| C5 — ancien workflow à chemin LIVE | PASS | `Cloudflare Audit CI` est `disabled_manually` depuis 2026-08-09 21:09:05 UTC |
| D1 — `/` | PASS | réponse `SAFE_PREVIEW`, 21 boutiques, polling automatique désactivé |
| D2 — `/health` | PASS | réponse `ok`, aucun binding d'état, six feeds en attente observables |
| D3 — `/config` | PASS | FR strict, cinq formats, calendrier dynamique, politique d'alertes exacte |
| D4 — `/opwatch/v1/calendar` | PASS | source officielle FR, 8 pages sémantiquement valides, références et fenêtres exactes |
| D5 — routes d'audit protégées | PASS | `/audit` et `/evaluate` exigent le jeton isolé ; smoke test authentifié réussi |
| E1 — calendrier officiel réel | PASS | 13 produits datés parsés ; 8 actifs au run : ST31-36, DP12, OP17 |
| E2 — dates/fenêtres | PASS | ST31-36 : 2026-07-31 ; DP12/OP17 : 2026-08-28 ; J-120/J+30 contrôlés |
| E3 — pages erreur/challenge | PASS | calendrier refusé si source non officielle, challenge HTTP 200 ou dates contradictoires |
| F1 — audit des 21 boutiques exécuté | PASS | 21/21 dans l'artifact `9044161158` |
| F2 — statuts observables et documentés | PASS | 13 saines, 6 pending authorized feed, 2 dégradées dans `STORES_21_AUDIT.md` |
| F3 — couverture commerciale externe complète | **BLOQUÉ** | 0/6 feeds partenaires ; Amazon reste fail-closed sans disponibilité et vendeur confirmés ; Otakuland HTTP 503 et discovery-only |
| G1 — parseur de feeds | PASS | CSV, TSV, JSON, XML ; titre, URL, prix, stock, langue, image, vendeur et identifiant |
| G2 — sécurité des feeds | PASS | HTTPS uniquement, réseaux privés refusés, URL secrète expurgée des erreurs et rapports |
| G3 — feeds partenaires obtenus | **BLOQUÉ** | Playin, Cultura, Micromania, Fnac, Carrefour et King Jouet nécessitent inscription/validation externe |
| H — Otakuland | PASS | HTTP 503 réel ; maintenu discovery-only sans capacité commerciale inventée |
| I — état et déduplication | PASS | baseline → précommande → prix → rupture → retour ; une alerte par transition ; retry après échec Discord |
| J1 — payload Discord final | PASS | boutique, produit, format, référence, prix, langue, disponibilité, heure, image et lien vérifiés |
| J2 — Discord end-to-end SAFE | PASS | chemin de dispatch et réponse webhook simulée 204 ; Preview générale en dry-run, aucun message réel |
| K1 — PR #4 reste Draft | PASS | PR ouverte en Draft ; aucune fusion demandée |
| K2 — `main` inchangée | PASS | base de PR toujours `4358d3fe360111d5ad0386782359970051d4c40e` ; aucun merge/push sur `main` |
| K3 — production activée | PASS | NON |
| L — coût V1 | PASS | aucun service payant ajouté ; GitHub, Cloudflare Free et endpoints publics/autorisés uniquement |

## Blockers exacts avant le verdict 100 %

1. Obtenir et valider les flux partenaires autorisés : 0/6 actuellement. Cela exige des comptes éditeur, l'acceptation de CGU et/ou une validation des marchands.
2. Après réception de chaque feed : le stocker en secret, exécuter sa recette FR/stock/prix/image/URL/vendeur, ajouter les régressions et relancer l'audit Preview.

Amazon peut osciller entre source lisible et source dégradée. Lors du run `31336313582`, sa source était techniquement saine mais aucun produit n'était commercialement qualifié : disponibilité inconnue et vendeur Amazon non confirmé. Otakuland restait dégradé en HTTP 503. Ces états ne sont pas masqués et ne peuvent générer ni fausse rupture ni fausse alerte.
