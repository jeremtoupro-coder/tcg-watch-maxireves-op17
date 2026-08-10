# Flux partenaires officiels des six boutiques protégées

État vérifié le 2026-08-10. Aucun CAPTCHA, challenge, endpoint privé ou URL supposée n'a été contourné.

## Ce que signifie « accès partenaire »

Il ne s'agit pas d'une autorisation de scraper ni d'un contact personnel avec la direction des boutiques. Il s'agit d'un compte éditeur sur un réseau d'affiliation officiel, puis d'une candidature au programme du marchand. Une fois acceptée, la plateforme peut fournir un flux catalogue prévu pour les éditeurs.

- Awin couvre la voie partenaire de Cultura et Fnac ; compte Publisher OP Watch validé, candidatures Cultura FR et Fnac FR envoyées le 2026-08-10 ;
- une candidature E.Leclerc FR a également été envoyée sur Awin ; E.Leclerc ne fait pas partie des six boutiques protégées mais son flux pourra améliorer la qualité de la source et le suivi du vendeur direct ;
- Kwanko couvre la voie partenaire de Micromania et Carrefour ; validation du compte Publisher encore attendue ;
- Playin utilise officiellement Affilae pour son programme d'affiliation et affiche « Devenir affilié » sur son site ; l'inscription éditeur Affilae est gratuite ;
- King Jouet n'expose actuellement aucun programme/flux éditeur public fiable : la seule voie autorisée identifiée reste une demande directe de flux/API partenaire via leur contact officiel ;
- Amazon FR est volontairement différé et reste fail-closed.

Aucun appel téléphonique n'est requis. Une inscription peut toutefois demander l'identité du propriétaire, un support de diffusion, l'acceptation de CGU et une validation du marchand. Même après acceptation, un flux n'est déclaré fonctionnel que s'il contient réellement les champs nécessaires à OP Watch.

| Boutique | Voie officielle trouvée | Accès actuel | Suite nécessaire |
|---|---|---|---|
| Playin | Affilae ; le site Playin déclare Affilae comme outil de son affiliation commerciale et affiche « Devenir affilié » | Compte Affilae OP Watch à créer puis candidature Playin | Une fois accepté, vérifier si Playin met un flux produits à disposition ; ne pas interroger l'origine en attendant |
| Cultura | Programme Cultura FR sur Awin, ID 113876 | Compte Publisher Awin validé ; candidature Cultura envoyée le 2026-08-10 | Après validation marchand, récupérer le flux produits avec stock, prix, image et vendeur |
| Micromania | Programme officiel Micromania relayé par Kwanko | Validation du compte Publisher Kwanko en attente | Après validation du compte, candidater à Micromania puis vérifier la présence d'un flux catalogue |
| Fnac | Programme Fnac FR sur Awin, ID 12665 ; la fiche annonce XML/CSV | Compte Publisher Awin validé ; candidature Fnac envoyée le 2026-08-10 | Après validation marchand, obtenir le flux ; conserver le vendeur Fnac obligatoire |
| Carrefour | Programme Carrefour chez Kwanko | Validation du compte Publisher Kwanko en attente | Après validation du compte, candidater à Carrefour puis obtenir le flux ; conserver le vendeur Carrefour obligatoire |
| King Jouet | Aucun programme éditeur public fiable trouvé à ce jour | Aucun accès autorisé | Utiliser uniquement le contact officiel King Jouet pour demander un flux catalogue/API partenaire ; rester fail-closed en attendant |

## Compatibilité des plateformes

Le parseur OP Watch accepte déjà CSV, TSV, JSON et XML avec les champs usuels : titre, URL, prix, stock, langue, image, vendeur, SKU/EAN/identifiant.

Des tests de compatibilité existent pour :

- Awin : colonnes cœur `product_name`, `aw_deep_link`, `search_price`, `merchant_image_url`, `in_stock`, `language`, `merchant_name`, `merchant_product_id` ;
- Kwanko : CSV personnalisé mappé vers les colonnes canoniques OP Watch ;
- Affilae : structure de flux comparateur contenant notamment nom produit, URL produit, prix, stock, image et EAN.

Affilae documente explicitement ses flux produits comme destinés principalement aux comparateurs de prix et recommande notamment EAN, nom, URL, prix, image, stock, délai de livraison et marque.

## Recette binaire avant activation d'un feed

1. URL secrète HTTPS, jamais journalisée ;
2. schéma parsé et au moins une ligne structurée ;
3. URL produit et image HTTPS ;
4. référence canonique reconnue ;
5. français confirmé ;
6. stock explicite ;
7. prix parsable ;
8. vendeur officiel confirmé pour toute marketplace ;
9. tests de régression ;
10. audit Preview sans fuite du secret.

Aucune URL de flux ne doit être inventée. L'acceptation d'un réseau ou d'un marchand n'est pas assimilée à la présence d'un flux : l'URL réelle doit être fournie par la plateforme ou le marchand et stockée comme secret GitHub/Cloudflare.

## Cas Amazon FR

Amazon ne fait pas partie des six variables `AUTHORIZED_FEED_*`. Sa voie officielle éventuelle est la Product Advertising API du Club Partenaires Amazon, soumise à un compte Partenaires, aux conditions de l'API et aux performances du compte. Pour le moment Amazon est volontairement repoussé : il reste fail-closed et ne doit pas bloquer la mise en service des autres boutiques.
