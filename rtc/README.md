# Module Transports RTC

Le module Transports RTC couvre la **région de Québec** : il donne le prochain autobus du RTC (autobus, Métrobus) vers une destination, la durée du trajet et le départ suivant, selon l’horaire publié par le RTC. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `rtc`).

## Ce que fait le module

- Il répond à « comment je vais à l’Université Laval ? » ou « c’est quand le prochain autobus pour Place Laurier ? » et affiche une carte « Transports RTC · à l’Université Laval » : la ligne et le délai, les passages suivants et la durée du trajet. Exemple réel, depuis la gare du Palais :

  > Pour te rendre à l’Université Laval, le prochain départ est l’autobus 807 dans 20 minutes selon l’horaire, au terminus D’Youville, à 13 minutes à pied. La durée du trajet est de 48 minutes. Correspondance avec l’autobus 79.

- **Horaire** : les heures viennent de l’horaire du RTC repris par Transitous et sont dites « selon l’horaire ». Si Transitous reçoit un jour le temps réel du RTC, l’indicateur `realTime` est déjà lu et l’heure réelle sera dite sans changer le module.
- Parmi les itinéraires proposés, le module retient celui qui arrive le plus tôt. « Le prochain » est le premier autobus qu’on peut attraper, marche jusqu’à l’arrêt comprise.
- Le nom de l’arrêt est dit proprement : « au terminus D’Youville » pour « T. D'Youville », « H.-Mercier et Saint-Joachim » pour « H.-Mercier / Saint-Joachim ».
- Rien n’est inventé : sans durée chez Transitous, aucune durée n’est dite ; sans passage à attraper, le module le dit sans promettre de départ ; un départ suivant inconnu n’est pas dit.
- Les données restent en cache 1 minute.

La mécanique (géocodage, itinéraire, passages, phrase et carte) est commune aux modules de transport du Québec : [`_lib/transitous.ts`](../_lib/transitous.ts).

## Sources des données et licences

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Itinéraire, ligne, arrêt, durée ; passages | [Transitous](https://transitous.org), `v5/plan` et `v5/stoptimes` | [Conditions de l’API Transitous](https://transitous.org/api/) : gratuite, sans jeton, usage non commercial, avec un lien vers [ses sources](https://transitous.org/sources/) |
| Horaires du RTC, repris par Transitous | Réseau de transport de la Capitale (GTFS) | [Licence d’utilisation des données ouvertes du RTC](https://www.rtcquebec.ca/donnees-ouvertes) : mention de la provenance (Réseau de transport de la Capitale) et de la date de mise à jour ; le jeu est aussi publié sur [Données Québec](https://www.donneesquebec.ca/licence/#cc-by) sous CC BY 4.0 |
| Destination et départ → coordonnées | Transitous, `v1/geocode` | Données © les contributeurs d’[OpenStreetMap](https://www.openstreetmap.org/copyright), sous licence ODbL |

Aucun jeton ni clé : rien à demander au RTC. Le module n’interroge que Transitous.

## Réglages d’une source

Dans **Modules → Transports RTC → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Adresse du départ | Adresse, intersection ou lieu (« Gare du Palais », « boulevard Laurier et route de l’Église »), cherché près du centre de Québec | vide |
| Latitude, longitude du départ | Au choix, à la place de l’adresse ; si elles sont saisies, elles passent avant | vides |
| Destinations favorites | Mot-clé dit à la voix (« travail »), formulation dans la réponse (« au travail »), adresse | aucune |

Le module ne contient aucun lieu par défaut : chaque foyer saisit le sien. **Tester** calcule le trajet vers la première destination favorite.

## Vie privée

L’adresse du départ est envoyée à Transitous pour la trouver (au plus une fois par 10 minutes) ; le départ part ensuite **arrondi à environ 100 m**. Une intersection proche est plus discrète que l’adresse exacte.

## Limites

- Région de Québec (latitude 46,5 à 47,2, longitude -71,8 à -70,8) ; les lieux à plus de 80 km du départ sont écartés.
- Pas d’heure réelle : Transitous ne reçoit pas de temps réel ouvert du RTC.
- Le géocodeur de Transitous (OpenStreetMap) remplace sans prévenir une adresse qu’il ne connaît pas par une voisine d’orthographe. Le module le refuse : avec un numéro civique, le résultat doit être sur la rue demandée ; pour une intersection, il doit contenir les deux rues. Sans ville dans l’adresse, une deuxième recherche ajoute « , Québec ».
- Les passages suivants viennent des 30 prochains passages de l’arrêt, complétés par les départs des itinéraires : à un terminus très desservi (D’Youville), le départ suivant peut manquer, et il n’est alors pas dit.
- Transitous est un service communautaire sans garantie : en panne, le module répond « Transitous est indisponible ».

## Outil vocal et affichage permanent

L’outil s’appelle `rtc__trajet`. Il reçoit la destination (`query`) : un mot-clé de destination favorite, ou une adresse ou un lieu de la région avec sa préposition (« au Château Frontenac », « à l’Université Laval »). Ce module ne propose pas d’affichage permanent.

## Auteur

[LucQuebec](https://github.com/LucQuebec)

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json), [\_lib/transitous.ts](../_lib/transitous.ts)
