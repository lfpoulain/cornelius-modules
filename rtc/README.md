# Module Transports RTC

Le module Transports RTC donne le prochain autobus du RTC (Québec) vers une destination, à l’heure réelle quand l’autobus est en route, avec la durée du trajet et le bus suivant. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `rtc`).

## Ce que fait le module

- Il répond à « comment je vais à l’Université Laval ? » et affiche une carte « Transports RTC · à l’Université Laval » : la ligne et le délai, les passages suivants (heure réelle ou horaire prévu) et la durée du trajet. Exemple réel :

  > Pour te rendre à l’Université Laval, le prochain autobus est le 805 dans 6 minutes, à l’arrêt H.-Mercier et Saint-Joachim, à 4 minutes à pied. La durée du trajet est de 42 minutes. Correspondance avec le 804. Le bus suivant est prévu dans 20 minutes selon l’horaire.

- Les passages des autobus déjà en route sont à l’heure réelle ; ceux qui n’ont pas encore quitté leur terminus sont dits « selon l’horaire ». Si le temps réel ne répond pas, tout est dit « selon l’horaire ».
- Parmi les itinéraires proposés, le module retient celui qui arrive le plus tôt. « Le prochain » est le premier autobus qu’on peut attraper, marche jusqu’à l’arrêt comprise.
- Les données restent en cache 1 minute.

## Sources des données

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Destination et départ → coordonnées | [Transitous](https://transitous.org/api/) `v1/geocode` | Gratuit, sans jeton ; usage non commercial raisonnable, sans garantie |
| Itinéraire, ligne, arrêt, durée, horaire prévu | Transitous `v5/plan` (horaires GTFS officiels du RTC) | Idem |
| Heure réelle du passage à l’arrêt | Données de l’appli **Nomade** du RTC (`api-iv.rtcquebec.ca/api/legacy`) | Accès ouvert, sans jeton ; non documenté, peut changer sans préavis |

Le module s’identifie honnêtement (`User-Agent: Cornelius-module-rtc/1.0 (usage personnel)`), ne se fait pas passer pour l’appli Nomade, et n’interroge le RTC qu’à la demande (une question vocale), quatre lectures à la fois au plus.

## Réglages d’une source

Dans **Modules → Transports RTC → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Point de départ | Nom du départ, dit dans les réponses | « la maison » |
| Adresse du départ | Adresse, intersection ou lieu (« Place D’Youville »), cherché près du centre de Québec | vide |
| Latitude, longitude du départ | Au choix, à la place de l’adresse ; si elles sont saisies, elles passent avant | vides |
| Destinations favorites | Mot-clé dit à la voix (« travail »), formulation dans la réponse (« au travail »), adresse | aucune |

Le module ne contient aucun lieu par défaut : chaque foyer saisit le sien. **Tester** calcule le trajet vers la première destination favorite.

## Vie privée

L’adresse du départ est envoyée à Transitous pour la trouver (au plus une fois par 10 minutes) ; le départ part ensuite **arrondi à environ 100 m**. Une intersection proche est plus discrète que l’adresse exacte. Le RTC ne reçoit que des numéros de ligne, de direction, de voyage et d’autobus, jamais de position.

## Limites

- Région de Québec (latitude 46,5 à 47,2, longitude -71,8 à -70,8) ; les lieux à plus de 80 km du départ sont écartés.
- Le géocodeur de Transitous (OpenStreetMap) remplace sans prévenir une adresse qu’il ne connaît pas par une voisine d’orthographe. Le module le refuse : avec un numéro civique, le résultat doit être sur la rue demandée ; pour une intersection, il doit contenir les deux rues. Sinon : « Adresse introuvable… Essayez une intersection proche ou un lieu connu ». Sans ville dans l’adresse, une deuxième recherche ajoute « , Québec ».
- Le temps réel ne couvre que la première ligne du trajet.
- Transitous est un service communautaire sans garantie : en panne, le module répond « Transitous est indisponible ».

## Outil vocal et affichage permanent

L’outil s’appelle `rtc__trajet`. Il reçoit la destination (`query`) : un mot-clé de destination favorite, ou une adresse ou un lieu à Québec avec sa préposition (« au Château Frontenac », « à l’Université Laval »). Une destination mémorisée par Cornelius (« retiens que chez Marie c’est au 123 rue X, Québec ») lui est passée par son adresse. La description de l’outil demande de dire les trois éléments de la réponse, dans l’ordre : certains modèles vocaux ne gardaient que le premier. Ce module ne propose pas d’affichage permanent.

## Auteur

[LucQuebec](https://github.com/LucQuebec), pour [Jokobee™](https://jokobee.com).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
