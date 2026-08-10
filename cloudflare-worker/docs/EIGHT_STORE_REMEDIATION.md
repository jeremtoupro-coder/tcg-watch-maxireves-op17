# OP Watch — remédiation des 8 boutiques dégradées

Date : 2026-08-09
Branche : `op-watch-v1-test`
LIVE : **NON**

## Résultat

Les huit boutiques qui étaient rouges ont été traitées sans contourner CAPTCHA, DataDome, Cloudflare ou une API privée.

### 1. Ludisphere — corrigé techniquement

Le domaine public expose un flux Shopify JSON de collection. Le domaine canonique Shopify public `020d06-2.myshopify.com` a été identifié puis testé depuis le runtime Cloudflare.

OP Watch utilise désormais :

`/collections/one-piece-card-game-precommande/products.json?limit=250`

Le moteur normalise ce JSON vers le modèle de candidats OP Watch (titre, référence, prix, disponibilité des variantes, image, URL produit).

Validation end-to-end Cloudflare :
- workflow run : `31326891123`
- job : `93278581812`
- Ludisphere : 1/1 source saine
- 2 candidats détectés
- 2 candidats FR
- 0 erreur

Verdict : **FIXED**.

### 2. Otakuland — corrigé en mode de surveillance

Le site renvoie actuellement HTTP 503 depuis plusieurs sorties réseau et les endpoints Woo Store publics renvoient eux aussi 503. Aucun produit One Piece TCG fiable n'a été identifié dans les observations actuelles.

Otakuland reste donc dans les 21 boutiques, mais `commercialAlertsEnabled=false`. Il est traité en découverte uniquement, toutes les 15 minutes, au lieu d'être interrogé chaque minute et de polluer Fast Watch avec une panne permanente.

Verdict : **DISCOVERY-ONLY, fail-safe**.

### 3 à 8. Playin, Cultura, Micromania, Fnac, Carrefour, King Jouet

Les essais directs ont confirmé des protections d'origine :
- Playin : Cloudflare 403 / `Just a moment...`
- Cultura : Cloudflare 403
- Micromania : shell Incapsula HTTP 200 sans contenu produit
- Fnac : DataDome / 403
- Carrefour : challenge Cloudflare / vérification humaine
- King Jouet : DataDome / 403 ; endpoints catalogue documentés nécessitant une autorisation (401)

Les sorties GitHub et Cloudflare donnent le même diagnostic. Un Reader public testé sur Playin renvoie lui aussi la page de challenge enveloppée en HTTP 200 ; OP Watch la rejette désormais explicitement.

Pour ces six boutiques, la stratégie Fast Watch a été remplacée par une entrée **flux produit partenaire autorisé** : CSV, TSV, JSON ou XML. Le parseur accepte les champs usuels de titre, URL, prix, stock, langue, image, vendeur et identifiants. L'URL du flux est stockée comme secret Cloudflare et n'est jamais exposée dans les audits.

Secrets prévus :
- `AUTHORIZED_FEED_PLAYIN_URL`
- `AUTHORIZED_FEED_CULTURA_URL`
- `AUTHORIZED_FEED_MICROMANIA_URL`
- `AUTHORIZED_FEED_FNAC_URL`
- `AUTHORIZED_FEED_CARREFOUR_URL`
- `AUTHORIZED_FEED_KING_JOUET_URL`

Tant qu'un secret n'est pas configuré, OP Watch **n'interroge plus l'origine protégée toutes les minutes**. La boutique apparaît dans `pendingAuthorizedFeedStores` au lieu d'être faussement traitée comme rupture ou panne commerciale.

Fnac et Carrefour restent fail-closed : le vendeur officiel doit être explicitement confirmé dans le flux avant toute alerte commerciale.

Verdict : **CODE READY / EXTERNAL FEED ACCESS REQUIRED**.

## Protections ajoutées

- Détection des pages Cloudflare, DataDome, Amazon Robot Check et vérification humaine.
- Détection des challenges enveloppés par un service Reader HTTP 200.
- Jamais de transformation d'une erreur source en rupture de stock.
- Pas d'écrasement d'état valide lorsqu'une boutique est dégradée.
- Marketplace : vendeur officiel obligatoire.
- URL de flux partenaire masquée dans les diagnostics.
- Fast Watch et Discovery séparés.
- Origines anti-bot non martelées lorsque le flux autorisé manque.

## Validation CI finale de cette phase

Run de référence après intégration des flux autorisés et des tests de sécurité :
- workflow : `Cloudflare Audit CI`
- run : `31328265227`
- job : `93282137593`
- TypeScript : success
- tests : **82/82 passed**
- Wrangler dry-run : success
- déploiement LIVE : skipped

## État réel

- Ludisphere : **corrigé et techniquement exploitable**.
- Otakuland : **corrigé comme source discovery-only** ; pas de faux Fast Watch.
- Playin / Cultura / Micromania / Fnac / Carrefour / King Jouet : **moteur corrigé, accès commercial en attente des URLs de flux autorisées**.
- Les 21 boutiques restent déclarées dans OP Watch.
- `main` n'est pas modifié.
- LIVE reste désactivé.

Le point restant n'est plus un problème de parsing ou de code : pour les six origines protégées, il faut obtenir une source produit autorisée auprès du marchand ou de son réseau partenaire. OP Watch est désormais prêt à l'ingérer sans nouvelle refonte.
