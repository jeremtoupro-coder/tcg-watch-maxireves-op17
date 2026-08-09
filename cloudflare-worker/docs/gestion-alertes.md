# Politique des alertes OP Watch V1

Les références ne sont plus ajoutées manuellement. Le catalogue officiel français alimente automatiquement les familles OP, EB, PRB, ST, DP et TS lorsqu'une date de sortie complète est publiée.

## Conditions commerciales cumulatives

Une fiche ne peut produire une alerte que si :

- sa référence correspond exactement à un seul produit actif J-120/J+30 ;
- son format est booster, display, case, double pack ou starter deck ;
- le français est explicitement confirmé ;
- le stock est déterminé (`available`, `preorder` ou `unavailable`) ;
- ce n'est ni un accessoire ni une carte à l'unité ;
- le connecteur et la source sont sains ;
- pour une marketplace, le vendeur officiel attendu est confirmé.

La langue inconnue, le stock inconnu et toute donnée ambiguë sont fail-closed.

## Événements

| Événement | Signification |
|---|---|
| `new_listing` | Nouvelle fiche après la baseline silencieuse |
| `back_in_stock` | Retour en stock |
| `preorder_opened` | Précommande ouverte |
| `price_drop` | Baisse de prix |
| `price_increase` | Hausse de prix |
| `became_unavailable` | Produit devenu indisponible |

Si stock et prix changent dans le même relevé, OP Watch choisit un seul événement prioritaire et le message inclut le prix courant. Une transition ne génère donc pas deux messages.

## Discord

Le payload contient : boutique, produit, format, référence, prix, vendeur lorsqu'il existe, disponibilité, langue, heure Europe/Paris, image et lien d'achat.

En `dry-run`, le payload est construit sans appel réseau. En LIVE, l'état produit n'est écrit qu'après livraison réussie et écriture du reçu anti-doublon.
