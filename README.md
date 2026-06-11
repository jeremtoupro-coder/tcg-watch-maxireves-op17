# TCG Watch Maxirêves OP17

Surveillance automatique de Maxirêves pour OP17 / OP-17, avec alertes Discord en mode stock quel que soit le prix.

Objectif actuel :

- Alerte dès qu'OP17 / OP-17 apparaît en stock ou en précommande chez Maxirêves, peu importe le prix.
- Le prix est affiché dans Discord, mais il ne bloque pas l'alerte.
- Les seuils display 130 € et case 1 560 € restent indicatifs pour décider après réception de l'alerte.
- Surveillance même MacBook éteint via GitHub Actions.
- Notification Discord via webhook.
- Polling propre toutes les 10 minutes environ.

> Important : GitHub Actions exécute les tâches planifiées en UTC et peut parfois retarder ou sauter un run en période de forte charge. C’est suffisant pour une veille boutique, mais ce n’est pas une garantie temps réel à la seconde.


---

## Mode prix

Le pack est réglé en mode :

```text
stock_any_price
```

Cela veut dire :

- si OP17 FR est détecté en stock/précommande, tu reçois une alerte même si le prix est trop haut ;
- le prix est seulement affiché pour que tu décides ;
- l'outil n'achète rien et ne remplit aucun panier.

Le réglage est dans `config/watchlist.json` :

```json
"alerting": {
  "mode": "stock_any_price",
  "ignore_price_for_stock_alerts": true
}
```

---

## 1. Contenu du pack

```text
tcg-watch-maxireves-op17/
├── .github/workflows/watch-maxireves.yml
├── config/watchlist.json
├── src/watcher.py
├── state/.gitkeep
├── .gitignore
└── README.md
```

Le script utilise uniquement la bibliothèque standard Python. Pas besoin d’installer `requests`, `bs4`, `selenium` ou Chrome.

---

## 2. Créer le webhook Discord

Tu dois avoir la permission **Manage Webhooks / Gérer les webhooks** sur ton serveur Discord.

1. Ouvre Discord.
2. Va dans ton serveur.
3. Crée un salon dédié, par exemple `#tcg-alertes`.
4. Clique sur la roue crantée du salon.
5. Va dans **Intégrations**.
6. Clique **Webhooks**.
7. Clique **Nouveau webhook**.
8. Nom conseillé : `Maxireves OP17 Watch`.
9. Vérifie que le salon sélectionné est bien `#tcg-alertes`.
10. Clique **Copier l’URL du webhook**.
11. Garde cette URL privée. Toute personne qui l’a peut poster dans ton salon.

Le webhook ressemble à :

```text
https://discord.com/api/webhooks/XXXXXXXX/YYYYYYYY
```

Ne le mets jamais dans le code. On va le mettre dans les secrets GitHub.

---

## 3. Créer le dépôt GitHub

Méthode simple depuis le site GitHub :

1. Va sur GitHub.
2. Clique **+** en haut à droite.
3. Clique **New repository**.
4. Nom : `tcg-watch-maxireves-op17`.
5. Mets le dépôt en **Private**.
6. Ne coche pas “Add a README file”, car le pack en contient déjà un.
7. Clique **Create repository**.

---

## 4. Envoyer le pack sur GitHub depuis ton MacBook

Ouvre **Terminal**.

Va dans le dossier où tu as dézippé le pack. Exemple :

```bash
cd ~/Downloads/tcg-watch-maxireves-op17
```

Vérifie Python :

```bash
python3 --version
```

Tu m’as dit être en Python 3.13.0, c’est parfait. Le script tourne aussi sur GitHub avec Python 3.13.

Initialise Git et pousse le pack :

```bash
git init
git add .
git commit -m "Initial OP17 Maxireves watcher"
git branch -M main
git remote add origin https://github.com/TON_PSEUDO_GITHUB/tcg-watch-maxireves-op17.git
git push -u origin main
```

