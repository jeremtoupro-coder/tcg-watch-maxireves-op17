# Hotfix Parkage + E.Leclerc — 2026-08-10

## Parkage

Le faux catalogue vide venait de la page catégorie Next.js : les cartes produits sont hydratées côté navigateur et ne sont pas présentes comme liens produit dans l'HTML initial.

Le connecteur utilise désormais en lecture seule l'API catalogue publique appelée par le frontend Parkage : catégorie One Piece Card Game `9883`, filtre `lang=fr`, 50 premiers résultats triés par pertinence. Aucun cookie, token ou contournement anti-bot n'est utilisé.

Audit SAFE Preview réel validé sur le run `31411708598` :

- runtime `healthy`
- source `public_structured_feed`
- 47 produits reconnus
- 47/47 `Français confirmé`
- 47/47 avec prix
- 47/47 avec disponibilité connue
- 47/47 commercialement admissibles avant filtre calendrier/format
- références observées : EB-02, EB-03, EB-04, OP-09, OP-11, OP-12, OP-13, OP-15, OP-16, ST-13, ST-16, ST-29, ST-30, ST-31, ST-32, ST-33, ST-34, ST-35, ST-36

Exemples retournés directement par l'API publique pendant le diagnostic : ST-33 FR à 19 € stock 11, ST-34 FR à 20 € stock 27, ST-35 FR à 20 € stock 37, ST-36 FR à 19 € stock 27.

## E.Leclerc

Le vendeur n'est plus un critère bloquant propre à OP Watch. Une offre peut être commercialement admissible si les autres critères (référence, FR, disponibilité, format/calendrier) sont confirmés.

- vendeur connu : Discord affiche le vendeur réel ;
- vendeur absent : Discord affiche `Vendeur non confirmé (Marketplace E.Leclerc)` ;
- OP Watch ne prétend jamais qu'une offre est vendue par E.Leclerc sans preuve.

Audit SAFE Preview réel sur le même run :

- runtime `healthy`
- 7 produits détectés
- 3 produits FR commercialement admissibles
- aucune exigence `requiredSellerPatterns` sur le connecteur E.Leclerc

## Validation avant production

Run CI / Preview : `31411708598`.

- TypeScript : PASS
- tests : PASS
- Wrangler dry-run : PASS
- audit réel 21 boutiques : PASS
- cadence isolée : 1 Discovery + 14 Fast Watch : PASS
- budget projeté : 6 939,45 GB-s/j
- garde interne : 9 000 GB-s/j
- plafond test gratuit : 13 000 GB-s/j
- marge jusqu'au plafond test : 46,62 %
- requêtes Durable Objects projetées : 20 352/j sur plafond test 100 000/j

La production doit être redéployée via le workflow manuel de production avant de considérer ce hotfix LIVE.
