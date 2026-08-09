# OP Watch — audit réel des 21 boutiques

Date du contrôle : 2026-08-09 à 20:53:17 UTC.

## Résultat binaire

L'audit a été exécuté depuis le Worker Cloudflare SAFE Preview réellement déployé, sur le commit `6bcd77e372435cb015db507f915f3417f33cc8d3` de `op-watch-v1-test`.

- 21/21 boutiques auditées ; aucune boutique retirée silencieusement.
- 13 sources saines, 6 en attente d'un flux autorisé, 2 dégradées.
- 13 boutiques sont configurées `active_fast_watch`, mais 12 étaient réellement capables de Fast Watch pendant ce run : Amazon a renvoyé un faux HTTP 200 sans contenu métier.
- 2 boutiques sont configurées `discovery_only` : Ludiworld est lisible mais sans route TCG One Piece validée ; Otakuland répond HTTP 503.
- 6/6 boutiques protégées restent `pending_authorized_feed` et leur origine n'est pas interrogée.
- 237 produits structurés observés, dont 121 avec français confirmé, 232 avec prix et 74 candidats commercialement stricts avant filtrage par la fenêtre du calendrier officiel.
- 0/6 flux partenaires configurés au moment du contrôle.
- production, KV et Discord LIVE : désactivés.

Un succès du workflow signifie que le contrôle s'est correctement terminé. Il ne transforme ni une source dégradée ni un flux externe manquant en succès commercial.

## Preuves d'exécution

