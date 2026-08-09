# Flux partenaires officiels des six boutiques protégées

État vérifié le 2026-08-09. Aucun CAPTCHA, challenge, endpoint privé ou URL supposée n'a été contourné.

| Boutique | Voie officielle trouvée | Accès actuel | Suite nécessaire |
|---|---|---|---|
| Playin | Le site officiel affiche « Devenir affilié » dans son pied de page | Page d'adhésion non récupérable sans passer la protection du site | Demander à Playin un flux catalogue autorisé ; ne pas interroger l'origine en attendant |
| Cultura | [Programme Cultura FR sur Awin, ID 113876](https://ui.awin.com/merchant-profile/113876) | Candidature Awin et validation obligatoires | Après validation, demander/activer le flux produits avec stock, prix, image et vendeur |
| Micromania | [Programme officiel Micromania](https://www.micromania.fr/affiliation.html) relayé par la [campagne Kwanko 3248](https://www.kwanko.com/fr/liste-campagnes/campagne/publisher/affiliation/Micromania/3248/) | Compte publisher Kwanko et validation obligatoires | Vérifier la présence d'un flux catalogue dans les supports autorisés |
| Fnac | [FAQ officielle](https://www.fnac.com/affiliation/faq) et [outils/flux XML ou TXT](https://www.fnac.com/affiliation/outils), via Awin ID 12665 | Compte Awin, site éditeur et validation obligatoires | Obtenir le flux ; conserver le vendeur Fnac obligatoire |
| Carrefour | [Programme Carrefour exclusif chez Kwanko](https://www.kwanko.com/fr/academy/affiliation/le-programme-daffiliation-carrefour-en-exclusivite-chez-kwanko/) depuis juin 2025 | Compte publisher Kwanko et validation obligatoires | Obtenir le flux ; conserver le vendeur Carrefour obligatoire |
| King Jouet | Aucun programme éditeur public fiable trouvé ; Cataleeze est un outil privé nécessitant autorisation | Aucun accès autorisé | Utiliser uniquement le [contact officiel King Jouet](https://www.king-jouet.com/contact.htm) pour demander un flux catalogue/API partenaire |

## Contrat d'ingestion déjà prêt

Le parseur accepte CSV, TSV, JSON et XML avec les champs usuels : titre, URL, prix, stock, langue, image, vendeur, SKU/EAN/identifiant.

Avant activation d'un feed, la recette binaire est :

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

L'inscription Awin/Kwanko implique une identité, l'acceptation de conditions et une validation externe. OP Watch ne peut ni l'effectuer automatiquement au nom du propriétaire ni transformer cette dépendance en succès technique.
