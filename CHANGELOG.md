# Historique des changements

Cette page retrace les modules ajoutés et modifiés, du plus récent au plus ancien. Chaque module suit sa propre `version`, indiquée entre parenthèses.

## Non publié

### 2026-10-31 : module Dépenses OpenAI

**Ajouté**

- Module **Dépenses OpenAI** (`depenses_openai`, 1.0.0) : dépenses du mois, du jour et des 7 derniers jours lues par l’API des coûts de l’organisation (clé Admin, en lecture seule si OpenAI le propose), avec les usages les plus chers et une alerte de budget à 80 % et 100 %, sur la carte comme sur l’affichage permanent. Les avoirs sont déduits ; « rien de publié pour l’instant » pour une journée sans montant ; un relevé repris après une panne est daté. Mois et jour suivent le fuseau du foyer, rapprochés des journées UTC d’OpenAI. Auteur : tigul_one.

### 2026-10-29 : licence MIT

**Modifié**

- Le dépôt passe de la PolyForm Noncommercial License 1.0.0 à la licence MIT : usage commercial permis pour tous, auteurs compris. Les contributeurs gardent leurs droits ; la clause qui autorisait les auteurs de Cornelius à redistribuer les contributions sous d’autres conditions disparaît. Cornelius reste sous PolyForm Noncommercial.
- La fiche du gabarit gagne une section « Auteur ».

### 2026-10-20 : passage à Cornelius 0.2.0

**Modifié**

- Tous les modules (1.1.0) demandent Cornelius 0.2.0 et s’y présentent avec leur nom, leur description, leur icône et leur phrase vocale (`display`). Jours et heures suivent le fuseau du foyer (`CORNELIUS_TIMEZONE`), et non plus Paris en dur.
- **Poubelles** : les bacs forment une liste, un bac et ses jours par ligne, encombrants compris ; les sources déjà réglées sont reprises (`configVersion` 2). Sur le miroir, « Ce soir » apparaît à 17 h, et le ramassage suivant à midi et à minuit, sans attendre.
- **Agenda** : précisions à la voix (« et samedi ? », « la semaine prochaine ? ») par les arguments `debut` et `jours` ; « Agenda incomplet » quand le fichier dépasse 8 Mo ; l’affichage permanent suit le début et la fin des rendez-vous ; les liens qui redirigent (iCloud) sont suivis.
- **Prix des carburants** : carburant principal en liste déroulante, avec « Tous » ; « et le SP98 ? » à la voix (argument `carburant`), avec « Pas de sans-plomb 98 à cette station. » s’il manque ; carte « Aucun prix » pour une station qui n’en publie pas.
- **Vacances et jours fériés** : zone et jours fériés en listes déroulantes ; calendrier relu toutes les 12 heures ; l’affichage permanent change de jour à minuit.
- **Vélos en libre-service** : les fichiers d’un réseau sont partagés entre ses stations et la recherche (`cacheMs`) ; plusieurs sources ne multiplient pas les requêtes.
- **Éphéméride** : sélection relue à minuit, dans le fuseau du foyer.
- **Titres de l’actualité** et **YouTube** : les flux qui redirigent et ceux qui ne sont pas en UTF-8 sont lus ; le User-Agent est celui de Cornelius.
- `_lib/temps.ts` : jour civil, minuit suivant et heure murale dans le fuseau du foyer, changements d’heure compris.
- Gabarit, tutoriel et tests : `display`, `minCoreVersion: '0.2.0'`, tests écrits avec `createTestModule`.

### 2026-10-20

**Ajouté**

- Module **Agenda** (`agenda`, 1.0.0) : les prochains rendez-vous d’un agenda partagé par son lien iCal privé ; fuseaux, journées entières, répétitions, exceptions et annulations.
- Module **Vélos en libre-service** (`velos`, 1.0.0) : vélos et places libres d’une station, dans les réseaux GBFS 2.x et 3.0 ; réseau choisi par ville, station par nom, sans jeton.
- Module **Prix des carburants** (`carburants`, 1.0.0) : les prix d’une station d’après le flux officiel du ministère, recherche de la station par commune ou code postal, sans jeton.
- Module **Titres de l’actualité** (`actu`, 1.0.0) : les premiers titres d’un flux RSS ou Atom choisi, dans l’ordre du journal, sans jeton.
- Module **Éphéméride** (`ephemeride`, 1.0.0) : ce qui s’est passé un jour comme aujourd’hui, d’après la sélection de Wikipédia en français, l’anniversaire le plus rond d’abord.
- Module **YouTube** (`youtube`, 1.0.0) : la dernière vidéo d’une chaîne par son flux public, Shorts compris ou non, sans jeton.
- `_lib/flux.ts` : lecture des flux RSS et Atom, partagée par les modules du dépôt.
- Module **Poubelles** (`poubelles`, 1.0.0) : quel bac sortir et quand, d’après le calendrier de ramassage écrit en toutes lettres (« mercredi semaines paires », « dernier vendredi du mois »), rappel la veille au soir, sans réseau.
- Module **Vacances et jours fériés** (`vacances`, 1.0.0) : vacances scolaires des zones A, B, C et de la Corse, prochain jour férié de métropole ou d’Alsace-Moselle, sans jeton.
- Le dépôt : gabarit `_template`, tutoriel [Créer un module](docs/creer-un-module.md), commandes `test`, `check` et `format` qui utilisent les outils du Cornelius voisin.
