# Module Transports STO

Le module Transports STO couvre la **région de Gatineau, au Québec** : il donne le prochain départ de la STO (autobus et Rapibus) vers une destination, avec les correspondances d’OC Transpo pour aller à Ottawa, la durée du trajet et le départ suivant, à l’heure réelle quand la STO la publie. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `sto`).

## Ce que fait le module

- Il répond à « comment je vais à la Colline du Parlement ? » ou « c’est quand le prochain autobus pour le Musée canadien de l’histoire ? » et affiche une carte « Transports STO · à la Colline du Parlement ». Exemple réel :

  > Pour te rendre à la Colline du Parlement, le prochain départ est l’autobus 400 dans 6 minutes, à la station de la Gappe, à 2 minutes à pied. La durée du trajet est de 36 minutes. Le suivant est prévu dans 15 minutes.

- **Heure réelle** : Transitous reçoit le temps réel de la STO. Un passage connu en temps réel est dit sans réserve ; les autres « selon l’horaire ».
- **Réseaux** : la STO est le réseau par défaut ; une correspondance d’OC Transpo est nommée (« l’autobus 95 d’OC Transpo », « l’O-Train, ligne 1 »).
- Parmi les itinéraires proposés, le module retient celui qui arrive le plus tôt. « Le prochain » est le premier départ qu’on peut attraper, marche jusqu’à l’arrêt comprise.
- Le nom de l’arrêt est dit proprement : « à la station de la Gappe » pour « Station de la GAPPE #2 ».
- Les données restent en cache 1 minute.

## Sources des données

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Destination et départ → coordonnées | [Transitous](https://transitous.org/api/) `v1/geocode` | Gratuit, sans jeton ; usage non commercial raisonnable, sans garantie |
| Itinéraire, ligne, arrêt, durée ; passages et heure réelle | Transitous `v5/plan` et `v5/stoptimes` (horaires GTFS et temps réel de la STO, d’OC Transpo) | Idem |

Aucun jeton ni clé : rien à demander à la STO.

## Réglages d’une source

Dans **Modules → Transports STO → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Point de départ | Nom du départ, dit dans les réponses | « la maison » |
| Adresse du départ | Adresse, intersection ou station (« Station de la Gappe »), cherchée près du centre de Gatineau | vide |
| Latitude, longitude du départ | Au choix, à la place de l’adresse ; si elles sont saisies, elles passent avant | vides |
| Destinations favorites | Mot-clé dit à la voix (« travail »), formulation dans la réponse (« au travail »), adresse | aucune |

Le module ne contient aucun lieu par défaut : chaque foyer saisit le sien. **Tester** calcule le trajet vers la première destination favorite.

## Vie privée

L’adresse du départ est envoyée à Transitous pour la trouver (au plus une fois par 10 minutes) ; le départ part ensuite **arrondi à environ 100 m**. Une intersection proche est plus discrète que l’adresse exacte.

## Limites

- Région de Gatineau (latitude 45,2 à 45,9, longitude -76,4 à -75,2) ; les lieux à plus de 80 km du départ sont écartés.
- Le géocodeur de Transitous (OpenStreetMap) remplace sans prévenir une adresse qu’il ne connaît pas par une voisine d’orthographe. Le module le refuse : avec un numéro civique, le résultat doit être sur la rue demandée ; pour une intersection, il doit contenir les deux rues. Sans ville dans l’adresse, une deuxième recherche ajoute « , Gatineau ».
- Transitous est un service communautaire sans garantie : en panne, le module répond « Transitous est indisponible ».

## Outil vocal et affichage permanent

L’outil s’appelle `sto__trajet`. Il reçoit la destination (`query`) : un mot-clé de destination favorite, ou une adresse ou un lieu de la région avec sa préposition (« au Musée canadien de l’histoire », « à la station de la Gappe »). Ce module ne propose pas d’affichage permanent.

## Auteur

[LucQuebec](https://github.com/LucQuebec), pour [Jokobee™](https://jokobee.com).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
