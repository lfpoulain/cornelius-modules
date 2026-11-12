# Module Transports STM

Le module Transports STM couvre la **région métropolitaine de Montréal, au Québec** : il donne le prochain départ en transport en commun (métro et autobus de la STM, autobus du RTL à Longueuil, autobus et trains de banlieue d’exo, REM) vers une destination, la durée du trajet, le départ suivant et la disponibilité du réseau. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `stm`).

## Ce que fait le module

- Il répond à « comment je vais au Centre Bell ? » ou « c’est quand le prochain métro pour la station Saint-Michel ? » et affiche une carte « Transports STM · au Centre Bell » : la ligne et le délai, puis les départs suivants et la durée du trajet. Exemple réel :

  > Pour te rendre au Centre Bell, le prochain départ est le métro, ligne orange dans 1 minute selon l’horaire, à la station Berri-UQAM, à 1 minute à pied. La durée du trajet est de 11 minutes. Le suivant est prévu dans 4 minutes selon l’horaire.

- **Disponibilité du réseau** : si la STM publie un avis en cours sur la ligne du trajet (interruption, ouverture tardive, détour), il est dit à la fin : « Avis de la STM : Ce samedi 14 novembre, le service métro débutera seulement vers 9h30 sur la ligne 5 - Bleue… ». « Service normal du métro » n’est jamais dit.
- Parmi les itinéraires proposés, le module retient celui qui arrive le plus tôt. « Le prochain » est le premier départ qu’on peut attraper, marche jusqu’à la station comprise.
- **Temps réel des autobus** : avec un Cornelius qui sait lire une réponse binaire (`bytes()`, proposé après la 0.3.0), le module lit le flux temps réel de la STM (GTFS-RT) et donne l’heure réelle des autobus en route. Le métro n’y figure pas, et un autobus qui n’a pas quitté son terminus non plus : leurs heures restent celles de l’horaire, et la réponse le dit (« selon l’horaire »). Avec Cornelius 0.3.0, tout reste « selon l’horaire », sans erreur.
- Les données restent en cache 1 minute ; le flux temps réel, 30 secondes ; l’état du service, 3 minutes.

## Réseaux couverts

| Réseau | Ce que Cornelius dit | Temps réel | Avis |
| --- | --- | --- | --- |
| STM (Montréal) : métro, autobus | « le métro, ligne verte », « l’autobus 51 » | Autobus (avec `bytes()`) | Oui |
| RTL (Longueuil) | « l’autobus 8 du RTL » | Non | Non |
| exo : autobus des couronnes | « l’autobus 708 d’exo » | Selon Transitous | Non |
| exo : trains de banlieue | « le train d’exo, ligne Saint-Jérôme » | Selon Transitous | Non |
| REM | « le REM » | Non | Non |

Le lieu de départ est dit selon son genre : « à la station Berri-UQAM », « à la gare Parc », « au terminus Longueuil », « à l’arrêt … ». L’état du service et le temps réel de la STM ne valent que pour un trajet qui commence sur une ligne de la STM : un autobus 8 du RTL n’a pas les avis de la ligne 8 de la STM.

**Laval** : la STL n’est pas encore dans Transitous. À Laval, le module donne le métro (Montmorency, De la Concorde, Cartier), les autobus et les trains d’exo, mais pas les autobus de la STL.

## Sources des données

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Destination et départ → coordonnées | [Transitous](https://transitous.org/api/) `v1/geocode` | Gratuit, sans jeton ; usage non commercial raisonnable, sans garantie |
| Itinéraire, ligne, station, durée ; passages suivants | Transitous `v5/plan` et `v5/stoptimes` (horaires GTFS officiels de la STM) | Idem |
| Heure réelle des autobus | STM, temps réel GTFS-RT `gtfs-rt/ic/v2/tripUpdates` (protobuf, environ 2 Mo pour tout le réseau, sans filtre possible) | [Données ouvertes de la STM](https://www.stm.info/fr/a-propos/developpeurs) ; clé d’application ; Cornelius avec `bytes()` |
| Disponibilité du réseau | STM, état du service `i3/v1/messages/etatservice` (JSON, environ 14 ko) | [Données ouvertes de la STM](https://www.stm.info/fr/a-propos/developpeurs) ; clé d’application |

## Clé de l’état du service

Aucun jeton à demander ni à saisir. C’est la STM, l’entreprise publique de transport de Montréal, qui exige une clé pour son état du service et son temps réel : une clé **par application**, qui sert à identifier chaque application qui interroge son API, pas chaque personne. Ce n’est ni un jeton personnel ni un secret d’utilisateur. Celle de l’application « Transports STM », déclarée publique auprès de la STM, est incluse dans le module (`cle.ts`). Elle est seulement brouillée, pour échapper aux robots qui cherchent des clés en clair : ce n’est pas un secret.

L’état du service et le temps réel ne sont lus que lorsqu’une question de trajet est posée, jamais en tâche de fond, puis gardés 3 minutes et 30 secondes dans le cache de chaque installation. Le décodage du flux temps réel (protobuf) est fait par le module, sans dépendance ([gtfs-rt.ts](gtfs-rt.ts)), pour les seuls voyages de l’arrêt. Clé refusée, quota atteint ou STM injoignable : la réponse reste celle de l’horaire, sans avis.

## Réglages d’une source

Dans **Modules → Transports STM → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Point de départ | Nom du départ, dit dans les réponses | « la maison » |
| Adresse du départ | Adresse, intersection ou station (« Berri-UQAM », « Saint-Denis et Mont-Royal »), cherchée près du centre de Montréal | vide |
| Latitude, longitude du départ | Au choix, à la place de l’adresse ; si elles sont saisies, elles passent avant | vides |
| Destinations favorites | Mot-clé dit à la voix (« travail »), formulation dans la réponse (« au travail »), adresse | aucune |

Le module ne contient aucun lieu par défaut : chaque foyer saisit le sien. **Tester** calcule le trajet vers la première destination favorite.

## Vie privée

L’adresse du départ est envoyée à Transitous pour la trouver (au plus une fois par 10 minutes) ; le départ part ensuite **arrondi à environ 100 m**. Une intersection proche est plus discrète que l’adresse exacte. Les coordonnées saisies partent elles aussi arrondies.

## Limites

- Région métropolitaine de Montréal et ses couronnes (latitude 45,0 à 46,1, longitude -74,6 à -72,9) ; les lieux à plus de 80 km du départ sont écartés.
- Le géocodeur de Transitous (OpenStreetMap) remplace sans prévenir une adresse qu’il ne connaît pas par une voisine d’orthographe (« 1500 rue Berri » → « 1500 rue Serre »). Le module le refuse : avec un numéro civique, le résultat doit être sur la rue demandée ; pour une intersection, il doit contenir les deux rues. Sinon : « Adresse introuvable… Essayez une intersection proche ou un lieu connu ».
- Sans ville dans l’adresse, une deuxième recherche ajoute « , Montréal ».
- Transitous est un service communautaire sans garantie : en panne, le module répond « Transitous est indisponible ».

## Outil vocal et affichage permanent

L’outil s’appelle `stm__trajet`. Il reçoit la destination (`query`) : un mot-clé de destination favorite, ou une adresse ou un lieu à Montréal avec sa préposition (« au Centre Bell », « à l’Université de Montréal »). Une destination mémorisée par Cornelius (« retiens que chez Marie c’est au 123 rue X, Montréal ») lui est passée par son adresse. Ce module ne propose pas d’affichage permanent.

## Auteur

[LucQuebec](https://github.com/LucQuebec), pour [Jokobee™](https://jokobee.com).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
