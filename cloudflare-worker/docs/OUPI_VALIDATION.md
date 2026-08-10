# Oupi — validation SAFE du connecteur

Date de validation : 2026-08-09

## Verdict

Le cas Oupi est validé en SAFE_PREVIEW pour l'accès HTTP depuis Cloudflare, la découverte des fiches publiques, la langue FR et l'état de stock. Le moteur ne doit jamais utiliser une carte de catégorie comme source finale de disponibilité : la fiche produit directe est la source de vérité.

## Problème initial

Un audit exécuté directement depuis un runner GitHub recevait HTTP 403 sur Oupi. Cela ne signifiait pas que le site nécessitait un navigateur ou un service payant.

Un probe exécuté depuis le vrai runtime Cloudflare Worker a montré un comportement dépendant du profil HTTP :

- User-Agent explicite `OPWatch/1.0 (+personal read-only stock monitor)` : HTTP 200.
- User-Agent imitant Chrome / Mozilla : HTTP 403.

La solution retenue n'essaie donc pas d'imiter un navigateur. Elle utilise un User-Agent honnête et stable et des requêtes HTTP simples.

## Sources publiques surveillées

- `https://oupi.eu/fr/413-precommande-one-piece?q=Langue-Fran%C3%A7ais`
- `https://oupi.eu/fr/414-display-one-piece`
- `https://oupi.eu/fr/513-case-scelle-de-display`
- `https://oupi.eu/fr/415-starter-deck-one-piece`
- `https://oupi.eu/fr/417-collection-pack-speciaux-one-piece`

Ces pages servent à découvrir les URLs de produits. Les fiches produits découvertes sont ensuite relues directement avant de déterminer langue et disponibilité.

## Faux positif de stock découvert puis corrigé

Lors d'un audit réel, une carte de catégorie pouvait faire apparaître une case OP17 comme disponible à cause de texte / boutons voisins alors que sa fiche produit directe affichait `Rupture de stock`.

Correction :

1. découverte depuis les catégories ;
2. suivi de l'URL produit publique découverte ;
3. lecture de la fiche produit directe ;
4. priorité absolue de la fiche directe dans le scoring ;
5. une erreur HTTP sur la fiche ne devient jamais `unavailable` ni `available` : la source est marquée en erreur / dégradée.

## Faux positif de langue découvert puis corrigé

La fiche Oupi d'une case OP17 FR contient une phrase descriptive mentionnant `Anglais`, alors que :

- son titre indique Français ;
- son résumé indique Français ;
- sa fiche technique indique `Langue : Français` ;
- la page contient aussi des produits liés en anglais.

Une recherche naïve du mot `Anglais` sur une grande portion de page classait donc à tort le produit en anglais.

Correction :

1. priorité au champ structuré `Langue / Language` de la fiche ;
2. à défaut, priorité au titre + URL du produit ;
3. le contexte élargi n'est qu'un fallback ;
4. la zone des produits liés est exclue de l'analyse principale de la fiche.

Un test de régression reproduit explicitement le texte contradictoire et vérifie que la fiche reste `Français confirmé`.

## Validation runtime finale

Une validation indépendante a interrogé le Worker Cloudflare réellement déployé et a exigé que les assertions suivantes réussissent toutes. Résultat :

```json
{
  "result": "OUPI_DIRECT_PAGE_TRUTH_VALIDATED",
  "categories200": 5,
  "display": {
    "availability": "unavailable",
    "direct": true
  },
  "case": {
    "availability": "unavailable",
    "direct": true
  },
  "englishMisclassified": 0,
  "totalSources": 11,
  "totalCandidates": 12
}
```

Cela signifie :

- les 5 catégories configurées répondent HTTP 200 depuis Cloudflare ;
- le display OP17 FR est découvert puis relu sur sa fiche directe ;
- la case OP17 FR est découverte puis relue sur sa fiche directe ;
- les deux sont correctement classés `unavailable`, conformément aux fiches publiques au moment du test ;
- aucun produit explicitement anglais n'est classé FR pendant cette validation ;
- aucune source HTTP dégradée n'est tolérée par le test final.

Workflow indépendant : `Oupi Runtime Validation`, run `31305049762`, job `93223929255`, conclusion `success`.

## Politique anti-faux-positif

Pour Oupi :

- HTTP 403 / 429 / 5xx / timeout = source dégradée, jamais changement de stock ;
- catégorie = découverte, pas vérité finale de stock ;
- fiche directe = vérité de stock et langue ;
- produit FR ambigu = pas d'alerte commerciale ;
- les URLs découvertes restent limitées au même host Oupi ;
- le nombre de fiches suivies par cycle de découverte est plafonné.

## Prix : point encore à surveiller avant LIVE

Des écarts de prix ont été observés entre certaines cartes de catégorie et les fiches directes. Tant qu'un produit est en rupture, le moteur n'expose volontairement pas un prix de catégorie comme prix fiable. Lorsqu'une fiche devient réellement commandable, le prix utilisé doit provenir de la fiche produit directe.

Le code suit déjà cette architecture. Une validation en situation réelle de retour en stock / ouverture de précommande reste souhaitable avant de considérer le prix Oupi comme validé pour le LIVE.

## Statut

- Accès Cloudflare → Oupi : VALIDÉ.
- WAF / User-Agent : VALIDÉ avec profil honnête OPWatch.
- Découverte des URLs : VALIDÉE.
- Relecture fiche directe : VALIDÉE.
- Stock OP17 display + case : VALIDÉ contre les fiches réelles du moment.
- Langue FR / contamination EN : VALIDÉE.
- Gestion HTTP 403 : VALIDÉE en erreur de source, jamais faux stock.
- Prix en futur état disponible : architecture correcte, observation réelle encore à faire avant LIVE.

**OUPI SAFE CONNECTOR: VALIDATED.**