Remplace `TON_PSEUDO_GITHUB` par ton pseudo GitHub.

Si macOS demande d’installer les outils développeur, accepte. C’est normal si Git n’était pas encore installé.

---

## 5. Ajouter le webhook Discord dans GitHub Secrets

Dans ton dépôt GitHub :

1. Clique **Settings**.
2. Dans le menu gauche, clique **Secrets and variables**.
3. Clique **Actions**.
4. Clique **New repository secret**.
5. Name : `DISCORD_WEBHOOK_URL`
6. Secret : colle l’URL du webhook Discord.
7. Clique **Add secret**.

Le nom doit être exactement :

```text
DISCORD_WEBHOOK_URL
```

---

## 6. Activer et tester GitHub Actions

1. Dans ton dépôt GitHub, clique l’onglet **Actions**.
2. Si GitHub affiche une alerte de sécurité pour les workflows, clique **I understand my workflows, go ahead and enable them**.
3. Clique sur le workflow **TCG Watch - Maxireves OP17**.
4. Clique **Run workflow**.
5. Laisse la branche sur `main`.
6. Clique le bouton vert **Run workflow**.

Après quelques secondes/minutes :

- le run doit passer en vert ;
- Discord doit recevoir une alerte si OP17 est détecté ;
- si OP17 n’est pas détecté, le run reste vert sans message d’alerte ;
- le fichier `state/watch_state.json` sera créé ou mis à jour automatiquement.

---

## 7. Tester Discord localement depuis ton Mac

Optionnel, utile pour vérifier ton webhook avant GitHub.

Dans Terminal :

```bash
cd ~/Downloads/tcg-watch-maxireves-op17
export DISCORD_WEBHOOK_URL="COLLE_TON_WEBHOOK_ICI"
python3 src/watcher.py --test-discord
```

Tu dois recevoir :

```text
✅ TCG Watcher connecté à Discord.
```

Ensuite, ferme le Terminal ou fais :

```bash
unset DISCORD_WEBHOOK_URL
```

---

## 8. Tester le watcher sans envoyer de message

```bash
python3 src/watcher.py --dry-run
```

Ça affiche ce qu’il ferait, sans poster sur Discord.

---

## 9. Configuration des seuils

Ouvre :

```text
config/watchlist.json
```

Les seuils actuels :

```json
"retail_display_price_eur": 120,
"max_display_price_eur": 130,
"case_display_count": 12,
"retail_case_price_eur": 1440,
"max_case_price_eur": 1560
```

Pour changer le prix max d’une display à 125 € :

```json
"max_display_price_eur": 125
```

Pour changer le prix max d’une case à 1 500 € :

```json
"max_case_price_eur": 1500
```

Après modification :

```bash
git add config/watchlist.json
git commit -m "Update OP17 thresholds"
git push
```

---

## 10. Ajouter OP18 ou une autre sortie plus tard

Dans `config/watchlist.json`, change :

```json
"watch_terms": ["OP17", "OP-17"]
```

Par exemple :

```json
"watch_terms": ["OP18", "OP-18"]
```

Ou surveille deux sorties :

```json
"watch_terms": ["OP17", "OP-17", "OP18", "OP-18"]
```

Puis :

```bash
git add config/watchlist.json
git commit -m "Add OP18 watch terms"
git push
```

---

## 11. Pourquoi ça ne pourrit pas ton cache navigateur

L’outil ne touche pas à ton navigateur.

Il tourne sur GitHub Actions, pas sur ton MacBook. Il fait des requêtes HTTP côté GitHub, avec son propre état dans :

```text
state/watch_state.json
```

Il utilise aussi `ETag` / `Last-Modified` quand le site les fournit, pour éviter de re-télécharger inutilement une page qui n’a pas changé.

---

## 12. Comportement anti-ban propre

Le script ne fait pas de contournement anti-bot.

Ce qu’il fait :

