# Simulation d'un changement réel

Cette opération lit une fiche française Oupi réellement enregistrée dans Cloudflare KV, simule son passage de `unavailable` à `available`, puis vérifie :

- la détection `back_in_stock` ;
- la correspondance avec une règle d'alerte ;
- la création d'un message Discord ;
- zéro envoi réseau Discord ;
- zéro écriture ou modification dans KV.
