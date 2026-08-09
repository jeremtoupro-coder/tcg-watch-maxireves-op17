# OP Watch — audit des 21 boutiques

Date : 2026-08-09

## Verdict court

Les 21 boutiques demandées sont désormais enregistrées dans OP Watch V1 TEST. Aucune n'est oubliée dans la configuration.

Le dernier audit strict a été exécuté depuis le vrai runtime Cloudflare, et non déduit d'un simple accès depuis un navigateur ou un moteur de recherche.

- 21/21 boutiques : intégrées dans la configuration SAFE TEST.
- 13/21 : sources HTTP actuellement lisibles et sémantiquement valides depuis Cloudflare.
- 8/21 : intégrées mais actuellement dégradées/quarantinées ; elles ne doivent pas produire de changement de stock tant que leur accès n'est pas fiable.
- LIVE général : toujours désactivé.

Un HTTP 200 n'est désormais plus considéré comme une réussite en soi. Le moteur rejette aussi les pages de challenge, Robot Check/CAPTCHA et les réponses qui ne contiennent pas le contenu métier attendu.

## Audit runtime de référence

Dernier audit complet après durcissement sémantique :

- workflow : `All Stores Runtime Audit`
- run : `31324809174`
- job : `93273369456`
- conclusion : `success`
- tests : 61 tests passés
- artifact : `9041228473`
- runtime : Cloudflare Worker réel
- configuration pendant l'audit : SAFE, aucune écriture KV commerciale, aucun Discord LIVE
- à la fin de l'audit, la preview verrouillée SAFE a été redéployée.

Le succès du workflow signifie que l'audit a été exécuté correctement et que les dégradations ont été enregistrées. Il ne signifie PAS que les 21 boutiques sont toutes techniquement accessibles.

## Matrice des 21 boutiques

| Boutique | Incluse | Runtime Cloudflare | Candidats observés lors du dernier audit | Statut / règle |
|---|---:|---|---:|---|
| Maxi Rêves | oui | sain | 0 | HTTP simple validé ; absence de candidat à cet instant ≠ absence de catalogue |
| Oupi | oui | sain | 12 | direct-page truth validée ; 2 candidats FR pendant l'audit |
| PixelHeart | oui | sain | 4 | 3 FR, 3 actionnables pendant l'audit |
| Fantasy Sphere | oui | sain | 12 | 10 FR ; fiches directes publiques prises en charge |
| Ludisphere | oui | **dégradé** | 0 | HTTP 429 depuis Cloudflare, y compris lors d'essais sur des fiches OP17 directes |
| Parkage | oui | sain | 0 | sources One Piece répondent et passent la validation sémantique |
| UltraJeux | oui | sain | 2 | réponses lisibles ; 0 FR reconnu sur l'échantillon du run |
| Playin | oui | **dégradé** | 0 | fiches témoins HTTP 403 ; Browser Run aboutit à une page de challenge Cloudflare |
| Philibert | oui | sain | 2 | catégorie française lisible ; qualification FR reste stricte |
| Cultura | oui | **dégradé** | 0 | fiches témoins HTTP 403 ; Browser Run aboutit à un challenge Cloudflare |
| Micromania | oui | **dégradé** | 0 | certaines routes répondent HTTP 200 mais sans contenu One Piece exploitable ; désormais rejetées comme faux HTTP 200 |
| Fnac | oui | **dégradé** | 0 | fiches directes HTTP 403 ; Browser Run rencontre DataDome/CAPTCHA ; vendeur Fnac doit en plus être confirmé |
| E.Leclerc | oui | sain | 0 | route de recherche lisible ; marketplace : vendeur E.Leclerc/SNC LCOMMERCE requis sur fiche directe avant alerte |
| Carrefour | oui | **dégradé** | 0 | simple HTTP 403 ; Browser Run renvoie une page de vérification humaine et non une vraie fiche produit |
| King Jouet | oui | **dégradé** | 0 | sources testées HTTP 403 ; Browser Run rencontre DataDome/CAPTCHA |
| JouéClub | oui | sain | 0 | catégorie One Piece lisible ; aucun stock n'est inventé si les données Angular ne sont pas résolues |
| Amazon FR | oui | sain au niveau source | 0 | Robot Check/CAPTCHA est explicitement rejeté ; vendeur/expéditeur Amazon requis avant alerte commerciale |
| Mystic-Ambre | oui | sain | 2 | 1 FR observé pendant l'audit |
| Ludiworld | oui | sain au niveau source | 0 | aucune route TCG suffisamment fiable validée ; alertes commerciales volontairement désactivées jusqu'à preuve contraire |
| VegaStore | oui | sain | 1 | 1 FR observé ; storefront Shopify public |
| Otakuland | oui | **dégradé** | 0 | routes testées HTTP 503 ; Browser Run finit sur erreur réseau ; aucun TCG One Piece fiable observé, mode découverte uniquement |