- 4 pages surveillées seulement ;
- environ 1 passage toutes les 10 minutes ;
- délai entre les pages ;
- user-agent explicite ;
- timeout court ;
- pas de navigateur automatisé ;
- pas de login ;
- pas de panier automatique ;
- pas de spam Discord ;
- pas de rotation IP/proxy ;
- pas de contournement CAPTCHA.

Si Maxirêves affiche un blocage ou des erreurs répétées, augmente l’intervalle dans `.github/workflows/watch-maxireves.yml`, par exemple toutes les 20 minutes :

```yaml
- cron: "7-59/20 * * * *"
```

---

## 13. Lecture des alertes Discord

### 🚨 ACHETER_MAINTENANT

OP17 FR détecté avec prix dans le seuil :

- display ≤ 130 € ;
- ou case ≤ 1 560 € ;
- et mention FR ;
- et stock/précommande potentiellement actionnable.

Avant de payer, vérifie quand même :

- langue FR explicite ;
- case scellée 12 displays si case ;
- stock réel ;
- prix total avec frais ;
- paiement protégé ;
- conditions de précommande et remboursement.

### 🟡 SURVEILLER

OP17 est détecté, mais il manque un élément :

- FR non confirmé ;
- prix non lu ;
- fiche pas actionnable ;
- sold out ;
- type produit incertain.

### 🔴 EVITER

Signal négatif fort :

- prix au-dessus du seuil ;
- langue EN/non-FR ;
- marketplace ou fiche non claire ;
- précommande hors budget.

---

## 14. Dépannage rapide

### Pas d’alerte Discord

1. Va dans GitHub → Actions.
2. Ouvre le dernier run.
3. Ouvre l’étape **Run Maxireves watcher**.
4. Regarde si `DISCORD_WEBHOOK_URL absent` apparaît.
5. Si oui, le secret est mal nommé ou absent.

Le secret doit être exactement :

```text
DISCORD_WEBHOOK_URL
```

### Workflow ne se lance pas

- Vérifie que le fichier existe : `.github/workflows/watch-maxireves.yml`
- Vérifie que le dépôt a les Actions activées.
- Lance manuellement avec **Run workflow**.

### Erreur “Permission denied” au moment du push de state

Dans GitHub :

1. Repo → **Settings**
2. **Actions**
3. **General**
4. Section **Workflow permissions**
5. Coche **Read and write permissions**
6. Sauvegarde

Le workflow contient déjà :

```yaml
permissions:
  contents: write
```

### Trop d’alertes

Supprime le fichier :

```text
state/watch_state.json
```

Puis commit/push. Ou augmente `max_alert_history`.

### Pas assez rapide

GitHub Actions n’est pas garanti à la minute exacte. Le cron est toutes les 10 minutes, mais GitHub peut retarder l’exécution. Pour du quasi-instantané, il faut un VPS ou un service de monitoring payant.

---

## 15. Commandes utiles

Lancer localement :

```bash
python3 src/watcher.py
```

Dry-run :

```bash
python3 src/watcher.py --dry-run
```

Test Discord :

```bash
export DISCORD_WEBHOOK_URL="TON_WEBHOOK"
python3 src/watcher.py --test-discord
unset DISCORD_WEBHOOK_URL
```

Voir l’état Git :

```bash
git status
```

Envoyer une modification :

```bash
git add .
git commit -m "Update watcher"
git push
```


## Alertes d'erreurs inquiétantes

Cette version envoie aussi une alerte Discord quand le watcher voit un problème qui peut mériter attention :

- **HTTP 403** : alerte immédiate, possible blocage.
- **HTTP 429** : alerte immédiate, possible rate limit.
- **HTTP 503 / timeout / erreur réseau** : pas d'alerte au premier incident isolé ; alerte après **3 erreurs consécutives** sur la même cible.
- **Toutes les pages en erreur sur le même run** : alerte globale.

Un 503 isolé sur `Recherche OP-17` reste donc traité comme un bruit temporaire. Le but est d'éviter le spam Discord tout en signalant les vrais problèmes de surveillance.
