# Guild Tracker

Site statique (HTML/CSS/JS, aucune installation) qui affiche le classement, des graphiques et un comparateur de membres à partir d'un fichier CSV. L'interface est en anglais.

## Pages

- **Rankings** : classement par puissance, niveau, contribution, score d'événements ou participation, avec l'évolution depuis la semaine précédente.
- **Charts** : évolution de la guilde, top 10, top 5 dans le temps, répartition des membres.
- **Compare** : deux membres côte à côte (tableau, courbes dans le temps, radar).
- **Data** : état des données, modèle de CSV à télécharger, prévisualisation d'un fichier avant publication.

## Publier sur GitHub Pages

1. Crée un dépôt GitHub (par exemple `guild-tracker`) et envoie-y tout le contenu de ce dossier.
2. Dans le dépôt : **Settings → Pages → Build and deployment**, source **Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Après environ une minute, le site est en ligne sur `https://TON-PSEUDO.github.io/guild-tracker/`.

## Mettre à jour les données chaque semaine

Les données sont dans `data/stats.csv` : **une ligne par membre et par semaine**.

| Colonne | Contenu |
|---|---|
| `date` | date de la semaine, format `AAAA-MM-JJ` |
| `member` | pseudo du membre (toujours écrit de la même façon) |
| `role` | Leader, Officer, Member… |
| `power` | puissance |
| `level` | niveau |
| `contribution` | contribution de la semaine |
| `event_score` | score aux événements de guilde |
| `event_participation` | participation aux événements, de 0 à 100 |

Pour ajouter une semaine : sur GitHub, ouvre `data/stats.csv`, clique sur le crayon, colle les nouvelles lignes à la fin, puis **Commit changes**. Tu peux d'abord vérifier ton fichier dans l'onglet **Data** du site (les erreurs indiquent la ligne à corriger).

Les 24 membres et 8 semaines actuels sont **fictifs** : remplace le contenu de `data/stats.csv` par tes vraies données, en gardant la première ligne (les noms de colonnes).

## Personnaliser

- `js/config.js` : titre du site, chemin du CSV, affichage de la note « demo data ».
- `css/style.css` : couleurs et typographie (variables en haut du fichier).

## Tester en local

Ouvrir `index.html` directement ne marche pas (le navigateur bloque la lecture du CSV). Depuis ce dossier :

```
python3 -m http.server
```

puis ouvre http://localhost:8000.

## Notes techniques

- Graphiques : Chart.js 4 (fichier local dans `vendor/`, pas de CDN).
- Les couleurs des séries ont été validées sur le fond sombre (contraste et distinction pour les daltoniens).