## Les 8 sources actuellement dégradées

1. Ludisphere — 429 depuis le runtime Cloudflare.
2. Playin — 403 / challenge Cloudflare.
3. Cultura — 403 / challenge Cloudflare.
4. Micromania — HTTP 200 trompeur sans contenu métier One Piece exploitable.
5. Fnac — 403 puis DataDome/CAPTCHA avec Browser Run.
6. Carrefour — 403 ; Browser Run = page de vérification humaine, pas fiche produit.
7. King Jouet — 403 puis DataDome/CAPTCHA avec Browser Run.
8. Otakuland — HTTP 503 / erreur réseau dans le test navigateur.

Ces huit boutiques restent dans OP Watch afin de ne pas être oubliées, mais leur état de source doit rester `degraded` jusqu'à ce qu'une voie publique fiable soit validée.

## Ce que l'audit a permis de corriger

### 1. HTTP 200 n'est plus synonyme de réussite

Micromania et certains anti-bots ont montré qu'une réponse HTTP 200 peut contenir un shell vide, une page Robot Check ou autre contenu qui n'est pas le catalogue attendu.

Chaque connecteur peut maintenant imposer des marqueurs sémantiques (`responseMustContainAny`). Si le contenu attendu n'est pas présent, la source passe en erreur au lieu de générer un faux état de stock.

### 2. Challenge/CAPTCHA détecté avant parsing

Le moteur reconnaît notamment :

- Cloudflare `Just a moment...` / challenge markup ;
- DataDome CAPTCHA ;
- Amazon Robot Check / validateCaptcha ;
- pages de vérification humaine / access denied ;
- pages d'erreur réseau Chromium.

Une page de challenge ne peut donc pas être interprétée comme une vraie fiche en rupture ou disponible.

### 3. Marketplaces en fail-closed

Pour Fnac, E.Leclerc, Carrefour et Amazon FR, une carte catalogue ne suffit pas. La fiche directe doit confirmer le vendeur attendu avant qu'un candidat puisse être commercialement éligible.

### 4. Dégradation isolée

Une boutique dégradée ne doit ni écraser son ancien état valide ni faire croire à une rupture. Elle est isolée du traitement commercial pendant le cycle.

### 5. Browser Run n'est pas considéré comme une baguette magique

Un test Browser Run a été tenté uniquement comme diagnostic public et sans contournement de CAPTCHA. Il n'a pas permis de rendre fiables Playin, Cultura, Fnac, King Jouet ou Otakuland. Carrefour a chargé beaucoup de HTML, mais l'analyse sémantique a montré qu'il s'agissait d'une page de vérification humaine, pas de la fiche produit.

Aucune de ces réponses n'a été marquée comme succès artificiellement.

## Interprétation des `0 candidats`

`0 candidat` ne veut pas dire `0 produit One Piece sur la boutique`.

Le run mesure le comportement du connecteur avec les références / témoins actuellement présents dans le moteur. La généralisation complète `calendrier officiel dynamique -> références actives -> discovery propre à chaque boutique` reste une étape distincte avant LIVE.

La métrique importante de cet audit est d'abord : la source fournit-elle une réponse réelle, fiable et exploitable sans masquer un challenge ou une erreur ?

## État de sécurité actuel

- `MONITORING_ENABLED=false`
- `WRITE_STATE=false`
- `DISCORD_MODE=dry-run`
- routes publiques d'audit refermées après chaque audit
- aucune PR fusionnée dans `main`
- aucune tentative de bypass d'authentification ou de CAPTCHA
- aucun proxy payant ajouté

## Verdict

**21/21 INTEGRATED IN SAFE TEST: YES**

**21/21 RUNTIME SOURCE-VALIDATED: NO — 13/21 actuellement valides, 8/21 dégradées**

**READY FOR LIVE: NO**

Le refus du LIVE est volontaire : OP Watch doit continuer à distinguer une boutique techniquement intégrée d'une boutique réellement surveillable avec une confiance suffisante.
