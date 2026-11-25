# Module Transports STS

Le module Transports STS couvre la **région de Sherbrooke, au Québec** : il donne le prochain autobus de la STS vers une destination, la durée du trajet et le départ suivant, selon l’horaire. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `sts`).

## Ce que fait le module

- Il répond à « comment je vais à l’Université de Sherbrooke ? » ou « c’est quand le prochain autobus pour le Cégep de Sherbrooke ? » et affiche une carte « Transports STS · au Cégep de Sherbrooke ». Exemple réel :

  > Pour te rendre au Cégep de Sherbrooke, le prochain départ est l’autobus 3 dans 4 minutes selon l’horaire, à l’arrêt King et Wellington, à 1 minute à pied. La durée du trajet est de 15 minutes. Le suivant est prévu dans 24 minutes selon l’horaire.

- **Horaire** : Transitous n’a pas de temps réel pour la STS ; les heures sont dites « selon l’horaire ». Le jour où il en aura, l’indicateur `realTime` est déjà lu et l’heure réelle sera dite sans changer le module.
- Parmi les itinéraires proposés, le module retient celui qui arrive le plus tôt. « Le prochain » est le premier départ qu’on peut attraper, marche jusqu’à l’arrêt comprise.
- Le nom de l’arrêt est dit proprement : « King et Wellington » pour « King / Wellington », « Carrefour de l’Estrie » avec l’apostrophe typographique.
- Rien n’est inventé : sans durée chez Transitous, aucune durée n’est dite ; sans passage à attraper, le module le dit sans promettre de départ.
- Les données restent en cache 1 minute.

La mécanique (géocodage, itinéraire, passages, phrase et carte) est commune aux modules de transport du Québec : [`_lib/transitous.ts`](../_lib/transitous.ts).

## Sources des données et licences

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Itinéraire, ligne, arrêt, durée ; passages | [Transitous](https://transitous.org), `v5/plan` et `v5/stoptimes` | [Conditions de l’API Transitous](https://transitous.org/api/) : gratuite, sans jeton, usage non commercial, avec un lien vers [ses sources](https://transitous.org/sources/) |
| Horaires de la STS, repris par Transitous | Société de transport de Sherbrooke (GTFS) | [Données Québec, jeu « Transport en commun » de la STS](https://www.donneesquebec.ca/recherche/fr/dataset/transport-sts) : [CC BY 4.0](https://www.donneesquebec.ca/licence/#cc-by) |
| Destination et départ → coordonnées | Transitous, `v1/geocode` | Données © les contributeurs d’[OpenStreetMap](https://www.openstreetmap.org/copyright), sous licence ODbL |

Aucun jeton ni clé : rien à demander à la STS.

## Réglages d’une source

Dans **Modules → Transports STS → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Adresse du départ | Adresse, intersection ou lieu (« Carrefour de l’Estrie », « King et Wellington »), cherché près du centre de Sherbrooke | vide |
| Latitude, longitude du départ | Au choix, à la place de l’adresse ; si elles sont saisies, elles passent avant | vides |
| Destinations favorites | Mot-clé dit à la voix (« travail »), formulation dans la réponse (« au travail »), adresse | aucune |

Le module ne contient aucun lieu par défaut : chaque foyer saisit le sien. **Tester** calcule le trajet vers la première destination favorite.

## Vie privée

L’adresse du départ est envoyée à Transitous pour la trouver (au plus une fois par 10 minutes) ; le départ part ensuite **arrondi à environ 100 m**. Une intersection proche est plus discrète que l’adresse exacte.

## Limites

- Région de Sherbrooke (latitude 45,2 à 45,6, longitude -72,2 à -71,6) ; les lieux à plus de 80 km du départ sont écartés.
- Le géocodeur de Transitous (OpenStreetMap) remplace sans prévenir une adresse qu’il ne connaît pas par une voisine d’orthographe. Le module le refuse : avec un numéro civique, le résultat doit être sur la rue demandée ; pour une intersection, il doit contenir les deux rues. Sans ville dans l’adresse, une deuxième recherche ajoute « , Sherbrooke ».
- Les passages suivants viennent des 30 prochains passages de l’arrêt : à un arrêt très desservi, le départ suivant peut manquer, et il n’est alors pas dit.
- Transitous est un service communautaire sans garantie : en panne, le module répond « Transitous est indisponible ».

## Outil vocal et affichage permanent

L’outil s’appelle `sts__trajet`. Il reçoit la destination (`query`) : un mot-clé de destination favorite, ou une adresse ou un lieu de la région avec sa préposition (« à l’Université de Sherbrooke », « au Cégep de Sherbrooke »). Ce module ne propose pas d’affichage permanent.

## Auteur

[LucQuebec](https://github.com/LucQuebec)

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json), [\_lib/transitous.ts](../_lib/transitous.ts)
