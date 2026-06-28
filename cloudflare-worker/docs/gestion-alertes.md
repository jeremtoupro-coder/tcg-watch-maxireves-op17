# Gérer les alertes sans modifier le moteur

Toutes les références et règles se trouvent dans :

```text
cloudflare-worker/config/alerts.json
```

Le fichier est contrôlé automatiquement par les tests et par `alerts.schema.json`.

## Désactiver temporairement une alerte

Repérer la règle dans `alerts`, puis passer :

```json
"enabled": false
```

La règle reste dans le fichier et peut être réactivée plus tard.

## Ne plus surveiller complètement une référence

Dans `products`, passer le produit à :

```json
"enabled": false
```

Le moteur ne cherchera plus ses alias dans les pages des boutiques.

## Ajouter une nouvelle référence

Exemple pour OP19 :

```json
{
  "id": "OP19",
  "label": "One Piece Card Game OP19",
  "enabled": true,
  "aliases": ["OP19", "OP-19", "OP 19"]
}
```

Ensuite, au choix :

1. ajouter `OP19` à la liste `productIds` d'une règle existante ;
2. créer une nouvelle règle dédiée.

Exemple de règle dédiée :

```json
{
  "id": "op19-fr-stock",
  "label": "OP19 français disponible",
  "enabled": true,
  "productIds": ["OP19"],
  "stores": ["*"],
  "languages": ["Français confirmé", "Langue non précisée"],
  "events": ["back_in_stock", "preorder_opened"],
  "availabilities": ["available", "preorder"],
  "notifyOnInitialDiscovery": false
}
```

## Limiter une alerte à certaines boutiques

Toutes les boutiques :

```json
"stores": ["*"]
```

Une sélection :

```json
"stores": ["maxireves", "oupi"]
```

Valeurs disponibles :

- `maxireves`
- `ludotrotter`
- `oupi`
- `fantasy-sphere`

## Limiter une alerte par langue

Français confirmé, avec tolérance lorsque le site ne précise pas la langue :

```json
"languages": ["Français confirmé", "Langue non précisée"]
```

Toutes les langues :

```json
"languages": ["*"]
```

## Limiter une alerte par prix

Le prix est exprimé en centimes. Exemple : ne pas alerter au-dessus de 130 € :

```json
"maxPriceCents": 13000
```

Il suffit de supprimer la propriété pour ne fixer aucune limite.

## Événements disponibles

| Événement | Signification |
|---|---|
| `new_listing` | Nouvelle fiche jamais vue auparavant |
| `back_in_stock` | Produit auparavant indisponible, désormais en stock |
| `preorder_opened` | Passage en précommande |
| `price_drop` | Baisse du prix détecté |
| `price_increase` | Hausse du prix détecté |
| `became_unavailable` | Produit devenu indisponible |
| `details_changed` | Titre, langue ou références modifiés |

## Première mise en service

La configuration actuelle utilise :

```json
"notifyOnInitialDiscovery": false
```

La première collecte constitue donc une base silencieuse. Les fiches déjà existantes ne déclenchent pas une pluie d'alertes au démarrage.

## Sécurité Discord

Tant que `DISCORD_MODE` vaut `dry-run`, les messages sont seulement construits et visibles dans le rapport. Aucun appel au webhook n'est effectué.

## Vérification automatique

Chaque modification du fichier déclenche :

```text
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

Une référence inconnue, un identifiant dupliqué ou une règle incomplète fait échouer le contrôle avant tout déploiement.
