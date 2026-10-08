# Guild Tracker

Site statique (HTML/CSS/JS, aucune installation) qui affiche le classement, des graphiques, les fiches des membres et le classement de la guilde, à partir de fichiers CSV. L'interface est en anglais.

## Pages

- **Rankings** : classement par puissance, niveau, contribution, ATK/DEF/HP/SPD, niveau d'équipement, etc. Filtre par classe, recherche par nom, évolution depuis la semaine précédente.
- **Member** (clic sur un nom) : fiche d'un membre avec sa classe, toutes ses statistiques comparées à la médiane de la guilde, et son équipement (armes, techniques, charmes).
- **Charts** : répartition des membres, top 10, membres par classe, médiane par classe, puissance selon le niveau, et évolution dans le temps dès qu'il y a deux semaines.
- **Compare** : deux membres côte à côte (tableau, radar de position dans la guilde, courbes dans le temps).
- **Guild** : étage atteint, dégâts au boss, puissance et activité de la guilde, et classement des guildes voisines.
- **Data** : fichiers chargés, valeurs à vérifier, modèles de CSV, prévisualisation d'un fichier avant publication.

## Les fichiers de données (dossier `data/`)

Chaque semaine, on **ajoute des lignes à la fin** de chaque fichier (sans toucher à la première ligne). Les dates s'écrivent `AAAA-MM-JJ`. Une cellule vide est acceptée.

| Fichier | Contenu | Obligatoire |
|---|---|---|
| `members.csv` | une ligne par membre et par semaine : `date, member, player_id, role, power, level, contribution, contribution_total, class, class_level, atk, def, hp, spd, weapon, second_hand, helmet, chestplate, boots, technique_1 à 4, charm_1 à 4` | oui |
| `guild.csv` | trois lignes par semaine (guilde au-dessus, la nôtre, guilde en dessous) : `date, guild, guild_level, members, guild_power, activeness, floor, boss_hp_remaining_pct, relation, rank, ranked_guild, ranked_floor, boss_damage_pct` | non |
| `stats.csv` | `date, member, role, power, level, contribution, event_score, event_participation` | non |

À savoir sur `stats.csv` : il ne remplace jamais `members.csv`. Il sert à ajouter les scores d'événements (les statistiques « Event score » et « Event participation » apparaissent dès qu'au moins une valeur est renseignée), et chaque écart avec `members.csv` est listé dans l'onglet **Data**. Les noms sont rapprochés d'un fichier à l'autre même s'ils sont écrits un peu différemment.

## Valeurs à vérifier

Quand les chiffres viennent d'une lecture de captures d'écran, il peut y avoir des erreurs. Le site ne corrige rien : il affiche les valeurs telles quelles, mais signale par un ⚠ (dans Rankings, sur la fiche du membre, et dans la liste de l'onglet **Data**) ce qui a l'air faux : puissance incompatible avec les PV, statistique 10 fois trop grande ou trop petite, pièce d'équipement incohérente, niveau qui baisse, nom avec un caractère inhabituel, total des puissances différent de celui de la guilde. Corrige alors le CSV et publie à nouveau.

## Publier sur GitHub Pages

1. Crée un dépôt GitHub (par exemple `guild-tracker`) et envoie-y tout le contenu de ce dossier.
2. Dans le dépôt : **Settings → Pages → Build and deployment**, source **Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Après environ une minute, le site est en ligne sur `https://TON-PSEUDO.github.io/guild-tracker/`.

## Mettre à jour chaque semaine

Sur GitHub, ouvre le fichier concerné dans `data/`, clique sur le crayon, colle les nouvelles lignes à la fin, puis **Commit changes**. Le site se republie en une minute. Tu peux d'abord vérifier un fichier avec **Data → Preview a file** : les erreurs de format indiquent la ligne à corriger.

## Personnaliser

- `js/config.js` : titre du site et chemins des trois fichiers.
- `css/style.css` : couleurs et typographie (variables en haut du fichier).

## Tester en local

Ouvrir `index.html` directement ne marche pas (le navigateur bloque la lecture des CSV). Depuis ce dossier :

```
python3 -m http.server
```

puis ouvre http://localhost:8000.

## Notes techniques

- Graphiques : Chart.js 4 (fichier local dans `vendor/`, pas de CDN).
- Les couleurs des séries ont été validées sur le fond sombre (contraste et distinction pour les daltoniens).
