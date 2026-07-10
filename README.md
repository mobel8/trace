# Trace

Suivi personnel local : habitudes, tâches, journal d'activité, historique et bilan.
Tout reste sur cette machine, dans un simple fichier JSON. Aucune dépendance npm.

## Lancer

Double-clic sur le raccourci **Trace** du Bureau (ou sur `Trace.vbs`).
Le lanceur démarre le serveur local en arrière-plan s'il ne tourne pas déjà,
puis ouvre Trace dans une fenêtre dédiée (mode application d'Edge, sans onglets).

À la main :

```
cd D:\trace
node server.js        # puis ouvrir http://127.0.0.1:47621
```

Variables d'environnement : `TRACE_PORT` (défaut 47621), `TRACE_DATA` (défaut `D:\trace\data`).

## Ce que ça fait

- **Aujourd'hui** : habitudes du jour à cocher (avec séries 🔥), tâches en retard
  et du jour, minuteur de focus, note rapide.
- **Tâches** : sections En retard / Aujourd'hui / À venir / Un jour, priorités,
  projets, échéances, terminées repliées.
- **Habitudes** : quotidiennes, jours précis ou N fois par semaine ; série en cours,
  record, taux sur 30 jours, mini-heatmap cliquable pour corriger le passé
  (cocher avant la création étend l'historique).
- **Journal** : notes horodatées avec `#tags`, sessions de focus intercalées.
- **Historique** : tout ce qui a été fait, jour par jour, filtrable et cherchable.
- **Bilan** : heatmap 6 mois, tâches par semaine, temps de focus par jour
  (bascule tableau sur chaque graphique), taux par habitude.
- **Réglages** : prénom, thème sombre/clair/auto, couleur d'accent, début de
  semaine, export/import JSON, remise à zéro.

## Raccourcis clavier

| Touche | Action |
|---|---|
| `n` | Nouvelle entrée (tâche ou note) — champ direct dans Tâches et Journal |
| `1`…`7` | Naviguer entre les vues |
| `/` | Rechercher (dans Historique) |
| `Entrée` | Valider la saisie en cours |
| `Échap` | Fermer la modale |

## Données et sauvegardes

- Base : `data/db.json` (écriture atomique : fichier temporaire puis renommage).
- Sauvegarde quotidienne automatique dans `data/backups/` (40 jours conservés),
  plus une copie avant chaque import.
- Si `db.json` est corrompu au démarrage, il est mis en quarantaine et la
  sauvegarde la plus récente est restaurée automatiquement.
- Export/Import complets depuis Réglages → Données.

## Architecture

```
server.js            serveur Node sans dépendance : statique + API JSON + persistance
public/logic.js      logique métier PURE (dates locales, réducteur d'état, séries,
                     agrégats) — partagée telle quelle entre serveur et navigateur
public/app.js        store optimiste (même réducteur), routeur hash, raccourcis
public/views/*.js    une vue par fichier ; public/charts.js : graphiques SVG maison
public/styles.css    design system complet (tokens sombre + clair, composants)
tests/               test-logic.mjs (37 asserts) · test-api.mjs (12 scénarios)
tools/make-ico.mjs   PNG → ICO (icône du raccourci)
```

Chaque modification passe par une op (`{type: 'task.create', …}`) appliquée par
le même réducteur côté client (optimiste) et côté serveur (vérité) ; toute
divergence de révision déclenche une resynchronisation.

## Tests

```
cd D:\trace
npm test    # = node tests/test-logic.mjs && node tests/test-api.mjs
```

Les tests API démarrent un vrai serveur sur un port jetable et couvrent aussi
l'arrêt brutal, la corruption du fichier et l'import/export.