- workflow : `OP Watch Test CI and Safe Preview` ;
- fichier : `.github/workflows/op-watch-test-preview.yml` ;
- run : [31335313909](https://github.com/jeremtoupro-coder/tcg-watch-maxireves-op17/actions/runs/31335313909) ;
- jobs `Validate code` et `Deploy and audit isolated preview` : `success` ;
- artifact : `op-watch-safe-preview-audit-31335313909`, ID `9044161158` ;
- mode du rapport : `SAFE_PREVIEW_READ_ONLY_AUDIT` ;
- configuration : `MONITORING_ENABLED=false`, `WRITE_STATE=false`, `DISCORD_MODE=dry-run`, aucun KV, aucun cron.

## Matrice opérationnelle

`Commercial strict` est le nombre de produits qui satisfaisaient simultanément les règles source, langue FR, disponibilité connue et vendeur officiel lorsqu'il est requis. Le calendrier officiel et les formats cibles sont encore appliqués ensuite par le moteur d'alerte.

| Boutique | Statut configuré | Runtime | Source utilisée | Fast Watch réel | Discovery réel | Commercial strict | Verdict |
|---|---|---|---|---:|---:|---:|---|
| Maxi Rêves | active Fast Watch | sain | HTML public WooCommerce, 9 URLs | oui | oui | 7 | opérationnel |
| Oupi | active Fast Watch | sain | HTML public PrestaShop, 21 URLs | oui | oui | 13 | opérationnel |
| PixelHeart | active Fast Watch | sain | HTML public, 8 URLs | oui | oui | 3 | opérationnel |
| Fantasy Sphere | active Fast Watch | sain | fiches HTML publiques, 12 URLs | oui | oui | 10 | opérationnel |
| Ludisphere | active Fast Watch | sain | flux Shopify JSON public, 1 URL | oui | oui | 33 | opérationnel |
| Parkage | active Fast Watch | sain | HTML public, 3 URLs | oui | oui | 0 | source valide, aucun produit reconnu au run |
| UltraJeux | active Fast Watch | sain | HTML public, 21 URLs | oui | oui | 1 | opérationnel |
| Playin | pending authorized feed | en attente | aucune ; `AUTHORIZED_FEED_PLAYIN_URL` absent | non | non | 0 | bloqué par flux autorisé manquant |
| Philibert | active Fast Watch | sain | HTML public, 6 URLs | oui | oui | 3 | opérationnel |
| Cultura | pending authorized feed | en attente | aucune ; `AUTHORIZED_FEED_CULTURA_URL` absent | non | non | 0 | bloqué par flux autorisé manquant |
| Micromania | pending authorized feed | en attente | aucune ; `AUTHORIZED_FEED_MICROMANIA_URL` absent | non | non | 0 | bloqué par flux autorisé manquant |
| Fnac | pending authorized feed | en attente | aucune ; `AUTHORIZED_FEED_FNAC_URL` absent | non | non | 0 | bloqué par flux et vendeur Fnac manquants |
| E.Leclerc | active Fast Watch | sain | recherche et fiches HTML publiques, 8 URLs | oui | oui | 0 | lisible ; fail-closed car vendeur E.Leclerc non confirmé |
| Carrefour | pending authorized feed | en attente | aucune ; `AUTHORIZED_FEED_CARREFOUR_URL` absent | non | non | 0 | bloqué par flux et vendeur Carrefour manquants |
| King Jouet | pending authorized feed | en attente | aucune ; `AUTHORIZED_FEED_KING_JOUET_URL` absent | non | non | 0 | bloqué par flux autorisé manquant |
| JouéClub | active Fast Watch | sain | catégorie HTML publique, 1 URL | oui | oui | 0 | source valide, aucun produit reconnu au run |
| Amazon FR | active Fast Watch | dégradé | recherche HTML publique, 1 URL | non | non | 0 | faux HTTP 200 rejeté ; vendeur Amazon non confirmé |
| Mystic-Ambre | active Fast Watch | sain | HTML public, 8 URLs | oui | oui | 3 | opérationnel |
| Ludiworld | discovery-only | sain | racine HTML publique, 1 URL | non | oui | 0 | aucune route TCG One Piece validée |
| VegaStore | active Fast Watch | sain | collection et fiche Shopify publiques, 2 URLs | oui | oui | 1 | opérationnel |
| Otakuland | discovery-only | dégradé | deux routes HTML publiques | non | non | 0 | HTTP 503 sur les deux routes |

## Données observées

| Boutique | Produits | Références reconnues | Langue | Disponibilité | Prix | Image | Vendeur attendu/confirmé | Latence | Erreur source |
|---|---:|---|---|---|---:|---:|---|---:|---|
| Maxi Rêves | 7 | OP10 ; ST20/31/33-36 | FR | disponible 7/7 | 7 | 7 | n/a | 11 195 ms | aucune |
| Oupi | 124 | DP02/05/06/08/10 ; EB01-04 ; OP01-17 ; PRB01-02 ; ST06/08/10/11/14-36 ; TS01-02 | EN, FR, inconnue | connue 124/124 | 124 | 124 | n/a | 7 794 ms | aucune |
| PixelHeart | 6 | EB05 ; OP16-18 | EN, FR | connue 6/6 | 6 | 6 | n/a | 3 169 ms | aucune |
| Fantasy Sphere | 17 | EB02 ; OP17-18 ; ST34-36 | FR, inconnue | connue 10/17 | 17 | 17 | n/a | 3 349 ms | aucune |
| Ludisphere | 45 | EB02-03 ; OP08-17 ; PRB01-02 ; ST15-21/23-30 | EN, FR | connue 45/45 | 45 | 45 | n/a | 242 ms | aucune |
| Parkage | 0 | aucune | aucune | n/a | 0 | 0 | n/a | 1 867 ms | aucune |
| UltraJeux | 19 | OP16 ; ST30-36 | EN, FR, inconnue | connue 19/19 | 19 | 19 | n/a | 5 850 ms | aucune |
| Playin | 0 | aucune | aucune | n/a | 0 | 0 | n/a | 0 ms | flux absent, origine non interrogée |
| Philibert | 5 | OP13/16/17 | FR | connue 3/5 | 5 | 5 | n/a | 1 977 ms | aucune |
| Cultura | 0 | aucune | aucune | n/a | 0 | 0 | Cultura : 0 confirmé | 0 ms | flux absent, origine non interrogée |
| Micromania | 0 | aucune | aucune | n/a | 0 | 0 | n/a | 0 ms | flux absent, origine non interrogée |
| Fnac | 0 | aucune | aucune | n/a | 0 | 0 | Fnac : 0 confirmé | 0 ms | flux absent, origine non interrogée |
| E.Leclerc | 7 | OP02/10/11/12 | FR, inconnue | connue 7/7 | 2 | 7 | E.Leclerc : 0 confirmé | 3 520 ms | aucune ; données commerciales mises en quarantaine |
| Carrefour | 0 | aucune | aucune | n/a | 0 | 0 | Carrefour : 0 confirmé | 0 ms | flux absent, origine non interrogée |
| King Jouet | 0 | aucune | aucune | n/a | 0 | 0 | n/a | 0 ms | flux absent, origine non interrogée |
| JouéClub | 0 | aucune | aucune | n/a | 0 | 0 | n/a | 550 ms | aucune |
| Amazon FR | 0 | aucune | aucune | n/a | 0 | 0 | Amazon : 0 confirmé | 392 ms | HTTP 200 sans contenu métier attendu |
| Mystic-Ambre | 6 | EB06 ; OP11/18/19 | EN, FR | connue 6/6 | 6 | 6 | n/a | 9 522 ms | aucune |
| Ludiworld | 0 | aucune | aucune | n/a | 0 | 0 | n/a | 1 183 ms | aucune ; offre TCG non trouvée |
| VegaStore | 1 | OP17 | FR | connue 1/1 | 1 | 1 | n/a | 485 ms | aucune |
| Otakuland | 0 | aucune | aucune | n/a | 0 | 0 | n/a | 421 ms | HTTP 503 × 2 |

## Règles de sûreté validées par le run

- Une réponse HTTP 200 sans contenu métier attendu est une erreur source : Amazon a été dégradé, pas déclaré en rupture.
- Les pages Cloudflare, DataDome, Incapsula, Robot Check et CAPTCHA sont rejetées avant parsing.
- Une erreur réseau ne remplace pas le dernier état commercial valide.
- Les origines Playin, Cultura, Micromania, Fnac, Carrefour et King Jouet ne sont pas pollées sans feed partenaire autorisé.
- Fnac, Carrefour, E.Leclerc et Amazon restent fail-closed tant que le vendeur attendu n'est pas confirmé.
- Les données EN, JP ou ambiguës ne deviennent pas des alertes FR.
- Otakuland reste discovery-only et dégradé ; aucune capacité commerciale n'est inventée.

## Verdict de cet audit

**AUDIT 21/21 EXÉCUTÉ : OUI**

**21/21 SOURCES COMMERCIALES OPÉRATIONNELLES : NON — 13 saines, 6 en attente, 2 dégradées**

**READY FOR LIVE : NON**
